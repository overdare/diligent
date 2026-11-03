# Performance captures and Lua profiling

Fix the measured bottleneck rather than changing settings across the board. Use the performance tools below when supported by the connected Studio. Establish the device, game section and load from the session or existing tools before asking for missing context. Studio PC results do not replace confirmation on a representative mobile device. These captures do not measure network traffic.

## Measure a named scenario

1. Prepare a reproducible game section with existing play, input, camera and observation tools. Record player/NPC counts, route, resolution, quality and frame cap in your working context. Do not discard spawning, joins or transitions as generic warmup.
2. Call `studiorpc_performance_capture` with `{"case":"combat_20_enemies","seconds":30}`. It returns a job ID immediately. Allowed duration is 1–60 seconds; the default is 30.
3. Run or observe the scenario. Poll `studiorpc_performance_report` with `{"jobId":"<returned ID>"}` at least two seconds apart. Capture state and scenario success are separate; automatic duration completion leaves the scenario outcome unverified.
4. To stop early, call capture with `{"action":"stop","jobId":"<ID>","outcome":"completed"}`. Use `failed` or `cancelled` with a `reason` when appropriate. Read the terminal report and raw artifacts. Repeat comparable cases when variability affects the conclusion.
5. Compare only matching conditions; report accepts an optional `baseline` job ID. Missing quality/load/effective-cap metadata can withhold automatic deltas. Apply game budgets in agent reasoning, not as tool arguments.

Reports integrate frame, coarse LuaMachine, Slate, process CPU/memory and explicit Lua regions. Use count, mean, p50, p95 and max together. Frame distributions are per completed frame interval; `luaScopes` distributions are per completed invocation and also have `total_ms`. Read missing-data reasons; null is not zero. Draw/thread/GPU snapshots are latest observations with unknown freshness, not spike-aligned distributions. CPU `usedCores` is CPU-seconds/wall-seconds; do not invent an effective CPU percentage.

In the agent Web UI, the performance result's **View performance capture** entry opens saved frame bars, selected-frame Lua label intervals, full label distributions and separate OS CPU/memory charts. Read an old job again to obtain the entry. The viewer reads artifacts only, with no live capture polling or game instrumentation. Its optional baseline shows both distributions; automatic differences require known matching conditions including topology and player count. Local PIE world counts do not prove joined player count. Lua labels compare by name, not capture-local ID. A label timeline is not an automatic function sampler or engine/GPU task trace.

## Profile selected Lua functions or regions

There is no automatic function sampler. For a user's function-level question, read the relevant gameplay script and insert paired `debug.profilebegin("label")` / `debug.profileend()` using `studiorpc_script_edit` (or `studiorpc_script_add` for a new script). Make these edits before PIE and inspect the returned validation report. Do not write gameplay .lua files with filesystem tools or instrument unrelated functions.

Use a small synchronous region and distinguish server/client labels. This example is valid on Studio builds exposing the diagnostic API:

```lua
local function UpdateEnemies(dt: number)
	debug.profilebegin("server.UpdateEnemies")
	-- Existing synchronous work; no task.wait, WaitForChild or other yielding call.
	debug.profileend()
end
```

Every early return must close its label. Keep pairs balanced through handled errors too. Do not wrap an entire coroutine containing waits. The collector drops open regions when a synchronous resume returns, yields or errors; an end after yielding is unmatched, not an elapsed wait sample. Nested labels include their children, so their times overlap.

Start PIE after adding markers, run the normal named capture, then inspect `luaScopes` in the same report. It includes the eight labels with the highest recorded total time; all retained calls and labels are saved in `lua-scopes.csv` and the manifest. `quality.manualScopes` shows dropped/unclosed/unmatched counts and omitted summaries. Recording is bounded to 8,192 calls, 32 labels (1–64 UTF-8 bytes), 32 open coroutine stacks and depth 32. A partial collection can bias the retained distribution; narrow the region or capture instead of presenting it as complete.

Treat inserted markers as temporary diagnostic edits and remove them after the requested investigation unless the user wants to retain them. Newly built client/server products expose no-op functions, but already deployed older binaries may lack the API. If instrumentation must remain in a publishable script, bind a compatibility fallback once outside the measured function:

```lua
local profilebegin = debug.profilebegin or function(_label: string) end
local profileend = debug.profileend or function() end

local function UpdateEnemies(dt: number)
	profilebegin("server.UpdateEnemies")
	-- Existing synchronous work.
	profileend()
end
```

Zero completed samples can mean missing/unclosed markers; it does not prove the function took no time. If the connected Studio reports unsupported capability, explain that exact limit rather than substituting Roblox APIs or enabling a heavy profiler.

## PIE and external server scope

Metrics belong to the measured process. Selecting a PIE client does not isolate its Lua, Slate or CPU cost. One-process PIE can put dedicated-server and client worlds on the same Studio game thread; inspect topology metadata and use server/client label prefixes.

Omit `separateServer` during ordinary playtesting. Use `studiorpc_game_play` with `{"restart":true,"numberOfPlayer":1,"separateServer":true}` only for controlled precision performance measurements that need the server in another process. It starts a headless dedicated server for that session without persisting the topology or player override. It changes the measurement topology, not the statistical precision of the existing counters; do not claim a speedup from uncontrolled comparisons. `false` forces one-process PIE for that request; omission preserves configured settings. A running or queued session rejects the option unless the sidecar first stops it through `restart:true`; do not combine it with `addClient:true`. No Studio restart is required.

The external server reads the saved world. Stop PIE and save intended changes through `studiorpc_level_save_file` when that is within the user's authorized scope, before starting separation; game.play does not save them automatically. Dirty map/package prompts can cancel startup in unattended runs. If a world was just copied or exported, save it in Studio so native packages and authored data agree.

An accepted start is asynchronous. Poll `studiorpc_game_pie_status` at least two seconds apart: `server.state` progresses through `serverStarting`, `clientStarting` and `ready`. Studio launches clients only after verifying this server's PID/start time, saved map, network version, BeginPlay and listening port. Server startup is bounded to 120 seconds, then client startup to 60 seconds. `ready` confirms the server and first local PIE client; the client list does not enumerate every external client process. For this precision workflow, prefer one player. Wait for `ready` and a running session, and confirm the intended players have joined and presentation is ready before capturing. A `failed` state includes `reason`; stop and inspect it before a deliberate retry. Do not automatically retry an accepted request. `studiorpc_game_stop` also cancels a pending start and removes its server. Changing or dirtying the world during startup aborts it.

For separate-server PIE, pass the ready status's `server.pid` in optional `serverPids` to add verified local descendant server CPU/memory to the Studio capture. An explicit `{pid,startTimeUtc,role:"dedicated_server"}` target measures an independently launched local server using OS counters only. External Lua labels and server tick time are unavailable through this path. Do not infer them from CPU usage. Existing input/observation tools also restrict separate-process PIE, even for its first local client.
