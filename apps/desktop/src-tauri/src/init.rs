// @summary First-run setup: deploy config.jsonc + plugins to ~/.diligent/
use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

/// Global ~/.diligent directory
fn global_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME").map(PathBuf::from);
    home.map(|h| h.join(".diligent"))
}

/// Resolve the bundled defaults directory from Tauri resources or exe-relative fallback.
fn resolve_defaults_dir(app: &tauri::App) -> Option<PathBuf> {
    // Installed bundle: resource_dir/defaults/
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("defaults");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    // Portable / dev fallback: next to the executable
    let exe = std::env::current_exe().ok()?;
    let candidate = exe.parent()?.join("defaults");
    if candidate.exists() { Some(candidate) } else { None }
}

/// Recursively copy a directory tree.
fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            fs::copy(&src_path, &dest_path)?;
        }
    }
    Ok(())
}

/// Run first-time setup. Non-fatal: logs errors but never blocks the app.
pub fn run(app: &tauri::App) {
    let Some(global) = global_dir() else {
        eprintln!("[init] Cannot determine home directory, skipping setup");
        return;
    };
    let defaults_dir = resolve_defaults_dir(app);

    // Ensure ~/.diligent/ exists
    if let Err(e) = fs::create_dir_all(&global) {
        eprintln!("[init] Cannot create {}: {e}", global.display());
        return;
    }

    // --- *.jsonc configs (config.jsonc, @package.jsonc, ...) ---
    if let Some(ref defaults) = defaults_dir {
        if let Ok(entries) = fs::read_dir(defaults) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !name_str.ends_with(".jsonc") {
                    continue;
                }
                let dest = global.join(&name);
                if !dest.exists() {
                    match fs::copy(&entry.path(), &dest) {
                        Ok(_) => eprintln!("[init] Created {}", dest.display()),
                        Err(e) => eprintln!("[init] Failed to copy {name_str}: {e}"),
                    }
                }
            }
        }
    }

    // --- plugins ---
    if let Some(ref defaults) = defaults_dir {
        let src_plugins = defaults.join("plugins");
        if src_plugins.is_dir() {
            let dest_plugins = global.join("plugins");
            if let Err(e) = fs::create_dir_all(&dest_plugins) {
                eprintln!("[init] Cannot create plugins dir: {e}");
                return;
            }
            // Copy each plugin that doesn't already exist
            if let Ok(entries) = fs::read_dir(&src_plugins) {
                for entry in entries.flatten() {
                    if !entry.path().is_dir() {
                        continue;
                    }
                    let name = entry.file_name();
                    let dest = dest_plugins.join(&name);
                    if !dest.exists() {
                        match copy_dir_recursive(&entry.path(), &dest) {
                            Ok(_) => eprintln!("[init] Deployed plugin: {}", name.to_string_lossy()),
                            Err(e) => eprintln!("[init] Failed to deploy {}: {e}", name.to_string_lossy()),
                        }
                    }
                }
            }
        }
    }
}
