---
name: tpa
description: "Helps build 3rd-person action games using the TPA (Third-Person Action) template. If the template isn't installed, guides installation. If already installed, leverages existing modules via architecture docs. Use this skill when the user requests anything related to 3rd-person action games, combat systems, character/skill/weapon creation, game UI, input handling, server-client communication, damage/HP logic, or plugin extensions. Do not invoke this skill if the user has declined to use the template."
---

## 1. Check TPA Info in Knowledge Tool

Read TPA project info from the Knowledge Tool.

### If TPA info does not exist

Ask the user whether they want to use the TPA template. Using the template makes it easy to build a third-person action game, but making it uniquely yours will take a bit more effort.

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
