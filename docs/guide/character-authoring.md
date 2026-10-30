# Character authoring ownership

The OVERDARE sidecar owns character authoring instructions and external workflow
orchestration. Studio owns native asset access, evaluation and mutation.

## Capability and guidance boundary

The native `character.api` response contains the input contract version, capability
envelope version, method and source identifiers, coordinate/pose formats, native
limits and target-specific publication/apply availability. Studio does not return
an authoring tutorial, quality-review procedure or a local Python runner path.

`studiorpc_character_api` calls that native method and preserves its response
fields. The sidecar adds `authoringGuide` from
`apps/overdare-ai-agent/bootstrap/skills/custom-character/references/authoring.json`.
The guide contains request explanations, data-writing instructions, workflow and
measurement interpretation. It is imported into the sidecar bundle and also
deployed with the skill's references.

The guide's `studioContract` must match the native input contract `version`.
Unknown versions keep their native capabilities and receive an unavailable guide
marker. Transport errors propagate; local documentation cannot turn an unavailable
Studio into a successful capability query. Native limits are never replaced by
values from the guide.

The native `apiVersion: 2` envelope separates capabilities from documentation.
The authored input contract remains `character-authoring/v15`. Native callers that
previously read workflow text or `verificationRunner` should use the Diligent
skill or the enriched agent tool instead.

## Ownership

| Diligent | Studio |
|---|---|
| Anatomy, rig/weight/motion writing instructions and examples | Actual geometry, bone, bind, material and skin reads |
| Tool selection and draft/review/publish/apply sequencing | Native Skeleton, SkeletalMesh and AnimSequence construction |
| Image attachment and quality interpretation | Pose, surface and contact measurements and rendering |
| External fresh-process runner and local RPC diagnostics client | Saved-source replay and revision-bound proof validation |
| Agent convenience validation | Authoritative input, source revision and mutation guards |

The existing native build, inspect and export operations remain available. Moving
instructions does not bypass source preservation, publication dependencies,
stale-source rejection, commit evidence or rollback checks.

`character.build(mode=apply)` changes the in-memory Workspace and marks the map
dirty. The agent tool uses the existing shared write lock and captures the
pre-edit rollback baseline; that capture may save the map before apply. Apply
does not save the resulting world. Call `studiorpc_level_save_file` explicitly
after a successful apply to persist it. Draft builds, commit and publication do
not acquire the map write lock or capture/save the world through this policy.

## Local source verification

The `custom-character` skill owns `scripts/character-source-proof.py`. Supply an
explicit Studio checkout with `--studio-root`; the script no longer infers a
Studio root from its installation directory. It can drive build/observe or verify
an existing draft in a separate process. Verification copies the saved draft into
an isolated user directory and installs proof only when the original files remain
unchanged. A failed native verification never installs its proof file.

The optional `scripts/character-tools.py` is an explicit-port native RPC diagnostic
client. Normal agent execution uses the bundled Studio tools. Both scripts ship
with the skill, rather than as Studio EditorResource assets.

## Validation

The method tests cover live capability preservation, guide version compatibility,
transport errors and existing character requests. Source-runner tests cover proof
installation, source changes and failed native verification. MCP and bootstrap
inventory tests cover tool discovery and skill deployment. Studio's
`FMCPCharacterApiBoundaryTest` verifies the native envelope, absence of agent
guidance and compiled-target availability.
