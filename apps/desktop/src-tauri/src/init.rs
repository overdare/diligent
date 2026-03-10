// @summary First-run setup: deploy config.jsonc + plugins to ~/.diligent/
use std::fmt::Write as FmtWrite;
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

/// Resolve the bundled defaults directory, trying multiple candidate paths.
fn resolve_defaults_dir(app: &tauri::App, log: &mut String) -> Option<PathBuf> {
    // 1. resource_dir() / defaults
    match app.path().resource_dir() {
        Ok(resource_dir) => {
            let _ = writeln!(log, "[init] resource_dir = {}", resource_dir.display());
            let candidate = resource_dir.join("defaults");
            let _ = writeln!(log, "[init] candidate(resource) = {} exists={}", candidate.display(), candidate.exists());
            if candidate.exists() {
                return Some(candidate);
            }
        }
        Err(e) => {
            let _ = writeln!(log, "[init] resource_dir() error: {e}");
        }
    }

    // 2. exe directory / defaults
    match std::env::current_exe() {
        Ok(exe) => {
            let _ = writeln!(log, "[init] exe = {}", exe.display());
            if let Some(exe_dir) = exe.parent() {
                let candidate = exe_dir.join("defaults");
                let _ = writeln!(log, "[init] candidate(exe) = {} exists={}", candidate.display(), candidate.exists());
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
        Err(e) => {
            let _ = writeln!(log, "[init] current_exe() error: {e}");
        }
    }

    let _ = writeln!(log, "[init] defaults dir not found — skipping deploy");
    None
}

/// Recursively copy a directory tree (always overwrites existing files).
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
    let mut log = String::new();

    let Some(global) = global_dir() else {
        let _ = writeln!(log, "[init] Cannot determine home directory, skipping setup");
        flush_log(&global_log_path(), &log);
        return;
    };

    let log_path = global.join("init.log");

    // Ensure ~/.diligent/ exists
    if let Err(e) = fs::create_dir_all(&global) {
        let _ = writeln!(log, "[init] Cannot create {}: {e}", global.display());
        flush_log(&log_path, &log);
        return;
    }

    let defaults_dir = resolve_defaults_dir(app, &mut log);

    if let Some(ref defaults) = defaults_dir {
        match fs::read_dir(defaults) {
            Err(e) => {
                let _ = writeln!(log, "[init] Cannot read defaults dir: {e}");
            }
            Ok(entries) => {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let src = entry.path();
                    let dest = global.join(&name);
                    if src.is_file() {
                        if !dest.exists() {
                            match fs::copy(&src, &dest) {
                                Ok(_) => { let _ = writeln!(log, "[init] Created {}", dest.display()); }
                                Err(e) => { let _ = writeln!(log, "[init] Failed to copy {}: {e}", name.to_string_lossy()); }
                            }
                        } else {
                            let _ = writeln!(log, "[init] Skipped (exists) {}", dest.display());
                        }
                    } else if src.is_dir() {
                        if let Err(e) = fs::create_dir_all(&dest) {
                            let _ = writeln!(log, "[init] Cannot create {}: {e}", dest.display());
                            continue;
                        }
                        match copy_dir_recursive(&src, &dest) {
                            Ok(_) => { let _ = writeln!(log, "[init] Deployed {}/", name.to_string_lossy()); }
                            Err(e) => { let _ = writeln!(log, "[init] Failed to deploy {}/: {e}", name.to_string_lossy()); }
                        }
                    }
                }
            }
        }
    }

    flush_log(&log_path, &log);
}

fn global_log_path() -> PathBuf {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME").map(PathBuf::from);
    home.unwrap_or_else(|| PathBuf::from(".")).join(".diligent").join("init.log")
}

fn flush_log(path: &Path, log: &str) {
    let _ = fs::write(path, log);
}
