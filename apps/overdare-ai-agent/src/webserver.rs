use std::path::PathBuf;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};

use crate::storage::{
    global_legacy_storage_dir, global_storage_dir, local_legacy_storage_dir, local_storage_dir, migrate_namespace_if_needed,
    storage_namespace,
};

pub struct WebServerOptions {
    pub cwd: String,
    pub userid: Option<String>,
}

pub fn parse_args(args: &[String]) -> Result<WebServerOptions, String> {
    let mut cwd: Option<String> = None;
    let mut userid: Option<String> = None;

    for arg in args {
        if let Some(value) = arg.strip_prefix("--cwd=") {
            if !value.is_empty() {
                cwd = Some(value.to_string());
            }
            continue;
        }
        if let Some(value) = arg.strip_prefix("--userid=") {
            if !value.is_empty() {
                userid = Some(value.to_string());
            }
            continue;
        }
        if matches!(arg.as_str(), "--help" | "-h") {
            return Err("Usage: overdare-ai-agent webserver --cwd=/path/to/project [--userid=abc]".to_string());
        }
    }

    let cwd = cwd.unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).to_string_lossy().to_string());
    Ok(WebServerOptions { cwd, userid })
}

fn default_web_log_path() -> Result<PathBuf, String> {
    let global = global_storage_dir().ok_or("Cannot determine home directory for web logs")?;
    let logs_dir = global.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|e| format!("Cannot create web log directory {}: {e}", logs_dir.display()))?;
    let date = chrono::Local::now().format("%Y%m%d").to_string();
    let pid = std::process::id();
    Ok(logs_dir.join(format!("{}-{}.log", date, pid)))
}

fn resolve_updated_sidecar_path() -> Option<PathBuf> {
    let bin_name = if cfg!(windows) { "diligent-web-server.exe" } else { "diligent-web-server" };
    let path = global_storage_dir()?.join("updates/runtime").join(bin_name);
    if path.exists() { Some(path) } else { None }
}

fn resolve_updated_dist_dir() -> Option<PathBuf> {
    let candidate = global_storage_dir()?.join("updates/runtime/dist/client");
    if candidate.exists() { Some(candidate) } else { None }
}

fn resolve_updated_rg_bin() -> Option<PathBuf> {
    let bin_name = if cfg!(windows) { "rg.exe" } else { "rg" };
    let path = global_storage_dir()?.join("updates/runtime").join(bin_name);
    if path.exists() { Some(path) } else { None }
}

fn migrate_global_namespace_if_needed() -> Result<(), String> {
    let legacy = global_legacy_storage_dir().ok_or("Cannot determine home directory for migration")?;
    let target = global_storage_dir().ok_or("Cannot determine home directory for migration")?;
    migrate_namespace_if_needed(&legacy, &target).map(|_| ())
}

fn migrate_local_namespace_if_needed(cwd: &str) -> Result<(), String> {
    let legacy = local_legacy_storage_dir(cwd);
    let target = local_storage_dir(cwd);
    migrate_namespace_if_needed(&legacy, &target).map(|_| ())
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
            if client.get(&url).send().await.map(|r| r.status().is_success()).unwrap_or(false) {
                return Ok::<(), String>(());
            }
            sleep(Duration::from_millis(200)).await;
        }
    })
    .await
    .map_err(|_| format!("Server at :{} did not become healthy within 30 s", port))?
}

fn format_child_exit(status: std::process::ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return format!("signal {signal}");
        }
    }
    match status.code() {
        Some(code) => format!("exit code {code}"),
        None => "unknown termination".to_string(),
    }
}

pub async fn run_foreground(options: WebServerOptions) -> Result<u16, String> {
    migrate_global_namespace_if_needed()?;
    migrate_local_namespace_if_needed(&options.cwd)?;

    let binary = resolve_updated_sidecar_path().ok_or(
        format!(
            "Updated runtime binary not found. Run 'overdare-ai-agent update' first so ~/.{}/updates/runtime/diligent-web-server exists.",
            storage_namespace()
        ),
    )?;
    let dist_dir = resolve_updated_dist_dir().ok_or(
        "Updated runtime dist/client not found. Run 'overdare-ai-agent update' first.".to_string(),
    )?;
    let log_path = default_web_log_path()?;
    let rg_path = resolve_updated_rg_bin();

    let mut args = vec![
        "--port=0".to_string(),
        format!("--dist-dir={}", dist_dir.to_string_lossy()),
        format!("--cwd={}", options.cwd),
        format!("--log-file={}", log_path.to_string_lossy()),
        format!("--parent-pid={}", std::process::id()),
    ];
    if let Some(userid) = options.userid.filter(|value| !value.is_empty()) {
        args.push(format!("--userid={userid}"));
    }

    let mut cmd = tokio::process::Command::new(&binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit());
    if let Some(rg) = rg_path.as_deref() {
        cmd.env("DILIGENT_RG_PATH", rg.to_string_lossy().as_ref());
    }
    cmd.env("DILIGENT_STORAGE_NAMESPACE", storage_namespace());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn updated sidecar: {e}"))?;
    let stdout = child.stdout.take().ok_or("No stdout from updated sidecar")?;

    let port = {
        let mut reader = BufReader::new(stdout);
        let deadline = Duration::from_secs(15);
        let mut line_buf = String::new();
        tokio::time::timeout(deadline, async {
            loop {
                line_buf.clear();
                let n = reader.read_line(&mut line_buf).await.map_err(|e| format!("read stdout: {e}"))?;
                if n == 0 {
                    let status = child
                        .wait()
                        .await
                        .map_err(|e| format!("wait sidecar exit: {e}"))?;
                    return Err::<u16, String>(format!(
                        "Sidecar exited before emitting DILIGENT_PORT ({})\nBinary: {}\nLog file: {}",
                        format_child_exit(status),
                        binary.display(),
                        log_path.display()
                    ));
                }
                if let Some(port_str) = line_buf.trim().strip_prefix("DILIGENT_PORT=") {
                    let port: u16 = port_str.trim().parse().map_err(|_| format!("Invalid port value: {}", port_str.trim()))?;
                    return Ok(port);
                }
            }
        })
        .await
        .map_err(|_| "Timed out waiting for DILIGENT_PORT from updated sidecar".to_string())?
    }?;

    wait_for_health(port).await?;
    tokio::spawn(async move {
        let _ = child.wait().await;
    });
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::parse_args;
    use crate::storage::storage_namespace;

    #[test]
    fn parse_args_reads_cwd_and_userid() {
        let args = vec!["--cwd=/tmp/project".to_string(), "--userid=user-1".to_string()];
        let parsed = parse_args(&args).expect("parse args");
        assert_eq!(parsed.cwd, "/tmp/project");
        assert_eq!(parsed.userid.as_deref(), Some("user-1"));
    }

    #[test]
    fn packaged_webserver_uses_packaged_namespace() {
        assert_eq!(storage_namespace(), "overdare");
    }
}
