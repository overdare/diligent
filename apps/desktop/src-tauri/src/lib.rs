// @summary Tauri app builder: registers plugins, exposes pick_directory/launch_server commands
mod init;
mod sidecar;
mod update;

use sidecar::{start_sidecar, stop_sidecar, SidecarState};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

const STARTUP_UPDATE_PROGRESS_EVENT: &str = "startup://update-progress";

const APP_PROJECT_NAME: &str = match option_env!("DILIGENT_APP_PROJECT_NAME") {
    Some(name) => name,
    None => "Diligent",
};

fn parse_startup_cwd_from_args<I, T>(args: I) -> Option<String>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString>,
{
    let mut args = args.into_iter().map(|arg| arg.into()).peekable();

    while let Some(arg) = args.next() {
        let arg = arg.to_string_lossy();
        if let Some(value) = arg.strip_prefix("--cwd=") {
            if !value.is_empty() {
                return Some(value.to_string());
            }
            continue;
        }

        if arg == "--cwd" {
            if let Some(value) = args.next() {
                let value: std::ffi::OsString = value.into();
                if !value.is_empty() {
                    return Some(value.to_string_lossy().to_string());
                }
            }
        }
    }

    None
}

fn parse_startup_userid_from_args<I, T>(args: I) -> Option<String>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString>,
{
    let mut args = args.into_iter().map(|arg| arg.into()).peekable();

    while let Some(arg) = args.next() {
        let arg = arg.to_string_lossy();
        if let Some(value) = arg.strip_prefix("--userid=") {
            if !value.is_empty() {
                return Some(value.to_string());
            }
            continue;
        }

        if arg == "--userid" {
            if let Some(value) = args.next() {
                let value: std::ffi::OsString = value.into();
                if !value.is_empty() {
                    return Some(value.to_string_lossy().to_string());
                }
            }
        }
    }

    None
}

fn resolve_startup_cwd() -> Option<String> {
    let raw = parse_startup_cwd_from_args(std::env::args_os())?;
    let path = PathBuf::from(raw);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().ok()?.join(path)
    };

    absolute
        .canonicalize()
        .ok()
        .filter(|path| path.is_dir())
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_startup_cwd() -> Option<String> {
    resolve_startup_cwd()
}

#[tauri::command]
fn get_startup_userid() -> Option<String> {
    parse_startup_userid_from_args(std::env::args_os())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupPreparationResult {
    update_applied: bool,
    update_log: String,
    init_log_path: Option<String>,
    update_steps: Vec<StartupUpdateStep>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Clone)]
struct StartupUpdateStep {
    stage: String,
    message: String,
}

fn map_update_progress(progress: update::UpdateProgress) -> StartupUpdateStep {
    let (stage, message) = match progress {
        update::UpdateProgress::Disabled => {
            ("disabled".to_string(), "Auto-update disabled".to_string())
        }
        update::UpdateProgress::BootstrapRequired => (
            "bootstrap_required".to_string(),
            "Runtime bootstrap required".to_string(),
        ),
        update::UpdateProgress::Checking { current_version } => (
            "checking".to_string(),
            format!("Checking for updates (current: v{current_version})"),
        ),
        update::UpdateProgress::Downloading { target_version } => (
            "downloading".to_string(),
            format!("Downloading runtime v{target_version}"),
        ),
        update::UpdateProgress::Verifying { target_version } => (
            "verifying".to_string(),
            format!("Verifying runtime v{target_version}"),
        ),
        update::UpdateProgress::Extracting { target_version } => (
            "extracting".to_string(),
            format!("Extracting runtime v{target_version}"),
        ),
        update::UpdateProgress::Applying { target_version } => (
            "applying".to_string(),
            format!("Applying runtime v{target_version}"),
        ),
        update::UpdateProgress::UpToDate => {
            ("up_to_date".to_string(), "Already up-to-date".to_string())
        }
        update::UpdateProgress::Updated { target_version } => (
            "updated".to_string(),
            format!("Updated to runtime v{target_version}"),
        ),
    };

    StartupUpdateStep { stage, message }
}

/// Run startup preparation before launching sidecar:
/// update check/apply + defaults deployment.
#[tauri::command]
async fn prepare_startup(app: tauri::AppHandle) -> Result<StartupPreparationResult, String> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<StartupUpdateStep>();

    let update_task = tauri::async_runtime::spawn_blocking(move || {
        let mut update_log = String::new();
        let mut update_steps = Vec::new();

        let update_applied = update::run_with_progress(
            &mut update_log,
            Some(&mut |progress| {
                let step = map_update_progress(progress);
                let _ = tx.send(step.clone());
                update_steps.push(step);
            }),
        )?;

        Ok::<(bool, String, Vec<StartupUpdateStep>), String>((update_applied, update_log, update_steps))
    });

    let app_for_emit = app.clone();
    let emit_task = tauri::async_runtime::spawn(async move {
        while let Some(step) = rx.recv().await {
            let _ = app_for_emit.emit(STARTUP_UPDATE_PROGRESS_EVENT, &step);
        }
    });

    let (update_applied, update_log, update_steps) = update_task
        .await
        .map_err(|e| format!("prepare_startup task join error: {e}"))??;

    let _ = emit_task.await;

    if !update_log.is_empty() {
        eprint!("{update_log}");
    }

    init::run(&app, update_applied);

    let init_log_path = {
        #[cfg(windows)]
        let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
        #[cfg(not(windows))]
        let home = std::env::var_os("HOME").map(PathBuf::from);
        home.map(|h| {
            h.join(".diligent")
                .join("init.log")
                .to_string_lossy()
                .to_string()
        })
    };

    Ok(StartupPreparationResult {
        update_applied,
        update_log,
        init_log_path,
        update_steps,
    })
}

/// Open a native folder picker and return the selected path (or null if cancelled).
#[tauri::command]
async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Open project folder")
        .pick_folder(move |result| {
            let _ = tx.send(result);
        });

    let path = rx.await.map_err(|_| "Channel error".to_string())?;
    Ok(path.map(|p| match p {
        FilePath::Path(pb) => pb.to_string_lossy().to_string(),
        _ => String::new(),
    }))
}

/// Start the sidecar with the given cwd, then open the main app window.
#[tauri::command]
async fn launch_server(app: tauri::AppHandle, cwd: String, userid: Option<String>) -> Result<(), String> {
    let port = start_sidecar(&app, &cwd, userid.as_deref()).await?;

    let url_str = format!("http://127.0.0.1:{}", port);
    let parsed: tauri::Url = url_str.parse().map_err(|e| format!("URL parse error: {e}"))?;

    // Create the app window BEFORE closing the splash so there is
    // never a zero-window gap that would trigger Tauri's auto-quit.
    tauri::WebviewWindowBuilder::new(&app, "app", tauri::WebviewUrl::External(parsed))
        .title(APP_PROJECT_NAME)
        .inner_size(1200.0, 800.0)
        .min_inner_size(1200.0, 800.0)
        .resizable(true)
        .build()
        .map_err(|e| format!("Failed to open app window: {e}"))?;

    if let Some(splash) = app.get_webview_window("main") {
        let _ = splash.close();
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("PANIC: {info}");
        #[cfg(debug_assertions)]
        let _ = std::fs::write("/tmp/diligent-panic.log", &msg);
        eprintln!("{msg}");
    }));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_startup_cwd,
            get_startup_userid,
            prepare_startup,
            pick_directory,
            launch_server
        ])
        .on_window_event(|window, event| {
            // Kill sidecar only when the main app window closes, not the loading splash.
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "app" {
                    stop_sidecar(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");

    app.run(|app_handle, event| {
        // Ensure sidecar is terminated on every app shutdown path
        // (window close, tray/menu quit, OS-level termination flow).
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            stop_sidecar(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{parse_startup_cwd_from_args, parse_startup_userid_from_args};

    #[test]
    fn parses_equals_form_cwd_argument() {
        let result = parse_startup_cwd_from_args(["diligent-desktop", "--cwd=/tmp/project"]);
        assert_eq!(result.as_deref(), Some("/tmp/project"));
    }

    #[test]
    fn parses_split_form_cwd_argument() {
        let result = parse_startup_cwd_from_args(["diligent-desktop", "--cwd", "./project"]);
        assert_eq!(result.as_deref(), Some("./project"));
    }

    #[test]
    fn ignores_missing_cwd_value() {
        let result = parse_startup_cwd_from_args(["diligent-desktop", "--cwd"]);
        assert_eq!(result, None);
    }

    #[test]
    fn ignores_empty_equals_form_cwd_argument() {
        let result = parse_startup_cwd_from_args(["diligent-desktop", "--cwd="]);
        assert_eq!(result, None);
    }

    #[test]
    fn parses_equals_form_userid_argument() {
        let result = parse_startup_userid_from_args(["diligent-desktop", "--userid=test-user"]);
        assert_eq!(result.as_deref(), Some("test-user"));
    }

    #[test]
    fn parses_split_form_userid_argument() {
        let result = parse_startup_userid_from_args(["diligent-desktop", "--userid", "test-user"]);
        assert_eq!(result.as_deref(), Some("test-user"));
    }

    #[test]
    fn ignores_missing_userid_value() {
        let result = parse_startup_userid_from_args(["diligent-desktop", "--userid"]);
        assert_eq!(result, None);
    }

    #[test]
    fn ignores_empty_equals_form_userid_argument() {
        let result = parse_startup_userid_from_args(["diligent-desktop", "--userid="]);
        assert_eq!(result, None);
    }
}
