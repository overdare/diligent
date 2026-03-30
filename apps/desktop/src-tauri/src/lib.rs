// @summary Tauri app builder: registers plugins, exposes pick_directory/launch_server commands
mod init;
mod sidecar;
mod update;

use sidecar::{start_sidecar, stop_sidecar, SidecarState};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

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
async fn launch_server(app: tauri::AppHandle, cwd: String) -> Result<(), String> {
    let port = start_sidecar(&app, &cwd).await?;

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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            // 1. Apply pending runtime update (must happen before init)
            let mut update_log = String::new();
            match update::apply_pending_update(&mut update_log) {
                Ok(true) => eprintln!("[update] Applied pending runtime update"),
                Ok(false) => {}
                Err(e) => eprintln!("[update] Failed to apply pending update: {e}"),
            }
            if !update_log.is_empty() {
                eprint!("{update_log}");
            }

            // 2. Deploy defaults (prefers updated paths if available)
            init::run(app);

            // 3. Background check for next launch
            update::spawn_update_check();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_startup_cwd, pick_directory, launch_server])
        .on_window_event(|window, event| {
            // Kill sidecar only when the main app window closes, not the loading splash.
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "app" {
                    stop_sidecar(window.app_handle());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::parse_startup_cwd_from_args;

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
}
