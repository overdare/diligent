# Live schema discovery transition

Status: design-only draft stacked on the compatibility implementation in PR #415.
No speculative Studio wire contract or runtime change is introduced here.

## Current baseline

The lower PR keeps the full compatibility upsert input schema, class-specific
validation, creation defaults, ObjectType handling, and VFX normalization. Editor
Luau and supplementary schema search are available together. Native Source guidance
and deprecated skill/agent redirects preserve authoring and installed-user paths.
The reference point before compatibility restoration was `ced206e9`; the static
catalog was restored from preview `4dac65bc`.

A direct `zodToJsonSchema(params)` serialization of the compatibility input measures
100,947 UTF-8 bytes, covering 58 instance classes and 18 service classes. This is
not a token count or a provider-specific request size. Record the actual advertised
schema and model request size again when evaluating a replacement.

## Studio contract gate

The Studio-side update reported on 2026-09-08 confirms that an empty query
performs a full search, and that descriptions may contain Korean UTF-8 text.
Use an explicit `{"query":""}` as the full-search request to validate and wire
through Diligent. This report supersedes the earlier empty-query rejection as the
intended contract; it is not a claim that the updated build was retested here.

Before implementing the integration, record the supported Studio build and verify:

- The explicit empty query returns the full catalog. Do not assume omitted query,
  whitespace-only query, or an empty query combined with classes has identical
  semantics; confirm those cases independently rather than inventing normalization.
- Whether Studio can return names/summary metadata without all property definitions,
  or whether Diligent must compact a full response after receiving it.
- Class/property filtering and the meaning of schemaVersion, creatable, service,
  description, writeCondition, and valueSchema, including optional/missing fields.
- Observable differences between no matches, unavailable capability, malformed
  requests, transport failures, and an incompatible build.

Earlier-build observations at 10.40.32.110:13378 on 2026-09-08, before the
reported contract update (retain as old-build compatibility cases):

| Request to instance.schema.search | Response |
| --- | --- |
| `{"classes":["ProceduralModel"]}` | One class returned |
| `{}` | `-32602`: query or classes is required |
| `{"query":""}` | `-32602`: query must be a non-empty string |
| `{"query":"*"}` | Empty classes array |

Do not preserve the old rejection as the expected behavior of the updated build.
Do not add alphabetical probing, guessed endpoints, or a manually maintained
catalog as a substitute for empty-query discovery.

## Empty-query and UTF-8 integration requirements

- Update the adapter's non-empty query validation when implementing this layer.
  The lower PR currently uses `query: z.string().min(1).optional()`.
- Preserve the intentional empty string through both the agent tool executor and
  MCP/router entry points. Their shared `dropEmptyOptionals` currently removes
  empty optional strings, so changing only `.min(1)` is insufficient. Cover the
  full model/MCP-to-RPC path; a direct raw RPC test alone misses this boundary.
  Scope the fix to semantic empty-query support without changing every optional
  parameter's behavior as an incidental migration.
- Preserve Korean descriptions through TCP chunk decoding, JSON parsing, catalog
  projection, model output, persisted full-output files, and UI rendering. Keep
  exact class/property identifiers; descriptions need not be translated to English.
- Measure wire/output limits in UTF-8 bytes (`Buffer.byteLength` or `TextEncoder`),
  not JavaScript string length. The current RPC logs label `.length` as bytes;
  correct that diagnostic measurement as part of the integration. Do not split
  multibyte text when compacting or truncating results.
- Test Korean descriptions split across TCP chunks and near the output cap. Assert
  exact round-trip strings and correct byte accounting, without replacement
  characters or unintended double escaping. Distinguish legitimate JSON escapes
  from corrupted rendered text.

## Intended data flow

1. Keep the system prompt concise: explain important or easily confused concepts,
   execution lifetimes, and the distinction between JSON properties and Luau/native
   methods. Do not embed all class/property definitions there.
2. Obtain the complete available class-name catalog from the connected Studio, using
   the explicit empty-query contract. Preserve supported summary metadata, including
   Korean descriptions where provided, and expose an
   explicit incomplete/unavailable state rather than presenting a partial catalog
   as complete.
3. Use schema search to retrieve only the selected class/property details. Preserve
   exact names, enum values, write conditions, and read-only distinctions.
4. Author through Editor Luau or the applicable focused instance/source tool, then
   verify the actual affected state. JSON discovery does not replace native Python
   geometry reference documentation or prove asynchronous generation completed.

Do not insert fetched schemas back into the large upsert input definition. Whether
and when the catalog is cached/injected must be specified after Studio version and
connection semantics are confirmed; there is no provisional cache implementation.

## Upsert compatibility gate

Information discovery and mutation validation are separate responsibilities. Keep
the lower PR's schema and parser until the discovery/authoring checks below pass.
Before reducing the large input schema, document the replacement for each of:

- Class/property/type validation and useful errors on unsupported writes.
- Creation defaults versus partial updates, which must not receive creation values.
- ObjectType/value normalization and VFX name/path handling.
- Singleton/identity protection and read-only fields such as WorldTransform.
- Installed deprecated guides and the native ProceduralModel Source reference.

A successful schema search is not evidence that these behaviors can be removed.
Any intentionally changed compatibility behavior needs its own regression case
and explanation in this PR before it becomes ready for review.

## Acceptance and evidence

Use the same representative tasks against the lower PR and the proposed dynamic
implementation. Record Studio build, request/response shapes, schemaVersion, exact
branch heads, tool-definition bytes, lookup output bytes/truncation, and outcomes.

- Verify that `{"query":""}` survives both agent and MCP input handling and
  reaches Studio unchanged; compare the returned full catalog to the authoritative
  engine listing. Verify Korean description round-trips and byte-limited output.
- Discover a supported class whose name is not supplied in the user prompt, static
  prompt guidance, or the current world. Compare the catalog with an authoritative
  engine listing; do not validate completeness using the response itself.
- Retrieve a previously unfamiliar property, material enum, or write condition and
  perform the corresponding valid edit. Reject invalid writes with useful evidence.
- Cover empty results, unavailable/outdated servers, transport failures, large
  catalogs, long detail responses, and context after a lookup has been compacted.
  None may silently authorize invented APIs or a gameplay substitute for Editor work.
- Re-run compatibility creation, partial update, tagged values, VFX conversion,
  singleton protection, and read-only WorldTransform read/write cases.
- Verify a native ProceduralModel change after the initial command has ended,
  without resubmitting Source; inspect generated state and clean up temporary data.
- Separate deterministic transport/parser tests from real model and Studio trials.
  Prompt string assertions and mocked responses do not establish model behavior.

## Rollout

Keep this PR draft while the Studio contract or any acceptance gate remains open.
The lower compatibility PR is independently usable. The empty-query semantics are
now reported by Studio, while deployment/build validation and the remaining
interface decisions still need confirmation. Update this document with those
verified details and implement against them; do not merge a schema-removal change merely to complete the stack.
When #415 merges, retarget/rebase this branch onto its destination so only the
long-term delta remains. No automatic merge or deployment is part of this plan.
