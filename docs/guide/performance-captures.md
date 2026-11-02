# Performance captures

The OVERDARE sidecar exposes two tools through the same product provider in the
agent runtime and standalone MCP server. A capture records a short, named game
case. It does not decide a game's frame budget or whether a change passes.

## Agent workflow

1. Prepare a reproducible case with the existing play, input, camera and observation
   tools. Record player count, enemy count, route, resolution, quality and frame cap
   in the agent's working context.
2. Call `studiorpc_performance_capture` with `{"case":"combat_20_enemies","seconds":30}`.
   The default is 30 seconds; the allowed range is 1–60 seconds.
3. Read `studiorpc_performance_report` with the returned `jobId`. Poll at least two
   seconds apart. For loading or joining, wait for `capturing` before triggering the
   event. Do not discard the event as generic warmup.
4. If the scenario finishes early, call capture with
   `{"action":"stop","jobId":"<returned ID>","outcome":"completed"}`. Failed or
   cancelled scenarios require a short `reason`. Capture completion and scenario
   completion are separate facts.
5. Read the completed report and its local artifacts. Repeat important cases three
   times. Keep each run's median separate from a median of pooled frames.
6. After a change, optionally pass a previous completed job ID as report's
   `baseline`. Inspect condition differences and missing metadata before comparing.
   The agent's skill applies project budgets to the saved frames if needed.

The capture input is a strict start/stop union. Unknown fields, including budget or
threshold settings, are rejected. There is no separate capability, status or
comparison tool. Starting a capture does not modify the map, save it or create a
rollback snapshot.

## What the measurements mean

| Measurement | Source and limits |
|---|---|
| `frame_ms` | Consecutive game-thread begin-frame timestamps, including sleep and cap time. The first begin anchors the capture. Only closed intervals enter statistics. |
| `lua_machine_ms` | Union of common VM resume and the three RunService scheduler scopes on the GT. Includes synchronous native calls and scheduler work; excludes suspended coroutine waiting. Independent LuaAPI C++ ticks are outside this coverage. |
| `slate_gt_ms` | GT elapsed time between the existing Slate pre/post widget-tick callbacks, including widget drawing. Platform/input processing before the pre callback, work after the post callback, the render thread and GPU are outside this coverage. |
| Thread, GPU, draw and primitive snapshots | Existing raw counters, labelled `latest_observed` with unknown freshness. They are not repeated into fake frame distributions or attributed to a spike. |
| Process CPU | One-second OS observations. `usedCores` is CPU-seconds divided by actual wall-seconds. CPU percent remains null because effective CPU capacity is not verified. |
| Process memory | Resident and private bytes, separately. Summed resident values are not unique physical memory usage. |

Lua and Slate are inclusive and can overlap. Do not add them or subtract their sum
from another thread time. A scope crossing a frame boundary invalidates that
metric's affected intervals; the frame interval itself remains usable.

All time-series summaries contain `n`, `mean`, `p50`, `p95` and `max`, including
unsupported rows with null numbers and a reason. Percentiles use nearest rank.
Average FPS is `1000 / mean(frame_ms)`. CPU means are weighted by actual observed
interval duration. OS observation windows are reported separately and are not
frame-aligned.

Measurements are process-scoped. Selecting a PIE client does not isolate its Lua,
Slate, rendering or process resource usage. In particular, a dedicated-server
world can live inside the Studio process in single-process PIE. Native condition
snapshots expose the local world counts and the single-process setting; they do
not claim to enumerate worlds in external processes.

## Targets and server resources

Omit `target` to capture the connected Studio. A PIE selection supplies both
`pieSessionId` and `clientId` from existing game tools. The native registry rejects
stale client identities and currently supports these selections only in
single-process PIE.

For controlled precision performance measurements only, start PIE through
`studiorpc_game_play` with `{"restart":true,"numberOfPlayer":1,"separateServer":true}`.
Omit this option for ordinary playtesting. It uses a separate headless dedicated
server for that request; `false` forces one-process PIE, and omission keeps Studio
configuration. It does not persist the topology/player override. The native
handler rejects the option for a running/queued session or with `addClient:true`.
`restart:true` stops first in the sidecar. No Studio restart is needed. Existing
input/observation restrictions and OS-only external server metrics still apply.
Separation changes topology, not the precision of the existing measurements.
The external server loads the saved world. Save intended changes first; play does
not save automatically. Dirty package prompts can cancel an unattended launch.
Wait for client readiness and verify the external PID and join/presentation;
accepting the start request alone does not establish a working session.

Optional `serverPids` adds up to four local server processes. Each must have an
explicit server command-line switch and verified Studio ancestry. Names alone
are insufficient. To measure an independently launched local server, supply
`target: {pid, startTimeUtc, role: "dedicated_server"}` instead; this target cannot
also have `serverPids`. It collects only OS CPU and memory. It does not infer an
internal server tick time or a zero GPU time.

The sidecar binds process samples to PID plus creation time and pins native RPCs
to their original host and port. A changed PID identity is stale. A remote or
unverified Studio host has no local process samples; it never queries an
unrelated local process with the same PID. OS sampling currently requires Windows
and uses one finite PowerShell worker with .NET process-counter reads. Identity
queries run before frame collection; the periodic loop does not query CIM.

## Results and recovery

Artifacts use the runtime namespace resolver:

```text
<project>/.<namespace>/performance/<jobId>/
  manifest.json
  frames.csv
  process.csv
  lua-scopes.csv
  summary.json
```

The generated job ID is the only directory key. A case name and native job ID
cannot select a filesystem path. Reports contain at most five longest frames and
are bounded to 16 KiB; raw arrays remain in the artifacts. Finished jobs can be
read without Studio. Interrupted jobs are reattached only after the original
process identity is verified. A host crash does not recover native-only frames.
If a terminal manifest exists without a summary after an interrupted artifact
write, report/stop return `ARTIFACT_INCOMPLETE` with retained artifact paths.
Existing raw files are preserved instead of being replaced with an empty capture.

## Explicit Lua regions

For selected code, add Roblox-style diagnostic labels to a synchronous region:

```lua
debug.profilebegin("AI.StepEnemies")
-- Work being investigated; close before returning, yielding or propagating errors.
debug.profileend()
```

These functions do not enable automatic function tracing or sampling. Standalone
Studio records them only during a performance capture, including PIE. Other
products expose no-op functions so instrumented game scripts remain valid.
The normal two-tool capture/report workflow needs no additional flag or tool.

`luaScopes` reports the eight labels with the highest recorded total elapsed time.
Each row has completed-invocation `n`, `mean`, `p50`, `p95`, `max` and `total_ms`.
This p50 is per completed invocation, unlike the frame-based LuaMachine summary.
Times are inclusive GT elapsed times, including synchronous native work; nested
labels overlap. They are neither exclusive CPU attribution nor a timeline UI.
The raw CSV retains label, frame ID, timestamps and duration for every kept call.

Recording is bounded to 8,192 calls, 32 distinct labels (1–64 UTF-8 bytes), 32
simultaneously open coroutine stacks and depth 32. Diagnostics never interrupt
game execution for a malformed pair or a limit. Dropped, unclosed and unmatched-end
counts appear under `quality.manualScopes`; a partial recording must not be treated
as a complete distribution. Limits can bias which invocations are retained.
All labels and valid raw records remain available in metadata/CSV even when the
compact report omits a label summary.

Pairs must close within the same synchronous coroutine resume. Open scopes are
discarded when that resume returns, yields or errors, and at capture end. Keep
begin/end balanced through early returns and handled errors too. This avoids
charging suspended waiting to an invocation, but does not reconstruct missing
markers or unwind a manually unbalanced protected call inside the same resume.

Labels are process-scoped. One-process PIE can collect server and client labels;
choose distinct names such as `server.AI.Step` and `client.UI.Update` when needed.
An external server added through `serverPids` supplies OS counters only; its Lua
labels are not transported by the current external-process measurement path.

Native collection retains at most 10,000 closed frames in a fixed numeric buffer,
one active capture and two completed captures. The sidecar downloads raw pages
after completion, computes summaries and saves files outside the native hot path.
It persists an idempotency key before starting and retries an uncertain start
with that same key. Cancelling one query does not cancel the bounded capture.

The sidecar deadline is capture duration plus 15 seconds. If Studio stops
responding, the result reports only retained host data. An open frame is not a
completed percentile sample. A Studio capture with no closed frames is failed;
an OS-only capture has no such frame requirement.

Baseline comparison returns `numeric_only`, `conditions_differ` or
`insufficient_metadata`. Unknown gameplay load, quality or effective cap can make
an automatic comparison unavailable even for the same case name. Current native
metadata does not verify those conditions; the agent can inspect raw reports and
apply its own explicitly justified comparison. The tool never returns a
performance pass/fail or a regression verdict.

## Native integration

The sidecar uses five internal JSON-RPC methods: `performance.capabilities`,
`performance.capture.start`, `performance.capture.status`,
`performance.capture.stop` and `performance.report.read`. They are intentionally
absent from the generic method-module catalog. Custom factories expose only the
two public tools. Short RPCs return jobs; none waits for the full capture period.

Frame and coarse collection are enabled only in standalone Studio builds,
including Shipping. The regular editor target reports unsupported capability.
The Lua timing collectors in the shared engine and LuaAPI plugin are compiled out
for other products; explicit label functions remain callable no-ops. No Stats
tree, tracing, CSV profiler, allocation/stack sampling or GPU
capture is enabled by these tools. Shipping runtime verification remains a
separate requirement from source compilation and mocked protocol tests.

The copied `MLaunchEngineLoop::Tick` body is currently disabled by `#if 0`.
Instrumenting its apparent Slate call sites would report false zeroes. The
collector subscribes to the live Slate callbacks only during a capture instead;
it adds no engine-wide profiler or permanent tick subscription.
