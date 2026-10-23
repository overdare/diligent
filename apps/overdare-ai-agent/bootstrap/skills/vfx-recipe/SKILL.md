---
name: vfx-recipe
description: "Use for every OVERDARE Studio visual effect (VFX) request: creating effects (explosions, bursts, splashes, smoke, fire, sparks, magic hits, slime, frost, electric shocks, auras, 'make an effect where …'), and editing effects that already exist in the level (change colors/intensity/duration, swap or add a source in a placed VFXRecipe, restructure its layers). Picks an adapted recipe template, a ready-made preset, or a composition from raw sources, using the reference data bundled in this skill. Not for particle work on Beam/Trail/ParticleEmitter instances."
---

# vfx-recipe

Owns all VFX effect work in OVERDARE Studio. All VFX reference data is bundled in this skill's `references/` directory — search it with the built-in `grep`/`read` tools. Never search the network for VFX data.

| Unit | Reference | What it is | How it's used |
|---|---|---|---|
| **Preset** | `references/presets.md` | Ready-made named effect | Create a `VFXPreset` instance with its exact catalog `PresetName` — used as-is, no internal editing |
| **Template** | `references/templates/` | A recipe pre-composed from several sources | Copy its Original Payload JSON as a `VFXRecipe` — verbatim, or with sources swapped / structure modified |
| **Source** | `references/sources.md` | One raw ingredient asset for a recipe layer (Base/Detail/Extra) | Placed as items inside a `VFXRecipe`'s layer arrays |

A **recipe** is the placed `VFXRecipe` instance itself — created and edited through `studiorpc_vfx_recipe_upsert`. Use this dedicated tool rather than `execute_luau`: its native layer getters omit Niagara parameters and return asset userdata that cannot be written back. Read complete existing layers with `studiorpc_instance_read`. Live schema search may report `creatable=false` or omit the layers; that does not describe the dedicated tool. Runtime scripts tune a placed recipe via `SetParam` / `SetParamAt` using each source item's `Name`.

## Routing

Pick the path for a new effect yourself unless the request names one:
- **Template-based recipe** (default): copy the closest official recipe and adapt colors, intensity, or sources.
- **Preset**: a ready-made effect matches as-is and its internals need no changes.
- **Direct composition**: no template is close, or the request needs a structure no template has.

For a request that edits a VFXRecipe already in the level, go straight to the edit flow below. If a path yields no acceptable match, move to the next one (template → preset → direct composition).

## Flow: template-based recipe

1. Read `references/templates/00_INDEX.md` and pick the 2–3 templates closest to the request (match on title, category, elements, keywords).
2. Choose the closest one. If none is close, switch to the preset flow.
3. Read the chosen `combo_*.md` file and copy its **Original Payload JSON** as the dedicated tool's `properties`. Pasting verbatim is safe: the top-level `LoopDuration` (read-only derived value) is accepted and ignored, and `Alpha` arrays pass through.
4. Adapt as requested:
   - **Theme/element change**: swap **Color / Alpha keypoints only** (e.g. all layers toward `#FF3000` for lava, `#3080FF` for frost). Keep the sources.
   - **Motion/shape change**: swap a source item's `NiagaraSystem` for another source **from the same layer** (check `references/sources.md`), or add/remove source items — keep at least one BaseLayer item.
   - **Intensity**: scale `SpawnCount` / `SpawnRate` together across layers.
5. `studiorpc_vfx_recipe_upsert` with `items: [{parentGuid, name, properties}]`, parented under the target Workspace object. Do not supply `class`.

## Flow: preset

1. `grep` `references/presets.md` case-insensitively with English keywords from the request (element, mood, purpose — e.g. `muzzle|gunfire`, `heal|buff`). Try synonyms before concluding there is no match. Each row is `| Resource | PresetName | DisplayName | Category | Subcategory | Genre | Keywords |`. Use the exact `PresetName` column, not Resource or the upstream DisplayName. Skip `UNAVAILABLE` rows. The names are derived from Studio DefaultCommonContent.ini and preset assets; upstream labels may contain typos or omit names.
2. Choose the best-matching preset. If none fits well, switch to the direct-composition flow.
3. Create with Editor Luau using the exact name: `local vfx = Instance.new("VFXPreset", workspace); vfx.Name = "MuzzleEffect"; vfx.Enabled = false; vfx.PresetName = "Muzzle"; return vfx.PresetName`. Use the requested parent and the catalog name for the selected effect.
4. Asset selection may load asynchronously. In a later call, read `PresetName` and verify it equals the requested name before setting dynamic parameters (Color, Alpha, Size, Transparency). A successful write alone is not proof: an invalid name can leave the default Fire effect in place. Do not replay creation if loading is pending.
5. Read existing curves before modifying them. Color and Alpha use bare keypoint arrays, with Color channels 0-255. PresetName changes reset source parameters, so apply custom parameters after the name resolves; then read them back. Set Enabled as requested after configuration. The generic instance tool also normalizes known resource aliases to exact names, but the preferred preset path is Editor Luau.

## Flow: direct composition

1. Read `references/sources.md` and plan layers: **BaseLayer** carries the effect's body (at least one item; `neutral`-element sources are the universal fallback), DetailLayer/ExtraLayer add accents and residue.
2. Use each source's short name as `NiagaraSystem` — the resource name minus its `VFX_UGC_<Layer>_` prefix (e.g. `VFX_UGC_Base_FireRise_A` → `FireRise_A`). Full resource names and full serving-asset paths also validate.
3. Set per-source parameters the chosen source supports (its catalog entry lists them; unsupported ones are silently ignored).
4. Create the `VFXRecipe` via `studiorpc_vfx_recipe_upsert` — prefer one call when the composition is already decided.

## Flow: edit an existing recipe

1. `studiorpc_instance_read` the placed VFXRecipe to get its current layer arrays.
2. Modify in place: swap a `NiagaraSystem` (same layer only), tweak parameters, add/remove source items. Layer arrays are replaced whole on update — always send the complete modified array, not a delta.
3. `studiorpc_vfx_recipe_upsert` **update** form (`items: [{guid, properties}]`) with the changed layer properties.

## Rate vs Burst sources

Sources with `_R` in the name are **Rate emitters**: set `Duration` (seconds) and `SpawnRate` (particles/sec). All others are **Burst emitters**: set `SpawnCount` (particles per activation). Never set Burst parameters on a Rate source or vice versa.

## Gotchas

- Some short names exist in **multiple layers** as distinct assets — `LiquidScatter_R_A` and `LightRise_R_A` (Base and Extra), `SmokeBurst_A` (Base and Detail); the layer you place one in decides which asset plays.
- `EmptySprite` / `EmptySprite_R` (Element: Empty) are blank templates for manual authoring in the editor — never pick them when composing an effect.
- A source from another layer is rejected by schema validation — the error lists the layer's valid sources.
- `ObjectType` tags (`Vector3` / `Color3` / `Content`) are injected by the sidecar — author plain `{X,Y,Z}`, `{R,G,B,Time}`, `{Content}` values; tagged values from template payloads also pass.
- Playback: `AutoActivate` (default true), `InfiniteLoop` (default true), `LoopCount` (used when `InfiniteLoop=false`). One-shot effects: `InfiniteLoop: false, LoopCount: 1`.
- Total recipe length is derived (`LoopDuration` is read-only): to shorten an effect, adjust source `Duration`/`Delay` or swap the longest source — don't try to set `LoopDuration`.

## Dedicated authoring contract

- Create: `studiorpc_vfx_recipe_upsert({items: [{parentGuid: "<workspace-or-parent-guid>", name: "Hit", properties: {InfiniteLoop: false, LoopCount: 1, BaseLayer: [{Name: "Body", NiagaraSystem: "NeutralBurst_A", SpawnCount: 2}]}}]})`.
- Update: read with `studiorpc_instance_read`, then submit `items: [{guid: "<recipe-guid>", properties: {BaseLayer: completeModifiedArray}}]` to the same tool. Omitted layers/properties stay unchanged; `[]` explicitly clears a layer. Do not mix creates and updates in one call.
- The tool validates VFXRecipe targets, normalizes source names and JSON type tags, and saves automatically. Use the returned GUID to read back applied parameters. An accepted write does not prove that an asynchronous asset has loaded or that the effect looks correct; verify those separately.
- Layer Position is local to the recipe root in centimeters; Rotation uses degrees. Delay, Duration and lifetime values use seconds; SpawnRate is particles per second and SpawnCount is a count. Size and Speed are source-specific scales; do not apply a blanket Roblox stud conversion to recipe parameters. Color channels are 0-255 and Color/Alpha keypoint Time is normalized 0-1.
- Runtime `SetParam` / `SetParamAt` / `Play` / `Stop` belong in gameplay scripts; they are not Editor commands of this authoring tool.
