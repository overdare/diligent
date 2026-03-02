// @summary Tauri app builder: registers plugins, starts sidecar, creates main window at server URL
mod sidecar;

use sidecar::{start_sidecar, stop_sidecar, SidecarState};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            // Loading splash is shown immediately via frontendDist = loading/index.html.
            // After the sidecar is ready we open the real app window and close the splash.
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                match start_sidecar(&handle).await {
                    Ok(port) => {
                        let url_str = format!("http://127.0.0.1:{}", port);
                        let parsed: tauri::Url = match url_str.parse() {
                            Ok(u) => u,
                            Err(e) => {
                                eprintln!("URL parse error: {e}");
                                return;
                            }
                        };

                        // Create the app window BEFORE closing the splash so there is
                        // never a zero-window gap that would trigger Tauri's auto-quit.
                        let result = tauri::WebviewWindowBuilder::new(
                            &handle,
                            "app",
                            tauri::WebviewUrl::External(parsed),
                        )
                        .title("Diligent")
                        .inner_size(1280.0, 800.0)
                        .min_inner_size(800.0, 600.0)
                        .resizable(true)
                        .build();

                        match result {
                            Ok(_) => {
                                if let Some(splash) = handle.get_webview_window("main") {
                                    let _ = splash.close();
                                }
                            }
                            Err(e) => eprintln!("Failed to open app window: {e}"),
                        }
                    }
                    Err(e) => eprintln!("Sidecar failed to start: {e}"),
                }
            });

            Ok(())
        })
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
