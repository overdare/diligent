# View Layer

## Server Views

### MovementView — `ServerStorage/Module/View/MovementView`
- `Lock(character)` / `Unlock(character)` — WalkSpeed=0, RotationSpeed=0 / restore saved values
- `SetSpeed(character, walk, rotation)` — controlled speed (for "Slow" movement type)
- `Knockback(attacker, target, config)` — directional impulse on target
- `ForwardDash(character, speed)` — forward impulse
- Automatically saves and restores original speeds

### CombatView — `ServerStorage/Module/View/CombatView`
- `ApplyDamage(humanoid, amount)` — TakeDamage
- `ApplySelfDamage(humanoid, amount)` — self HP cost
- `ApplyHeal(humanoid, amount)` — heal (used for lifesteal)

CombatView does NOT handle knockback (MovementView does that).

## Client Views — `ReplicatedStorage/Module/View/`

### ButtonLayout
Weapon Override + Find-or-Create pattern. `Build(frame, slotNames, charConfig, charId, weaponId)` first checks `ReplicatedStorage/UI/Weapon/{weaponId}/` for a weapon-specific button folder:

**Weapon override mode** (folder exists):
1. Hides all existing GuiButtons in Frame
2. Clones `{SlotName}Button` from weapon folder into Frame
3. Falls back to `createButton()` for any missing buttons
4. On `Clear()`, destroys clones and restores hidden Frame buttons

**Default mode** (no folder): Searches Frame for `{SlotName}Button` first; creates dynamically if not found. Hides buttons for inactive slots.

When `charId` is provided, auto-calls `ApplyIcons(charId)` which resolves icons through the AssetDB chain.

**Weapon UI folder structure:**
```
ReplicatedStorage/UI/Weapon/{WeaponId}/
  AttackButton, SkillButton, Skill2Button, ...
```
Folder name must match WeaponDB key. Button names must follow `{SlotName}Button` convention.

**Icon apply behavior (ApplyIcons):**
- Icon exists → creates/reuses `IconImage`, sets `TextTransparency=1` and `BackgroundTransparency=1` (hides text and background)
- No icon → destroys `IconImage`, restores `TextTransparency=0` and `BackgroundTransparency=0` (shows text and background)
- On character switch, slots without icons are always reset to prevent stale icons from the previous character.

**Icon button visual feedback:** Buttons with icons have `BackgroundTransparency=1`, making `BackgroundColor3` changes invisible. Cooldown/rejection feedback uses `ImageColor3` tint in parallel:
- Cooldown (disabled): `ImageColor3 = Color3.fromRGB(100,100,100)` (darkened)
- Rejection: `ImageColor3 = Color3.fromRGB(150,30,30)` (red flash, 0.2s then restore)
- Enabled: `ImageColor3 = Color3.fromRGB(255,255,255)` (original)

### BtnController
Captures touch input → `RequestAbility:FireServer(slotName)`. Shows cooldown UI overlay. Resolves `weaponId` from `EquippedWeapon` StringValue (or `CharDB.DefaultWeapon` fallback) and passes it to `ButtonLayout.Build` for weapon override support.

**Icon button press feedback:** When AssetDB icons are used, `BackgroundTransparency=1` makes the built-in `AutoButtonColor` effect invisible. BtnController directly controls `ImageColor3` to provide press feedback:
- **Press slots:** press → `ImageColor3 = rgb(180,180,180)` (dim) → auto-restore after 0.15s (skipped if cooldown active, preserving CooldownUtil dim)
- **Hold slots:** press → dim persists → restore on button release

Button naming convention: `{SlotName}Button` → maps to slot `{SlotName}`.

### FeedbackView
Displays cooldown timers, rejection feedback, resource gauge. For buttons with icon images, uses `ImageColor3` tint for cooldown (darkened) and rejection (red flash) feedback, since `BackgroundTransparency=1` makes BackgroundColor3 changes invisible.

### HpBarView
HP bar display connected to Humanoid.

### CharacterHpBar — `StarterPlayerScripts/CharacterHpBar` (LocalScript)
Auto-manages HP bars for all players.

**Local player:** ScreenGui at top-center with text (TextScaled).
**Other players:** BillboardGui on HumanoidRootPart for overhead HP bar.

- GaugeUtil for gauge Size/Text, lerpColor for HP-ratio color interpolation (green→yellow→red)
- Full lifecycle: PlayerAdded/Removing, CharacterAdded, Died
- OVERDARE PlayerAdded fires once for existing players — duplicate guard included
- `isnil()` defense against destroyed instances
- BillboardGui on HumanoidRootPart (Head not supported) + ExtentsOffsetWorldSpace
- ScreenGui may be lost on respawn → `ensureScreenGui()` auto-recreates

### CharSelectView
Character selection UI. Reads CharDB for character list, auto-generates buttons. Sends `SelectCharacter:FireServer(charId)`.

### LoadingScreen — `StarterGui/LoadingScreen` (LocalScript)
Loading screen that preloads `AssetDB.Resource` animation assets at game start.

**UI structure:** `ScreenGui > Frame > LoadingFrame > Bar(gauge) + LoadingText(%) + Loading(text)`

**Flow:**
1. Wait for character spawn → get Humanoid
2. Call `AssetLoaderUtil.PreloadAnimations(humanoid, AssetDB.Resource, options)`
3. `onProgress` updates Bar size + LoadingText percentage
4. `onComplete` waits 0.3s then sets `screenGui.Enabled = false`
