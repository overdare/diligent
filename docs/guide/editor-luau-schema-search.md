# Editor Luau with live class discovery

The OVERDARE bundled Studio provider exposes `studiorpc_instance_schema_search`
and `studiorpc_execute_luau`. These are product tools using the existing tool
result/approval protocol, so Web and TUI receive the same output and error state.
No client-specific RPC method or UI is required.

If the appropriate class is unknown, discover available classes with
`studiorpc_instance_schema_search` and an empty query. For a known class, request
its details directly without fetching the full catalog first. Then author with
`studiorpc_execute_luau` targeting Editor. Instance reads, hierarchy moves/deletes,
and focused Source reads/edits remain available. The bulk JSON upsert tool and
its static class/property catalog are removed in this long-term draft.

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

The tool accepts `query` (including an empty string), `classes` containing 1-20
exact non-empty names, or both. No filters is also accepted and normalizes to
`{"query":""}`. The common executor removes empty optional strings; the adapter
restores this explicit full-search request without changing global cleanup rules.
Class-only requests still reach Studio as class filters. A non-empty query remains
a literal class/property substring; no wildcard, limit, or cursor is invented.

Full discovery returns schemaVersion and a compact class catalog: class names,
descriptions (including Korean), creatable/service and other class metadata are
preserved, while property payloads are omitted. The adapter labels this output
`view: "classes"`. Request `classes` to retrieve the detailed properties, with an
optional property query. Targeted results preserve all response fields unchanged.
This separation keeps all property definitions out of the initial class list.

UTF-8 descriptions are preserved through TCP decoding and JSON serialization.
RPC byte diagnostics use UTF-8 byte lengths. If a tool output exceeds the common
limit, keep its beginning and provide the persisted full output when available;
a truncated catalog must not be treated as complete. There is no persistent schema
cache or automatic injection of an exhaustive property catalog into the prompt.

The updated Studio contract is reported to support empty-query full search. The
currently connected build still returned `-32602` for that request during draft
verification. That error is surfaced; the agent must not invent a partial catalog
using wildcard/alphabet probing. Full-list integration with an updated Studio
remains a draft acceptance gate. Focused class/property queries work on the tested
build and may support a documented operation even when full discovery is unavailable.

The previous upsert class validators, automatic defaults, ObjectType insertion,
VFX short-name expansion and upsert-only diagnostics/file recovery are retired
with that tool. Editor assignments must use supported Luau values and exact asset
names/paths. Existing hierarchy move protections and Mobility normalization remain.

Readback is independent of writable schemas and preserves WorldTransform/Size
when supplied by Studio or the saved file. These are useful spatial observations,
not proof that a field is writable. The Editor's supported property contract
controls assignments; saved file caches may be stale.

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

Use live class/property hints. Create related containers before their children
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

The procedural dummy-JSON runner, experiment, interpreter bundle, and separate
`proceduralmodel.api / validate / set` tools remain retired. Native ProceduralModel
and its Source format are retained in Studio.

The `procedural-builder` skill and agent definitions remain removed: they belonged
to the retired local Luau runner. The `geometry-recipe` skill and agent are active
native ProceduralModel authoring guides. They retain geometry/material/UV/resource
and verification guidance while using Editor Luau, Source helpers and later
readback instead of the removed dedicated recipe RPCs. They are not deprecated
redirects, and restoring them does not restore a second world-editing tool family.
Existing installed builder copies are not automatically deleted by the name-based
updater; this change adds no broad filesystem cleanup.

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

Tests exercise empty-query full search through the shared tool executor and MCP,
compact class catalogs, unchanged targeted schemas, Korean descriptions split
across TCP chunks, UTF-8 byte accounting, and persisted truncated results. They
also verify that upsert is absent while Editor error/save handling and retained
instance/Source tools continue to work. The bundled registry exposes the active geometry-recipe skill/agent while keeping
the procedural-builder and retired tools absent. Actual full-catalog discovery
on the updated Studio and end-to-end model authoring remain draft gates.
