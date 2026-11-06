//! Real PTY tests; the fixture is this test binary, with no external shell or model dependency.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, IsTerminal, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[test]
fn terminal_fixture() {
    if std::env::var("OVERDARE_PTY_FIXTURE").as_deref() != Ok("1") {
        return;
    }
    if std::env::var_os("OVERDARE_GRANDCHILD_PID_FILE").is_some() {
        let _grandchild = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "terminal_grandchild_fixture", "--nocapture"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
    }
    println!("PTY_READY tty={}", std::io::stdout().is_terminal());
    std::io::stdout().flush().unwrap();
    let mut line = String::new();
    std::io::stdin().read_line(&mut line).unwrap();
    println!("PTY_ECHO:{}", line.trim());
    std::io::stdout().flush().unwrap();
}

#[test]
fn terminal_grandchild_fixture() {
    let Some(path) = std::env::var_os("OVERDARE_GRANDCHILD_PID_FILE") else {
        return;
    };
    std::fs::write(path, std::process::id().to_string()).unwrap();
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[cfg(windows)]
#[test]
fn forced_helper_termination_kills_its_entire_process_tree() {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
    let file = std::env::temp_dir().join(format!(
        "overdare-terminal-grandchild-{}.pid",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&file);
    let mut child = Command::new(env!("CARGO_BIN_EXE_overdare-terminal"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut env: std::collections::HashMap<String, String> = std::env::vars().collect();
    env.insert("OVERDARE_PTY_FIXTURE".to_string(), "1".to_string());
    env.insert(
        "OVERDARE_GRANDCHILD_PID_FILE".to_string(),
        file.to_string_lossy().to_string(),
    );
    let mut input = child.stdin.take().unwrap();
    writeln!(input, "{}", json!({"program": std::env::current_exe().unwrap(), "args": ["--exact", "terminal_fixture", "--nocapture"],
        "cwd": std::env::current_dir().unwrap(), "env": env, "cols": 90, "rows": 25})).unwrap();
    input.flush().unwrap();
    let stdout = child.stdout.take().unwrap();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if event["type"] == "output" {
                let bytes = STANDARD.decode(event["data"].as_str().unwrap()).unwrap();
                if bytes.windows(4).any(|window| window == b"\x1b[6n") {
                    let _ = writeln!(
                        input,
                        "{}",
                        json!({"type": "input", "data": STANDARD.encode("\x1b[1;1R")})
                    );
                    let _ = input.flush();
                }
            }
        }
    });
    for _ in 0..200 {
        if file.exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let pid: u32 = std::fs::read_to_string(&file)
        .expect("grandchild must start")
        .parse()
        .unwrap();
    unsafe {
        let handle = OpenProcess(0x00100000, 0, pid); // SYNCHRONIZE
        assert!(!handle.is_null());
        child.kill().unwrap();
        child.wait().unwrap();
        let result = WaitForSingleObject(handle, 5000);
        CloseHandle(handle);
        assert_eq!(result, 0, "grandchild survived forced helper termination");
    }
    let _ = std::fs::remove_file(file);
}

#[test]
fn native_pty_accepts_utf8_input_resize_and_reports_exit() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_overdare-terminal"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut env: std::collections::HashMap<String, String> = std::env::vars().collect();
    env.insert("OVERDARE_PTY_FIXTURE".to_string(), "1".to_string());
    writeln!(input, "{}", json!({"program": std::env::current_exe().unwrap(), "args": ["--exact", "terminal_fixture", "--nocapture"],
        "cwd": std::env::current_dir().unwrap(), "env": env, "cols": 90, "rows": 25})).unwrap();
    input.flush().unwrap();
    let stdout = child.stdout.take().unwrap();
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if send.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    let mut transcript = Vec::new();
    let mut sent = false;
    let result = (|| {
        loop {
            let line = receive
                .recv_timeout(Duration::from_secs(20))
                .expect("terminal event timeout");
            let event: Value = serde_json::from_str(&line).unwrap();
            if event["type"] == "error" {
                panic!("PTY error: {event}");
            }
            if event["type"] == "output" {
                let bytes = STANDARD.decode(event["data"].as_str().unwrap()).unwrap();
                // ConPTY asks the terminal frontend for its initial cursor position.
                if bytes.windows(4).any(|window| window == b"\x1b[6n") {
                    writeln!(
                        input,
                        "{}",
                        json!({"type": "input", "data": STANDARD.encode("\x1b[1;1R")})
                    )
                    .unwrap();
                    input.flush().unwrap();
                }
                transcript.extend(bytes);
                if !sent && String::from_utf8_lossy(&transcript).contains("PTY_READY tty=true") {
                    writeln!(
                        input,
                        "{}",
                        json!({"type": "resize", "cols": 110, "rows": 30})
                    )
                    .unwrap();
                    writeln!(
                        input,
                        "{}",
                        json!({"type": "input", "data": STANDARD.encode("Studio 한글\r\n")})
                    )
                    .unwrap();
                    input.flush().unwrap();
                    sent = true;
                }
            }
            if event["type"] == "exit" {
                assert_eq!(event["code"], 0);
                break;
            }
        }
        assert!(sent, "fixture was not in a terminal");
        assert!(
            String::from_utf8_lossy(&transcript).contains("PTY_ECHO:Studio 한글"),
            "{}",
            String::from_utf8_lossy(&transcript)
        );
    })();
    let _ = child.kill();
    let _ = child.wait();
    result
}
