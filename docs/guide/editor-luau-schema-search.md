# Editor Luau with live class discovery

The OVERDARE bundled Studio provider exposes `studiorpc_instance_schema_search`
and `studiorpc_execute_luau`. These are product tools using the existing tool
result/approval protocol, so Web and TUI receive the same output and error state.
No client-specific RPC method or UI is required.

If the appropriate class is unknown, discover available classes by calling
`studiorpc_instance_schema_search` with no filters. For a known class, request
its details directly without fetching the full catalog first. Then author with
`studiorpc_execute_luau` targeting Editor. Instance reads, hierarchy moves/deletes,
and focused Source reads/edits remain available. The general JSON upsert tool is
removed in this long-term draft. VFXRecipe authoring stays on the dedicated
`studiorpc_vfx_recipe_upsert` tool (#491). It owns a VFXRecipe-only schema
(`methods/vfx-recipe.params.ts`) with source-name expansion and type tags, plus its
own file/RPC write path; nothing else from the static catalog remains. ActionSequence
authoring stays on `studiorpc_action_sequence_write`.

Select an implementation from its execution lifetime, not from a keyword or model
category. An Editor command runs once and its VM is discarded. A persistent
Studio-managed mechanism can react after the command ends. A gameplay Script runs
in the game, not in the Editor. Values and attributes are data; their existence
does not establish an active change handler. Live property schemas do not describe
that lifecycle, so combine them with the relevant execution contract.

Validate the behavior where the user expects it: after setup, change an input and
observe the result without resubmitting the authoring command. A gameplay test
cannot establish Editor-time reactions. No request vocabulary forces a particular
class; the documented native generation lifecycle below is a capability the agent
can use when it satisfies the requested behavior.

## Discovering JSON properties

The tool accepts an optional **non-empty** `query`, `classes` containing 1-20 exact
non-empty names, or both. Omit `query` when no substring filter is needed:

```js
await tools.studiorpc_instance_schema_search({}); // Compact full class catalog.
await tools.studiorpc_instance_schema_search({ classes: ["TextLabel", "UIGridLayout", "Script"] }); // All properties.
await tools.studiorpc_instance_schema_search({ classes: ["MeshPart"], query: "Material" }); // Filtered properties.
```

`{"query":""}` is invalid even when `classes` is present. Agent and MCP entry points
reject it before contacting Studio and direct the caller to omit `query`; it is
not silently converted into a successful lookup. The local validator distinguishes
an omitted query from a malformed present query so shared optional-value cleanup
cannot erase the mistake. The advertised input schema remains a flat object with
an optional `query` whose `minLength` is 1, and code-mode descriptions include the
same examples. Non-empty queries remain literal class/property substrings; no
wildcard, limit, or cursor is invented.

Full discovery returns schemaVersion and a compact class catalog: class names,
descriptions (including Korean), creatable/service and other class metadata are
preserved, while property payloads are omitted. The adapter labels this output
`view: "classes"` and adds the sidecar class `note` where the overlay has one.
Request `classes` to retrieve the detailed properties, with an optional property
query. This separation keeps all property definitions out of the initial class list.

UTF-8 descriptions are preserved through TCP decoding and JSON serialization.
RPC byte diagnostics use UTF-8 byte lengths. If a tool output exceeds the common
limit, keep its beginning and provide the persisted full output when available;
a truncated catalog must not be treated as complete. There is no persistent schema
cache or automatic injection of an exhaustive property catalog into the prompt.

## Sidecar schema overlay

Studio's schema states shapes but not meaning: the tested build has no class or
property descriptions, no units, and omits several properties that Editor Luau
reads and writes. The sidecar merges an annotation table
(`methods/instance-schema-overlay.table.ts`) into every targeted result instead:

- `note` on classes and properties: units (cm, degrees, seconds), asset ID format,
  and contextual limits that `writeCondition` cannot express (Mobility only on
  direct Workspace children, UIStroke Contextual only on text elements, internal
  condition flags such as `bActivePivotOffset`). Property notes are keyed by
  `<Class>.<Property>` or by the declaring class, so an inherited property is
  annotated once; the exact class key wins.
- `source: "sidecar"` properties for values Studio omits: VFXPreset `PresetName`,
  `Color`, `Alpha`, `Size`, `Transparency`, `Importance`, MaterialVariant
  `UseCustomPhysicsProperties`, SimulationBall `BallSimParams` and
  `MicroBounceThresholdMult`. They follow Studio's property query filtering, and
  a property query Studio cannot match still returns them in a `source: "sidecar"`
  class entry. If Studio starts publishing one, Studio's entry wins and keeps only
  the sidecar note. VFXRecipe layer arrays are not supplemented: the class note
  routes recipe authoring to `studiorpc_vfx_recipe_upsert`.
- `valueTypes`: for each value shape present in the result (Color3, CFrame,
  UDim2, enums, instance references, …), how to write it in Editor Luau.
- Engine sentinel enum members (`Max`, `LastMaterial` in material enums) are
  removed from `valueSchema.enum`.

Every overlay entry was checked against a live Studio build (schemaVersion
`blake3:9c5e427e…`), including Editor Luau writes. Notable findings: Color3 JSON
0-255 equals `Color3.fromRGB`, while `Color3.new` takes linear values; VFXPreset
`PresetName` takes the presets.md `PresetName` column and silently ignores
Resource names.

`test/fixtures/studio-schema-property-index.json` records the class → property →
declaredOn index of that build. The overlay tests fail when a note key no longer
names a published property or a supplement duplicates one; re-record the index
from targeted `instance.schema.search` lookups when Studio's schema changes.

The connected Studio successfully returned 162 classes for `{}` during live
verification. The earlier `-32602` result came from `{"query":""}`, not from an
unsupported full-catalog request. If Studio rejects a valid empty request, surface
that error without wildcard/alphabet probing or inventing a partial catalog.

The general tool's class validators, automatic defaults, ObjectType insertion,
ValueBase tagging and UI diagnostics are retired; only the VFXRecipe schema's own
equivalents remain behind the dedicated tool. Editor assignments must use supported Luau values and exact asset
names/paths; the overlay documents them but does not convert or validate values.
Existing hierarchy move protections and Mobility normalization remain.

Readback is independent of writable schemas and preserves WorldTransform/Size
when supplied by Studio or the saved file. These are useful spatial observations,
not proof that a field is writable. The Editor's supported property contract
controls assignments; saved file caches may be stale.

## Editor execution and failure recovery

`execute.luau` accepts exactly `target: "Editor"` and `code: string`. Every call
uses a new VM with the active world's game/workspace; world edits persist but
Lua globals/references do not. Return values are first-value strings, not captured
print logs: no return/nil gives `"nil"`, supported tables give a JSON string.

Use the provided `workspace`, `game.Workspace`, or direct service children. Current
native Editor builds also expose `game:GetService`, the `os` table, and `isnil`;
service-specific members remain limited by the Editor API. `task` and `GetDebugId`
remain unavailable. `GetPivot`/`PivotTo` support BasePart/Model receivers only,
excluding world roots. Older builds may differ: verify method/global support on
the connected build rather than assuming gameplay API parity. Use the live schema
for unfamiliar classes/properties; it does not enumerate methods or globals. Use
ordinary nil checks on lookup results and discard references after destroying
instances.
For example, the following command uses the documented instance creation path:

```json
{"target":"Editor","code":"local p = Instance.new('Part'); p.Name = 'AgentPart'; p.Parent = workspace; return p.Name"}
```

Use live class/property hints. Create related containers before their children
within one command, and return a small verification summary rather than the whole
world. A result over 64 KiB fails with a serialization error and returns nothing:
filter in Luau, return counts or only the needed fields, split broad reads by
subtree, and read script text with the script tools instead of returning `Source`.
A focused readback proves properties, not visual appearance or gameplay.

Editor Size is `(X, Y, Z)` with Y vertical. In the tested Studio mapping, native
Source receives `(Editor Z, Editor X, Editor Y)`, expressed as native
`(width, depth, height)` with Z up. For native width=160, depth=45, height=240,
the unrotated Editor Size is `(45,240,160)`. Keep the coordinate space explicit
at the boundary; a matching outer box in a smoke test does not prove the intended
width/depth orientation. Rotation cannot fix invalid dimensions already used by
the generator. Check positive derived dimensions and clearances across parameter
combinations before emitting geometry.

Studio supports instance/attribute edits and Script.Source within its editable API.
It forbids deleting/reparenting the DataModel root and detaching existing instances
into temporary hierarchies. Unconnected new temporary objects are cleaned up.
PIE transitions/running PIE, another Editor transaction, and collaborative editing
reject execution. Limits are 256 KiB UTF-8 source, 64 KiB output, 1,024 explicit
instance creations, and 5 seconds Lua execution; native calls are not preemptible.
Missing strings, unsupported targets and NUL produce `-32602`; execution conditions,
compile/runtime errors, resource limits and serialization failures produce `-32000`.

Ordinary edits share command Undo; Script.Source file restoration is outside that
guarantee. The tool retains `command_id`, `mutation_attempted`, and `undo_recorded`
and never retries execution. When `mutation_attempted` is explicitly false, the
failure says no mutation was attempted; correct the code before submitting a new
command. Otherwise, changes may remain and the current world and Undo state must
be inspected before recovery. `undo_recorded=false` alone does not prove that no
edits occurred. A transport failure leaves the mutation outcome unknown.

Success already includes a `level.save.file` call. Do not issue another save for
the same edits. A save failure retains the execution result and reports that the
code succeeded; recover saving without executing the code again. A successful
response proves the save RPC returned, not that reopening the world or Undo was
tested.

The first return value is authored by the submitted code. It is not a native
generation report and contains no automatic confirmation that asynchronous
generation completed. An empty later result does not reveal whether generation
is pending or failed, much less its cause. Use actual diagnostics if available;
otherwise report the cause as unknown. Do not label an unchanged string replacement
as a repair or identical measurements as evidence of a change. Child identity and
outer bounds can remain stable while internal geometry changes, so verification
must use an observable that is relevant to the requested effect.

Likewise, a screenshot path or onScreen projection only establishes capture or
framing. If a cross-host path cannot be read, use an available project mount or
report that the image was not inspected. Do not claim visual correctness from
those status fields. This guidance does not add a bake-status API or change the
Studio-side generator; those capabilities remain owned by Studio.

## Procedural removal and release

The procedural dummy-JSON runner, experiment and interpreter bundle remain retired.
Native `proceduralmodel.api / validate / set` tools are restored by the preceding
PR #441 and remain available here. They supply the full Python API reference,
recipe validation and explicit authoring/bake reports.

The native authoring skill restored as `geometry-recipe` by #434 is renamed to
`procedural-model-builder` here. It keeps the geometry/material/UV/resource and
verification guidance while using Editor Luau, Source helpers and later readback,
alongside the restored native recipe RPCs; it is not a deprecated redirect and does
not restore a second world-editing tool family. The skills manifest lists
`procedural-model-builder` and revokes `geometry-recipe`, so initialization removes
the old installed copy and prevents its reinstallation.

The `geometry-recipe` agent was removed earlier: it had no tool or model settings of
its own, so the system prompt delegates new props to a `general` sub-agent that loads
the skill. The agents manifest revokes the old installed copy, and no renamed agent
is added.

The retired `procedural-builder` skill and agent are removed from bootstrap assets.
The bootstrap manifest revokes both names so initialization removes old installed
copies and prevents reinstallation, including from older bundles. User-created
entries with other names remain untouched; project world/source files are not
migrated or removed.

Ordinary startup uses `MissingOnly` and does not replace existing entries.
`scripts/dev-cross-studio.sh` also only creates missing links; restarting it is not
an upgrade of installed copies. Validate migration through the actual applied
runtime update / local runtime bundle install path. For development, use explicitly
configured bootstrap paths or refresh just the known product-owned copies after
backing up customizations. Do not delete the global skills/agents directories.

Procedural modeling represents a form as generation rules plus parameters. The
rules encode relationships among generated parts; rerunning them with different
inputs produces related forms. Parameters can control dimensions, counts, fill,
spacing, or layout. The generated geometry is derived output rather than the
authoritative description of the model. Lasting changes belong in the rules or
their inputs, and a parameter has an effect only when the source consumes it.

`ProceduralModel` is Studio's persistent implementation of this concept. It stores
the source and inputs, and Studio regenerates its children independently of the
short-lived Editor command. Merely creating ordinary parts with a loop does not
retain that generation lifecycle. Existing world objects and user
source files are preserved. It uses the same Editor tool: `Instance.new` creates it,
`Size` and `Source` configure it, and `AutoRebuild=true` lets Studio generate its
MeshPart children. Source is still Python because that is the Studio class's
native format. The dedicated ProceduralModel reference, validation, and set tools
supplement this shared Editor path; they do not restore generic JSON upsert. Use
existing source or Studio documentation rather than inventing Python APIs.

The native module declares `OVDR_PARAMETERS` and defines
`on_generate(model, size, attributes)`. Its module scope remains declarative;
geometry is created inside the entry point. Merge meshes with the same material
and tint, dispose temporary mesh handles, apply normals and UVs, then declare a
generated child with `model.part`. The complete bootstrap example covers these
steps using the existing `parts.chamfered_box`, `G.place`, `G.append_mesh`, and
Unreal LinearColor contracts. It is an authoring reference, not a request-specific
class-selection rule or a restored standalone tool family.

Documentation search can supply additional APIs, but no search match is not proof
that a mechanism defined by the supplied contract is unavailable. The gameplay
Lua search/validation/Play workflow is scoped to gameplay scripts; it must not
replace an Editor authoring requirement with a gameplay implementation.

Live checks on 2026-09-08 confirmed Source assignment and automatic generation of
two MeshPart children from an existing source. The children were absent inside
the execution call and present when read two seconds later. Therefore automatic
save after the Editor command does not prove the asynchronous bake is finished.
Read back the affected model in a later call before claiming generation succeeded;
persist subsequent generated changes if needed. Do not replay creation because
the children are not immediately present. The tested Editor rejects `Rebuild`
and `Bake` members; do not invent synchronous bake calls.

Live schema exposes `AutoRebuild` and `Size` but omits Source, which is available
through instance reads and Editor Luau. Focused Source helpers accept an actual
string Source regardless of class, preserving non-Lua indentation. Lua validation,
grep, and script deletion remain specific to Lua scripts. No ProceduralModel
class exception is needed in the source-editing code.

The common runtime experiments API
is independent of both generation systems: test fixtures named `procedural` do not
register a product tool. The product experiment definition is removed, so a saved
`experiments.overrides.procedural` value cannot restore the deleted tool.

The consolidated feature PR targets `preview/release-40` and includes its tests.
Do not deploy this feature live early. Review and merge into preview through the
release process; immediately before live release, merge preview/release-40 into
main (the default branch referred to as master in the release request). Creating
this PR does not authorize an automatic preview/main merge or deployment.

## Verification boundaries

Tests exercise empty-request full search and empty-query rejection through the
shared tool executor and MCP, compact class catalogs, overlay merging on targeted
schemas (inherited notes,
sentinel removal, supplements and their query filtering, Studio precedence,
valueTypes), overlay keys against the recorded Studio index, Korean descriptions split
across TCP chunks, UTF-8 byte accounting, and persisted truncated results. They
also verify that the general upsert tool is absent while Editor error/save handling,
retained instance/Source tools and the dedicated VFXRecipe tool continue to work. The bundled registry exposes the active
procedural-model-builder skill/agent while keeping procedural-builder and the
retired local runner absent. Live full-catalog transport and targeted lookups have
been verified; end-to-end model authoring remains a draft gate.
