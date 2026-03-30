// @summary Runtime auto-update: check manifest, download bundle, verify SHA256, stage for next launch

use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Version compiled into the Tauri shell during packaging.
const BUNDLED_RUNTIME_VERSION: &str = match option_env!("DILIGENT_RUNTIME_VERSION") {
    Some(v) => v,
    None => "0.0.0-dev",
};

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    platforms: std::collections::HashMap<String, PlatformBundle>,
}

#[derive(Debug, Deserialize, Serialize)]
struct PlatformBundle {
    url: String,
    sha256: String,
    #[serde(default)]
    size: u64,
}

/// Written to `updates/runtime/version.json` after successful staging.
#[derive(Debug, Serialize, Deserialize)]
pub struct InstalledVersion {
    pub version: String,
    pub applied_at: String,
    pub sha256: String,
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn global_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME").map(PathBuf::from);
    home.map(|h| h.join(".diligent"))
}

fn updates_dir() -> Option<PathBuf> {
    global_dir().map(|g| g.join("updates"))
}

fn current_platform() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "darwin-arm64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "darwin-x64";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "linux-x64";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "linux-arm64";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "windows-x64";
}

/// Resolve the manifest URL.
/// Priority: `DILIGENT_UPDATE_URL` compile-time env > empty (disabled).
fn resolve_manifest_url() -> String {
    match option_env!("DILIGENT_UPDATE_URL") {
        Some(url) if !url.is_empty() => url.to_string(),
        _ => String::new(),
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Read the currently installed (updated) version, if any.
pub fn installed_version() -> Option<InstalledVersion> {
    let path = updates_dir()?.join("runtime/version.json");
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Apply a previously-downloaded pending update.
/// Extracts the zip to `updates/runtime/`, writes `version.json`.
/// Returns `Ok(true)` if an update was applied, `Ok(false)` if nothing to do.
///
/// Must be called synchronously at startup BEFORE sidecar spawn.
pub fn apply_pending_update(log: &mut String) -> Result<bool, String> {
    let updates = match updates_dir() {
        Some(d) => d,
        None => return Ok(false),
    };

    let manifest_path = updates.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(false);
    }

    let manifest: UpdateManifest = serde_json::from_str(
        &fs::read_to_string(&manifest_path).map_err(|e| format!("read manifest: {e}"))?,
    )
    .map_err(|e| format!("parse manifest: {e}"))?;

    let platform = current_platform();
    let bundle = match manifest.platforms.get(platform) {
        Some(b) => b,
        None => return Ok(false),
    };

    let zip_name = format!("runtime-bundle-{}-{}.zip", manifest.version, platform);
    let zip_path = updates.join("pending").join(&zip_name);
    if !zip_path.exists() {
        return Ok(false);
    }

    // Already applied this version?
    if let Some(installed) = installed_version() {
        if installed.version == manifest.version {
            let _ = writeln!(log, "[update] v{} already applied, skipping", manifest.version);
            // Clean up stale pending zip
            let _ = fs::remove_file(&zip_path);
            return Ok(false);
        }
    }

    let _ = writeln!(log, "[update] Applying pending update v{}...", manifest.version);

    // Verify checksum
    if !verify_sha256(&zip_path, &bundle.sha256)? {
        let _ = fs::remove_file(&zip_path);
        return Err("Pending update failed SHA256 verification".into());
    }

    // Extract to staging directory
    let staging = updates.join("runtime_staging");
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| format!("clean staging: {e}"))?;
    }
    extract_zip(&zip_path, &staging)?;

    // Set executable permissions (unix)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for name in ["diligent-web-server", "rg"] {
            let bin = staging.join(name);
            if bin.exists() {
                let _ = fs::set_permissions(&bin, fs::Permissions::from_mode(0o755));
            }
        }
    }

    // Write version.json into staging
    let version_info = InstalledVersion {
        version: manifest.version.clone(),
        applied_at: chrono::Local::now().to_rfc3339(),
        sha256: bundle.sha256.clone(),
    };
    fs::write(
        staging.join("version.json"),
        serde_json::to_string_pretty(&version_info).unwrap(),
    )
    .map_err(|e| format!("write version.json: {e}"))?;

    // Atomic swap: remove old runtime, rename staging
    let runtime = updates.join("runtime");
    if runtime.exists() {
        fs::remove_dir_all(&runtime).map_err(|e| format!("remove old runtime: {e}"))?;
    }
    fs::rename(&staging, &runtime).map_err(|e| format!("rename staging to runtime: {e}"))?;

    // Clean up pending zip
    let _ = fs::remove_file(&zip_path);

    let _ = writeln!(log, "[update] Successfully applied v{}", version_info.version);
    Ok(true)
}

/// Spawn a non-blocking background task that checks for updates and downloads
/// the bundle if a newer version is available.
pub fn spawn_update_check() {
    tauri::async_runtime::spawn(async {
        if let Err(e) = check_and_download().await {
            eprintln!("[update] background check failed: {e}");
        }
    });
}

// ---------------------------------------------------------------------------
// Internal: check + download
// ---------------------------------------------------------------------------

async fn check_and_download() -> Result<(), String> {
    let manifest_url = resolve_manifest_url();
    if manifest_url.is_empty() {
        return Ok(()); // updates disabled
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(format!("diligent-desktop/{}", BUNDLED_RUNTIME_VERSION))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    // 1. Fetch remote manifest
    let manifest: UpdateManifest = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| format!("fetch manifest: {e}"))?
        .json()
        .await
        .map_err(|e| format!("parse manifest: {e}"))?;

    // 2. Save manifest locally
    let updates = updates_dir().ok_or("cannot resolve updates dir")?;
    fs::create_dir_all(&updates).map_err(|e| format!("create updates dir: {e}"))?;
    fs::write(
        updates.join("manifest.json"),
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("serialize manifest: {e}"))?,
    )
    .map_err(|e| format!("write manifest: {e}"))?;

    // 3. Compare versions
    let effective_version = installed_version()
        .map(|v| v.version)
        .unwrap_or_else(|| BUNDLED_RUNTIME_VERSION.to_string());

    if manifest.version == effective_version {
        return Ok(()); // already up to date
    }

    // 4. Resolve platform bundle
    let platform = current_platform();
    let bundle = manifest
        .platforms
        .get(platform)
        .ok_or(format!("no bundle for platform {platform}"))?;

    let pending_dir = updates.join("pending");
    fs::create_dir_all(&pending_dir).map_err(|e| format!("create pending dir: {e}"))?;

    let zip_name = format!("runtime-bundle-{}-{}.zip", manifest.version, platform);
    let zip_path = pending_dir.join(&zip_name);

    // 5. Check if already downloaded and valid
    if zip_path.exists() {
        if verify_sha256(&zip_path, &bundle.sha256)? {
            return Ok(()); // already downloaded
        }
        let _ = fs::remove_file(&zip_path);
    }

    // 6. Download
    let response = client
        .get(&bundle.url)
        .send()
        .await
        .map_err(|e| format!("download bundle: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("read bundle bytes: {e}"))?;

    fs::write(&zip_path, &bytes).map_err(|e| format!("write bundle: {e}"))?;

    // 7. Verify download
    if !verify_sha256(&zip_path, &bundle.sha256)? {
        let _ = fs::remove_file(&zip_path);
        return Err("Downloaded bundle failed SHA256 verification".into());
    }

    eprintln!(
        "[update] Downloaded v{} for {} ({} bytes)",
        manifest.version,
        platform,
        bytes.len()
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal: helpers
// ---------------------------------------------------------------------------

fn verify_sha256(path: &Path, expected: &str) -> Result<bool, String> {
    let data = fs::read(path).map_err(|e| format!("read file for checksum: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hex = format!("{:x}", hasher.finalize());
    Ok(hex == expected)
}

fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("create extract dir: {e}"))?;

    #[cfg(unix)]
    {
        let status = std::process::Command::new("unzip")
            .args([
                "-o",
                &zip_path.to_string_lossy(),
                "-d",
                &dest.to_string_lossy(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| format!("unzip: {e}"))?;
        if !status.success() {
            return Err(format!("unzip exited with {}", status));
        }
    }

    #[cfg(windows)]
    {
        let script = format!(
            "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
            zip_path.display(),
            dest.display()
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| format!("powershell: {e}"))?;
        if !status.success() {
            return Err(format!("Expand-Archive exited with {}", status));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_platform_returns_known_value() {
        let plat = current_platform();
        assert!(
            ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"]
                .contains(&plat),
            "unexpected platform: {plat}"
        );
    }

    #[test]
    fn verify_sha256_correct() {
        let tmp = std::env::temp_dir().join("diligent-test-sha256");
        fs::write(&tmp, b"hello world").unwrap();
        // SHA256 of "hello world"
        let expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
        assert!(verify_sha256(&tmp, expected).unwrap());
        assert!(!verify_sha256(&tmp, "0000").unwrap());
        let _ = fs::remove_file(&tmp);
    }

    #[test]
    fn installed_version_serde_roundtrip() {
        let v = InstalledVersion {
            version: "1.2.3".to_string(),
            applied_at: "2026-03-30T12:00:00+09:00".to_string(),
            sha256: "abc123".to_string(),
        };
        let json = serde_json::to_string(&v).unwrap();
        let parsed: InstalledVersion = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.version, "1.2.3");
        assert_eq!(parsed.sha256, "abc123");
    }

    #[test]
    fn bundled_version_has_value() {
        // In dev builds this is "0.0.0-dev"; in release it's injected.
        assert!(!BUNDLED_RUNTIME_VERSION.is_empty());
    }
}
