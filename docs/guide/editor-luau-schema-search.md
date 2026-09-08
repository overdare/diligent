# Editor Luau and live instance schemas

The OVERDARE bundled Studio provider exposes `studiorpc_instance_schema_search`
and `studiorpc_execute_luau`. These are product tools using the existing tool
result/approval protocol, so Web and TUI receive the same output and error state.
No client-specific RPC method or UI is required.

Use one authoring workflow: discover the running Studio's classes and editable
properties, edit the world with Editor Luau, and read back the affected objects.
Existing instance and script tools remain available for focused reads and text
edits. The agent does not select a separate authoring tool family for each class.

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

`instance.schema.search` accepts a non-empty `query`, `classes` containing 1–20
non-empty exact class names, or both. Search is case-insensitive substring matching
against class/property names; combined filters search within the selected classes.
A class-name match includes every exposed property. `limit` and `cursor` are not
supported. Invalid filters produce Studio error `-32602`.

Results preserve `schemaVersion`, `classes`, `class`, `creatable`, `service`, and
property `name`, `declaredOn`, optional `writeCondition`, and optional `valueSchema`.
No matches is an empty classes array. This schema describes instance JSON editing,
not every Luau member. Check creation and write conditions before editing.
The query is one literal substring. Use a classes-only query to discover a class;
do not concatenate class/property names into an expression and interpret the empty
result as a capability check. Schema discovery does not provide geometry-function
documentation. The bootstrap prompt carries a minimal native Source reference
adapted from the previous implementation so that basic authoring does not depend
on an unrelated search result.
Schema discovery is read-only and does not request execute permission or save the
world. Do not treat an old local list of unsupported classes as authoritative.

The former `instance.params.ts` catalog is removed. Upsert validates the request
structure and protects tool-owned identity/hierarchy keys; Studio validates class
membership and value semantics. New classes and properties are forwarded without
local allowlists. Known singleton roots retain their creation/move/delete guards.
Read preserves JSON properties for unknown classes. Neither path injects class
defaults, infers ObjectType tags, expands VFX short names, or strips unknown values.
Use the complete JSON shapes from live hints/current instance reads, and full VFX
asset paths. The legacy v1 file-edit path also preserves supplied JSON; it still
requires Studio apply/save to validate and synchronize edits.

`WorldTransform` is a derived cache: instance reads omit it from
`properties`, and upsert rejects it for both additions and updates. Discover the
class's writable transform properties through live schema search instead.

If v1 upsert's apply call fails, it restores the original file bytes only when
the file still matches the bytes written by that upsert. A later external save
is preserved, and a failed restoration is reported with the original apply error.
This is file recovery, not a Studio rollback: the live world may have partially
applied the request, so inspect it before retrying. No apply is automatically retried.

## Editor execution and failure recovery

`execute.luau` accepts exactly `target: "Editor"` and `code: string`. Every call
uses a new VM with the active world's game/workspace; world edits persist but
Lua globals/references do not. Return values are first-value strings, not captured
print logs: no return/nil gives `"nil"`, supported tables give a JSON string.

Use the provided `workspace` or `game.Workspace`. The tested Editor build rejects
`game:GetService`; gameplay API familiarity is not evidence of Editor support.
The gameplay `isnil` helper is also unavailable in the Editor VM. Use ordinary
nil checks on lookup results and discard references after destroying instances.
For example, the following command uses the documented instance creation path:

```json
{"target":"Editor","code":"local p = Instance.new('Part'); p.Name = 'AgentPart'; p.Parent = workspace; return p.Name"}
```

Discover the target class first. Create related containers before their children
within one command, and return a small verification summary rather than the whole
world. A focused readback proves properties, not visual appearance or gameplay.

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

The procedural dummy-JSON runner, tool, builder skill/agent, experiment and interpreter
bundle are retired. The separate `proceduralmodel.api`, `proceduralmodel.validate`,
and `proceduralmodel.set` tools and geometry-recipe skill/agent are also retired.
Their API-output narrowing layer is no longer needed. Editor Luau is the default
world-editing path. Existing user recipe files and installed global skill/agent
definitions are not removed automatically.
During release validation, check `~/.overdare/skills/procedural-builder/` and
`~/.overdare/agents/procedural-builder/` (use `~/.overdare-dev/` for dev installs).
Also check `skills/geometry-recipe/` and `agents/geometry-recipe/` under the same
global storage directory. Back up any customizations, then manually remove obsolete
bundled definitions when present. Leftover definitions do not restore removed tools.

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
native format; the agent has no separate recipe API, validation tool, or baking
tool. Use existing source or Studio documentation rather than inventing Python APIs.

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

Tests use injected responses and a local TCP Studio stand-in to verify filter
validation, future-class search/create/read/update, exact JSON forwarding, failure
metadata, no retry, read-only schema discovery, approval rejection, removal of the
procedural tool/skill/agent surface, and successful execution followed by save
failure. They run after removing the old static catalog. They do not prove actual
Editor VM behavior, world persistence, Undo, resource limits or Studio compatibility;
those require a running compatible Editor before release.
