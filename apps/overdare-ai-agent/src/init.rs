use std::collections::BTreeSet;
use std::fmt::Write as FmtWrite;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::env::Env;
use crate::skill_manifest::{reject_symlink, remove_entry, valid_name};
use crate::storage::global_storage_dir;

const PLUGIN_MANIFEST: &str = "plugins-manifest.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluginRevocations {
    schema_version: u32,
    revoked: BTreeSet<String>,
}

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

/// Deploy mode for a single bootstrap file. `config.jsonc` holds user settings
/// (model, permissions/commit delegation, tool toggles, MCP servers) that only
/// ever live in the global config; an applied update must never clobber it, so
/// force MissingOnly regardless of the run's mode. Every other bootstrap file
/// (e.g. system-prompt.txt) keeps the run's mode and still FullSyncs on update.
fn deploy_mode_for_file(name: &str, mode: DeployMode) -> DeployMode {
    if name == "config.jsonc" {
        DeployMode::MissingOnly
    } else {
        mode
    }
}

fn resolve_updated_bootstrap_dir(env: Env, log: &mut String) -> Option<PathBuf> {
    // Resolve bootstrap/defaults from the active runtime directory (versioned
    // pointer first, legacy flat dir as fallback) so init deploys assets from
    // the same runtime that start will launch.
    let runtime = crate::update::current_runtime_dir(env)?;

    let bootstrap = runtime.join("bootstrap");
    if bootstrap.exists() {
        let _ = writeln!(
            log,
            "[init] Using updated bootstrap path: {}",
            bootstrap.display()
        );
        return Some(bootstrap);
    }

    let defaults = runtime.join("defaults");
    if defaults.exists() {
        let _ = writeln!(
            log,
            "[init] Falling back to legacy defaults path: {}",
            defaults.display()
        );
        return Some(defaults);
    }

    None
}

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

/// Per-init staging directory under the global storage root. Kept OUT of the
/// scanned skills/agents dirs so a crash mid-swap can't leave a partial copy
/// that discovery would mistake for a real skill/agent.
fn staging_dir(global: &Path) -> PathBuf {
    global.join(".init-staging")
}

/// Deploy one entry atomically: fully copy it into `staging` first, then swap it
/// into place (drop the old entry, rename the staged copy in). Rename is atomic
/// on the same filesystem, so the destructive window shrinks from a whole
/// recursive copy to a single rename — if staging the copy fails, `dest` is left
/// intact instead of half-deleted, and the error propagates to the caller.
fn stage_and_swap(src: &Path, dest: &Path, staging: &Path) -> std::io::Result<()> {
    fs::create_dir_all(staging)?;
    let staged = staging.join(dest.file_name().unwrap_or_default());
    let _ = fs::remove_dir_all(&staged);
    let _ = fs::remove_file(&staged);

    // 1. Stage the new content. A failure here leaves dest untouched.
    if src.is_dir() {
        copy_dir_recursive(src, &staged)?;
    } else {
        fs::copy(src, &staged)?;
    }

    // 2. Swap it in: remove the old entry, then move the staged copy into place.
    if dest.is_dir() {
        fs::remove_dir_all(dest)?;
    } else if dest.exists() {
        fs::remove_file(dest)?;
    }
    fs::rename(&staged, dest)
}

fn deploy_plugins(
    src: &Path,
    dest: &Path,
    staging: &Path,
    log: &mut String,
    mode: DeployMode,
) -> std::io::Result<()> {
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
                if let Err(e) = stage_and_swap(&src_plugin, &dest_plugin, staging) {
                    // Log and keep going: one bad entry must not abort the whole
                    // deploy or block agent start (P077 keeps a bootable install).
                    eprintln!(
                        "[init] Failed to deploy plugins/{}/{}: {e}",
                        name_str,
                        plugin_name.to_string_lossy()
                    );
                }
            }
        } else {
            let exists = dest_child.exists();
            if !should_copy_entry(exists, mode) {
                continue;
            }
            if let Err(e) = stage_and_swap(&src_child, &dest_child, staging) {
                eprintln!("[init] Failed to deploy plugins/{name_str}: {e}");
            }
        }
    }
    Ok(())
}

/// Sync non-skill directories that mix bundled entries and user additions.
/// Skills use skill_manifest's journal and revocation policy instead.
///
/// Explicitly revoked product agents are removed by skill_manifest and skipped
/// here, including on rollback. Other absent entries remain user-owned.
fn deploy_managed_dir(
    src: &Path,
    dest: &Path,
    staging: &Path,
    log: &mut String,
    mode: DeployMode,
) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    let dir_label = dest.file_name().unwrap_or_default().to_string_lossy().into_owned();
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let src_child = entry.path();
        let dest_child = dest.join(&name);
        if dir_label == "agents"
            && crate::skill_manifest::is_agent_revoked(dest.parent().unwrap(), &src_child)
                .map_err(std::io::Error::other)?
        {
            continue;
        }
        let exists = dest_child.exists();
        if !should_copy_entry(exists, mode) {
            let _ = writeln!(
                log,
                "[init] Kept existing {}/{}",
                dir_label,
                name.to_string_lossy()
            );
            continue;
        }
        if let Err(e) = stage_and_swap(&src_child, &dest_child, staging) {
            // Log and keep going: a failed entry leaves its old copy intact
            // (stage_and_swap swaps only after a full copy) and must not abort
            // the deploy or block agent start (P077).
            eprintln!(
                "[init] Failed to deploy {}/{}: {e}",
                dir_label,
                name.to_string_lossy()
            );
        }
    }
    Ok(())
}

/// `@scope/name` or `name`, each component a portable lowercase directory name,
/// so a revocation can never address anything outside `<global>/plugins`.
fn valid_plugin_package(package: &str) -> bool {
    match package.strip_prefix('@') {
        Some(scoped) => scoped
            .split_once('/')
            .is_some_and(|(scope, name)| valid_name(scope) && valid_name(name)),
        None => valid_name(package),
    }
}

/// Plugin packages the product retired, from the bundle's `plugins-manifest.json`.
///
/// Not journaled like agent revocations: only bundles that predate bundled tool
/// providers ship plugins, and their sidecars still load them, so a revocation
/// must not outlive the bundle that declares it.
fn read_plugin_revocations(bootstrap: &Path) -> Result<BTreeSet<String>, String> {
    let json = match fs::read_to_string(bootstrap.join(PLUGIN_MANIFEST)) {
        Ok(json) => json,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(BTreeSet::new()),
        Err(e) => return Err(e.to_string()),
    };
    let manifest: PluginRevocations =
        serde_json::from_str(&json).map_err(|e| format!("invalid plugin manifest: {e}"))?;
    if manifest.schema_version != 1 {
        return Err("unsupported plugin manifest schemaVersion".into());
    }
    if let Some(package) = manifest.revoked.iter().find(|p| !valid_plugin_package(p)) {
        return Err(format!("invalid revoked plugin package: {package}"));
    }
    Ok(manifest.revoked)
}

/// Remove retired product plugins from the global plugin root, where the runtime
/// would otherwise auto-discover and load them. Only listed package names are
/// touched; every other plugin directory is user-owned.
fn remove_revoked_plugins(global: &Path, revoked: &BTreeSet<String>) {
    let root = global.join("plugins");
    'packages: for package in revoked {
        let mut path = root.clone();
        for part in package.split('/') {
            // Never follow a linked plugin root or scope out of global storage.
            if let Err(e) = reject_symlink(&path) {
                eprintln!("[init] Skipped revoked plugin {package}: {e}");
                continue 'packages;
            }
            path.push(part);
        }
        if fs::symlink_metadata(&path).is_err() {
            continue;
        }
        match remove_entry(&path) {
            Ok(()) => eprintln!("[init] Removed revoked plugin {package}"),
            Err(e) => eprintln!("[init] Failed to remove revoked plugin {package}: {e}"),
        }
    }
}

pub fn run(env: Env, update_applied: bool) -> Result<(), String> {
    let mut log = String::new();
    let mode = if update_applied {
        DeployMode::FullSync
    } else {
        DeployMode::MissingOnly
    };
    let Some(global) = global_storage_dir(env) else {
        return Ok(());
    };
    fs::create_dir_all(&global).map_err(|e| format!("Cannot create {}: {e}", global.display()))?;
    let _deployment_lock = crate::skill_manifest::DeploymentLock::acquire(&global)?;
    let Some(bootstrap) = resolve_updated_bootstrap_dir(env, &mut log) else {
        return Ok(());
    };
    // Read the identity beside the captured source, not the mutable active
    // pointer (another launcher may switch that pointer during this init).
    let runtime_version = bootstrap
        .parent()
        .and_then(|runtime| fs::read_to_string(runtime.join("version.json")).ok())
        .and_then(|json| serde_json::from_str::<crate::update::InstalledVersion>(&json).ok())
        .map(|installed| installed.version)
        .unwrap_or_else(|| bootstrap.display().to_string());
    crate::skill_manifest::deploy_skills(&bootstrap, &global, &runtime_version, update_applied)?;
    // Fresh staging dir for atomic swaps; clear any leftovers from a prior crash.
    let staging = staging_dir(&global);
    let _ = fs::remove_dir_all(&staging);
    let entries =
        fs::read_dir(&bootstrap).map_err(|e| format!("Cannot read bootstrap dir: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == "skills"
            || name == "skills-manifest.json"
            || name == "agents-manifest.json"
            || name == PLUGIN_MANIFEST
        {
            continue;
        }
        let src = entry.path();
        let dest = global.join(&name);
        if src.is_file() {
            let existed_before = dest.exists();
            let file_mode = deploy_mode_for_file(&name.to_string_lossy(), mode);
            if should_copy_entry(existed_before, file_mode) {
                if let Err(e) = stage_and_swap(&src, &dest, &staging) {
                    eprintln!("[init] Failed to deploy {}: {e}", name.to_string_lossy());
                }
            }
        } else if src.is_dir() {
            if name.to_string_lossy() == "plugins" {
                let _ = deploy_plugins(&src, &dest, &staging, &mut log, mode);
            } else {
                // Agents (and other bootstrap dirs) mix bundled product
                // entries with user-created ones; sync per-entry so an applied
                // update overwrites bundled names but preserves user additions.
                let _ = deploy_managed_dir(&src, &dest, &staging, &mut log, mode);
            }
        }
    }
    let _ = fs::remove_dir_all(&staging);
    match read_plugin_revocations(&bootstrap) {
        Ok(revoked) => remove_revoked_plugins(&global, &revoked),
        // Cleanup is not needed to boot; a bad manifest must not block start.
        Err(e) => eprintln!("[init] Skipped plugin revocations: {e}"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn managed_dir_overwrites_product_and_preserves_user_entries() {
        // Simulate an applied update (FullSync) syncing bootstrap skills over a
        // global skills dir that holds a bundled skill + a user-made skill.
        let base = std::env::temp_dir()
            .join(format!("overdare-init-managed-fullsync-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let src = base.join("bootstrap-skills");
        let dest = base.join("global-skills");

        // Bootstrap ships one product skill with new content.
        write(&src.join("agent-guide/SKILL.md"), "v2 product");
        // Global dir has the old product skill + a user-created skill.
        write(&dest.join("agent-guide/SKILL.md"), "v1 product");
        write(&dest.join("my-skill/SKILL.md"), "user content");

        let mut log = String::new();
        deploy_managed_dir(&src, &dest, &base.join(".staging"), &mut log, DeployMode::FullSync)
            .unwrap();

        // Product skill overwritten; user skill untouched.
        assert_eq!(
            fs::read_to_string(dest.join("agent-guide/SKILL.md")).unwrap(),
            "v2 product"
        );
        assert_eq!(
            fs::read_to_string(dest.join("my-skill/SKILL.md")).unwrap(),
            "user content",
            "user-created skill must survive an update"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn managed_dir_missing_only_keeps_existing_product_entry() {
        // Non-update run (MissingOnly): don't touch an existing bundled entry.
        let base = std::env::temp_dir().join(format!(
            "overdare-init-managed-missingonly-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        let src = base.join("bootstrap-skills");
        let dest = base.join("global-skills");

        write(&src.join("agent-guide/SKILL.md"), "v2 product");
        write(&dest.join("agent-guide/SKILL.md"), "v1 product");

        let mut log = String::new();
        deploy_managed_dir(&src, &dest, &base.join(".staging"), &mut log, DeployMode::MissingOnly)
            .unwrap();

        assert_eq!(
            fs::read_to_string(dest.join("agent-guide/SKILL.md")).unwrap(),
            "v1 product",
            "MissingOnly must not overwrite an existing entry"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn config_jsonc_is_never_overwritten_on_full_sync() {
        // The whole point of the fix: an applied update (FullSync) must not
        // clobber the user's existing global config.jsonc.
        let mode = deploy_mode_for_file("config.jsonc", DeployMode::FullSync);
        assert_eq!(mode, DeployMode::MissingOnly);
        assert!(!should_copy_entry(true, mode)); // exists -> keep user's file
        assert!(should_copy_entry(false, mode)); // missing -> seed from bootstrap
    }

    #[test]
    fn other_files_still_full_sync() {
        // system-prompt.txt and friends are stock assets: keep overwriting them.
        let mode = deploy_mode_for_file("system-prompt.txt", DeployMode::FullSync);
        assert_eq!(mode, DeployMode::FullSync);
        assert!(should_copy_entry(true, mode));
    }

    #[test]
    fn missing_only_run_is_unchanged_for_config() {
        // On a non-update run the whole deploy is MissingOnly already; the
        // config.jsonc special case must not change that.
        assert_eq!(
            deploy_mode_for_file("config.jsonc", DeployMode::MissingOnly),
            DeployMode::MissingOnly
        );
    }

    #[test]
    fn failed_stage_keeps_existing_dest_intact() {
        // The anti-data-loss guarantee: if staging the new copy fails, the old
        // dest must survive (no remove-then-failed-copy destruction).
        let base = std::env::temp_dir()
            .join(format!("overdare-init-staging-fail-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let missing_src = base.join("does-not-exist");
        let dest = base.join("skill");
        write(&dest.join("SKILL.md"), "old content");

        let result = stage_and_swap(&missing_src, &dest, &base.join(".staging"));

        assert!(result.is_err(), "copying a missing source must fail");
        assert_eq!(
            fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "old content",
            "dest must be untouched when staging fails"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn init_removes_revoked_plugins_and_keeps_others() {
        crate::testutil::with_temp_home("init-plugin-revoke", |_| {
            let global = global_storage_dir(Env::Prod).unwrap();
            let runtime = global.join("updates/runtime");
            write(&runtime.join(crate::update::sidecar_bin_name()), "");
            fs::create_dir_all(runtime.join("dist/client")).unwrap();
            write(
                &runtime.join("bootstrap").join(PLUGIN_MANIFEST),
                r#"{"schemaVersion":1,"revoked":["@overdare/plugin-validator","legacy-tool"]}"#,
            );
            let plugins = global.join("plugins");
            write(&plugins.join("@overdare/plugin-validator/index.js"), "stale");
            write(&plugins.join("legacy-tool/index.js"), "stale");
            write(&plugins.join("@overdare/plugin-other/index.js"), "kept");
            write(&plugins.join("user-plugin/index.js"), "user");

            run(Env::Prod, false).unwrap();

            assert!(!plugins.join("@overdare/plugin-validator").exists());
            assert!(!plugins.join("legacy-tool").exists());
            assert!(
                plugins.join("@overdare/plugin-other/index.js").exists(),
                "an unlisted package in the same scope stays"
            );
            assert!(
                plugins.join("user-plugin/index.js").exists(),
                "user plugins stay"
            );
        });
    }

    #[test]
    fn plugin_revocation_rejects_paths_outside_plugin_root() {
        let base = std::env::temp_dir()
            .join(format!("overdare-init-plugin-paths-{}", std::process::id()));
        for package in ["../skills", "@overdare/../../skills", "@overdare/a/b", "@/x", "/abs"] {
            write(
                &base.join(PLUGIN_MANIFEST),
                &format!(r#"{{"schemaVersion":1,"revoked":["{package}"]}}"#),
            );
            assert!(
                read_plugin_revocations(&base).is_err(),
                "{package} must be rejected"
            );
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn shipped_manifest_revokes_legacy_validator_plugin() {
        // Regression: #418 dropped the provider that superseded this package,
        // and the stale copy came back as a `validatelua` tool.
        let bootstrap = Path::new(env!("CARGO_MANIFEST_DIR")).join("bootstrap");
        assert!(read_plugin_revocations(&bootstrap)
            .unwrap()
            .contains("@overdare/plugin-validator"));
    }
}
