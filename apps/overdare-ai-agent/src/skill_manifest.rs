// @summary Journals global bootstrap skill deployment and permanent name revocation.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

const STATE: &str = ".bootstrap-skills-state.json";
const MANIFEST: &str = "skills-manifest.json";

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    name: String,
    entry: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    skills: Vec<Entry>,
    revoked: Vec<Entry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct State {
    schema_version: u32,
    runtime_version: String,
    #[serde(default)]
    inventory_version: String,
    skills: Vec<Entry>,
    revoked: BTreeSet<Entry>,
    pending: BTreeSet<String>,
    #[serde(default)]
    cleanup: BTreeSet<String>,
}

/// The OS releases the lock on process exit, including crashes. Never unlink the
/// lock file: a second inode would allow concurrent writers to hold separate locks.
pub(crate) struct DeploymentLock {
    _file: File,
}
impl DeploymentLock {
    pub(crate) fn try_acquire(global: &Path) -> Result<Option<Self>, String> {
        let path = global.join(".bootstrap-deploy.lock");
        reject_symlink(&path)?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        match file.try_lock() {
            Ok(()) => Ok(Some(Self { _file: file })),
            Err(std::fs::TryLockError::WouldBlock) => Ok(None),
            Err(std::fs::TryLockError::Error(e)) => Err(e.to_string()),
        }
    }

    pub(crate) fn acquire(global: &Path) -> Result<Self, String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(lock) = Self::try_acquire(global)? {
                return Ok(lock);
            }
            if Instant::now() >= deadline {
                return Err("bootstrap deployment is busy; retry init".into());
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && !name.starts_with('-')
        && !name.ends_with('-')
}

fn validate_entries(entries: &[Entry]) -> Result<(), String> {
    let mut names = BTreeSet::new();
    let mut paths = BTreeSet::new();
    for entry in entries {
        // Entries are one portable directory component; never accept a path.
        if !valid_name(&entry.name)
            || !valid_name(&entry.entry)
            || !names.insert(&entry.name)
            || !paths.insert(&entry.entry)
        {
            return Err("invalid or duplicate bootstrap skill name/entry".into());
        }
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            Err(format!("refusing symlink: {}", path.display()))
        }
        Ok(_) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn validate_tree(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err(format!("bundle contains symlink: {}", path.display()));
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            validate_tree(&entry.map_err(|e| e.to_string())?.path())?;
        }
    } else if !meta.is_file() {
        return Err("bundle contains a special file".into());
    }
    Ok(())
}

fn skill_name(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let normalized = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let mut header = Vec::new();
    let mut closed = false;
    for line in lines {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        header.push(line);
    }
    if !closed {
        return None;
    }
    let yaml: serde_yaml_ng::Value = serde_yaml_ng::from_str(&header.join("\n")).ok()?;
    yaml.get("name")?.as_str().map(str::to_owned)
}

fn read_manifest(source: &Path) -> Result<(Manifest, bool), String> {
    let path = source.join(MANIFEST);
    reject_symlink(&path)?;
    let (manifest, explicit) = match fs::read_to_string(&path) {
        Ok(json) => (
            serde_json::from_str::<Manifest>(&json)
                .map_err(|e| format!("invalid skill manifest: {e}"))?,
            true,
        ),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            // Old bundles have no manifest. Infer only current installable entries,
            // never new revocations. Existing durable revocations still apply.
            let mut skills = Vec::new();
            let dir = source.join("skills");
            reject_symlink(&dir)?;
            if dir.exists() {
                for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
                    let item = item.map_err(|e| e.to_string())?;
                    if let Some(name) = skill_name(&item.path().join("SKILL.md")) {
                        skills.push(Entry {
                            name,
                            entry: item.file_name().to_string_lossy().into_owned(),
                        });
                    }
                }
            }
            (
                Manifest {
                    schema_version: 1,
                    skills,
                    revoked: Vec::new(),
                },
                false,
            )
        }
        Err(e) => return Err(e.to_string()),
    };
    if manifest.schema_version != 1 {
        return Err("unsupported skill manifest schemaVersion".into());
    }
    validate_entries(&manifest.skills)?;
    validate_entries(&manifest.revoked)?;
    let skills_dir = source.join("skills");
    reject_symlink(&skills_dir)?;
    if explicit && skills_dir.exists() {
        for child in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
            let child = child.map_err(|e| e.to_string())?;
            if child.path().join("SKILL.md").exists()
                && !manifest
                    .skills
                    .iter()
                    .chain(&manifest.revoked)
                    .any(|e| e.entry == child.file_name().to_string_lossy())
            {
                return Err(format!(
                    "unlisted bootstrap skill: {}",
                    child.path().display()
                ));
            }
        }
    }
    for active in &manifest.skills {
        if manifest
            .revoked
            .iter()
            .any(|r| r.name == active.name || r.entry == active.entry)
        {
            return Err("active and revoked bootstrap skills overlap".into());
        }
        reject_symlink(&source.join("skills"))?;
        let dir = source.join("skills").join(&active.entry);
        validate_tree(&dir)?;
        if skill_name(&dir.join("SKILL.md")).as_deref() != Some(&active.name) {
            return Err(format!(
                "missing or mismatched SKILL.md for {}",
                active.name
            ));
        }
    }
    Ok((manifest, explicit))
}

fn read_state(global: &Path) -> Result<Option<State>, String> {
    let path = global.join(STATE);
    reject_symlink(&path)?;
    let state: State = match fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json)
            .map_err(|e| format!("invalid bootstrap skill state: {e}"))?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if state.schema_version != 1 {
        return Err("unsupported bootstrap skill state schemaVersion".into());
    }
    validate_entries(&state.skills)?;
    for entry in &state.revoked {
        validate_entries(std::slice::from_ref(entry))?;
    }
    if state
        .pending
        .iter()
        .any(|name| !state.skills.iter().any(|e| &e.name == name))
    {
        return Err("bootstrap skill state has unknown pending entries".into());
    }
    if state
        .cleanup
        .iter()
        .any(|entry| !valid_name(entry) || state.skills.iter().any(|e| &e.entry == entry))
    {
        return Err("invalid bootstrap skill cleanup entry".into());
    }
    Ok(Some(state))
}

fn write_state(global: &Path, state: &State) -> Result<(), String> {
    let tmp = global.join(format!("{STATE}.{}.tmp", std::process::id()));
    reject_symlink(&tmp)?;
    let json = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    let mut file = File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(&json)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&tmp, global.join(STATE)).map_err(|e| e.to_string())
}

fn remove_entry(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        // Do not recurse through links (including Windows directory symlinks).
        Ok(meta) if meta.file_type().is_symlink() => {
            #[cfg(windows)]
            {
                if path.is_dir() {
                    return fs::remove_dir(path);
                }
            }
            fs::remove_file(path)
        }
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn copy_tree(src: &Path, dest: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.file_type().is_symlink() {
        return Err(io::Error::other("refusing bundle symlink"));
    }
    if meta.is_dir() {
        fs::create_dir_all(dest)?;
        for child in fs::read_dir(src)? {
            let child = child?;
            copy_tree(&child.path(), &dest.join(child.file_name()))?;
        }
    } else if meta.is_file() {
        fs::copy(src, dest)?;
    } else {
        return Err(io::Error::other("refusing special file"));
    }
    Ok(())
}

fn replace_entry(source: &Path, dest: &Path, staging: &Path) -> io::Result<()> {
    let fresh = staging.join("new");
    let backup = staging.join("old");
    fs::create_dir_all(staging)?;
    // Recover a crash between moving the old copy aside and publishing the new.
    if fs::symlink_metadata(&backup).is_ok() && fs::symlink_metadata(dest).is_err() {
        fs::rename(&backup, dest)?;
    }
    remove_entry(&fresh)?;
    copy_tree(source, &fresh)?;
    remove_entry(&backup)?;
    let existed = fs::symlink_metadata(dest).is_ok();
    if existed {
        fs::rename(dest, &backup)?;
    }
    if let Err(error) = fs::rename(&fresh, dest) {
        if existed {
            let _ = fs::rename(&backup, dest);
        }
        return Err(error);
    }
    remove_entry(&backup)
}

/// Caller holds DeploymentLock for the whole global init, including legacy assets.
pub(crate) fn deploy_skills(
    source: &Path,
    global: &Path,
    runtime_version: &str,
    updated: bool,
) -> Result<(), String> {
    let (manifest, explicit) = read_manifest(source)?;
    let previous = read_state(global)?;
    let dest = global.join("skills");
    reject_symlink(&dest)?;
    let staging = global.join(".bootstrap-skills-staging");
    reject_symlink(&staging)?;
    // Validate old paths before they may be used in filesystem operations.
    let mut state = previous.unwrap_or(State {
        schema_version: 1,
        runtime_version: runtime_version.into(),
        inventory_version: runtime_version.into(),
        skills: Vec::new(),
        revoked: BTreeSet::new(),
        pending: BTreeSet::new(),
        cleanup: BTreeSet::new(),
    });
    let changed = updated || state.runtime_version != runtime_version;
    // An older release never shipped later skills: absence on rollback is not
    // evidence that the product retired them. Explicit revocations still win.
    let rollback = semver::Version::parse(runtime_version)
        .ok()
        .zip(
            semver::Version::parse(if state.inventory_version.is_empty() {
                &state.runtime_version
            } else {
                &state.inventory_version
            })
            .ok(),
        )
        .is_some_and(|(target, previous)| target < previous);
    let reconcile_removals = explicit && !rollback;
    if reconcile_removals {
        for old in &state.skills {
            if !manifest.skills.iter().any(|e| e.name == old.name) {
                state.revoked.insert(old.clone());
            }
        }
    }
    state.revoked.extend(manifest.revoked);
    // Revocations survive rollback; active entries cannot take over revoked paths.
    let active: Vec<Entry> = manifest
        .skills
        .into_iter()
        .filter(|e| {
            !state
                .revoked
                .iter()
                .any(|r| r.name == e.name || r.entry == e.entry)
        })
        .collect();
    // Keep old inventory across manifest-less bundles so the next manifest can
    // still compute removals even after a legacy rollback.
    let old_entries = state.skills.clone();
    for old in &old_entries {
        if active
            .iter()
            .any(|e| e.name == old.name && e.entry != old.entry)
            && !active.iter().any(|e| e.entry == old.entry)
        {
            state.cleanup.insert(old.entry.clone());
        }
    }
    state
        .cleanup
        .retain(|path| !active.iter().any(|e| &e.entry == path));
    if reconcile_removals {
        state.skills = active.clone();
        state.inventory_version = runtime_version.into();
    } else {
        for entry in &active {
            state
                .skills
                .retain(|old| old.name != entry.name && old.entry != entry.entry);
            state.skills.push(entry.clone());
        }
    }
    state
        .pending
        .retain(|name| active.iter().any(|e| &e.name == name));
    if changed {
        state.pending.extend(active.iter().map(|e| e.name.clone()));
    }
    state.runtime_version = runtime_version.into();
    // Persist revocation and retry intent BEFORE touching skill files. A failed
    // delete remains blocked at runtime and will be attempted again next init.
    write_state(global, &state)?;
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for entry in &state.revoked {
        if let Err(e) = remove_entry(&dest.join(&entry.entry)) {
            eprintln!("[init] Failed to remove revoked skill {}: {e}", entry.name);
        }
    }
    // Clean up a renamed managed entry without revoking its still-active name.
    for path in state.cleanup.clone() {
        match remove_entry(&dest.join(&path)) {
            Ok(()) => {
                state.cleanup.remove(&path);
            }
            Err(e) => eprintln!("[init] Failed to clean old skill entry {path}: {e}"),
        }
    }
    write_state(global, &state)?;
    // YAML names can differ from filenames. Only delete global entries; links
    // are unlinked rather than following their targets for recursive deletion.
    for child in fs::read_dir(&dest).map_err(|e| e.to_string())? {
        let child = child.map_err(|e| e.to_string())?;
        let path = child.path();
        let skill_path = if path.is_dir() {
            path.join("SKILL.md")
        } else {
            path.clone()
        };
        if skill_name(&skill_path).is_some_and(|name| state.revoked.iter().any(|e| e.name == name))
        {
            if let Err(e) = remove_entry(&path) {
                eprintln!(
                    "[init] Failed to remove revoked skill {}: {e}",
                    path.display()
                );
            }
        }
    }
    for entry in &active {
        let target = dest.join(&entry.entry);
        if !state.pending.contains(&entry.name) && fs::symlink_metadata(&target).is_ok() {
            continue;
        }
        state.pending.insert(entry.name.clone());
        write_state(global, &state)?;
        let entry_staging = staging.join(&entry.entry);
        reject_symlink(&entry_staging)?;
        match replace_entry(
            &source.join("skills").join(&entry.entry),
            &target,
            &entry_staging,
        ) {
            Ok(()) => {
                state.pending.remove(&entry.name);
            }
            Err(e) => eprintln!("[init] Failed to deploy skill {}: {e}", entry.name),
        }
        write_state(global, &state)?;
    }
    Ok(())
}
