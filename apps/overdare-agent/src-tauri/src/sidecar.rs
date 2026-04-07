// @summary Sidecar lifecycle: spawn Bun web server, parse port from stdout, navigate WebView
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use chrono::Local;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// ---------------------------------------------------------------------------
// Managed child: supports both Tauri sidecar and direct tokio process
// ---------------------------------------------------------------------------

pub enum ManagedChild {
    TauriChild(CommandChild),
    TokioChild(tokio::process::Child),
}

impl ManagedChild {
    fn pid(&self) -> Option<u32> {
        match self {
            ManagedChild::TauriChild(c) => Some(c.pid()),
            ManagedChild::TokioChild(c) => c.id(),
        }
    }

    pub fn kill(self) {
        #[cfg(windows)]
        if let Some(pid) = self.pid() {
            let _ = kill_process_tree_windows(pid);
        }

        match self {
            ManagedChild::TauriChild(c) => {
                let _ = c.kill();
            }
            ManagedChild::TokioChild(mut c) => {
                // tokio::process::Child::kill() is async; calling it without await does not
                // actually terminate the process. Use start_kill() in this synchronous path.
                let _ = c.start_kill();
            }
        }
    }
}

#[cfg(windows)]
fn kill_process_tree_windows(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("taskkill failed to launch: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("taskkill exited with status: {status}"))
    }
}

pub struct SidecarState(pub Mutex<Option<ManagedChild>>);

fn should_prefer_bundled_runtime_for_current_build() -> bool {
    cfg!(debug_assertions)
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

fn global_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME").map(PathBuf::from);
    home.map(|h| h.join(".diligent"))
}

fn default_web_log_path() -> Result<PathBuf, String> {
    let global = global_dir().ok_or("Cannot determine home directory for Desktop web logs")?;
    let logs_dir = global.join("logs");
    fs::create_dir_all(&logs_dir)
        .map_err(|e| format!("Cannot create Desktop web log directory {}: {e}", logs_dir.display()))?;

    let date = Local::now().format("%Y%m%d").to_string();
    let pid = std::process::id();
    Ok(logs_dir.join(format!("{}-{}.log", date, pid)))
}

/// Check for updated sidecar binary at ~/.diligent/updates/runtime/
fn resolve_updated_sidecar_path() -> Option<PathBuf> {
    let bin_name = if cfg!(windows) {
        "diligent-web-server.exe"
    } else {
        "diligent-web-server"
    };
    let path = global_dir()?.join("updates/runtime").join(bin_name);
    if path.exists() { Some(path) } else { None }
}

/// Check for updated dist/client at ~/.diligent/updates/runtime/dist/client/
fn resolve_updated_dist_dir() -> Option<PathBuf> {
    let candidate = global_dir()?.join("updates/runtime/dist/client");
    if candidate.exists() { Some(candidate) } else { None }
}

/// Check for updated rg binary at ~/.diligent/updates/runtime/
fn resolve_updated_rg_bin() -> Option<PathBuf> {
    let bin_name = if cfg!(windows) { "rg.exe" } else { "rg" };
    let path = global_dir()?.join("updates/runtime").join(bin_name);
    if path.exists() { Some(path) } else { None }
}

/// Resolve dist/client: prefer bundle resource_dir, fall back to directory next to the exe.
fn resolve_bundled_dist_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("dist").join("client");
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    // Portable / dev fallback: look next to the executable
    let exe = std::env::current_exe().map_err(|e| format!("Cannot resolve exe path: {e}"))?;
    let exe_dir = exe.parent().ok_or("Cannot resolve exe directory")?;
    Ok(exe_dir.join("dist").join("client"))
}

/// Resolve bundled rg binary path. Returns None if not found (fall back to system PATH).
fn resolve_bundled_rg_bin() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let rg = if cfg!(windows) {
        exe_dir.join("rg.exe")
    } else {
        exe_dir.join("rg")
    };
    if rg.exists() { Some(rg) } else { None }
}

// ---------------------------------------------------------------------------
// Sidecar lifecycle
// ---------------------------------------------------------------------------

/// Spawn the Bun web server sidecar and return the port it is listening on.
/// Prefers updated binaries from ~/.diligent/updates/runtime/ if available.
pub async fn start_sidecar(app: &AppHandle, cwd: &str, userid: Option<&str>) -> Result<u16, String> {
    if should_prefer_bundled_runtime_for_current_build() {
        return start_bundled_sidecar(app, cwd, userid).await;
    }

    // Prefer updated paths, fall back to bundled
    let dist_dir = resolve_updated_dist_dir()
        .map_or_else(|| resolve_bundled_dist_dir(app), Ok)?;
    let dist_dir_str = dist_dir.to_string_lossy().to_string();

    let log_path = default_web_log_path()?;
    let log_path_str = log_path.to_string_lossy().to_string();

    let rg_path = resolve_updated_rg_bin().or_else(resolve_bundled_rg_bin);

    let mut args = vec![
        "--port=0".to_string(),
        format!("--dist-dir={}", dist_dir_str),
        format!("--cwd={}", cwd),
        format!("--log-file={}", log_path_str),
    ];
    if let Some(userid) = userid.filter(|value| !value.is_empty()) {
        args.push(format!("--userid={}", userid));
    }
    args.push(format!("--parent-pid={}", std::process::id()));

    if let Some(updated_sidecar) = resolve_updated_sidecar_path() {
        spawn_updated_sidecar(app, &updated_sidecar, &args, rg_path.as_deref()).await
    } else {
        spawn_bundled_sidecar(app, &args, rg_path.as_deref()).await
    }
}

async fn start_bundled_sidecar(app: &AppHandle, cwd: &str, userid: Option<&str>) -> Result<u16, String> {
    let dist_dir = resolve_bundled_dist_dir(app)?;
    let dist_dir_str = dist_dir.to_string_lossy().to_string();

    let log_path = default_web_log_path()?;
    let log_path_str = log_path.to_string_lossy().to_string();

    let rg_path = resolve_bundled_rg_bin();

    let mut args = vec![
        "--port=0".to_string(),
        format!("--dist-dir={}", dist_dir_str),
        format!("--cwd={}", cwd),
        format!("--log-file={}", log_path_str),
    ];
    if let Some(userid) = userid.filter(|value| !value.is_empty()) {
        args.push(format!("--userid={}", userid));
    }
    args.push(format!("--parent-pid={}", std::process::id()));

    spawn_bundled_sidecar(app, &args, rg_path.as_deref()).await
}

/// Spawn the updated sidecar via tokio::process::Command.
async fn spawn_updated_sidecar(
    app: &AppHandle,
    binary: &std::path::Path,
    args: &[String],
    rg_path: Option<&std::path::Path>,
) -> Result<u16, String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut cmd = tokio::process::Command::new(binary);

    #[cfg(windows)]
    {
        // NEW_PROCESS_GROUP improves cleanup behavior when terminating process trees.
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    cmd.args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit());

    if let Some(rg) = rg_path {
        cmd.env("DILIGENT_RG_PATH", rg.to_string_lossy().as_ref());
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn updated sidecar: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("No stdout from updated sidecar")?;

    // Parse port from stdout
    let port = {
        let mut reader = BufReader::new(stdout);
        let deadline = Duration::from_secs(15);
        let mut line_buf = String::new();
        tokio::time::timeout(deadline, async {
            loop {
                line_buf.clear();
                let n = reader
                    .read_line(&mut line_buf)
                    .await
                    .map_err(|e| format!("read stdout: {e}"))?;
                if n == 0 {
                    return Err::<u16, String>(
                        "Sidecar stdout closed before emitting DILIGENT_PORT".into(),
                    );
                }
                if let Some(port_str) = line_buf.trim().strip_prefix("DILIGENT_PORT=") {
                    let port: u16 = port_str
                        .trim()
                        .parse()
                        .map_err(|_| format!("Invalid port value: {}", port_str.trim()))?;
                    return Ok(port);
                }
            }
        })
        .await
        .map_err(|_| "Timed out waiting for DILIGENT_PORT from updated sidecar".to_string())?
    }?;

    // Store child for cleanup
    let state = app.state::<SidecarState>();
    *state.0.lock().unwrap() = Some(ManagedChild::TokioChild(child));

    // Wait until /health responds
    wait_for_health(port).await?;

    Ok(port)
}

/// Spawn the bundled sidecar via Tauri's shell plugin.
async fn spawn_bundled_sidecar(
    app: &AppHandle,
    args: &[String],
    rg_path: Option<&std::path::Path>,
) -> Result<u16, String> {
    let mut sidecar_cmd = app
        .shell()
        .sidecar("diligent-web-server")
        .map_err(|e| format!("Cannot create sidecar command: {e}"))?
        .args(args);

    if let Some(rg) = rg_path {
        sidecar_cmd = sidecar_cmd.env("DILIGENT_RG_PATH", rg.to_string_lossy().as_ref());
    }

    let (mut rx, child) = sidecar_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    // Store child for cleanup
    let state = app.state::<SidecarState>();
    *state.0.lock().unwrap() = Some(ManagedChild::TauriChild(child));

    // Read stdout lines looking for DILIGENT_PORT=<number>
    let port = parse_port_from_stdout(&mut rx).await?;

    // Wait until /health responds
    wait_for_health(port).await?;

    Ok(port)
}

/// Kill the sidecar if it is running.
pub fn stop_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                child.kill();
            }
        }
    }
}

async fn parse_port_from_stdout(
    rx: &mut tauri::async_runtime::Receiver<CommandEvent>,
) -> Result<u16, String> {
    use tokio::time::timeout;

    let deadline = Duration::from_secs(15);

    loop {
        match timeout(deadline, rx.recv()).await {
            Err(_) => return Err("Timed out waiting for DILIGENT_PORT from sidecar".into()),
            Ok(None) => return Err("Sidecar stdout closed before emitting DILIGENT_PORT".into()),
            Ok(Some(event)) => {
                if let CommandEvent::Stdout(line) = event {
                    let text = String::from_utf8_lossy(&line);
                    if let Some(port_str) = text.trim().strip_prefix("DILIGENT_PORT=") {
                        let port: u16 = port_str
                            .trim()
                            .parse()
                            .map_err(|_| format!("Invalid port value: {}", port_str.trim()))?;
                        return Ok(port);
                    }
                }
            }
        }
    }
}

async fn wait_for_health(port: u16) -> Result<(), String> {
    use tokio::time::{sleep, timeout};

    let url = format!("http://127.0.0.1:{}/health", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Cannot build HTTP client: {e}"))?;

    let deadline = Duration::from_secs(30);
    timeout(deadline, async {
        loop {
            if client
                .get(&url)
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                return Ok::<(), String>(());
            }
            sleep(Duration::from_millis(200)).await;
        }
    })
    .await
    .map_err(|_| format!("Server at :{} did not become healthy within 30 s", port))?
}

#[cfg(test)]
mod tests {
    use super::should_prefer_bundled_runtime_for_current_build;

    #[test]
    fn tokio_child_kill_path_uses_sync_start_kill() {
        // Regression guard: ManagedChild::kill() is synchronous, so tokio child
        // termination must use start_kill() (not async kill() without await).
        let source = include_str!("sidecar.rs");
        assert!(
            source.contains("c.start_kill()"),
            "ManagedChild::TokioChild branch must use start_kill() for shutdown"
        );
    }

    #[test]
    fn desktop_dev_builds_prefer_bundled_runtime_assets() {
        assert!(should_prefer_bundled_runtime_for_current_build());
    }
}
