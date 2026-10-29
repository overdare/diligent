---
name: performance-optimization
description: General performance guide for OVERDARE worlds on mobile, covering scripts, physics, characters, rendering, networking, and memory. Use when a design's cost scales with object, NPC, or effect counts, per-frame scripts, or network sends; when the user reports lag, slow loading, or memory crashes; or when finishing a world for release.
---

# Performance Optimization

Players run worlds on mobile devices, where frame time, memory, and network budget run out far sooner than in Studio on a PC. Apply what fits the current task while building, and work on the reported problem when there is one. Run a full optimization pass over the world only when the user asks for one or is finishing the world for release.

Fix the actual bottleneck rather than changing settings across the board. You cannot read frame time, memory, or network usage yourself, so when the user reports a problem, ask which device, where in the world, and under what load (player count, NPCs, effects) it happens, and target what that points to. Ask the user to confirm the result on a representative mobile device.

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

- Use the smallest texture dimensions that remain readable at player distance. Managed Part/ProceduralModel albedo supports 256, 512, or 1024 pixels through the texture-authoring tools. Inspect the native `Texture` summary's source, allowed, and resident dimensions; streaming can temporarily use smaller mips. Other texture groups and legacy imports have their own limits. Texture memory follows pixel dimensions, along with compression and mipmaps, not file size.
- Combine small icons into one sprite sheet and select each with `ImageRectOffset` and `ImageRectSize`.
- Keep rarely opened UI panels in a ScreenGui with `Enabled = false` until the player opens them; a disabled ScreenGui does not create its child widgets.
- Keep `ReplicatedStorage` to what clients need. Put server-only objects and modules in `ServerStorage`; the server-only hierarchy is excluded from client loading, though assets it shares with replicated objects still download.
- Studio's Preload Asset Manager has a limited number of slots, and you cannot edit it. When loading is slow, suggest that the user preload only what players need right after joining.
