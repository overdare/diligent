# Editor Luau and live instance schemas

The OVERDARE bundled Studio provider exposes `studiorpc_instance_schema_search`
and `studiorpc_execute_luau`. These are product tools using the existing tool
result/approval protocol, so Web and TUI receive the same output and error state.
No client-specific RPC method or UI is required.

Use one authoring workflow: discover the running Studio's classes and editable
properties, edit the world with Editor Luau, and read back the affected objects.
Existing instance and script tools remain available for focused reads and text
edits. The agent does not select a separate authoring tool family for each class.

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

## Editor execution and failure recovery

`execute.luau` accepts exactly `target: "Editor"` and `code: string`. Every call
uses a new VM with the active world's game/workspace; world edits persist but
Lua globals/references do not. Return values are first-value strings, not captured
print logs: no return/nil gives `"nil"`, supported tables give a JSON string.

Use the provided `workspace` or `game.Workspace`. The tested Editor build rejects
`game:GetService`; gameplay API familiarity is not evidence of Editor support.
For example, the following command uses the documented instance creation path:

```json
{"target":"Editor","code":"local p = Instance.new('Part'); p.Name = 'AgentPart'; p.Parent = workspace; return p.Name"}
```

Discover the target class first. Create related containers before their children
within one command, and return a small verification summary rather than the whole
world. A focused readback proves properties, not visual appearance or gameplay.

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

`ProceduralModel` remains a Studio class, with existing world objects and user
source files preserved. It uses the same Editor tool: `Instance.new` creates it,
`Size` and `Source` configure it, and `AutoRebuild=true` lets Studio generate its
MeshPart children. Source is still Python because that is the Studio class's
native format; the agent has no separate recipe API, validation tool, or baking
tool. Use existing source or Studio documentation rather than inventing Python APIs.

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
