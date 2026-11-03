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

The native `apiVersion: 1` envelope separates capabilities from documentation.
The initial public operation contract is `character-authoring/v1`, with
`authored_v1` input documents. Workflow guidance and optional fresh-process
verification belong to the Diligent skill and enriched agent tool.

## Ownership

| Diligent | Studio |
|---|---|
| Anatomy, rig/weight/motion writing instructions and examples | Actual geometry, bone, bind, material and skin reads |
| Tool selection and draft/review/publish/apply sequencing | Native Skeleton, SkeletalMesh and AnimSequence construction |
| Image attachment and quality interpretation | Pose, surface and contact measurements and rendering |
| Optional fresh-process runner and local RPC diagnostics client | Native source replay and source/revision/asset integrity validation |
| Agent convenience validation | Authoritative input, source revision and mutation guards |

## Operation boundaries

| Surface | Input and effect | Persistence |
|---|---|---|
| `animation.read/write` | Existing ODA/general rig; sparse reference-pose Euler delta keys, version-1 animation JSON | Local editable `/Temp/AnimationAssets/` clips; `write` saves the asset, not a published ID |
| `animation.publish` | Uploads a saved clip with its original Skeleton | Each call issues a new numeric asset ID; old IDs remain unchanged |
| `character.build` | Geometry plus separate `authored_v1` rig and dense parent-local quaternion motion, or motion only for an existing rig | A requestId freezes one saved draft; commit validates its exact four revisions |
| `character.inspect` | Source/build, selected observation, or live runtime inspection | Observation may save isolated capture evidence; it does not edit Workspace or advance live playback |
| `character.export` | Committed native draft, either FBX interchange or ordinary native publication | Publication may issue partial IDs on failure; no Workspace placement |
| `character.build(mode=apply)` | Successful publication plus source-graph revision for an inspected source | Creates the result or adds an existing-rig Animation; world save is separate |

The two animation input formats are separate contracts. `motion.document`, travel metadata and
contact intervals belong to `character.build`, not `animation.write`. New authored rigs require
identity root keys; existing-rig motion preserves the original root bind on every frame.
Character draft assets under `/ProceduralCharacters/` are inspected through `character.inspect`,
not by passing their package paths to `animation.read`.

Known native limitation: ordinary `animation` revision hashing does not include `bEnableRootMotion`,
`bForceRootLock` or `RootMotionRootLock`. Changes to those settings alone may escape its revision
conflict check. This is a Studio follow-up, separate from character draft validation.

Scene properties and gameplay scripts use OVERDARE Y-up coordinates; authoring geometry and
native measurements use Unreal Z-up centimetres. A coordinate frame does not prescribe anatomical
facing. The [custom-character skill](../../apps/overdare-ai-agent/bootstrap/skills/custom-character/SKILL.md)
owns facing, camera and runtime-integration guidance.

The existing native build, inspect and export operations remain available. Moving
instructions does not bypass source preservation, publication dependencies,
stale-source rejection, revision/asset integrity or rollback checks.

Draft build does not render review captures automatically. The caller selects
an observation preset relevant to the task; inspection renders that preset when
its revision-bound capture is missing, and `refresh:true` recaptures any preset.
Bone probes use persisted explicit `observationBones`/`bendTestRegions`, without
anatomy guesses. Available presets are operations, not a required checklist.
Commit, publication and apply do not require captures or fresh-process proof.
Their native source/revision/asset integrity checks remain authoritative. Raw
measurements and source-replay integrity success do not certify motion quality.

`character.build(mode=apply)` changes the in-memory Workspace and marks the map
dirty. The agent tool uses the existing shared write lock and captures the
pre-edit rollback baseline; that capture may save the map before apply. Apply
does not save the resulting world. Call `studiorpc_level_save_file` explicitly
after a successful apply to persist it. Draft builds, commit and publication do
not acquire the map write lock or capture/save the world through this policy.

## Optional local source replay

The `custom-character` skill owns `scripts/character-source-proof.py`. Supply an
explicit Studio checkout with `--studio-root`; the script no longer infers a
Studio root from its installation directory. It can drive build/observe or verify
an existing draft in a separate process. Verification copies the saved draft into
an isolated user directory and installs proof only when the original files remain
unchanged. A failed native verification never installs its proof file.
The runner does not automatically replay a build. Invoke `verify-source`
explicitly when useful; its output is external diagnostic evidence and does not
gate commit, publication or apply. An explicit observe request can render its
selected capture and requires rendering support.

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
