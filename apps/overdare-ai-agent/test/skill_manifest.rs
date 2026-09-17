// @summary Regression tests for global bootstrap skill ownership and replay.
#[path = "../src/skill_manifest.rs"]
mod skill_manifest;

use skill_manifest::{deploy_skills, DeploymentLock};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "skill-manifest-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("global")).unwrap();
        Self(root)
    }
    fn global(&self) -> PathBuf {
        self.0.join("global")
    }
    fn source(&self) -> PathBuf {
        self.0.join("bootstrap")
    }
    fn bundle(&self, active: &[&str], revoked: &[&str]) {
        let source = self.source();
        if source.exists() {
            fs::remove_dir_all(&source).unwrap();
        }
        fs::create_dir_all(source.join("skills")).unwrap();
        for name in active {
            write(
                &source.join("skills").join(name).join("SKILL.md"),
                &skill(name, "bundle"),
            );
        }
        let entries = |names: &[&str]| {
            names
                .iter()
                .map(|name| serde_json::json!({"name":name,"entry":name}))
                .collect::<Vec<_>>()
        };
        write(&source.join("skills-manifest.json"), &serde_json::json!({"schemaVersion":1,"skills":entries(active),"revoked":entries(revoked)}).to_string());
    }
    fn run(&self, version: &str, updated: bool) -> Result<(), String> {
        deploy_skills(&self.source(), &self.global(), version, updated)
    }
    fn installed(&self, name: &str) -> PathBuf {
        self.global().join("skills").join(name).join("SKILL.md")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}
fn skill(name: &str, body: &str) -> String {
    format!("---\nname: {name}\ndescription: fixture\n---\n{body}\n")
}

#[test]
fn installs_missing_updates_bundled_and_preserves_user_entries() {
    let f = Fixture::new();
    f.bundle(&["official"], &[]);
    write(&f.installed("custom"), &skill("custom", "user"));
    f.run("v1", true).unwrap();
    write(&f.installed("official"), &skill("official", "edited"));
    f.run("v1", false).unwrap();
    assert!(fs::read_to_string(f.installed("official"))
        .unwrap()
        .contains("edited"));
    f.bundle(&["official", "new-skill"], &[]);
    f.run("v2", true).unwrap();
    assert!(fs::read_to_string(f.installed("official"))
        .unwrap()
        .contains("bundle"));
    assert!(f.installed("new-skill").exists());
    assert!(fs::read_to_string(f.installed("custom"))
        .unwrap()
        .contains("user"));
    fs::remove_dir_all(f.installed("official").parent().unwrap()).unwrap();
    f.run("v2", false).unwrap();
    assert!(f.installed("official").exists());
}

#[test]
fn removed_modified_skills_stay_revoked_after_recreation_and_rollback() {
    let f = Fixture::new();
    f.bundle(&["bad"], &[]);
    f.run("v1", true).unwrap();
    write(&f.installed("bad"), &skill("bad", "modified"));
    f.bundle(&[], &[]);
    f.run("v3", true).unwrap();
    assert!(!f.installed("bad").exists());
    write(&f.installed("bad"), &skill("bad", "recreated"));
    f.run("v3", false).unwrap();
    assert!(!f.installed("bad").exists());
    f.bundle(&["bad"], &[]);
    f.run("v1", true).unwrap();
    assert!(!f.installed("bad").exists());
}

#[test]
fn legacy_revocations_remove_aliases_and_flat_files_without_local_state() {
    let f = Fixture::new();
    f.bundle(&[], &["bad"]);
    write(
        &f.installed("renamed"),
        &skill("'bad' # YAML comment", "edited"),
    );
    write(&f.global().join("skills/flat.md"), &skill("bad", "flat"));
    write(&f.installed("custom"), &skill("custom", "preserved"));
    f.run("v2", false).unwrap();
    assert!(!f.installed("renamed").exists());
    assert!(!f.global().join("skills/flat.md").exists());
    assert!(f.installed("custom").exists());
}

#[test]
fn corrupt_manifest_or_state_never_authorizes_deletion() {
    let f = Fixture::new();
    f.bundle(&["official"], &[]);
    f.run("v1", true).unwrap();
    write(&f.source().join("skills-manifest.json"), "{");
    assert!(f.run("v2", true).is_err());
    assert!(f.installed("official").exists());
    f.bundle(&[], &["official"]);
    write(&f.global().join(".bootstrap-skills-state.json"), "{");
    assert!(f.run("v2", true).is_err());
    assert!(f.installed("official").exists());
}

#[test]
fn interrupted_update_replays_without_another_runtime_update() {
    let f = Fixture::new();
    f.bundle(&["official"], &[]);
    f.run("v1", true).unwrap();
    let state_path = f.global().join(".bootstrap-skills-state.json");
    let mut state: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&state_path).unwrap()).unwrap();
    state["pending"] = serde_json::json!(["official"]);
    write(&state_path, &state.to_string());
    write(&f.installed("official"), &skill("official", "old"));
    f.run("v1", false).unwrap();
    assert!(fs::read_to_string(f.installed("official"))
        .unwrap()
        .contains("bundle"));
    let state: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(state_path).unwrap()).unwrap();
    assert_eq!(state["pending"], serde_json::json!([]));
}

#[test]
fn rejects_traversal_and_missing_source_before_pruning() {
    let f = Fixture::new();
    f.bundle(&["official"], &[]);
    f.run("v1", true).unwrap();
    f.bundle(&["new"], &["official"]);
    fs::remove_file(f.source().join("skills/new/SKILL.md")).unwrap();
    assert!(f.run("v2", true).is_err());
    assert!(f.installed("official").exists());
    write(
        &f.source().join("skills-manifest.json"),
        r#"{"schemaVersion":1,"skills":[],"revoked":[{"name":"bad","entry":"../outside"}]}"#,
    );
    assert!(f.run("v2", true).is_err());
}

#[test]
fn deployment_lock_excludes_another_writer_and_releases_on_drop() {
    let f = Fixture::new();
    let lock = DeploymentLock::acquire(&f.global()).unwrap();
    assert!(DeploymentLock::try_acquire(&f.global()).unwrap().is_none());
    drop(lock);
    assert!(DeploymentLock::try_acquire(&f.global()).unwrap().is_some());
}

#[test]
fn failed_copy_keeps_old_content_and_retries_on_ordinary_init() {
    let f = Fixture::new();
    f.bundle(&["official"], &[]);
    f.run("v1", true).unwrap();
    write(&f.installed("official"), &skill("official", "old content"));
    let obstruction = f.global().join(".bootstrap-skills-staging/official");
    fs::remove_dir_all(&obstruction).unwrap();
    write(&obstruction, "not a directory");
    f.run("v2", true).unwrap();
    assert!(fs::read_to_string(f.installed("official"))
        .unwrap()
        .contains("old content"));
    let state: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(f.global().join(".bootstrap-skills-state.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(state["pending"], serde_json::json!(["official"]));
    fs::remove_file(obstruction).unwrap();
    f.run("v2", false).unwrap();
    assert!(fs::read_to_string(f.installed("official"))
        .unwrap()
        .contains("bundle"));
}

#[test]
fn legacy_bundle_does_not_revoke_missing_skills_or_restore_revoked_ones() {
    let f = Fixture::new();
    f.bundle(&["official"], &["bad"]);
    f.run("v2", true).unwrap();
    f.bundle(&["bad"], &[]);
    fs::remove_file(f.source().join("skills-manifest.json")).unwrap();
    f.run("v1", true).unwrap();
    assert!(f.installed("official").exists());
    assert!(!f.installed("bad").exists());
    f.bundle(&[], &[]);
    f.run("v3", true).unwrap();
    assert!(!f.installed("official").exists());
}

#[test]
fn runtime_change_replays_update_even_if_update_flag_was_lost() {
    let f = Fixture::new();
    f.bundle(&["official"], &[]);
    f.run("v1", true).unwrap();
    write(&f.installed("official"), &skill("official", "old"));
    f.run("v2", false).unwrap();
    assert!(fs::read_to_string(f.installed("official"))
        .unwrap()
        .contains("bundle"));
}

#[test]
fn repeated_rollback_does_not_revoke_skills_introduced_in_a_later_release() {
    let f = Fixture::new();
    f.bundle(&["later"], &[]);
    f.run("2.0.0", true).unwrap();
    f.bundle(&[], &[]);
    f.run("1.0.0", true).unwrap();
    f.run("1.0.0", false).unwrap();
    assert!(f.installed("later").exists());
    f.bundle(&["later"], &[]);
    f.run("2.0.0", true).unwrap();
    let state: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(f.global().join(".bootstrap-skills-state.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(state["revoked"], serde_json::json!([]));
    f.bundle(&[], &[]);
    f.run("3.0.0", true).unwrap();
    assert!(!f.installed("later").exists());
}

#[test]
fn ordinary_first_init_adopts_existing_active_skills_without_overwriting() {
    let f = Fixture::new();
    f.bundle(&["official"], &[]);
    write(&f.installed("official"), &skill("official", "edited"));
    f.run("v1", false).unwrap();
    assert!(fs::read_to_string(f.installed("official"))
        .unwrap()
        .contains("edited"));
    f.bundle(&[], &[]);
    f.run("v2", true).unwrap();
    assert!(!f.installed("official").exists());
}

#[test]
fn rust_deployer_accepts_the_packaged_repository_manifest() {
    let f = Fixture::new();
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("bootstrap");
    deploy_skills(&source, &f.global(), "fixture", true).unwrap();
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(source.join("skills-manifest.json")).unwrap())
            .unwrap();
    for entry in manifest["skills"].as_array().unwrap() {
        assert!(f.installed(entry["entry"].as_str().unwrap()).exists());
    }
    for entry in manifest["revoked"].as_array().unwrap() {
        assert!(!f.installed(entry["entry"].as_str().unwrap()).exists());
    }
}

#[test]
fn cli_skip_update_deploys_policy_and_skills_to_the_selected_global_root() {
    let f = Fixture::new();
    f.bundle(&["official"], &["bad"]);
    let global = f.0.join(".overdare-dev");
    let runtime = global.join("updates/runtime");
    fs::create_dir_all(runtime.join("dist/client")).unwrap();
    let binary = if cfg!(windows) {
        "diligent-web-server.exe"
    } else {
        "diligent-web-server"
    };
    write(&runtime.join(binary), "fixture");
    write(
        &runtime.join("version.json"),
        r#"{"version":"1.0.0","applied_at":"fixture","sha256":"fixture"}"#,
    );
    fs::rename(f.source(), runtime.join("bootstrap")).unwrap();
    write(&global.join("skills/bad/SKILL.md"), &skill("bad", "edited"));
    write(
        &global.join("skills/custom/SKILL.md"),
        &skill("custom", "user"),
    );
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_overdare-ai-agent"))
        .args(["--agent-env=dev", "init", "--skip-update"])
        .env("HOME", &f.0)
        .env("USERPROFILE", &f.0)
        .env_remove("SENTRY_DSN")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("INIT_RESULT=skipped"));
    assert!(global.join("skills/official/SKILL.md").exists());
    assert!(global.join("skills/custom/SKILL.md").exists());
    assert!(!global.join("skills/bad").exists());
    assert!(global.join(".bootstrap-skills-state.json").exists());
    assert!(!global.join("skills-manifest.json").exists());
    assert!(!f.0.join(".overdare").exists());
}

#[cfg(unix)]
#[test]
fn refuses_a_symlinked_global_skills_root_without_touching_external_files() {
    let f = Fixture::new();
    f.bundle(&[], &["bad"]);
    let outside = f.0.join("outside");
    write(&outside.join("bad/SKILL.md"), &skill("bad", "external"));
    std::os::unix::fs::symlink(&outside, f.global().join("skills")).unwrap();
    assert!(f.run("v1", true).is_err());
    assert!(outside.join("bad/SKILL.md").exists());
}

#[cfg(unix)]
#[test]
fn failed_deletion_keeps_a_durable_revocation_and_retries() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    f.bundle(&[], &["bad"]);
    write(&f.installed("bad"), &skill("bad", "edited"));
    let skills = f.global().join("skills");
    fs::set_permissions(&skills, fs::Permissions::from_mode(0o555)).unwrap();
    let result = f.run("1.0.0", false);
    fs::set_permissions(&skills, fs::Permissions::from_mode(0o755)).unwrap();
    result.unwrap();
    // Directory removal cannot finish without write permission on its parent.
    assert!(skills.join("bad").exists());
    let state: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(f.global().join(".bootstrap-skills-state.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(state["revoked"][0]["name"], "bad");
    f.run("1.0.0", false).unwrap();
    assert!(!skills.join("bad").exists());
}

#[cfg(unix)]
#[test]
fn revoked_symlink_is_unlinked_without_deleting_its_target() {
    let f = Fixture::new();
    f.bundle(&[], &["bad"]);
    let external = f.0.join("outside");
    write(&external.join("SKILL.md"), &skill("bad", "outside"));
    fs::create_dir_all(f.global().join("skills")).unwrap();
    std::os::unix::fs::symlink(&external, f.global().join("skills/bad")).unwrap();
    f.run("v1", true).unwrap();
    assert!(external.join("SKILL.md").exists());
    assert!(fs::symlink_metadata(f.global().join("skills/bad")).is_err());
}
