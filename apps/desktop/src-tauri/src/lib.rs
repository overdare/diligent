// @summary Tauri app builder: registers plugins, exposes pick_directory/launch_server commands
mod init;
mod sidecar;

use sidecar::{start_sidecar, stop_sidecar, SidecarState};
use std::sync::Mutex;
use tauri::Manager;

const APP_PROJECT_NAME: &str = match option_env!("DILIGENT_APP_PROJECT_NAME") {
    Some(name) => name,
    None => "Diligent",
};

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
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            init::run(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pick_directory, launch_server])
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
