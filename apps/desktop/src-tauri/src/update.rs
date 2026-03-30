// @summary Runtime auto-update: check manifest, download bundle, verify SHA256, apply immediately

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

const DEFAULT_UPDATE_MANIFEST_URL: &str =
    "https://github.com/overdare/diligent/releases/latest/download/update-manifest.json";

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    platforms: std::collections::HashMap<String, PlatformBundle>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
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

fn runtime_dir() -> Option<PathBuf> {
    updates_dir().map(|u| u.join("runtime"))
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

/// Strip a single-line JSONC comment from one line of text.
/// Only strips `//` that appears outside a quoted string, so values like
/// `"url": "https://example.com"` are preserved correctly.
fn strip_jsonc_line_comment(line: &str) -> &str {
    let mut in_string = false;
    let mut escape_next = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if escape_next {
            escape_next = false;
            i += 1;
            continue;
        }
        match chars[i] {
            '\\' if in_string => {
                escape_next = true;
            }
            '"' => {
                in_string = !in_string;
            }
            '/' if !in_string && i + 1 < chars.len() && chars[i + 1] == '/' => {
                // Find the byte offset of this character position and slice there.
                let byte_offset = line
                    .char_indices()
                    .nth(i)
                    .map(|(b, _)| b)
                    .unwrap_or(line.len());
                return &line[..byte_offset];
            }
            _ => {}
        }
        i += 1;
    }
    line
}

fn read_user_config_json() -> Option<serde_json::Value> {
    let path = match global_dir() {
        Some(g) => g.join("config.jsonc"),
        None => return None,
    };
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return None,
    };

    // Strip single-line JSONC comments while respecting quoted strings.
    // A `//` that appears inside a JSON string value must not be treated as a comment.
    let stripped: String = content
        .lines()
        .map(|line| strip_jsonc_line_comment(line))
        .collect::<Vec<_>>()
        .join("\n");

    serde_json::from_str::<serde_json::Value>(&stripped).ok()
}

/// Check if auto-update is disabled via ~/.diligent/config.jsonc `"updateMode": "disabled"`.
fn is_update_disabled() -> bool {
    read_user_config_json()
        .and_then(|val| {
            val.get("updateMode")
                .and_then(|v| v.as_str())
                .map(|s| s == "disabled")
        })
        .unwrap_or(false)
}

/// Resolve the manifest URL.
/// Priority: process env `DILIGENT_UPDATE_URL` > compile-time env > fixed default.
fn resolve_manifest_url() -> String {
    if let Ok(url) = std::env::var("DILIGENT_UPDATE_URL") {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    match option_env!("DILIGENT_UPDATE_URL") {
        Some(url) if !url.is_empty() => url.to_string(),
        _ => DEFAULT_UPDATE_MANIFEST_URL.to_string(),
    }
}

fn runtime_bootstrap_required() -> bool {
    if BUNDLED_RUNTIME_VERSION == "0.0.0-dev" {
        return false;
    }

    let runtime = match runtime_dir() {
        Some(path) => path,
        None => return false,
    };

    let sidecar_name = if cfg!(windows) {
        "diligent-web-server.exe"
    } else {
        "diligent-web-server"
    };

    let has_sidecar = runtime.join(sidecar_name).exists();
    let has_dist = runtime.join("dist/client").exists();

    !(has_sidecar && has_dist)
}

fn should_download_update(
    manifest_version: &str,
    effective_version: &str,
    bootstrap_required: bool,
) -> bool {
    bootstrap_required || manifest_version != effective_version
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

/// Result of fetching update info from the remote manifest.
struct FetchedUpdate {
    version: String,
    sha256: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub enum UpdateProgress {
    Disabled,
    BootstrapRequired,
    Checking { current_version: String },
    Downloading { target_version: String },
    Verifying { target_version: String },
    Extracting { target_version: String },
    Applying { target_version: String },
    UpToDate,
    Updated { target_version: String },
}

fn report_progress(
    progress: &mut Option<&mut dyn FnMut(UpdateProgress)>,
    event: UpdateProgress,
) {
    if let Some(callback) = progress.as_deref_mut() {
        callback(event);
    }
}

#[cfg(windows)]
fn hide_windows_console(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_windows_console(_cmd: &mut std::process::Command) {}

/// Fetch manifest and download bundle on a dedicated thread.
/// reqwest::blocking panics inside an existing tokio runtime (Tauri's setup
/// hook runs in one), so all HTTP work must happen off the async runtime.
fn fetch_update(
    manifest_url: &str,
    effective_version: String,
    bootstrap_required: bool,
    progress: &mut Option<&mut dyn FnMut(UpdateProgress)>,
) -> Result<Option<FetchedUpdate>, String> {
    let manifest_url = manifest_url.to_string();
    let platform = current_platform().to_string();

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(format!("diligent-desktop/{}", BUNDLED_RUNTIME_VERSION))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    // 1. Fetch remote manifest
    let manifest_response = client
        .get(&manifest_url)
        .send()
        .map_err(|e| format!("fetch manifest: {e}"))?;

    if !manifest_response.status().is_success() {
        return Err(format!(
            "fetch manifest failed: HTTP {} ({})",
            manifest_response.status(),
            manifest_url
        ));
    }

    let manifest_body = manifest_response
        .text()
        .map_err(|e| format!("read manifest body: {e}"))?;

    let manifest: UpdateManifest = serde_json::from_str(&manifest_body).map_err(|e| {
        let preview = manifest_body
            .replace('\n', " ")
            .chars()
            .take(180)
            .collect::<String>();
        format!(
            "parse manifest: {e} (url: {}, body preview: {})",
            manifest_url, preview
        )
    })?;

    // 2. Compare versions
    if !should_download_update(&manifest.version, &effective_version, bootstrap_required) {
        report_progress(progress, UpdateProgress::UpToDate);
        return Ok(None);
    }

    // 3. Resolve platform bundle
    let bundle = manifest
        .platforms
        .get(&platform)
        .ok_or(format!("no bundle for platform {platform}"))?
        .clone();

    report_progress(
        progress,
        UpdateProgress::Downloading {
            target_version: manifest.version.clone(),
        },
    );

    // 4. Download bundle
    let response = client
        .get(&bundle.url)
        .send()
        .map_err(|e| format!("download bundle: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .map_err(|e| format!("read bundle bytes: {e}"))?;

    Ok(Some(FetchedUpdate {
        version: manifest.version,
        sha256: bundle.sha256,
        bytes: bytes.to_vec(),
    }))
}

/// Run the full update cycle synchronously: check manifest, download if newer,
/// verify checksum, and apply immediately.
///
/// Must be called at startup BEFORE sidecar spawn.
/// Returns `Ok(true)` if an update was applied, `Ok(false)` if already up-to-date or disabled.
pub fn run_with_progress(
    log: &mut String,
    mut progress: Option<&mut dyn FnMut(UpdateProgress)>,
) -> Result<bool, String> {
    if is_update_disabled() {
        let _ = writeln!(log, "[update] auto-update disabled via config");
        report_progress(&mut progress, UpdateProgress::Disabled);
        return Ok(false);
    }

    let bootstrap_required = runtime_bootstrap_required();
    if bootstrap_required {
        let _ = writeln!(log, "[update] Runtime bootstrap required (missing updated runtime)");
        report_progress(&mut progress, UpdateProgress::BootstrapRequired);
    }

    let manifest_url = resolve_manifest_url();
    if manifest_url.is_empty() {
        if bootstrap_required {
            return Err(
                "No update URL configured (set DILIGENT_UPDATE_URL at runtime or compile with it), cannot bootstrap runtime".to_string(),
            );
        }
        return Ok(false); // no update URL compiled in
    }

    let effective_version = installed_version()
        .map(|v| v.version)
        .unwrap_or_else(|| BUNDLED_RUNTIME_VERSION.to_string());

    report_progress(
        &mut progress,
        UpdateProgress::Checking {
            current_version: effective_version.clone(),
        },
    );

    let _ = writeln!(log, "[update] Checking for updates (current: v{effective_version})...");

    let fetched = match fetch_update(
        &manifest_url,
        effective_version.clone(),
        bootstrap_required,
        &mut progress,
    )? {
        Some(f) => f,
        None => {
            let _ = writeln!(log, "[update] Already up-to-date");
            report_progress(&mut progress, UpdateProgress::UpToDate);
            return Ok(false);
        }
    };

    let _ = writeln!(
        log,
        "[update] Downloaded v{} ({} bytes), verifying...",
        fetched.version,
        fetched.bytes.len()
    );

    let updates = updates_dir().ok_or("cannot resolve updates dir")?;
    fs::create_dir_all(&updates).map_err(|e| format!("create updates dir: {e}"))?;

    let platform = current_platform();
    let zip_path = updates.join(format!(
        "runtime-bundle-{}-{}.zip",
        fetched.version, platform
    ));
    fs::write(&zip_path, &fetched.bytes).map_err(|e| format!("write bundle: {e}"))?;

    // Verify checksum
    report_progress(
        &mut progress,
        UpdateProgress::Verifying {
            target_version: fetched.version.clone(),
        },
    );
    if !verify_sha256(&zip_path, &fetched.sha256)? {
        let _ = fs::remove_file(&zip_path);
        return Err("Downloaded bundle failed SHA256 verification".into());
    }

    // Extract to staging directory
    let staging = updates.join("runtime_staging");
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| format!("clean staging: {e}"))?;
    }

    report_progress(
        &mut progress,
        UpdateProgress::Extracting {
            target_version: fetched.version.clone(),
        },
    );
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
        version: fetched.version.clone(),
        applied_at: chrono::Local::now().to_rfc3339(),
        sha256: fetched.sha256.clone(),
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

    report_progress(
        &mut progress,
        UpdateProgress::Applying {
            target_version: fetched.version.clone(),
        },
    );
    fs::rename(&staging, &runtime).map_err(|e| format!("rename staging to runtime: {e}"))?;

    // Clean up zip
    let _ = fs::remove_file(&zip_path);

    let _ = writeln!(
        log,
        "[update] Successfully updated to v{}",
        version_info.version
    );

    report_progress(
        &mut progress,
        UpdateProgress::Updated {
            target_version: version_info.version.clone(),
        },
    );

    Ok(true)
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
        let mut cmd = std::process::Command::new("powershell");
        hide_windows_console(&mut cmd);

        let status = cmd
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

    #[test]
    fn should_download_when_bootstrap_required_even_same_version() {
        assert!(should_download_update("1.2.3", "1.2.3", true));
    }

    #[test]
    fn should_not_download_when_same_version_and_bootstrap_not_required() {
        assert!(!should_download_update("1.2.3", "1.2.3", false));
    }

    #[test]
    fn should_download_when_version_differs() {
        assert!(should_download_update("1.2.4", "1.2.3", false));
    }
}
