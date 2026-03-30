// @summary First-run setup: deploy config.jsonc + plugins to ~/.diligent/
use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DeployMode {
    MissingOnly,
    FullSync,
}

fn should_copy_entry(dest_exists: bool, mode: DeployMode) -> bool {
    match mode {
        DeployMode::MissingOnly => !dest_exists,
        DeployMode::FullSync => true,
    }
}

/// Global ~/.diligent directory
fn global_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME").map(PathBuf::from);
    home.map(|h| h.join(".diligent"))
}

/// Check for updated defaults at ~/.diligent/updates/runtime/defaults/
fn resolve_updated_defaults_dir(log: &mut String) -> Option<PathBuf> {
    let candidate = global_dir()?.join("updates/runtime/defaults");
    if candidate.exists() {
        let _ = writeln!(log, "[init] Using updated defaults: {}", candidate.display());
        Some(candidate)
    } else {
        None
    }
}

/// Resolve the bundled defaults directory, trying multiple candidate paths.
fn resolve_defaults_dir(app: &tauri::AppHandle, log: &mut String) -> Option<PathBuf> {
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

/// Deploy plugins directory: delete and re-copy each bundled package individually.
/// Supports scoped packages (@scope/plugin-name) by iterating one level deeper.
/// Packages not present in the bundle (e.g. user-added plugins) are left untouched.
fn deploy_plugins(src: &Path, dest: &Path, log: &mut String, mode: DeployMode) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        let src_child = entry.path();
        let dest_child = dest.join(&name);

        if !src_child.is_dir() {
            continue;
        }

        if name_str.starts_with('@') {
            // Scoped package directory (@scope/): iterate individual plugin dirs inside
            fs::create_dir_all(&dest_child)?;
            for plugin_entry in fs::read_dir(&src_child)? {
                let plugin_entry = plugin_entry?;
                let plugin_name = plugin_entry.file_name();
                let src_plugin = plugin_entry.path();
                let dest_plugin = dest_child.join(&plugin_name);
                if !src_plugin.is_dir() {
                    continue;
                }
                let exists = dest_plugin.exists();
                if !should_copy_entry(exists, mode) {
                    let _ = writeln!(
                        log,
                        "[init] Kept existing plugins/{}/{}/",
                        name_str,
                        plugin_name.to_string_lossy()
                    );
                    continue;
                }
                if exists {
                    fs::remove_dir_all(&dest_plugin)?;
                    let _ = writeln!(
                        log,
                        "[init] Removed stale plugins/{}/{}/",
                        name_str,
                        plugin_name.to_string_lossy()
                    );
                }
                copy_dir_recursive(&src_plugin, &dest_plugin)?;
                let _ = writeln!(log, "[init] Deployed plugins/{}/{}/", name_str, plugin_name.to_string_lossy());
            }
        } else {
            // Non-scoped plugin: delete dest package dir and replace
            let exists = dest_child.exists();
            if !should_copy_entry(exists, mode) {
                let _ = writeln!(log, "[init] Kept existing plugins/{}/", name_str);
                continue;
            }

            if exists {
                fs::remove_dir_all(&dest_child)?;
                let _ = writeln!(log, "[init] Removed stale plugins/{}/", name_str);
            }
            copy_dir_recursive(&src_child, &dest_child)?;
            let _ = writeln!(log, "[init] Deployed plugins/{}/", name_str);
        }
    }
    Ok(())
}

/// Deploy defaults with policy:
/// - MissingOnly (default): copy only when target does not exist
/// - FullSync (after update applied): replace with bundled/updated defaults
/// Non-fatal: logs errors but never blocks the app.
pub fn run(app: &tauri::AppHandle, update_applied: bool) {
    let mut log = String::new();

    let mode = if update_applied {
        DeployMode::FullSync
    } else {
        DeployMode::MissingOnly
    };

    let _ = writeln!(
        log,
        "[init] Deploy mode: {}",
        match mode {
            DeployMode::MissingOnly => "missing-only",
            DeployMode::FullSync => "full-sync",
        }
    );

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

    // Prefer updated defaults from auto-update, fall back to bundled defaults
    let defaults_dir = resolve_updated_defaults_dir(&mut log)
        .or_else(|| resolve_defaults_dir(app, &mut log));

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
                        let existed_before = dest.exists();
                        if !should_copy_entry(existed_before, mode) {
                            let _ = writeln!(log, "[init] Kept existing {}", dest.display());
                            continue;
                        }

                        match fs::copy(&src, &dest) {
                            Ok(_) => {
                                if existed_before {
                                    let _ = writeln!(log, "[init] Overwrote {}", dest.display());
                                } else {
                                    let _ = writeln!(log, "[init] Created {}", dest.display());
                                }
                            }
                            Err(e) => { let _ = writeln!(log, "[init] Failed to copy {}: {e}", name.to_string_lossy()); }
                        }
                    } else if src.is_dir() {
                        if name.to_string_lossy() == "plugins" {
                            // Plugins: delete and re-copy each bundled package individually
                            match deploy_plugins(&src, &dest, &mut log, mode) {
                                Ok(_) => { let _ = writeln!(log, "[init] Deployed plugins/"); }
                                Err(e) => { let _ = writeln!(log, "[init] Failed to deploy plugins/: {e}"); }
                            }
                        } else {
                            let existed_before = dest.exists();
                            if !should_copy_entry(existed_before, mode) {
                                let _ = writeln!(log, "[init] Kept existing {}/", name.to_string_lossy());
                                continue;
                            }

                            if existed_before {
                                if let Err(e) = fs::remove_dir_all(&dest) {
                                    let _ = writeln!(log, "[init] Cannot replace {}: {e}", dest.display());
                                    continue;
                                }
                            }
                            match copy_dir_recursive(&src, &dest) {
                                Ok(_) => {
                                    let _ = writeln!(log, "[init] Deployed {}/", name.to_string_lossy());
                                }
                                Err(e) => { let _ = writeln!(log, "[init] Failed to deploy {}/: {e}", name.to_string_lossy()); }
                            }
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

#[cfg(test)]
mod tests {
    use super::{should_copy_entry, DeployMode};

    #[test]
    fn missing_only_copies_only_when_target_missing() {
        assert!(should_copy_entry(false, DeployMode::MissingOnly));
        assert!(!should_copy_entry(true, DeployMode::MissingOnly));
    }

    #[test]
    fn full_sync_always_copies() {
        assert!(should_copy_entry(false, DeployMode::FullSync));
        assert!(should_copy_entry(true, DeployMode::FullSync));
    }
}
