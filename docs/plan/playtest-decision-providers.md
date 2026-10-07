# Swappable playtest decision providers and visual observations

Status: the initial design below is now implemented and covered by offline tests
(2026-10-07). The [product guide](../guide/playtest-decision-providers.md) is the
current behavior reference. Public Decisions authentication probes using the
existing ChatGPT token, including updated version headers, returned HTTP 401.
No authenticated Decisions success or live visual episode has been established.
Cross-host image access still requires a verified shared-root mapping; it is not
created automatically. The existing PoC outcomes and installed game source remain
separate evidence from these framework changes.

## Objective and boundary

Use the same game adapter, candidate semantics, input executor, assertions and
episode ownership with different decision providers. Provider replacement should
be a run setting once its adapter exists, not another game-specific harness rewrite.
Adding visual evidence changes observation acquisition, not game rules or success
criteria. Vision may improve perception/choice but does not repair pathfinding,
conflicting guards or incorrect target-completion semantics by itself.

At design time, the runner already injected `RunPlaytestOptions.choose(frame,
candidates, signal, context)`. The remaining coupling was in tool assembly,
which directly constructed `createLayaChooser`. That assembly now uses the small
provider factory and the runner accepts optional visual evidence. The Lua driver
still has no chooser callback and needs none for this provider change.

## Official contract checked

Source: [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions),
fetched 2026-10-07. The guide describes a public beta using `POST /v1/decisions`
with `gpt-6-luna`, text/image input and predicate/choice/score questions.

For this workload use a choice question. Map candidate IDs/descriptions to
`questions[].choices[].value/description`. Read the named answer from the `answers`
array and normalize its choice, probabilities, confidence and usage. A refusal,
wrong answer type/name or choice outside the supplied catalog must not dispatch
input. Laya's `questions.action.criteria` and `answers.action.choice` format is a
different adapter, not the OpenAI wire format.

Images must be inline base64 data URLs in `input_image` parts. Hosted image URLs
and file IDs are not supported by this endpoint according to the guide. A Windows
path is neither image content nor a usable API image URL.

Independent questions can share a request; an action choice cannot depend on the
answer to a predicate in that same request. Start with one action question. Add
visual diagnostic predicates only for a concrete evaluation need, treating them
as estimates rather than authoritative game-state or win evidence.

## Minimal implementation shape

```text
game adapter: state + memory + candidate intents + verification facts
                           |
common observation preparation: optional viewport image + capture provenance
                           |
             normalized decision input
                 /                    \
       Laya adapter              OpenAI Decisions adapter
                 \                    /
                normalized candidate ID
                           |
existing fresh-state validation -> physical input -> correlated game feedback
```

Use a small provider interface/factory; no plugin registry or new game RPC is
needed merely to translate the model request. Each provider declares supported
input modalities, accepts the common decision input and returns the existing
normalized choice/diagnostics. Keep cancellation and the remaining episode budget
in call options. Provider-specific authentication, serialization and response
parsing belong in its adapter. A provider must not read Studio or execute input.

Common observation preparation owns image capture/access, not the provider or
game Lua. Keep image bytes outside the JSON StringValue driver frame. Pass compact
game facts and the existing runner context as text, with optional image parts.
Keep full verification state separate from policy-visible observations.

Implemented run settings (see the product guide for current constraints):

| Setting | Choices / meaning |
| --- | --- |
| `decisionProvider` | `laya` or `openai-decisions` |
| `observationMode` | `structured` or `structured+image` |
| `model` | Provider-compatible explicit model |

Retain existing Laya defaults for compatibility; select OpenAI explicitly. A
text-only provider with required visual input is a configuration error. Do not
silently drop images or switch providers on an error. Provider choice belongs in
the shared product tool assembly so Web, TUI and MCP use the same behavior.
Credentials come from the sidecar's server-side API-key configuration, never Lua,
tool arguments, trace records or the browser. Codex sign-in alone does not establish
that an OpenAI API credential or account access is configured.

## Visual observation requirements

1. Capture the actual owned PIE viewport/client with its GUI. Record capture time,
   image dimensions, camera and corresponding state/candidate context. Screenshot
   and state reads are not automatically atomic; check relevant changes around
   capture and re-observe when their relationship is no longer valid.
2. Make pixels accessible to the sidecar. The current screenshot attachment code
   reads `result.path` on the agent host. The recorded Windows Horror screenshot
   directory was outside the Mac's mounted share. Use verified shared-root mapping
   where available, or a supported image transfer from Studio; do not fabricate
   a local path or expose a new unauthenticated file server. Same-host Windows
   deployment can read its capture files directly. Choose the available transport
   before claiming dev-cross visual support.
3. Bind visible targets to candidate IDs using same-capture camera projections,
   readable target descriptions and screen locations when available. A raw image
   does not tell the model which opaque ID is the lower drawer. Projection inside
   the viewport is not proof of visibility through an occluder.
4. Capture at useful decision boundaries, initially new target/room selection or
   recovery, rather than every observation tick or W-key step. Bound capture size,
   age, frequency and request deadline. Keep continuous structured observation and
   the existing input validity/watchdog behavior while the model is pending.
5. Record image identity/hash and timing with the decision trace. Keep image bytes
   out of high-frequency JSON logs. Missing, stale or wrong-client images must be
   visible failures of the requested vision mode, not an unlabelled text-only run.

A fixed-choice API cannot invent a new target or return an arbitrary bounding-box
schema. The harness must offer useful navigation/interaction/recovery alternatives.
An explicitly supported re-observe option can request better evidence; it must
not count as gameplay progress or keep renewing the watchdog.

## Implementation and acceptance sequence

1. Add provider-neutral construction and the OpenAI request/response adapter,
   with tests for serialization, named-answer parsing, refusal, invalid choice,
   authentication handling and cancellation. Retain existing Laya tests/defaults.
2. Add shared visual acquisition and tests for actual bytes, capture provenance,
   unsupported modality, wrong/missing/stale capture and state revalidation. Do
   not describe the cross-host path limitation as solved by the model adapter.
3. Record the resolved provider/model, observation mode, harness hash, assistance,
   capture policy, decision interval and endpoint host in each run's metadata.
4. Compare Laya structured, Decisions structured, and Decisions structured+image
   under the same game/harness/profile and comparable initial conditions. The two
   Decisions modes isolate the contribution of vision. Separate offline adapter
   tests, recorded-scene decision evaluation and actual owned live episodes.
5. Verify GUI/target distinctions, selected input recipients, target completion,
   actual exploration/collection and cleanup. If the scenario is not reached,
   mark it unexercised. Do not inherit success from a different provider/hash.

Measure capture/encoding, upload+API wall time, observation age, stale-choice
rejections and end-to-end control time separately. The guide's speed comparison
is against Responses, not local Laya; it is not a latency guarantee for this
Windows/sidecar setup. Use actual usage and the documented pricing for cost
estimates once real requests are measured. A visual interpretation remains policy
evidence; authoritative game feedback still decides what happened.
