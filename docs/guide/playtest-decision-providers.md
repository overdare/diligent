# Playtest decision providers and visual input

The shared `studiorpc_game_playtest` tool supports a provider choice without
rewriting the Studio adapter. Web, TUI and MCP consume the same tool implementation.
The runner retains input validation, intent commitment, progress watchdog and
owned-session cleanup. A model/provider never directly sends Studio input.

## Run settings

| Argument | Behavior |
| --- | --- |
| `decisionProvider` | `laya` (default) or `openai-decisions` |
| `observationMode` | `structured` (default) or `structured+image` |
| `model` | Laya model/configured default, or currently `gpt-6-luna` for Decisions |
| `decisionUrl` | Existing Laya override. Decisions accepts only its official HTTPS endpoint. |
| `maxVisualAgeMs` | 250..30000, default 2000; maximum image age before a new model choice dispatch |

Existing `harnessName`, `goal`, duration, decision interval and stuck timeout keep
their behavior. Laya's existing defaults and wire format remain intact; visual
mode with Laya is rejected instead of silently dropping images.

Example for an already installed, validated harness:

```json
{
  "harnessName": "current-game-native",
  "goal": "Inspect available objects and make real mission progress",
  "decisionProvider": "openai-decisions",
  "observationMode": "structured+image",
  "model": "gpt-6-luna",
  "maxDurationMs": 100000,
  "stuckTimeoutMs": 15000,
  "intentDecisionIntervalMs": 8000,
  "maxVisualAgeMs": 2000
}
```

These durations are example settings, not latency promises. Do not start raw PIE
first; the playtest tool starts and stops its own session.

## Credentials and request handling

Set `OPENAI_API_KEY` in the **sidecar host's** server environment. Do not put a
credential in tool arguments, Lua, browser configuration or traces. The adapter
sends it as a Bearer credential to `https://api.openai.com/v1/decisions`, rejects
custom authenticated destinations and disables redirects. Missing credentials
fail before any Studio calls. There is no automatic ChatGPT OAuth reuse or token
refresh in this adapter. No unrelated coding-provider settings are changed.

Decisions uses text/image `input` and a named `choice` question. Each candidate's
ID becomes a supplied choice value; the named answer is normalized into the
runner's existing choice format. Refusal, malformed/duplicate answers, an unknown
choice or an HTTP error cannot dispatch input. Raw HTTP error bodies are not
echoed because they may reflect credentials or submitted observations.

Laya still warms its installed model. Decisions preparation checks configuration
without sending a fabricated inference request; the first genuine model decision
tests service/account availability. Success in offline transport tests is not proof
that an account can use the API. See the [official Decisions contract](https://developers.openai.com/api/docs/guides/decisions).

## Screenshot acquisition

Visual mode uses the existing `game.screenshot` RPC with GUI included. It verifies
one targeted/injectable client in the owned PIE session before and after capture.
Ambiguous multi-client views and mismatched session/client metadata fail closed.
It reads PNG bytes and validates signature, header dimensions against capture
metadata, and local bounds (10 MiB; at most 8192 pixels on either axis).

Same-host captures use the absolute path returned by Studio. For different hosts,
configure a verified filesystem mapping in the sidecar environment:

```text
STUDIO_SCREENSHOT_REMOTE_ROOT=<absolute capture directory as seen by Studio>
STUDIO_SCREENSHOT_LOCAL_ROOT=<absolute mounted counterpart on the sidecar host>
```

Both are required together. Only paths contained in the remote root map to the
local root; traversal and local symlink escapes are rejected. This is a mapping,
not a file-transfer service or an automatic mount/share creator. A Windows path
outside the configured mapping fails on a Mac. These screenshot roots are distinct
from the existing image-import `STUDIO_LOCAL_FILE_ROOT/REMOTE_FILE_ROOT` settings.

The previously recorded Horror screenshots were outside the Mac's mounted project
directory. This implementation does not make those files accessible automatically.
Use a verified shared capture directory or same-host deployment before claiming
live visual support for that environment.

## Timing, evidence and semantics

Captures occur for actual model choices, not every observation or input step.
Singleton actions and retained intent steps remain automatic and use fresh
structured checks. The observer continues while capture/inference runs. Changes
to candidate validity during capture discard the visual decision before requesting
the model; expired images also invalidate choices before dispatch. The ordinary
watchdog and overall deadline cancel capture/inference and clean up the owned PIE.

Image and game-state reads are **not atomic**. The trace records the source state
revision, conservative capture-request-start time, session/client identity, image
dimensions, camera metadata and SHA-256. Existing current-frame validity guards
still run before input. Capture age and identity checks do not prove perfect visual
alignment for all dynamic scenes; derive appropriate target/context validity in
the game adapter and measure end-to-end latency.

PNG evidence is saved under the episode's `images/<sha256>.png`. Trace entries contain
metadata and artifact paths, never base64 image data. `decision_configuration` and
the summary record `decisionConfig` and `runConfig`, including the resolved provider,
model, observation mode, endpoint and explicit episode settings. `visual_observation`
correlates the capture to `decisionId`; its presence does not itself confirm an action.

Vision does not invent executable targets or determine game victory. Keep target
IDs and useful descriptions in the catalog, provide screen-location context when
available, and verify effects through real game feedback. Compare structured-only
and visual runs on the same provider/harness before attributing improvement to vision.

## Validation status (2026-10-07)

Offline tests exercise request formats, inline image delivery, credential/response
failures, provider switching through the shared tool, capture provenance, stale-image
rejection and cleanup. They use controlled responses and do not measure model quality.

A small live text probe with the current Diligent ChatGPT OAuth token returned HTTP
401 at the public Decisions endpoint. Repeating with the existing ChatGPT headers
and version `0.159.0`, then `0.160.1`, also returned 401. The latter version was checked
against the [official changelog](https://learn.chatgpt.com/docs/changelog). Tokens and
account identifiers were not printed or copied into repository artifacts. No
authenticated Decisions success or vision-backed Studio episode is established.
