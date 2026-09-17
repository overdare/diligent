# Bootstrap skill lifecycle (OVDR-15018)

## Policy

The launcher owns global product skills, isolated by prod/dev storage root. A
removed product name is revoked permanently, including user-modified copies.
Unrelated user skills and project files are preserved. Runtime discovery and
loading reject revoked names across all discovery roots.

## Implementation sequence

1. Add synthetic lifecycle tests under `apps/overdare-ai-agent/test/` and shared
   runtime discovery/loading tests. Verify the new behavior fails first.
2. Add `bootstrap/skills-manifest.json` with active name/entry pairs and explicit
   cumulative revocations for legacy installs. Validate the manifest against
   source assets during packaging and before launcher deployment.
3. Implement a Rust skill deployment module and integrate it into `init`.
   Persist `.bootstrap-skills-state.json` with desired inventory, runtime
identity, cumulative revocations and pending updates. Journal before mutation,
   record successful updates only, retry interrupted updates on ordinary init.
   Serialize global deployment using an OS file lock. Do not follow symlinks
   during destructive operations or copy unvalidated bundle paths.
4. Read the global revocation state in shared runtime discovery and recheck at
   skill execution, covering both Web/TUI and stale cached skill tools. Reject
   malformed policy state rather than treating it as an empty revocation list.
5. Test packaging, migration, repeated pruning, aliases/flat files, partial
   failures, locking, state corruption and project/global discovery. Document
   authoring and operational behavior; commit, push and open a PR.

## State transitions

Every init unions explicit revocations and removed previous names into durable
revocations. An already revoked name cannot be revived by a rollback. Runtime
identity changes or an applied update enqueue active entries for replacement;
otherwise existing active entries are kept. Missing entries and pending updates
are deployed. Revoked entries are pruned on every init regardless of update mode.
Failure to delete leaves the revocation durable and blocks runtime use. Failure
to update leaves pending work for the next init. State is replaced atomically.

Manifest absence supports old bundles without inferring removals. A known state
must still enforce prior revocations on legacy bundles. Invalid manifests/state
must never authorize pruning. Explicit legacy revocations remain in releases so
users can skip versions or lose their local state without restoring retired code.

## Compatibility and limits

The launch command still does not run init unconditionally. Already running
processes recheck revocation when loading a skill; instructions already loaded
into conversation history cannot be retracted. Project and extra-path files are
filtered, not physically deleted. Revocation is product policy, not an OS access
control against users editing all local policy files or running an old binary.

The implementation retains an inventory version across rollback so repeated
downgrades do not misclassify newly introduced skills as retired. Explicit
revocations remain permanent. Rename cleanup is also journaled until successful.
