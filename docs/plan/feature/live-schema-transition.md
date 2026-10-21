# Live schema discovery implementation draft

Status: implementation draft stacked on native RPC restoration PR #441
(`fix/restore-proceduralmodel-rpcs`), targeting preview/release-40. Compatibility
#415 and geometry restoration #434 are already merged. This draft removes upsert and implements dynamic discovery.

## Implemented behavior

- Inherit proceduralmodel.api / validate / set unchanged from #441. These native
  authoring tools remain available; only the local procedural runner stays retired.

- Remove the upsert tool, its static instance.params catalog, class-bound write
  validators/defaults/transformations, upsert renderer, and v1/v2 upsert execution.
  Keep instance read, hierarchy move/delete, Source helpers and their shared
  Mobility/singleton safeguards. Remove the procedural-builder skill/agent definitions. Rename the active geometry-recipe skill/agent inherited from #434 to
  procedural-model-builder and remove the old geometry-recipe entries here. The
  underlying native authoring guidance is restored by #434, not by this PR.
- Full discovery is a request with no filters: `{}`. Class-only requests use
  `{"classes":[...]}` with no `query`; property searches add a non-empty query.
  Empty queries are rejected before Studio dispatch, not silently normalized.
  The validator distinguishes omission from malformed input while the model-facing
  JSON Schema stays a flat object. System and code-mode prompts show all three forms.
- Full search projects the Studio result to class metadata, retaining names,
  descriptions, creatable/service and schemaVersion but omitting property payloads.
  The tool adds `view: "classes"` and a hint to request classes for details. This is
  a local output projection, not a new Studio RPC parameter.
- Targeted lookup preserves the full returned property schemas and descriptions and
  merges the sidecar schema overlay: notes migrated from the retired upsert catalog
  (units, contextual limits), Luau value-type guidance, sentinel enum removal, and
  `source:"sidecar"` properties Studio omits (VFXRecipe layers, VFXPreset.PresetName
  and others) because Studio-side schema changes are not available. Studio fields
  stay authoritative. No wildcard probing, alternate endpoints, persistent cache, or
  prompt-level property-schema injection is added.
- Preserve Korean UTF-8 descriptions through JSON and chunked TCP responses. Measure
  RPC diagnostics in UTF-8 bytes. Oversized model output uses head truncation and
  the common full-output store; neither truncation nor empty results prove that
  the complete catalog was observed.
- Update the system prompt to fetch the full catalog when the appropriate class
  is unknown. A known class goes directly to targeted property lookup, then
  Editor Luau. Retain the tested
  native Python Source example and explicit Editor/gameplay lifetime distinction.
  Update UI, VFX and asset-pack skills so they no longer call the removed upsert.

## Contract and current server evidence

Studio-side guidance says full search takes an empty request (`{}`) and descriptions
may contain Korean text. The connected Studio at 10.40.32.110:13378 answered:

| Request | Observed result |
| --- | --- |
| `{}` | Full catalog: 162 classes (about 212 KB raw) |
| `{"query":""}` | `-32602`: query must be a non-empty string |
| `{"classes":["ProceduralModel"]}` | One detailed class returned |
| `{"classes":["MeshPart"],"query":"Material"}` | Material enum and MaterialVariant returned |

An earlier draft sent `{"query":""}` for full search and recorded the `-32602` reply as
an old-build case; the empty request is the working contract. An error for `{}` is
still reported as an unavailable catalog without invented fallback queries.

## Compatibility impact

The compatibility upsert input measured 100,947 UTF-8 bytes (58 instance classes
and 18 service classes) before removal. This is serialized schema size, not tokens.
The upper branch no longer advertises that tool or automatically validates/converts
its old JSON payloads. Existing saved tool records can still be displayed, but an
attempt to call the removed tool must fail as unavailable.

World changes now use Editor Luau. Correct class/property values, creation
settings, exact VFX paths, and read-only distinctions must come from live hints,
applicable documentation and actual Studio validation. The lower PR remains the
usable compatibility option until this transition is verified sufficiently.

## Verification and remaining acceptance gates

Current draft checks: lint/typecheck and 2,448 package tests passed. The related
Studio tool, MCP and packaging suites passed 290 tests across 21 isolated files.
The shared executor live check confirmed upsert is absent and a MeshPart Material
lookup returns detailed hints. Full search through the shared executor returned all
162 classes as a 20,207-byte compact catalog, below the output cap, for both `{}` and
`{"query":""}` inputs.

Deterministic tests must cover:

- Upsert absence in bundled and MCP tool catalogs, with Editor and schema search
  still present; preserve retained instance/source tool tests.
- No-filter inputs from agent and MCP entry points reaching Studio as the empty
  full-search request; empty queries with or without classes rejected before RPC.
  Keep global empty-input cleanup semantics for unrelated tools unchanged.
- Complete class-name preservation while removing bulky property bodies from full
  responses; targeted lookup retains writeCondition/valueSchema and Korean text.
- UTF-8 character boundaries across TCP chunks and output caps, exact full-output
  persistence and correct byte measurements.
- An old server's full-search error surfacing without invented fallback requests.

Before making this PR ready:

1. Verify full discovery on the actual updated Studio and compare with an
   authoritative engine class listing. Do not infer completeness from a synthetic
   response or a successful class-specific query.
2. Exercise real model tasks that require classes absent from prompt examples and
   the current world. Confirm correct material/property choice from detail lookups.
3. Compare the lower and upper branches on creation, edits, UI and VFX authoring,
   parameter-triggered native regeneration, context/output size, and failures.
4. Verify useful behavior on large catalogs and old/unavailable servers. A missing
   catalog must not trigger invented APIs or gameplay substitution for Editor work.

Keep #429 draft while these live acceptance gates remain open. Compatibility #415
is already merged; do not reopen or modify it. No automatic merge or deployment
is part of this change.
