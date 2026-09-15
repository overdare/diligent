# Bootstrap skill deployment

The OVERDARE launcher deploys product skills globally, to `~/.overdare/skills`
for prod and `~/.overdare-dev/skills` for dev. All worlds under the same user and
environment share these files. Project skill files are never deleted by init.

## Release manifest

`apps/overdare-ai-agent/bootstrap/skills-manifest.json` contains:

```json
{
  "schemaVersion": 1,
  "skills": [{ "name": "example", "entry": "example" }],
  "revoked": [{ "name": "retired-example", "entry": "retired-example" }]
}
```

`name` is the YAML `name` in `SKILL.md`. `entry` is one directory component under
`skills/`, not an absolute or relative path. Entries use the same kebab-case
syntax as skill names. Names and entries must be unique across both lists.
Active names must match their source `SKILL.md`. Build validation rejects missing
assets, unlisted skills, duplicate entries and symlinks. Non-skill workspaces
without a top-level `SKILL.md` are not part of the managed inventory.

When adding a skill, add its name/entry to `skills`. When retiring one, remove it
from `skills` and append it to `revoked`. **Keep explicit revocations in every
later release.** They cover users without local state, skipped releases, and
state loss. Retired source folders can be deleted; the two historical UI skill
tombstones remain in the source for compatibility with older consumers.

Packaging copies bootstrap into the bundle's `defaults/` directory. Init prefers
`bootstrap/` when present and otherwise reads `defaults/`. The manifest is read
as deployment metadata, not copied as an ordinary global user config file.

## Local state and retries

The launcher writes `.bootstrap-skills-state.json` directly under the selected
global storage root. The state has `schemaVersion: 1` and these fields:

| Field | Meaning |
| --- | --- |
| `runtimeVersion` | Runtime whose deployment was last attempted |
| `inventoryVersion` | Version of the inventory used to infer removals; retained on rollback |
| `skills` | Known managed name/entry pairs (desired inventory, not a success receipt) |
| `revoked` | Cumulative revoked name/entry pairs |
| `pending` | Active skill names whose replacement has not completed |
| `cleanup` | Old managed directory names awaiting cleanup after an entry rename |

Every init holds an OS lock on `.bootstrap-deploy.lock`, including deployment of
other bootstrap assets. The lock releases on process exit; its file stays in
place. A competing init waits at most ten seconds and reports a retryable busy
message if the lock remains held.

Before mutating skills, init atomically journals the inventory, revocations and
pending replacements. It then:

1. Removes previously managed names absent from a later manifest, plus explicit
   revocations. Repeated rollback to an older runtime does not retire newer names.
2. Removes revoked global entries even if the user edited them. The global scan
   also removes aliases and flat Markdown files whose YAML name is revoked.
   Symlinks are unlinked; their external targets are not recursively deleted.
3. On an applied runtime update, replaces all active product entries. A runtime
   identity change also completes an update interrupted before skill deployment.
4. On ordinary init, keeps existing active entries, installs missing entries and
   retries pending replacements. Unrelated user entries are preserved.
5. Records each successful replacement. Failure leaves pending work for next init.

Skill replacements stage content under `.bootstrap-skills-staging/<entry>/`.
The old entry is moved aside before publishing the new one and restored on
publication failure. A subsequent replacement recovers a crash between those
renames. Failed deletions remain durably revoked and are retried every init.

Malformed manifests or state do not mean an empty inventory: init reports an
error before pruning. Old bundles without manifests cannot introduce removals;
previous revocations still apply. Never manually clear `revoked` to fix an
installation. Use a new skill name for a replacement workflow.

## Runtime enforcement

Shared runtime discovery filters revoked names before exposing skills to Web or
TUI. This applies to global, project and configured additional roots. Skill
execution rechecks the state, including a cached tool created before revocation.
The OVERDARE MCP `load_skill` path uses the same global policy even though its
skill content comes directly from the runtime bundle.

Unreadable or malformed existing policy fails closed for skill discovery/loading.
With no state file, generic Diligent and installations predating this feature
retain their existing behavior. This feature requires the updated launcher and
runtime; an older launcher does not implement managed pruning.

`start` does not unconditionally run init. Studio must continue its init-before-
start lifecycle. A running conversation may already contain previously loaded
instructions; revocation prevents subsequent skill loads, not historical context
or direct filesystem access. Project/extra-path files remain on disk even when
their revoked name is unavailable. This is product lifecycle policy, not access
control against local users modifying policy files or running old binaries.

## Verification

```sh
cargo test --manifest-path apps/overdare-ai-agent/Cargo.toml --test skill-manifest
bun test ./packages/runtime/test/skills ./packages/runtime/test/tools/skill.test.ts
bun test ./apps/overdare-ai-agent/test/scripts/skills-manifest.test.ts
bun test ./apps/overdare-ai-agent/sidecar/test/mcp-server.test.ts
```

Rust 1.89 or newer is required for standard-library file locking.
