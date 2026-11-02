---
name: performance-optimization
description: Measure and optimize OVERDARE worlds with performance capture/report tools and explicit debug.profilebegin/profileend Lua regions. Use for Lua function profiling, PIE/server CPU or frame-time questions, lag, memory issues, and costs that scale with object, NPC, effect, per-frame script or network counts.
---

# Performance Optimization

Players run worlds on mobile devices, where frame time, memory, and network budget run out far sooner than in Studio on a PC. Apply what fits the current task while building, and work on the reported problem when there is one. Run a full optimization pass over the world only when the user asks for one or is finishing the world for release.

Fix the measured bottleneck rather than changing settings across the board. Use the performance tools below when supported by the connected Studio. Establish the device, game section and load from the session or existing tools before asking for missing context. Studio PC results do not replace confirmation on a representative mobile device. These captures do not measure network traffic.

## Measure a named scenario

1. Prepare a reproducible game section with existing play, input, camera and observation tools. Record player/NPC counts, route, resolution, quality and frame cap in your working context. Do not discard spawning, joins or transitions as generic warmup.
2. Call `studiorpc_performance_capture` with `{"case":"combat_20_enemies","seconds":30}`. It returns a job ID immediately. Allowed duration is 1–60 seconds; the default is 30.
3. Run or observe the scenario. Poll `studiorpc_performance_report` with `{"jobId":"<returned ID>"}` at least two seconds apart. Capture state and scenario success are separate; automatic duration completion leaves the scenario outcome unverified.
4. To stop early, call capture with `{"action":"stop","jobId":"<ID>","outcome":"completed"}`. Use `failed` or `cancelled` with a `reason` when appropriate. Read the terminal report and raw artifacts. Repeat important cases three times.
5. Compare only matching conditions; report accepts an optional `baseline` job ID. Missing quality/load/effective-cap metadata can withhold automatic deltas. Apply game budgets in agent reasoning, not as tool arguments.

Reports integrate frame, coarse LuaMachine, Slate, process CPU/memory and explicit Lua regions. Use count, mean, p50, p95 and max together. Frame distributions are per completed frame interval; `luaScopes` distributions are per completed invocation and also have `total_ms`. Read missing-data reasons; null is not zero. Draw/thread/GPU snapshots are latest observations with unknown freshness, not spike-aligned distributions. CPU `usedCores` is CPU-seconds/wall-seconds; do not invent an effective CPU percentage.

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

Use the existing script validation report and actual capture evidence before claiming profiling worked. Zero completed samples can mean missing/unclosed markers; it does not prove the function took no time. If the connected Studio reports unsupported capability, explain that exact limit rather than substituting Roblox APIs or enabling a heavy profiler.

## PIE and external server scope

Metrics belong to the measured process. Selecting a PIE client does not isolate its Lua, Slate or CPU cost. One-process PIE can put dedicated-server and client worlds on the same Studio game thread; inspect topology metadata and use server/client label prefixes.

Omit `separateServer` during ordinary playtesting. Use `studiorpc_game_play` with `{"restart":true,"numberOfPlayer":1,"separateServer":true}` only for controlled precision performance measurements that need the server in another process. It starts a headless dedicated server for that session without persisting the topology or player override. It changes the measurement topology, not the statistical precision of the existing counters; do not claim a speedup from uncontrolled comparisons. `false` forces one-process PIE for that request; omission preserves configured settings. A running or queued session rejects the option unless the sidecar first stops it through `restart:true`; do not combine it with `addClient:true`. No Studio restart is required.

The external server reads the saved world. Stop PIE and save intended changes through `studiorpc_level_save_file` when that is within the user's authorized scope, before starting separation; game.play does not save them automatically. Dirty map/package prompts can cancel startup in unattended runs. If a world was just copied or exported, save it in Studio so native packages and authored data agree.

An accepted start is asynchronous. Poll `studiorpc_game_pie_status` at least two seconds apart: `server.state` progresses through `serverStarting`, `clientStarting` and `ready`. Studio launches clients only after verifying this server's PID/start time, saved map, network version, BeginPlay and listening port. Server startup is bounded to 120 seconds, then client startup to 60 seconds. Wait for `ready`, a running session and the expected clients, and confirm join/presentation before capturing. A `failed` state includes `reason`; stop and inspect it before a deliberate retry. Do not automatically retry an accepted request. `studiorpc_game_stop` also cancels a pending start and removes its server. Changing or dirtying the world during startup aborts it.

For separate-server PIE, pass the ready status's `server.pid` in optional `serverPids` to add verified local descendant server CPU/memory to the Studio capture. An explicit `{pid,startTimeUtc,role:"dedicated_server"}` target measures an independently launched local server using OS counters only. External Lua labels and server tick time are unavailable through this path. Do not infer them from CPU usage. Existing input/observation tools also restrict separate-process PIE, even for its first local client.

## Scripts

- Connect to `RunService.Heartbeat`, `Stepped`, or `RenderStepped` only for work that must follow every frame, such as a camera follow or smoothing a visual. Drive everything else from events, or from a `task.wait(interval)` loop at the rate the gameplay needs, such as a 0.2-second AI tick.
- Split heavy work, such as building a large grid, serializing a large table, or client startup setup, into chunks and yield with `task.wait()` between them. Wrapping the work in `task.spawn` starts it immediately, and `task.defer` does not guarantee a frame is drawn first, so neither spreads the cost on its own.
- Pair every connection that outlives its object with `:Disconnect()`. Clear per-player tables and connections in `Players.PlayerRemoving` and per-character ones in `Player.CharacterRemoving`; otherwise memory grows with every player who joins and leaves.

## Physics and Mobility

- Prefer **Static** Mobility for level geometry that never moves; see the system prompt for how Mobility is set and inherited. Besides rendering cost, a Movable MeshPart ticks every frame while a Static one does not, so Static also saves CPU.
- Anchor every part that does not need simulation.
- Turn off `CanCollide`, `CanTouch`, and `CanQuery` on parts that nothing collides with, touches, or raycasts against, such as decorations, distant scenery, and effect parts. The flags are coupled: `CanCollide = true` forces `CanQuery = true`, and `CanQuery = false` forces `CanTouch = false`. Set them in an order that ends in the combination you want.
- When a large or detailed mesh only needs a rough walkable shape, turn off its `CanCollide` and use a few invisible anchored Parts as its collision.

## Characters and NPCs

- Finish a character's appearance before it spawns. Adding, removing, or changing MeshParts inside a character Model makes the engine re-evaluate and rebuild its merged mesh.
- Spawn NPCs when players come near and remove them when players leave the area. Pooling NPCs instead of destroying and respawning them saves spawn cost but not memory, so stop a pooled NPC's AI loops and movement while it waits.

## Rendering

- Draw cost grows with the number of objects, the materials on each, and the rendering passes they need, such as shadows and transparency. Reduce all three: fewer, larger pieces with fewer materials.
- When 10 or more similar Parts or MeshParts form static geometry, consider merging them into one MeshPart in a ProceduralModel (the `procedural-model-builder` skill). Keep separate pieces only when they need different materials or must move or behave independently.
- Identical-looking copies are cheapest when they share the same `MeshId` and `TextureId`; copies with separate IDs each add draws, memory, and download. Duplicates usually come from importing a whole scene as one file or from baking the same ProceduralModel several times, instead of importing or baking one asset and cloning it. Vary copies with `Size`, `Color`, and `Material` rather than creating recolored variants. In an optimization pass, list each MeshPart's `Name`, `MeshId`, and `TextureId` with Editor Luau: same-named parts that use different IDs are likely duplicates, so replace them with clones of one.
- Keep triangle counts proportional to an object's size and importance. For ProceduralModels, treat the baked `targetTriangles` and model-wide warnings as the budget.
- `MeshPart.EnableMeshShadowDetails` pins the mesh's shadow to a fixed LOD level rather than switching quality on. The level, `MeshShadowDetailLevel` (`Original`, `Medium`, or `Low`, default `Low`), is set in Studio's Properties panel and is not writable from Luau. Change either only after comparing the shadow result.
- Use few lights, and keep `PointLight.Range` and `SpotLight.Range` and `Angle` only as wide as the effect needs. Overlapping lights multiply cost. Turn off lights with `Enabled = false` while players are out of their range, for example room by room indoors.
- Avoid stacking semi-transparent surfaces, such as large `Transparency` parts, layered glass, and dense particles; each layer is drawn again over the ones behind it.
- Keep `ParticleEmitter` counts and rates modest, and avoid changing emitter properties every frame.

## Networking

- Server instances replicate to every client by default, so creating or destroying large instance trees on the server at runtime is expensive. Place reusable objects in advance and toggle or pool them. When a large tree must be created at runtime, build it over several frames.
- Fire a `RemoteEvent` when a value changes, not every frame. Throttle sends driven by player input, and send compact data such as IDs and numbers rather than large tables.
- Run visual-only work in a `LocalScript`: tweens, camera moves, effects, and UI animation. A server-side `TweenService` tween keeps changing its target's properties, and when those properties replicate, that adds network traffic.

## Memory and loading

- Preserve original source artwork. Existing device profiles, mips and streaming determine cooked/allowed and resident dimensions. Source resolution guarantees neither. Texture resolution/LOD quality is a known issue for the owning team. Report observed limits without resizing/reimporting artwork, changing profiles or adding rendering workarounds. Use existing MaterialVariant or MeshPart image paths; do not add per-face atlases to basic Parts. Other texture groups and imports have their own limits. Texture memory follows pixel dimensions, compression and mipmaps, not file size.
- Combine small icons into one sprite sheet and select each with `ImageRectOffset` and `ImageRectSize`.
- Keep rarely opened UI panels in a ScreenGui with `Enabled = false` until the player opens them; a disabled ScreenGui does not create its child widgets.
- Keep `ReplicatedStorage` to what clients need. Put server-only objects and modules in `ServerStorage`; the server-only hierarchy is excluded from client loading, though assets it shares with replicated objects still download.
- Studio's Preload Asset Manager has a limited number of slots, and you cannot edit it. When loading is slow, suggest that the user preload only what players need right after joining.
