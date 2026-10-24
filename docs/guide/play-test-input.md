# Play-test input

This guide describes the play-test (PIE) input tools that exist in the repository today.

## What they are for

While OVERDARE Studio runs a play test, these tools let the agent play the game — press keys, click, and
walk the character — instead of asking the user to do it by hand and report back.

## Tools

| Tool | Purpose |
|------|---------|
| `studiorpc_game_pie_status` | Whether a play test runs, its `pieSessionId`, and which clients accept input |
| `studiorpc_game_input_inject` | Play an ordered batch of key / pointer events into the running play test |
| `studiorpc_game_character_move_to` | Walk the character to a world position using its navigation |
| `studiorpc_game_character_move_status` | Outcome of a `move_to` request |
| `studiorpc_game_ui_browse` | List the UI on screen with the rectangle each element occupies |
| `studiorpc_viewport_camera_read` | Where the camera on screen is, how much it covers, and what it is aimed at |
| `studiorpc_game_playtest_harness` | Describe, read, install, update, or report saved runs of game-specific Luau harnesses |
| `studiorpc_game_playtest` | Run bounded autonomous/scripted episodes, record evidence, and clean up owned PIE/driver state |

They live in `apps/overdare-ai-agent/sidecar/src/tools/studiorpc/tools/pie-input/` and `…/methods/`, and are
registered by the Studio RPC provider, so they reach the product agent, the TUI, the MCP router, and
`overdare-ai-agent:tools` through the same registry as every other Studio tool.

## Editable UGC playtest harnesses

Diligent prepares a harness from the current project's Lua, GUI, accepted server snapshots, and feedback.
The harness is code inside Studio: a ModuleScript at
`ReplicatedStorage.DiligentPlaytestHarnesses.<name>` and a common LocalScript driver at
`StarterPlayer.StarterPlayerScripts.DiligentPlaytestDriver_<name>`. Installation and updates also maintain the
reserved `DiligentPlaytestAPI` helper ModuleScript beside the adapter. Installation saves the project, reads
the adapter/helper source back, and validates the managed assets. These assets remain available for later runs.

Harness installation and updates await the request's rollback-baseline capture before acquiring the
harness write lock. Snapshot capture uses that same lock, so it must finish before the edit holds it.

New drivers are installed disabled. After run approval, the runner temporarily enables only the selected
managed driver when necessary and restores its original `Enabled` value after owned PIE cleanup. An already
enabled driver is not rewritten; other drivers are never changed. Temporary mutation captures the baseline
before acquiring the write lock. Cancellation uses an independent, bounded cleanup signal. Failed restoration
is reported in `driver.restoration` and marks the tool result as an error without rewriting the game outcome.
An external PIE session is never stopped just to restore a flag. Process termination is not a transactional
rollback; inspect the driver if the process exits before cleanup.

Use `game_playtest_harness` with `operation: "describe"` for the authoring contract. The adapter returns
`observe()` and optional `start()`. It owns compact state, up to 16 useful candidate input batches, their
validity/expiry, expected state changes, real game events, and terminal rules. `start()` can subscribe to
accepted snapshots and feedback. `observe()` must not perform gameplay actions. Convert game objects to
plain JSON facts; the common driver supplies revision, harness identity, and game time.

During PIE, the driver publishes `workspace.DiligentPlaytestFrame_<name>`. The native TypeScript runner
continuously reads it through `game.observe`, even while the decision provider runs or an input batch runs. In the
default `autonomous` mode only multiple-candidate decisions call the configured provider; a single candidate runs directly. Before dispatch, the runner
rechecks the latest frame, action identity, validity key, expiry, and PIE client. Effects are reported from
subsequent state, and success requires an observed adapter terminal. A completed input RPC alone does not
establish a gameplay result.

The maintenance loop is:

1. Inspect the current game's scripts and visible GUI; author/install an adapter.
2. Run `game_playtest` with its `harnessName`, objective, mode, and bounded duration (up to 180 seconds for one
   player, 900 seconds for two).
3. Read `verification`, `diagnostics` and `repeatedFailure` in the result, then the returned `tracePath` and
   `summaryPath`; compare observations, decisions, input replies, effects, checks and game feedback.
4. Read the installed source, improve it using `operation: "update"` and its `expectedSourceHash`, then
   rerun. Source comparison also happens inside the editor transaction to detect intervening edits.

Harness edits are refused during PIE. The runner refuses an existing PIE session, honors cancellation,
and stops only the same session it started. Adapter errors, stale observations, invalid input, model
errors, and session replacement are recorded as runtime failures rather than game defeats. Traces live
under `<cwd>/.overdare/playtests/`. Web and TUI use the existing tool progress/result protocol; MCP exposes
the same registered tools and final results, with the live trace available on disk.
Game-specific candidate quality and truthful terminal rules remain the adapter author's responsibility.

### Typed descriptor helpers

Use the installed helper module to give mixed input/action/expectation arrays a stable strict Luau type:

```lua
--!strict
local P = require(script.Parent.DiligentPlaytestAPI)
local actions: {P.Action} = {}
table.insert(actions, P.action("forward", "Move forward", {
    P.key("W", "press", 100),
    P.wait(50),
}, {
    P.expect("distance", "increase"),
}))
```

The example's `distance` must be a real observed state field in the game-specific adapter. Constructors only
describe actions and checks; they never perform gameplay, choose a strategy, or manufacture an outcome.
`P.Event`, `P.Action`, `P.Expectation`, `P.Intent` and `P.WaitCondition` can annotate empty arrays and controller
variables without `any` casts. Native input bounds, balanced inputs and frame validation still apply.

Helpers include `key(key, action, durationMs?)`, `wait(durationMs, untilCondition?)`,
`look(yawDegrees?, pitchDegrees?, timeoutMs?)`, `click(target, button?)`, `clickAt(x, y, button?)`,
`pointer(x, y)`, `mouseDelta(x, y)`, `scroll(delta)`, `expect(key, op, value?)` and
`action(id, description, events, expectations?)`. Pointer coordinates are normalized. Conditional waits use
the existing input contract, for example `P.wait(1000, {ui = "StartButton", visible = true})`.
An `equals` expectation requires an actual scalar value; `false` is retained, not treated as missing.

Install/update refresh managed helpers alongside the common driver. A reserved-name collision with unrelated
code is rejected, not overwritten. Keep game-specific logic in the adapter. Existing plain-table adapters
continue to use the same observation contract.

### Run modes

`mode: "autonomous"` (default) is model-mediated play: frames with several meaningful candidates call the decision
provider, and `decisionEvidence` measures whether the model's choices were dispatched and had confirmed effects.

`mode: "verification"` is scripted acceptance for a feature or regression. No decision provider is created,
warmed or called, and provider arguments (`decisionProvider`, `model`, `decisionUrl`, `maxVisualAgeMs`,
`observationMode: "structured+image"`) are rejected. When several candidates are offered the runner dispatches the
first one in adapter order and records a `scenario_choice`; singletons and retained intents behave as in autonomous
mode. `decisionEvidence.status` is `not_applicable`, so the harness does not need artificial choice points to look
model-driven. The verdict comes from requirement checks and the game terminal.

### Requirement checks and the driver api

The managed driver (v5) passes an `api` table to `start(api)`:

- `api.declareCheck(id, basis, description?)` declares a checkpoint with status `pending`. `basis` is
  `requirement` for an acceptance criterion from the user's spec, or `auxiliary` for a harness diagnostic such as
  timing or an intermediate pose.
- `api.check(id, status, detail?)` reports `pass` or `fail` (or back to `pending`) with at most 2 KiB of the facts
  that decided it.
- `api.emit(level, message, data?)` logs a game event. The driver assigns ids and republishes each event for
  3 seconds (newest 32), so adapters never keep a growing log in the frame.

Adapters may instead return `checks` from `observe()`; then the driver registry is not published. At most 32 checks
per frame, unique ids. The runner latches each status transition with its detail and returns
`verification = {status, requirement, auxiliary, checks}`. `status` is `passed`, `failed`, `incomplete` or
`not_declared` and covers requirement checks only; auxiliary checks never decide it. Verification is reported next
to the game terminal, never folded into `outcome`: a terminal success with a failed requirement is reported as both.

The frame JSON stays capped at 256 KiB. An oversized frame fails the run with the five largest sections (top-level
keys and `state.*` keys) and their byte counts. Publish current facts; report verdicts through checks and logs
through events instead of accumulating proofs or samples in `state`.

Studio may encode an empty Luau record as `[]`. Only schema-declared record slots (`state`, `decisionState`,
event `data`, check `detail`, and actor-local equivalents) normalize that empty value to `{}`. Populated arrays
and `null` are still rejected there; nested semantic arrays remain arrays. This keeps startup/error frames
readable without weakening the state contract.

Integer input fields (`durationMs`, `timeoutMs`) are rounded to whole milliseconds before validation, because Luau
arithmetic produces fractions.

### Diagnostics and repeated failures

The full saved summary carries `diagnostics`: the episode phase reached (`startup` or `running`), frames observed, the most
frequent readiness waits, the last dispatched action with its input status and failed expectations, counts of action
results with unmet expectations (top keys), the last observer error and plain-language hints. Hints point at the next
thing to check, for example which readiness condition kept a startup from completing, or that a terminal success
came with failed requirement checks. They are never a verdict.
Compact output includes bounded diagnostic previews; read `summaryPath` for complete details or when `outputMode` is `minimal`.

After writing a run, the tool compares it with the newest saved runs of the same harness under
`.overdare/playtests/`. When the same failure signature (outcome plus reason with measured values such as `25030ms`
normalized, step numbers kept) appears in at least three consecutive runs, the result includes
`repeatedFailure = {count, signature, sameSourceHash, runIds, guidance}`. It does not block the run; it tells the
agent to stop rerunning the same hypothesis and to probe the responsible boundary narrowly.

### Compact results and evidence reports

Run responses begin with `runId`, `summaryPath`, `tracePath` and `coveragePath`. Full persisted evidence is not
truncated: `summary.json` retains checks, details, transitions, diagnostics and actor evidence;
`coverage.json` retains all declared targets; `trace.jsonl` retains recorded events. The response itself uses
bounded descriptions and at most eight attention checks (failed, pending, or previously failed).
`omittedChecks` and `omittedAttentionChecks` make omissions explicit. Requirement counts, terminal outcome,
decision participation and cleanup remain separate. A passing final check may still have `everFailed: true`.

Concurrency output retains counters and the native-timing uncertainty, not the full input-timing array.
It reports `inputTimingsRecorded` and `inputTimingsDropped`; consult the summary for individual timings.
An unusually large response falls back to `outputMode: "minimal"` with provenance and aggregate verdicts
rather than allowing large details to hide file paths.

Use the existing harness tool's report operation instead of generating a separate Python/patch audit script:

```json
{
  "operation": "report",
  "name": "feature-checks",
  "runIds": ["1700000000000-aaaaaaaa", "1700000000001-bbbbbbbb"]
}
```

Replace these example values with actual returned names and IDs. Select up to 50 distinct runs, including
relevant failures and the required normal, exception and regression scenarios. The tool validates saved
identities, requirement counts/verdicts and required evidence files before publishing anything. Missing,
invalid or mismatched records fail explicitly rather than producing a partial pass. No Studio or provider
call is made.

The response gives `jsonPath` and `markdownPath` under `.overdare/playtests/reports/`. Reports are deterministic
for the same selected records and locations, regardless of selection order. They retain selected failures,
recovered-check flags, harness source hashes, summary SHA-256, decision participation and cleanup facts.
They describe selected runs only, not a complete history. Harness hashes identify adapter versions, not
game-code/build versions. Full per-actor details and diagnostics remain linked from each summary path.

Reports deliberately set `acceptance: "not_assessed"`. They do not prove visual/audio quality, unexecuted
requirements, or global map preservation. A terminal success, later passing run, or declared coverage never
erases earlier selected evidence or substitutes for those checks.

### Two players

`numberOfPlayer: 2` owns two real injectable PIE clients. The adapter's root frame keeps `actions` empty and
publishes `state.multiplayerActors` with exactly two actors, as an array (Luau numeric-key tables accepted) or as a
map keyed by each actor's `actorId`. Initial `game.character.read` positions (or native user ids) bind clients to
actors once. Each actor then runs its own decision/input loop with separate history, intent, watchdog, coverage and
decision evidence; `actorGoals` overrides the goal per actor. Physical batches must fit
`maxPhysicalBatchDurationMs` (default 2000, 250..5000) and use keys, unconditional waits or normalized pointer
positions. Results add `perActorEvidence` and `concurrencyEvidence`; the latter separates model and input RPC
overlap from native input overlap, which the transport does not report. The authoritative root terminal, or both
actor terminals, end the episode.

`invoke-server.ts` in the playtest tool folder calls the same registered tools through an already running
sidecar's authenticated `/mcp-router` route, using that sidecar's provider configuration. It requires an explicit
`--approve` flag and a router token, accepts loopback origins only, and never restarts or reconfigures the backend.

The authoring skill's `references/controller-design.md` separates game bindings,
state/event reduction, parameterized action capabilities, model decision points
and adjustable policy configuration where useful. These are responsibilities, not
mandatory layers or a state-machine framework. Diligent preserves working behavior
and improves one demonstrated problem at a time. Legality guards should remove impossible
actions; preferences should expose useful alternatives for the model to choose.

For exploratory player simulation, the adapter supplies observations, controls and
verification rather than a predetermined solution route. Ordinary candidates can
combine camera-relative movement, view changes and interaction with optional short
approach/aim assists. Model responsibility depends on which decisions remain open,
not on how often the model is called. Player-observable decision facts and
privileged verification facts should be separated with `decisionState`; candidate
descriptions must respect that same observation scope.

Users can ask Diligent to adjust assistance and test conditions independently.
The authoring skill directs it to keep supported settings in a small editable
adapter configuration, update them with the source-hash-checked harness tool, and
use existing goal/duration/watchdog arguments. Each advertised setting needs actual
candidate/execution/assertion behavior; this is not a generic profile API or a
settings panel, and existing adapters do not gain those settings automatically.
Test-condition success and game completion remain distinct. Gameplay rules stay
outside this configuration.

For multi-step goals, each current action may carry `intent` with stable `id`,
`description`, `validityKey` and nonempty `completeWhen` expectations. Every action
in a nonempty frame must be intent-tagged or legacy; each intent supplies one
current physical step. The runner chooses goal IDs, retains the selection-time
state, and executes fresh matching steps until observed completion or invalidation.
`intentDecisionIntervalMs` (default 2000, range 250..30000) allows the model to
continue or switch at input boundaries when alternatives exist. Re-selecting the
same goal does not reset its baseline, age or no-progress budget.

Optional frame `decisionState` supplies a compact model view when full `state`
contains per-target verification tables. The model receives that projection,
the goal and candidate descriptions; effect and completion predicates still use
full `state`. Keep all three model inputs concise to fit the installed model's
context budget. Omitting the projection preserves legacy full-state requests.

The runner also provides up to three recent completed inputs in
`controller.recentActions`, with action ID, optional intent ID and a result:
`effect_confirmed`, `effect_unconfirmed` or `not_checked`. Only checks on healthy
post-input observations can confirm an effect. Unconfirmed checks do not prove
that no effect occurred; they use the first newer frame. Automatic inputs are
included, while offered/rejected choices and cancelled inputs are not. History
resets with each episode, contains no raw verification values and is recorded as
`controllerContext` on model-start trace events. This is short-term feedback for
the chooser, not an adapter callback or a persistent exploration map.

The adapter remains observation-driven and does not receive an onDecision callback.
Runner-owned intent memory needs no new Studio RPC. Generate each goal's step
independently from facts, without changing a global chosen target while enumerating
options. Trace `intentId` identifies the policy goal; `executionId` identifies each
physical batch, whose action ID may change. `intent_completed` is based on observed
completion predicates, not model selection or input completion. The game's terminal
remains a separate result. Empty goals or changed context invalidate commitment.

Choose the goal boundary to match the test. For target-level interaction, an
adapter can retain one `inspect:<target>` intent through approach, focus, input and
authoritative confirmation; successful camera alignment alone does not complete
that goal. Keep target/lifecycle validity stable across mechanical phases and
preserve verification values after the target leaves the candidate subset.
The skill's [interaction-state reference](../../apps/overdare-ai-agent/bootstrap/skills/autonomous-playtest/references/interaction-state.md)
covers native GUI/recipient correlation, shared-key effects, pending/blocked states
and compact memory. These are adapter authoring patterns, not additional RPCs or
a callback from Laya to Lua.

Results include `decisionEvidence`, separate from game outcome, verification and coverage:
`not_exercised`, `selected_not_dispatched`, `dispatched_unverified`, `effects_observed`, or `not_applicable` in
verification mode. Counts distinguish model requests, returned choices, matching dispatches, confirmed effects,
automatic (singleton) dispatches and scenario dispatches. A shared `decisionId` correlates those stages in the trace
even when observation revisions advance or action IDs repeat. The model-start record includes candidate
descriptions as well as IDs. Evidence is aggregated before trace truncation; it verifies participation and declared
effects, not strategy quality or a game win.

For agent-led preparation and maintenance, load the bundled `autonomous-playtest` skill. It derives the
test inventory from the current project's code and the user's objective rather than copying a sample
game's bindings or exercising every unrelated feature. `operation: "list"` discovers actual installed
names. A read of an absent name returns `found:false` with the author/install next step; RPC failures
remain failures and are not interpreted as absence. Updating an adapter also refreshes its managed
common driver. The driver publishes a valid `ready:false` frame while loading, and the runner waits
within its startup bound rather than classifying unavailable startup character data as another session.

Optional coverage declares stable targets `{id, kind: action|state|event, description, source?}` in
`coverage.targets`, witnessed state/event ids in `coverage.observed`, and action target ids in
`actions[].coverageKey`. The returned `coveragePath` points to a separate report. Candidate availability,
model/singleton selection, input dispatch, completed input, and confirmed effects are separate stages.
Action targets require a nonempty passing effect assertion after completed input; state/event targets
require adapter-reported observations. No inventory is reported as `not_declared`, never 100% coverage.
The percentage covers only the declared test targets, not automatic whole-code branch coverage, and
does not change the episode's success/failure outcome.

For the default Laya provider, native Ollaya must already be installed. Set `DILIGENT_LAYA_URL` to its `/api/decide`
endpoint and optionally `DILIGENT_LAYA_MODEL` (default `laya:en`), or pass `decisionUrl`/`model` per run.
The model is warmed before PIE starts. The decision endpoint is local to the sidecar's host, which may be
a Mac connected by dev-cross to Windows Studio; it need not be hosted inside Studio. An ordinary Ollama
service does not implement this native decision API. The old Python raid PoC is not a production dependency.

`decisionProvider: "openai-decisions"` selects the public OpenAI Decisions adapter;
`observationMode: "structured+image"` adds actual PNG observations at model-decision
boundaries. Credentials are server-side and no ChatGPT OAuth fallback is automatic.
See [decision providers and visual input](playtest-decision-providers.md) for the
implemented settings, image mapping, freshness checks and validation limits.

For measured results, failed cases and source-specific acceptance limits, see the
[PoC review](../review/autonomous-playtest-poc.md). It distinguishes historical
victories from the final Horror grouped-inspection implementation, which was
saved but not exercised through completion. Documentation updates do not alter
installed game adapters or constitute a new live test.

The fixture `sidecar/test/fixtures/playtest/hollow-warden-adapter.luau` demonstrates one game's bindings
and controls. It is a starting example, not a universal adapter. Diligent must derive each UGC game's
bindings, candidate calculations, and outcomes from that project and verify them through actual runs.

## Aiming without measuring a picture

`game.ui.browse` and `game.screenshot` report positions in the same viewport-normalized `0..1` space that
`pointerMove` consumes, so clicking a button is: browse, take the centre of its `rect`, move, press. Nothing
is read off an image, which matters because screenshots are resized on the way to the model — a normalized
rectangle survives that, an absolute pixel does not.

`rect` is computed from the element's authored `UDim2` against its parent's rectangle rather than read from
`AbsolutePosition`. Measured positions only exist for widgets Slate actually laid out: a hidden element keeps
a stale one and an off-screen element reports `0, 0`, which would put an off-screen button in the top-left
corner and send a click somewhere harmless-looking and wrong. The computed rect is right in both cases. The
exception is elements a `UIListLayout` or `UIGridLayout` positions, whose authored position the layout
overrides.

Check `onScreen` before clicking. It folds together the element's own `visible`, every ancestor's `visible`,
and whether the rect actually intersects the viewport — so `visible: true` with `onScreen: false` is a real
combination, meaning the element is switched on but its parent is off or it sits past the edge.

`includeGui` captures the UI the player is actually looking at. It used to capture the authored one:
`MLuaGUICaptureHelper` kept only ScreenGuis rooted at `StarterGui`, so the `PlayerGui` clone the game runs on
was skipped — UI a script built at runtime never appeared and a retitled label still showed its authored
text, while everything the scripts had not touched matched, which is what made it easy to miss. It now
captures the play test's own world and composites `PlayerGui` / `CoreGui`, falling back to `StarterGui` only
in the editor, where that *is* the screen being authored. Those roots are already laid out at the game
viewport's scale, so the capture renders them at that scale rather than the editor viewport's DPI — drawing
them at the wrong scale left the boxes right (they are relative) and the text, sized in pixels, spilling out
of them.

`viewport.camera.read` answers the questions a picture cannot. A perspective viewport keeps its field of view
fixed and zooms by moving the camera, so `focusDistance` — how far the screen centre is from the camera — is
the real zoom indicator, not `fieldOfView`; `orthoWidth` is filled in only for an orthographic viewport, where
it is the true magnification. `visibleExtentAtFocus` converts that into world units
(`width = 2 · d · tan(fov/2)`, `height = width / aspect`, 1 unit = 1 cm). `centerHit` names what is under the
crosshair. `source` says whether that camera is the editor viewport or the running play test — during a play
test the player camera is what fills the screen, and `game.screenshot` reports the same block for the shot it
just took, so the two never describe different moments.

`game.screenshot` also accepts `cameraPosition` + `lookAt` to aim one shot; the editor viewport returns to
where the user left it as soon as the capture ends, on every path including failure. It is rejected during a
play test, because moving the editor viewport would not change what the capture shows.

## Studio contract

The tools call the Studio RPC methods `game.pie.status`, `game.input.inject`, `game.input.releaseAll`,
`game.character.moveTo`, and `game.character.moveStatus`. Studio compiles them into the standalone Sandbox
target only (`WITH_MCP_PIE_INPUT`), so an editor-target Studio answers method-not-found.

Studio enforces, and the tools pre-check:

- keys `W A S D Q E R SpaceBar LeftShift LeftControl`, pointer buttons `left` / `right`
- at most 64 events and 10s of total `wait` per batch
- every key and button pressed down must be released inside the same batch
- `pointerMove` positions are viewport-normalized `0..1`; `mouseDelta` axes are bounded by ±4096 and need a
  captured mouse
- `scroll` takes ±10 wheel notches at the current pointer position
- `textInput` takes up to 256 printable characters and goes to whatever holds keyboard focus, so Studio
  refuses it with `viewportNotFocused` rather than typing into one of its own panels. Note that the OVERDARE
  Lua API has no `TextBox`, so nothing scriptable receives characters yet — this exists for when one lands

`action: "press"` (with an optional `durationMs`) is a sidecar shorthand: Studio has no press action, so the
tool expands it to `down` / `wait` / `up` before sending. It is the shape to reach for — one authored event
instead of three, and no way to leave a key held past the end of the batch. Because the limits apply to what
actually reaches Studio, the 64-event cap is checked *after* expansion.

## Target resolution

`pieSessionId` and `clientId` are optional. Omitted, the tool reads `game.pie.status` and takes the live
session and its first injectable client, so a single tool call is enough to send input. An explicitly passed
id is checked against that snapshot, which turns a stale id into a message naming the live session instead of
a bare Studio error code.

## Connection scope

Studio scopes held input and a running sequence to the TCP connection that sent them, and `rpc.ts` opens a
connection per call. A batch therefore has to be self-contained — which is also what Studio's validator
demands — and a dropped call releases whatever it held.

Studio releases held input on sequence end, connection close (`MCPService` subscribes `OnConnectionClosed`
to `ReleaseAllForConnection`), PIE end, and observed physical input. `game.input.releaseAll` exists as an RPC
but is deliberately **not** exposed as a tool: it only cancels a sequence owned by the calling connection, and
a fresh per-call connection never owns one. `studiorpc_game_stop` is the escape hatch.

## Waiting

### Autonomous playtest progress watchdog

`studiorpc_game_playtest` defaults to `stuckTimeoutMs: 15000`, independently of the
overall episode limit. It returns `outcome: "stuck"` when no meaningful progress is
confirmed, cancels pending model/input work and stops only its owned PIE session.
The summary and trace retain the inactivity interval, progress source, last action
and observed state. This is a test-control outcome, not a game defeat. The tool
accepts a different timeout up to 180000 ms, or an explicit 0 to disable it.

Game adapters report a monotonic `progress.sequence` for meaningful observed
milestones or useful effects. Frame revisions, clocks, repeated inputs and position
jitter must not advance it. A normal pause can include
`progress.waiting = {reason, timeoutMs}`. The first such declaration per sequence
pauses inactivity for a fixed duration on the runner's local clock. Repeating,
changing or re-adding it cannot renew that allowance; removal resumes the remaining
budget early. The overall episode limit still applies throughout the pause.

Older adapters without this telemetry use completed non-wait input with changed,
fully passing effect expectations as a fallback. This does not infer mission
progress or legitimate long waits: maintain the adapter and refresh its managed
driver through `game_playtest_harness update` when those distinctions are needed.
Once adapter telemetry appears, it remains authoritative for that episode.

### Input batch waits

`game.input.inject` answers only once the batch has played out, so the tool raises the RPC timeout by the
batch's own wait time. `studiorpc_game_character_move_to` polls `game.character.moveStatus` until the move
reaches a terminal status (`reached`, `interrupted`, `timedOut`, `superseded`, `cancelled`, `failed`,
`pieEnded`) and reports how long it waited; `wait: false` returns the `requestId` immediately instead.

## Arriving is not touching

`move_to` reports `arrived` by measuring where the character actually stopped, because Studio returns
`reached` whenever path following succeeds — which a level with no navigation data does without the character
having moved at all. `arrived` is judged against `arrivalTolerance`, 150 units unless the caller says
otherwise, and the value used is echoed in the reply.

The default suits travel and is far too loose for contact. A trigger volume is often 40 units across, so a
move can be `arrived: true` and still nowhere near enough to touch anything, and an agent testing "does
walking into this coin collect it" gets a pass from a call that proves nothing. Pass an `arrivalTolerance`
about the size of the target when arrival is the thing under test.

Even a real overlap is not proof a trigger fired. `game.character.read`'s `standingOn` is a probe straight
down — `distance: 0` means resting on that surface, never that its `Touched` event ran. Only the game's own
state answers that.

## One name for one thing

Every tool that reports a GUID calls it `instanceGuid`; `instance.read` takes it as `guid`. An agent that
copied one into the other used to get a bare zod `invalid_type` naming a field it had never heard of, and had
to work out that two similarly-named tools take different identifiers. Both ends are now tolerant:
`instance.read` accepts `instanceGuid`, and `game.instance.read` accepts either `name` or `instanceGuid`.
Instances a script creates at run time have no GUID at all, so those are findable only by name — which is why
the live tool takes a name in the first place.

## Taking over: what interrupts an injected batch

Studio cancels a running batch when it sees the user take over, which is a **press** — a key, a mouse button,
a wheel notch — not a mouse *movement*. That distinction matters more than it looks: a cursor resting over the
Studio window emits move events continuously, and that is exactly the situation whenever a person is watching
the play test. Treating movement as a takeover made pointer injection unusable in the only case it is needed,
and it also broke clicking outright: with the move trigger in place a batch's press reached the button and
`SButton::OnMouseButtonUp` ran, but its click gate (`IsHovered()` / `HasMouseCapture()`) had already been
disturbed, so `UButton::OnClicked` never fired and the button's `Activated` never reached Lua.

Measured A/B on one binary, changing only whether `HandleMouseMoveEvent` triggers the interrupt:

| Mouse move triggers takeover | `OnButtonPressed` | `OnButtonReleased` | `OnButtonClicked` |
|---|---|---|---|
| yes | fires | fires | **never fires** |
| no | fires | fires | fires |

So `FPiePhysicalInputObserver` deliberately does not implement `HandleMouseMoveEvent`. Key down/up, mouse
button down/up, double-click and wheel all still cancel the batch, which is what "the user grabbed the
controls" actually looks like.
