# Studio session report root-cause investigation

This review tracks all 23 remaining rows in [issue #470](https://github.com/overdare/diligent/issues/470),
using the original row numbers. Rows 2, 4, 15, 17, and 24 were removed by the issue's editor before
this work; they are outside this scope. The baseline is `6e35c4ac` on a detached managed worktree.

The supplied reports establish symptoms in their recorded Studio builds, not reproduction on the
current engine. This repository contains the agent, TCP client, schemas, and bootstrap guidance.
It does not contain Studio's renderer, Luau bindings, CharacterMovement, DataStore implementation,
or the external FeasibilityJudge smoke harness. No live Studio endpoint or report-world fixture
was supplied for this change. The user explicitly excluded work requiring those external sources
or endpoints. The table retains their routing evidence for traceability, but engine and external
harness implementation/reproduction are outside this task. Their causes remain unconfirmed.

The implemented scope consists of six client paths (rows 1, 5, 7, 16, 22, and 26), plus corrections
to Diligent's batching, transform, physics-trial, and harness-contract guidance. No engine row is
declared fixed by the agent's tests.

## Work plan

1. Check the latest issue and main, route each symptom to its owning boundary.
2. Add failing regression tests for reproducible client-side errors.
3. Fix transport diagnostics, screenshot delivery, teleport/stop verdicts, and durable dev bootstrap.
4. Correct evidence guidance without fabricating engine API support or declaring engine bugs fixed.
5. Verify affected tool contracts and record externally owned rows as excluded.

## Findings by issue row

| Row | Finding and evidence | Change or remaining requirement |
|---|---|---|
| 1: RPC stalls | Confirmed client defects: `rpc.ts` collapsed transport failures into generic messages and did not handle peer EOF/close. A closed socket could wait for the full timeout. It also accepted a response without matching its request ID. These do not explain every reported game-thread stall. | Fixed close/error handling, response validation, and structured request/phase/outcome diagnostics; no automatic replay. Original Studio stalls need the precise engine build, socket state, server-side queue/thread traces, and request IDs. |
| 3: Black isolated render | `game.screenshot.ts` forwards `instanceId` and attaches the returned PNG. The client does not implement isolated rendering or move ServerStorage objects into a render world. Bounds prove geometry exists, not that the render pass drew it. | Engine rendering cause unconfirmed. Reproduce the same GUID in ServerStorage and Workspace with identical yaws; retain images, bounds, build ID, and capture logs. Do not temporarily reparent automatically: that changes the world under inspection. |
| 5: Remote PNG inaccessible | Confirmed: `attachImages` reads `result.path` on the agent host and silently omits the image when unavailable. The existing dev shared-directory adapter mapped imports toward Studio but never mapped screenshots back. | Fixed reverse mapping for `path` and `paths`, preserving `studioPath`. A provider-level test verifies inline delivery from a mounted share. Unreadable capture paths now report `imageDelivery.status=unavailable`. The screenshot directory must actually be inside the configured share; the client cannot retrieve an arbitrary remote C: file through a nonexistent file RPC. |
| 6: Capture timing/partial black frame | Input and screenshot are separate RPCs. No atomic render-frame capture API exists in this registry. The client does not composite engine render passes. | Engine capability/rendering investigation required. Collect sequence and capture timestamps plus image comparisons; do not claim a selected animation phase from input completion alone. |
| 7: Teleport/readback mismatch | Confirmed: the teleport branch read the selected character after moving, then preferred `started.landedAt` over that readback and always returned `outcome=teleported`. Read failure was swallowed and the claimed destination still established apparent success. | Fixed verdicts: observed `landedAt`, separate `reportedLandedAt`/`rpcTeleported`, and matched/mismatch/unavailable/rejected classifications. Tests cover contradictory position, absent readback, rejection, and normal success. This verifies immediate placement, not future persistence; authority correction or unit conversion needs engine traces. |
| 8: Nested wait path miss | `pie-input/events.ts` accepts a string instance condition and `pie-input/index.ts` forwards the expanded sequence unchanged. Studio evaluates the condition; `game.observe` uses another engine method. No client path resolver runs between them. | Engine resolver discrepancy remains unconfirmed. Reproduce the full path, root prefix, leaf name ambiguity, client/authority worlds, and exact timing. Guidance preserves atomic held-input sequences rather than splitting them across connections. |
| 9: Velocity revived at recovery | The repository defines LinearVelocity properties but does not implement Physics/Running transitions or network-owned character motion. | Engine cause unconfirmed. Obtain a minimal two-client world and state/velocity trace before constraint creation, after zero velocity, at constraint removal, and at Running recovery. Record network ownership and isolate the constraint from impulses/ragdoll. |
| 10: Ignore profile does not pass gate | Collision tools author profile data and apply it; no character capsule movement implementation is present. Reading a profile name does not establish which profile the movement capsule uses. | Engine/application reproduction required: inspect the capsule's actual response channel, authority state, profile revision, and owner/non-owner motion against the same gate. |
| 11: Enabled write hangs | ProximityPrompt.Enabled is a writable schema property. The reported stall occurred in a gameplay Script, beyond the TCP client's execution path. | Engine binding cause unconfirmed. A minimal existing prompt plus before/after logs and server thread dump is required. Avoid silently treating omission of the write as a fix. |
| 12: DataStore write not read back | The agent repository has no Studio DataStore backend or persistence cache. A script's saved log is not a storage commit trace. | Engine/backend reproduction required: same key/scope, exact non-default payload, write result, immediate and delayed reads, fresh PIE read, backend commit/cache diagnostics. Sandbox/nonpersistent mode must be established before attributing lost persistence. |
| 13: Clone unsupported/partial changes | Editor execution is an independent VM with its own supported member set. `execute-luau-tool.ts` already retains mutation/Undo evidence and avoids replay; property discovery does not advertise methods. The report's unsupported member is engine-side. | Capability remains external. Added guidance to establish duplication support before deleting/moving existing trees and to inspect partial mutations. No invented clone RPC or static substring rejection was added. |
| 14: Descendants did not move | The bootstrap prompt previously guaranteed parent/child propagation for all edits, although the supplied Editor observation contradicts that guarantee. The agent does not implement descendant transforms. | Removed the unconditional guidance and require representative subtree readback before bulk transforms. Actual Editor propagation cause still requires a minimal parent/child fixture and comparison with gameplay. |
| 16: Stop accepted but still running | Confirmed client defect: `game.stop` returned the engine acknowledgement without observing completion. `game.play(restart=true)` always sent stop, even for an already stopped session, then started without confirming stop. | Fixed bounded completion observation, explicit stopPending, initial status check, and restart gating. Tests cover delayed stop, pending/unknown/error states, rejected stop, and already-stopped restart. Engine shutdown liveness remains external. |
| 18: VFX preset name mismatch | Both the schema and catalog specify Resource names. This repository has no VFXPreset setter. One report says a DisplayName works, but some catalog entries have blank display names, so a universal Resource-to-DisplayName replacement is unsupported. | Engine setter/name contract remains unconfirmed. Read schema and PresetName before/after with one Resource and its catalog DisplayName, retaining engine warnings and visual results. No speculative mapping was added. |
| 19: Ninth layout slot | Upsert serializes layout/constraint properties. Child placement in PIE is engine layout code, not a sidecar loop capped at eight children. | Engine layout reproduction required with nine synthetic children, constraints toggled, runtime rects, and a screenshot. Record clipping/scrolling and any script-authored changes. |
| 20: Backpack absent | Bootstrap GUI references already require observing the native selector and representative equipment. Enabled state and replicated Tools are necessary inputs, not evidence that widgets or key bindings exist. Native CoreGui code is outside this repository. | Engine reproduction required with StarterPack and runtime-granted Tool variants, client inventory, equip events, and CoreGui widget diagnostics. |
| 21: Local FBX/asset deletion | The registry contains `asset_manager.image.import` and Asset Store model imports, but no native local-FBX bulk import or registration list/delete methods. | Confirmed capability gap; server implementation/API is required. Do not pass FBX to the PNG importer or declare file staging equivalent to import. Specify resource identities, overwrite/delete behavior, and created GUID readback before implementation. |
| 22: gui-builder broken link | Confirmed: `scripts/dev-cross-studio.sh` installed global links pointing into a source checkout. Deleting a temporary checkout broke the required skill and its references. The packaged Rust installer already copies entries. | Fixed the dev launcher to stage durable copies, replace same-name entries as complete units, preserve unrelated names and old link targets, and retain recoverable backups if restoration fails. Behavior tests include source removal, refreshed nested files, legacy links, copy failure, and installation failure. |
| 23: Harness rejects teleport | Current sidecar deliberately distinguishes `teleported` from navigation `arrived`. No external harness implementation appears in this repository. | Corrected the play-test guide to describe verified teleport success and failure/unverified states. Existing and new tests establish the tool contract; the external harness still needs the corresponding success predicate change. |
| 25: Off navmesh | Direct W movement does not establish the existence of a navigable path or a start polygon. The sidecar forwards engine diagnostics and does not build navmesh. | Cause unconfirmed. Collect start coordinates, nearest valid polygon/distance, navmesh generation state, agent dimensions, and navigation system diagnostics. Teleport cannot validate a walking path. |
| 26: HUD overlap estimate | Confirmed boundary limitation: v1 `collectUiDiagnostics` estimates authored rectangles at 1386x640. AnchorPoint is already applied. Runtime scripts, layouts, constraints, and a different viewport can disagree with these estimates. The exact reported scene was not available. | Added explicit authored-layout provenance and `runtimeVerified=false` to diagnostics; guide output now requires observe/pixel confirmation before changing HUD. Exact false-positive arithmetic remains unconfirmed without the original authored tree and runtime rects. |
| 27: Oversized Editor batch | Source limits are ceilings; a native call cannot be preempted. The report explicitly describes an agent batching mistake, not proof that 500 creations always exceed execution time. | Added small representative batching, cost/subtree verification, and timeout recovery guidance. No source-text instance counter was added: procedural/dynamic creation cannot be inferred safely from substring counts. |
| 28: Repeated physics tuning | The report identifies mixed environmental and physics variables with insufficient recovery measurement. | Added an obstacle/ownership/state baseline, one-mechanism trials, and impact/stop/recovery/later checkpoints to the bootstrap guidance. This is a prompt contract improvement, not empirical proof of changed model behavior or an engine fix. |

## Verification

The regression tests exercise runtime-owned results and propagation, not simulated engine physics.
Transport tests use actual loopback TCP connections; screenshot delivery goes through the shared
provider; launcher tests remove source fixtures and inject copy/rename failures. Stop and teleport
tests prove the client's interpretation of contradictory or incomplete RPC responses.

- Studio tool, MCP, and related regression suites: 459 tests passed across 28 files.
- Durable launcher suite: 10 tests passed (independently rechecked during integration).
- `bun run typecheck`: passed; the final sidecar-only no-emit check also passed.
- `bun run lint`: passed across 1,168 files.
- `bash -n scripts/dev-cross-studio.sh` and `git diff --check`: passed.

None of the externally owned rows above is marked resolved by these client regressions. They were
excluded at the user's request. The minimal evidence listed in the table is a handoff reference,
not additional work scheduled or required to complete the Diligent changes.
