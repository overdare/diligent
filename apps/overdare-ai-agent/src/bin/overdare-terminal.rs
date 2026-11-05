//! Private stdio PTY bridge. No terminal content is logged or sent to monitoring.
use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, BufRead, Read, Write};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

#[derive(Deserialize)]
struct Launch {
    program: String,
    args: Vec<String>,
    cwd: String,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
}

enum Event {
    Control(Value),
    Output(Vec<u8>),
    OutputClosed,
    InputClosed,
}

struct ManagedChild(Box<dyn portable_pty::Child + Send + Sync>);
impl std::ops::Deref for ManagedChild {
    type Target = dyn portable_pty::Child + Send + Sync;
    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}
impl std::ops::DerefMut for ManagedChild {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.0.as_mut()
    }
}
impl Drop for ManagedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn emit(message: Value) -> Result<(), String> {
    let stdout = io::stdout();
    let mut out = stdout.lock();
    writeln!(out, "{message}")
        .and_then(|_| out.flush())
        .map_err(|e| e.to_string())
}

fn size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(2..=300).contains(&rows) {
        return Err("Terminal size must be 2..500 columns and 2..300 rows".to_string());
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn run() -> Result<(), String> {
    let mut input = io::stdin().lock();
    let mut first = String::new();
    input.read_line(&mut first).map_err(|e| e.to_string())?;
    if first.len() > 1024 * 1024 {
        return Err("Launch configuration is too large".to_string());
    }
    let launch: Launch =
        serde_json::from_str(&first).map_err(|e| format!("Invalid launch configuration: {e}"))?;
    drop(input);
    let pair = native_pty_system()
        .openpty(size(launch.cols, launch.rows)?)
        .map_err(|e| format!("Cannot open PTY: {e}"))?;
    let mut command = CommandBuilder::new(&launch.program);
    command.args(&launch.args);
    command.cwd(&launch.cwd);
    command.env_clear();
    for (key, value) in launch.env {
        command.env(key, value);
    }
    let mut child = ManagedChild(
        pair.slave
            .spawn_command(command)
            .map_err(|e| format!("Cannot start terminal process: {e}"))?,
    );
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let (send, receive) = mpsc::sync_channel(32);
    let output = send.clone();
    std::thread::spawn(move || {
        let mut bytes = [0u8; 8192];
        loop {
            match reader.read(&mut bytes) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if output.send(Event::Output(bytes[..count].to_vec())).is_err() {
                        return;
                    }
                }
            }
        }
        let _ = output.send(Event::OutputClosed);
    });
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if line.len() > 1024 * 1024 {
                break;
            }
            let Ok(value) = serde_json::from_str(&line) else {
                break;
            };
            if send.send(Event::Control(value)).is_err() {
                return;
            }
        }
        let _ = send.send(Event::InputClosed);
    });
    emit(json!({"type": "ready", "pid": child.process_id()}))?;
    let mut exited = None;
    let mut output_closed = false;
    loop {
        match receive.recv_timeout(Duration::from_millis(25)) {
            Ok(Event::Output(bytes)) => {
                if emit(json!({"type": "output", "data": STANDARD.encode(bytes)})).is_err() {
                    break;
                }
            }
            Ok(Event::OutputClosed) => output_closed = true,
            Ok(Event::InputClosed) => break,
            Ok(Event::Control(value)) => match value["type"].as_str() {
                Some("input") => {
                    let data = value["data"].as_str().ok_or("Input needs base64 data")?;
                    let bytes = STANDARD
                        .decode(data)
                        .map_err(|_| "Invalid input encoding")?;
                    if writer
                        .write_all(&bytes)
                        .and_then(|_| writer.flush())
                        .is_err()
                    {
                        break;
                    }
                }
                Some("resize") => {
                    let cols = value["cols"]
                        .as_u64()
                        .and_then(|n| u16::try_from(n).ok())
                        .ok_or("Invalid columns")?;
                    let rows = value["rows"]
                        .as_u64()
                        .and_then(|n| u16::try_from(n).ok())
                        .ok_or("Invalid rows")?;
                    pair.master
                        .resize(size(cols, rows)?)
                        .map_err(|e| e.to_string())?;
                }
                Some("stop") => break,
                _ => return Err("Unknown terminal control message".to_string()),
            },
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        if exited.is_none() {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                exited = Some((status.exit_code(), Instant::now()));
            }
        }
        if let Some((code, at)) = exited {
            if output_closed || at.elapsed() > Duration::from_secs(2) {
                emit(json!({"type": "exit", "code": code}))?;
                return Ok(());
            }
        }
    }
    let _ = child.kill();
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = emit(json!({"type": "exit", "code": status.exit_code()}));
    Ok(())
}

#[cfg(windows)]
struct ProcessJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl ProcessJob {
    fn attach(pid: Option<u32>) -> Result<Self, String> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::*;
        use windows_sys::Win32::System::Threading::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(format!(
                    "Cannot create terminal process job: {}",
                    io::Error::last_os_error()
                ));
            }
            let job = Self(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
            {
                return Err(format!(
                    "Cannot configure terminal process job: {}",
                    io::Error::last_os_error()
                ));
            }
            let process = OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE,
                0,
                pid.ok_or("Missing terminal process id")?,
            );
            if process.is_null() {
                return Err(format!(
                    "Cannot open terminal process: {}",
                    io::Error::last_os_error()
                ));
            }
            let assigned = AssignProcessToJobObject(handle, process);
            let error = io::Error::last_os_error();
            CloseHandle(process);
            if assigned == 0 {
                return Err(format!("Cannot attach terminal process job: {error}"));
            }
            Ok(job)
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

fn main() {
    // Assign the host before creating any child, so every descendant inherits the job.
    // Keep its non-inheritable handle through the final protocol response.
    #[cfg(windows)]
    let _job = match ProcessJob::attach(Some(std::process::id())) {
        Ok(job) => job,
        Err(message) => {
            let _ = emit(json!({"type": "error", "message": message}));
            std::process::exit(1);
        }
    };
    if let Err(message) = run() {
        let _ = emit(json!({"type": "error", "message": message}));
        std::process::exit(1);
    }
}
