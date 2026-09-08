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
