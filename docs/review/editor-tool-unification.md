# Editor tool unification verification

Date: 2026-09-08. Target: `preview/release-40`.

## Requirement and resulting surface

The requested workflow is live instance schema discovery followed by
`execute.luau(target: "Editor")` for world editing. The standalone
`proceduralmodel.api`, `proceduralmodel.validate`, `proceduralmodel.set`, and
geometry-recipe skill/agent were not required by that contract and are removed.
The earlier procedural builder, interpreter bundle, and static instance schema
removal remain part of the same change.

Implementation and regression tests are consolidated into PR #415. The former
#416, #419, #423, and #424 layers are superseded; no output-narrowing layer remains
for an API the agent no longer exposes. Existing world objects and source files
are preserved. Lua validation replacement, agent reporting, steering, and other
unrelated work are outside this change.

## Live Studio evidence

Read-only discovery returned `ProceduralModel` as creatable, with `AutoRebuild`
and `Size`. The live schema omitted Source, but instance reads and Editor Luau
returned it. Editor member reads of `Rebuild` and `Bake` failed as unsupported.

After explicit user approval, disposable models were created through raw
`execute.luau` requests using an existing, already working source. No dedicated
ProceduralModel RPC was used for these checks.

1. `Instance.new("ProceduralModel")`, parenting, Size, Source assignment, and
   AutoRebuild assignment succeeded. Source readback matched the assigned text.
2. With AutoRebuild enabled, the creation call initially observed zero children.
   A second command two seconds later observed two children.
3. A further inspection confirmed `WoodPlanks` and `MetalFrame`, both MeshPart
   instances. All temporary models were deleted and cleanup was confirmed.

Selected actual return values:

```json
{"created":true,"sourceAssigned":true,"childrenAfterSource":0,"cleaned":true,"ok":true}
```

```json
{"cleaned":true,"found":true,"autoRebuild":true,"sourceLength":2329,"children":2}
```

```json
{"cleaned":true,"parts":{"1":{"name":"WoodPlanks","class":"MeshPart"},"2":{"name":"MetalFrame","class":"MeshPart"}}}
```

These checks establish Editor-based creation, configuration, and asynchronous
mesh generation in the tested Studio build. They do not establish arbitrary
source correctness, visual quality, publish completion, Undo behavior, or
reopening durability. Immediate Editor auto-save does not prove a later bake is
finished; focused readback and persistence of subsequent generated changes remain
part of the authoring workflow.

## Regression checks

- Lint and workspace typecheck passed.
- Package tests: 2,376 passed.
- Public app-server E2E: 51 passed.
- Web tests: 489 passed.
- Non-Web sidecar and packaging tests, run per file to isolate existing module
  mocks: 478 passed across 45 files; tool CLI: 5 passed separately.
- Editor contract tests first reproduced missing retirement, read-only discovery,
  no-mutation diagnostics, auto-save documentation, and save-result retention.
- Generic Source tests first failed for future Source-bearing classes, then
  passed with class-independent reads/edits and non-Lua indentation preservation.

Socket-dependent checks were rerun with local networking permission. The tool CLI
mock originally omitted the new StudioRpcError export; it now preserves actual
module exports while replacing the transport calls. No live failure is hidden by
these test-environment repairs.

## Authoring-reference follow-up

Subsequent user sessions still substituted a gameplay Script after documentation
search returned unrelated results. The bootstrap described the native lifecycle
but omitted the working authoring reference previously supplied by the removed
tool/skill path. Its general gameplay fallback instruction also allowed an
incorrect change of execution context.

The bootstrap now includes a complete minimal native Source module adapted from
the existing implementation: parameter declaration, on_generate, beveled mesh
creation, checked normals/append/UV operations, temporary handle disposal, and
material-group declaration. Gameplay search and validation are explicitly scoped
to gameplay Lua. A missing search match does not invalidate a supplied contract
or permit replacing Editor behavior with a gameplay implementation.

With explicit user approval, the exact new example was extracted from the prompt
and run through Editor Luau on a disposable model. A later read returned one
Surface MeshPart whose Size matched the model at X=120, Y=80, Z=60; the model was
then deleted and cleanup confirmed. Python syntax validation, five bootstrap
contract tests, lint, and typecheck passed.

A fresh, read-only model-planning check selected ProceduralModel, native Unreal
Python, and AutoRebuild for the user's adjustable-model request. That check proves
the selected plan under the refreshed prompt, not complete generation of an
arbitrary asset. No request-specific class-routing rule was added.

## Contract review and main refresh

The next session used the correct ProceduralModel class but still mixed gameplay
helpers into Editor code, confused Editor height with native geometry axes, guessed
a material name, and reported success without the necessary evidence. The prompt
and Editor tool description now separate those contracts explicitly:

- Gameplay-only reference helpers do not apply in the Editor VM.
- Editor height is Size.Y; the tested native Source tuple maps Editor Z, X, Y.
  Derived dimensions must remain positive across parameter combinations.
- Relevant property and enum hints must inform the values actually used. JSON
  schemas do not describe arbitrary native geometry function arguments.
- An authored Editor return and successful save do not report asynchronous
  generation completion or the cause of an empty result.
- No-op edits, identical measurements, unread screenshot paths, and onScreen
  projections cannot establish a repaired generator or correct appearance.

This follow-up changes guidance and its regression coverage, not the Studio
generator or existing world objects. It does not add a bake-status endpoint or
claim that missing native diagnostics can be recovered from an empty result.

The branch was rebased onto main `13fea6ec`, then aligned with the updated
`preview/release-40` merge `4dac65bc`, which includes that main and #406. The PR
target remains preview. Main's Windows portproxy guide is preserved. UIListLayout
coverage now verifies no alignment suggestion/default injection, deliberate value
forwarding, and Studio-owned value validation instead of importing the retired
static schema.

Validation after the main refresh: lint/typecheck, 2,396 package tests, 52 E2E
tests, 505 Web tests, and 31 focused Editor/schema/prompt tests passed. These are
contract and regression checks; no live world was modified in this follow-up.

## Premerge property and file recovery follow-up

The dynamic property boundary preserves the derived WorldTransform cache in
instance.read properties as read-only spatial information, alongside Size when
present, and rejects WorldTransform in both add and update upserts. The old static
read projection omitted it, but the old geometry guidance expected it for camera
placement; keeping that omission would perpetuate the inconsistency. Tagged values
and unknown future properties remain intact; the static class catalog is not
restored. Both v1 and v2 use this shared property boundary.

The v1 upsert path now retains pre-write bytes and attempts to restore them when
level.apply rejects. It checks that the file still matches the upsert's output
before restoring; a later observed external write is preserved. Recovery failures
retain the original apply error, and every failure explicitly leaves Studio state
unconfirmed. This does not roll back a partially applied live world or retry apply.
Other users of the shared file-writing helper are unchanged.

Validation: the focused pre-fix run reproduced five failing cases; after the fix,
32 property/recovery/Mobility tests and 34 v1/v2 compatibility tests passed.
`bun run lint`, `bun run typecheck`, and `bun test` passed (2,448 tests). The initial
sandboxed full and v2 runs hit filesystem/socket restrictions and passed after
rerunning with those permissions. No live Studio world was modified in this
follow-up.
