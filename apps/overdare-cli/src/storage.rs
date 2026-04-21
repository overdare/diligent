use std::path::{Path, PathBuf};

pub const DEFAULT_STORAGE_NAMESPACE: &str = "diligent";
pub const PACKAGED_STORAGE_NAMESPACE: &str = "overdare";

pub fn storage_namespace() -> &'static str {
	match option_env!("DILIGENT_STORAGE_NAMESPACE") {
		Some(value) if !value.trim().is_empty() => value,
		_ => PACKAGED_STORAGE_NAMESPACE,
	}
}

pub fn hidden_dir_name() -> String {
	format!(".{}", storage_namespace())
}

pub fn legacy_hidden_dir_name() -> String {
	format!(".{}", DEFAULT_STORAGE_NAMESPACE)
}

pub fn global_storage_dir() -> Option<PathBuf> {
	#[cfg(windows)]
	let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
	#[cfg(not(windows))]
	let home = std::env::var_os("HOME").map(PathBuf::from);

	home.map(|h| h.join(hidden_dir_name()))
}

pub fn global_legacy_storage_dir() -> Option<PathBuf> {
	#[cfg(windows)]
	let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
	#[cfg(not(windows))]
	let home = std::env::var_os("HOME").map(PathBuf::from);

	home.map(|h| h.join(legacy_hidden_dir_name()))
}

pub fn local_storage_dir(cwd: &str) -> PathBuf {
	PathBuf::from(cwd).join(hidden_dir_name())
}

pub fn local_legacy_storage_dir(cwd: &str) -> PathBuf {
	PathBuf::from(cwd).join(legacy_hidden_dir_name())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationOutcome {
	Migrated { from: PathBuf, to: PathBuf },
	SkippedNoLegacy,
	SkippedTargetExists,
}

pub fn migrate_namespace_if_needed(legacy: &Path, target: &Path) -> Result<MigrationOutcome, String> {
	if target.exists() {
		return Ok(MigrationOutcome::SkippedTargetExists);
	}
	if !legacy.exists() {
		return Ok(MigrationOutcome::SkippedNoLegacy);
	}
	std::fs::rename(legacy, target)
		.map(|_| MigrationOutcome::Migrated { from: legacy.to_path_buf(), to: target.to_path_buf() })
		.map_err(|e| format!("Failed to migrate {} -> {}: {e}", legacy.display(), target.display()))
}

#[cfg(test)]
mod tests {
	use super::{
		hidden_dir_name, legacy_hidden_dir_name, migrate_namespace_if_needed, storage_namespace, MigrationOutcome,
		PACKAGED_STORAGE_NAMESPACE,
	};
	use std::fs;
	use std::path::PathBuf;

	fn unique_temp_dir(label: &str) -> PathBuf {
		std::env::temp_dir().join(format!(
			"overdare-cli-storage-test-{}-{}-{}",
			label,
			std::process::id(),
			chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
		))
	}

	#[test]
	fn packaged_namespace_defaults_to_overdare() {
		assert_eq!(storage_namespace(), PACKAGED_STORAGE_NAMESPACE);
		assert_eq!(hidden_dir_name(), ".overdare");
		assert_eq!(legacy_hidden_dir_name(), ".diligent");
	}

	#[test]
	fn migrate_namespace_if_needed_moves_legacy_when_target_missing() {
		let root = unique_temp_dir("migrated");
		let legacy = root.join(".diligent");
		let target = root.join(".overdare");
		fs::create_dir_all(&legacy).expect("create legacy dir");
		fs::write(legacy.join("state.txt"), "ok").expect("write legacy file");

		let outcome = migrate_namespace_if_needed(&legacy, &target).expect("migrate namespace");
		assert!(matches!(outcome, MigrationOutcome::Migrated { .. }));
		assert!(!legacy.exists());
		assert_eq!(fs::read_to_string(target.join("state.txt")).expect("read target file"), "ok");

		let _ = fs::remove_dir_all(&root);
	}

	#[test]
	fn migrate_namespace_if_needed_skips_when_legacy_missing() {
		let root = unique_temp_dir("skip-no-legacy");
		let legacy = root.join(".diligent");
		let target = root.join(".overdare");

		let outcome = migrate_namespace_if_needed(&legacy, &target).expect("skip without legacy");
		assert_eq!(outcome, MigrationOutcome::SkippedNoLegacy);
		assert!(!target.exists());
	}

	#[test]
	fn migrate_namespace_if_needed_skips_when_target_exists() {
		let root = unique_temp_dir("skip-target-exists");
		let legacy = root.join(".diligent");
		let target = root.join(".overdare");
		fs::create_dir_all(&legacy).expect("create legacy dir");
		fs::create_dir_all(&target).expect("create target dir");
		fs::write(legacy.join("legacy.txt"), "legacy").expect("write legacy file");

		let outcome = migrate_namespace_if_needed(&legacy, &target).expect("skip when target exists");
		assert_eq!(outcome, MigrationOutcome::SkippedTargetExists);
		assert!(legacy.exists());
		assert!(target.exists());

		let _ = fs::remove_dir_all(&root);
	}
}
