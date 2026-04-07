# Utility Layer — `ReplicatedStorage/Module/Util/`

## Project-Coupled Utilities

Depend on project data (CharDB, WeaponDB, SkillDB). Require modification when porting to another project.

### ConfigUtil
`ResolveConfig(charId, weaponId)` — merges CharDB (stats) + WeaponDB (skills) into single config table. Used by ServerController on character select and weapon equip.

**Depends on:** CharDB, WeaponDB (require)

### SlotUtil
- `GetSlotNames(config)` — extracts skill slot keys from merged config (checks each value against SkillDB)
- `IsSlot(config, key)` — returns true if key's value exists in SkillDB
- `FindSlotBySequencerId(config, seqId)` — reverse lookup: sequence name → slot name + SkillDB config

**Depends on:** SkillDB (require)

### ClientBridge — `ReplicatedStorage/Module/ClientBridge`
ClientRuntime calls `ClientBridge.Bind(script)`. Uses `_findCharacter()` helper to locate character (depth-independent), with `_N` suffix fallback for sequence name lookup. Auto-reads SkillDB config and connects ClientDash (impulse) or ClientTeleport (blink) on client side.

**Depends on:** ConfigUtil, SlotUtil, MovementUtil (require)

## Standalone Utilities

No external module dependencies. Directly reusable in other projects.

### AssetLoaderUtil
Fully standalone animation load/preload utility.

**Public API:**
- `GetAnimator(humanoid, waitTimeout?)` — safely extract Animator from Humanoid
- `LoadAnimations(humanoid, animFolder, options?)` — batch-load Animation instances from folder
- `PreloadAnimations(humanoid, assetIds, options?)` — preload from ovdrassetid string array
- `LoadAndCacheAnimations(cacheKey, humanoid, animFolder, options?)` — load + cache
- `GetCachedAnimations(cacheKey)` / `ClearCache(cacheKey?)` — cache management

**Options (shared by all functions, all optional):**
- `timeout: number` — track.Length wait timeout (default 0.2s)
- `onProgress: function(ratio, current, total)` — per-item progress
- `onComplete: function(tracks?)` — all done
- `onItemLoaded: function(name, track, index, total)` — per-item success
- `onError: function(name, err)` — per-item failure

**Load mechanism:** `Animator:LoadAnimation` + `track.Length > 0` wait (OVERDARE lacks ContentProvider:PreloadAsync). PreloadAnimations batch-creates temporary Animation instances for parallel download → sequential wait → Destroy cleanup.

### Other Standalone Utilities

| Utility | Purpose |
|---|---|
| ButtonUtil | Touch button binding (Press + Hold) |
| CooldownUtil | Button cooldown display + auto re-enable |
| GaugeUtil | Gauge UI update (HP, energy, etc.) |
| MovementUtil | Client-side movement (dash impulse, etc.) |
| OverlapUtil | Area detection utility |
| RayMoveUtil | Raycast-based movement |
| TargetSnapUtil | Target snap/tracking |
| ToggleGroupUtil | Group-based Show/Hide callback manager |
| DropdownUtil | Dropdown UI creation/management |
