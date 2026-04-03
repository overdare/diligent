# TPA Template V4 — Architecture Index

Third-Person Action game template for OVERDARE engine.
Uses Action Sequence for skill timing. MVC + Data-Driven + Plugin architecture.

## Layers (top→bottom dependency, top = most edited)

```
DATA         SkillDB · CharDB · WeaponDB · AssetDB
MODEL        CharacterModel · CombatModel · ResourceModel · StatusEffectModel · FSM
CONTROLLER   ServerController · SequencerController · SlotManager · PersistentEffectManager
VIEW         MovementView · CombatView · ButtonLayout · BtnController · CharSelectView · CharacterHpBar · LoadingScreen
PLUGIN       SlotDef/ · SequenceHandler/Hit/ · SequenceHandler/Active/ · StateBehavior/
RUNTIME      ServerRuntime_N · ClientRuntime_N (1-line wrappers)
```

## Key Paths

- `ReplicatedStorage/Data/` — SkillDB, CharDB, WeaponDB, AssetDB
- `ReplicatedStorage/Module/Util/` — ConfigUtil, SlotUtil, AssetLoaderUtil, ClientBridge
- `ReplicatedStorage/Module/View/` — ButtonLayout, BtnController, FeedbackView, HpBarView, CharSelectView
- `StarterGui/LoadingScreen/` — LoadingScreen (resource preload + loading UI)
- `ReplicatedStorage/Template/ActionSequence/` — Runtime templates
- `ServerStorage/Module/Model/` — CharacterModel, CombatModel, ResourceModel, StateMachine
- `ServerStorage/Module/Controller/` — ServerController, SequencerController, SlotManager, PersistentEffectManager
- `ServerStorage/Module/View/` — MovementView, CombatView
- `ServerStorage/Module/SlotDef/` — Attack, Guard, Skill, Dash, SpecialSkill
- `ServerStorage/Module/SequenceHandler/Hit/` — DefaultHit
- `ServerStorage/Module/SequenceHandler/Active/` — IceAoE etc.

## Key Rules

1. 4 data files control ALL balance and visuals.
2. Every ServerRuntime = `SequencerController.Bind(script)` (1 line).
3. Content extension (add skill, character, weapon) = data + plugin file only. Zero core modification.
4. New systems (NPC AI, party, inventory, etc.) may require structural code changes to Model/Controller layers.

## How to Use (Token-Efficient)

**ALWAYS read 00_INDEX (this file) first.** Then read ONLY the files your task needs:

| Task | Read ONLY these |
|---|---|
| Add/change skill, character, or weapon | 01_DATA + 08_EXTENSION |
| Modify damage, combat, or HP logic | 02_MODEL |
| Change input handling or server events | 03_CONTROLLER |
| Modify UI, buttons, HP bar, loading screen | 04a_VIEW |
| Use ConfigUtil, SlotUtil, or other utilities | 04b_UTIL |
| Add new SlotDef or SequenceHandler plugin | 05_PLUGIN_RUNTIME |
| Understand how input→combat→combo works | 06_FLOWS |
| Action Sequence tracks, naming, combos | 07_ACTIONSEQUENCE |
| Step-by-step guide for adding content | 08_EXTENSION |
| Full architecture understanding | All files (01→08, 04a+04b) |

**Do NOT read all files unless you need full architecture understanding.**
Most tasks need only 1-2 files beyond this index.

## File List

- **01_DATA_LAYER** — SkillDB, CharDB, WeaponDB, AssetDB schemas
- **02_MODEL_LAYER** — CharacterModel, CombatModel, FSM, ResourceModel
- **03_CONTROLLER_LAYER** — ServerController, SequencerController, SlotManager
- **04a_VIEW_LAYER** — Server/Client Views, LoadingScreen
- **04b_UTIL_LAYER** — Project-coupled (ConfigUtil, SlotUtil, ClientBridge) + Standalone (AssetLoaderUtil, ButtonUtil, GaugeUtil, etc.)
- **05_PLUGIN_RUNTIME_LAYER** — SlotDef, SequenceHandler (Hit/Active), Runtime templates
- **06_FLOWS** — Input, combat, combo, character select, spawn flows
- **07_ACTIONSEQUENCE** — Action Sequence tracks, naming, combos, runtime
- **08_EXTENSION_GUIDE** — Step-by-step: add skill, character, weapon
