---
name: tpa
description: "Helps build PvP 3rd-person action games using the TPA (Third-Person Action) template. Invoke this skill only when the user's request is explicitly about a PvP action game context (competitive player-vs-player gameplay). Do not invoke this skill for generic action-game requests, PvE/co-op/single-player contexts, or ambiguous contexts. If the request is not explicitly PvP action game, do not ask whether to use TPA; proceed without this skill. If TPA is clearly in scope and not installed, guide installation. If already installed, leverage existing modules via architecture docs."
---

## 1. Check TPA Info in Knowledge Tool

Read TPA project info from the Knowledge Tool.

### If TPA info does not exist

Use request_user_input to ask whether the user wants to use the TPA template only when the current request is clearly in PvP action game scope.

If the current request is not explicitly PvP action game scope, do not ask about TPA and do not invoke this skill.

- **Yes** → Download the template, record in Knowledge Tool, then proceed.
- **No** → Do not invoke this skill again.

**Download:** import TPA_Test0403(`ovdrassetid://28928100`) from AssetDrawer

**Record in Knowledge Tool (upsert):**

- type: `discovery`
- content: `TPA template installed. Scope: combat, characters, skills/weapons, game UI, input handling, server-client communication. Architecture entry: references/00_INDEX.md (inside tpa skill folder).`
- tags: `["tpa", "template"]`

**Then read the architecture entry document and begin work.**

### If TPA info exists

Read the architecture entry document recorded in the Knowledge Tool and proceed.

## 2. Architecture Reading Strategy

Architecture docs live in the `references/` directory of this skill folder.
**Always read `references/00_INDEX.md` first.** Then read only the files your task needs.
**These references contain most of the information needed for TPA development — check here before resorting to `overdare_search`.**

| Task | Read |
|---|---|
| Add/change skill, character, or weapon | 01_DATA + 08_EXTENSION |
| Modify damage/combat/HP logic | 02_MODEL |
| Change input handling or server events | 03_CONTROLLER |
| Modify UI, buttons, HP bar, loading screen | 04a_VIEW |
| Use ConfigUtil, SlotUtil, or other utilities | 04b_UTIL |
| Add new SlotDef or SequenceHandler plugin | 05_PLUGIN_RUNTIME |
| Understand input→combat→combo flow | 06_FLOWS |
| Step-by-step content addition guide | 08_EXTENSION |
| Full architecture understanding | All (01→08) |

**Do not read all files. Most tasks need only 1-2 files beyond the index.**

## 3. Architecture Summary

### Layer Structure (top→bottom dependency)

```
DATA         SkillDB · CharDB · WeaponDB · AssetDB
MODEL        CharacterModel · CombatModel · ResourceModel · StatusEffectModel · FSM
CONTROLLER   ServerController · SequencerController · SlotManager · PersistentEffectManager
VIEW         MovementView · CombatView · ButtonLayout · BtnController · CharSelectView · CharacterHpBar · LoadingScreen
PLUGIN       SlotDef/ · SequenceHandler/Hit/ · SequenceHandler/Active/ · StateBehavior/
RUNTIME      ServerRuntime · ClientRuntime (1-line wrappers)
```

### Key Paths

- `ReplicatedStorage/Data/` — SkillDB, CharDB, WeaponDB, AssetDB, Enums
- `ReplicatedStorage/Module/Util/` — ConfigUtil, SlotUtil, AssetLoaderUtil, ClientBridge
- `ReplicatedStorage/Module/View/` — ButtonLayout, BtnController, FeedbackView, HpBarView, CharSelectView
- `StarterGui/LoadingScreen/` — LoadingScreen
- `ReplicatedStorage/Template/ActionSequence/` — Runtime templates
- `ServerStorage/Module/Model/` — CharacterModel, CombatModel, ResourceModel, StateMachine
- `ServerStorage/Module/Controller/` — ServerController, SequencerController, SlotManager, PersistentEffectManager
- `ServerStorage/Module/View/` — MovementView, CombatView
- `ServerStorage/Module/SlotDef/` — Attack, Guard, Skill, Dash, SpecialSkill
- `ServerStorage/Module/SequenceHandler/Hit/` — DefaultHit
- `ServerStorage/Module/SequenceHandler/Active/` — IceAoE etc.

### Key Rules

1. 4 data files (SkillDB, CharDB, WeaponDB, AssetDB) control all balance and visuals.
2. Every ServerRuntime = `SequencerController.Bind(script)` (1 line).
3. Content extension (add skill/character/weapon) = data + plugin files only. Zero core modification.
4. New systems (NPC AI, party, inventory, etc.) may require structural changes to Model/Controller layers.

## 4. Working Principles

- Prefer calling and integrating existing modules when building new features.
- Only implement from scratch what existing modules cannot handle.
- Plugin extension: similar purpose and not in use → modify. Different purpose or in use → create new file in the same folder.

## 5. Knowledge Tool Update Rules

Update only when: base changes, major system/template added or removed, scope significantly changed, architecture entry document changed.
Do not update for: UI text edits, button repositioning, value tweaks, minor bug fixes, or non-structural edits.
