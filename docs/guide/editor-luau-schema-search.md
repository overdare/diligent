# Editor Luau and live instance schemas

The OVERDARE bundled Studio provider exposes `studiorpc_instance_schema_search`
and `studiorpc_execute_luau`. These are product tools using the existing tool
result/approval protocol, so Web and TUI receive the same output and error state.
No client-specific RPC method or UI is required.

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

Studio supports instance/attribute edits and Script.Source within its editable API.
It forbids deleting/reparenting the DataModel root and detaching existing instances
into temporary hierarchies. Unconnected new temporary objects are cleaned up.
PIE transitions/running PIE, another Editor transaction, and collaborative editing
reject execution. Limits are 256 KiB UTF-8 source, 64 KiB output, 1,024 explicit
instance creations, and 5 seconds Lua execution; native calls are not preemptible.
Missing strings, unsupported targets and NUL produce `-32602`; execution conditions,
compile/runtime errors, resource limits and serialization failures produce `-32000`.

Ordinary edits share command Undo; Script.Source file restoration is outside that
guarantee. Failures can leave changes applied. The tool retains `command_id`,
`mutation_attempted`, and `undo_recorded` in output and metadata, marks errors, and
never retries execution. Transport failure means mutation outcome is unknown.
Inspect the current world and Undo state before recovery. Success is flushed through
`level.save.file`; a save failure explicitly reports that execution already succeeded.

## Procedural removal and release

The procedural dummy-JSON runner, tool, builder skill/agent, experiment and interpreter
bundle are retired. Editor Luau is the direct world-editing path. Existing user recipe
files and installed global skill/agent definitions are not removed automatically.
During release validation, check `~/.overdare/skills/procedural-builder/` and
`~/.overdare/agents/procedural-builder/` (use `~/.overdare-dev/` for dev installs).
Back up any customizations, then manually remove obsolete bundled definitions when
present. Leftover definitions do not restore the removed execution tool.

`ProceduralModel` is the separate Studio Python mesh-recipe system from preview.
Its `proceduralmodel.api`, `proceduralmodel.validate`, `proceduralmodel.set` and
geometry-recipe skill/agent remain supported. The common runtime experiments API
is independent of both generation systems: test fixtures named `procedural` do not
register a product tool. The product experiment definition is removed, so a saved
`experiments.overrides.procedural` value cannot restore the deleted tool.

The feature branch starts at main, but the PR target is `preview/release-40`.
Do not deploy this feature live early. Review and merge into preview through the
release process; immediately before live release, merge preview/release-40 into
main (the default branch referred to as master in the release request). Creating
this PR does not authorize an automatic preview/main merge or deployment.

## Verification boundaries

Tests use injected responses and a local TCP Studio stand-in to verify filter
validation, future-class search/create/read/update, exact JSON forwarding, failure
metadata, no retry, approval rejection, and successful execution followed by save
failure. They run after removing the old static catalog. They do not prove actual
Editor VM behavior, world persistence, Undo, resource limits or Studio compatibility;
those require a running compatible Editor before release.
