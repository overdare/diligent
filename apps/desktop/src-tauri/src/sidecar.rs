// @summary Sidecar lifecycle: spawn Bun web server, parse port from stdout, navigate WebView
use std::sync::Mutex;
use std::time::Duration;

use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub struct SidecarState(pub Mutex<Option<CommandChild>>);

/// Resolve dist/client: prefer bundle resource_dir, fall back to directory next to the exe.
fn resolve_dist_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
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

/// Spawn the Bun web server sidecar and return the port it is listening on.
pub async fn start_sidecar(app: &AppHandle, cwd: &str) -> Result<u16, String> {
    let dist_dir = resolve_dist_dir(app)?;
    let dist_dir_str = dist_dir.to_string_lossy().to_string();

    // Spawn the sidecar with port=0 so the OS picks a free port
    let sidecar_cmd = app
        .shell()
        .sidecar("diligent-web-server")
        .map_err(|e| format!("Cannot create sidecar command: {e}"))?
        .args([
            "--port=0",
            &format!("--dist-dir={}", dist_dir_str),
            &format!("--cwd={}", cwd),
        ]);

    let (mut rx, child) = sidecar_cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    // Store child for later cleanup
    let state = app.state::<SidecarState>();
    *state.0.lock().unwrap() = Some(child);

    // Read stdout lines looking for DILIGENT_PORT=<number>
    let port = parse_port_from_stdout(&mut rx).await?;

    // Wait until /health responds (up to 30 s)
    wait_for_health(port).await?;

    Ok(port)
}

/// Kill the sidecar if it is running.
pub fn stop_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
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
