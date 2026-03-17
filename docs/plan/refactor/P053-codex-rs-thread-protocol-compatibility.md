---
id: P053
title: Full Codex-RS thread protocol compatibility
type: refactor
status: proposed
owner: diligent
created: 2026-03-17
---

# Significance

This migration is not a cosmetic protocol rename. It is a reset of the contract that defines what a Diligent thread is, how a thread is resumed, how live execution is observed, and how every frontend reconstructs state.

Today, Diligent still has a split-brain thread model:

- the runtime emits one set of live execution events
- the history API returns a different shape centered on raw `messages` and `transcript`
- Web and TUI independently rebuild display state from those raw history shapes
- tool rendering has partially moved to producer-owned structured payloads, but thread hydration has not followed the same architectural move

As a result, the codebase pays the same tax in multiple places:

- duplicated parsing logic
- hidden coupling between persistence formats and UI state
- drift risk between Web and TUI
- protocol messages that are too thin at the boundary, forcing clients to re-derive information already known on the server

The significance of this migration is that it removes that split at the root. After this work, a thread in Diligent is no longer defined by raw transcript internals plus frontend reconstruction logic. It is defined by a codex-rs-compatible item model and codex-rs-compatible thread lifecycle protocol.

That gives the project four strategic benefits:

1. **One thread model across all frontends.** CLI, Web, and Desktop consume the same semantic thread items.
2. **One resume model and one live model.** History and live no longer speak different conceptual languages.
3. **Producer-owned protocol enrichment.** The runtime, not the clients, owns the transformation from execution facts to displayable thread items.
4. **Deep codex-rs alignment.** Future borrowing of protocol ideas, tests, and UI patterns from codex-rs becomes cheaper because names, shapes, and semantics line up.

In short, this migration is important because it changes Diligent from “a system with a codex-inspired protocol surface” into “a system whose thread boundary is actually organized like codex-rs”.

# Context

## Why this plan exists now

Recent work on structured tool render payloads proved that when the producer emits richer boundary objects, consumers become dramatically simpler. That refactor removed one visible symptom of the old pattern, but it also made a deeper inconsistency impossible to ignore:

- tool rendering moved toward producer-owned structured payloads
- thread history restoration remained consumer-owned parsing of raw transcript-like data

That mismatch means Diligent currently has two incompatible philosophies inside the same protocol boundary:

- **live path:** relatively item-oriented and event-oriented
- **history path:** transcript-oriented and parser-oriented

The current history path still depends on client logic that extracts text, thinking, tool meaning, and resume state from lower-level payloads. This is exactly the coupling pattern that codex-rs largely avoids by making the server own `ThreadItem` construction and by using `thread/resume` as a semantic thread snapshot API.

## What is structurally wrong with the current thread boundary

The present Diligent thread protocol mixes together two different concerns:

1. **Canonical record of what happened**
2. **Renderable state needed to reconstruct the UI**

Those are not the same thing, but the current API makes clients treat them as though they were. The practical consequences are:

- raw history structures leak across the protocol boundary
- frontend code must know too much about message content block internals
- thread resume becomes a second implementation of rendering logic
- the server is no longer the only place that knows how tool, thinking, plan, and transcript facts should appear to users

## Why codex-rs is the reference point

This project already states codex-rs as an architectural influence, especially at the app-server protocol boundary. The relevant codex-rs lesson is not merely naming. The important lesson is structural:

- threads are restored through item snapshots, not raw transcript parsing
- live execution is streamed as item lifecycle updates, not ad hoc frontend reconstruction hints
- interactive flows such as approvals and tool-driven user input are modeled as item-scoped requests
- the protocol's semantic center is `ThreadItem`, not provider message internals

This plan therefore treats codex-rs compatibility as a thread-boundary redesign, not a shallow rename project.

## Primary references

The following files should be read before implementation. They are the concrete reference points that define the target contract for this migration.

### Diligent files to understand the current divergence

- `ARCHITECTURE.md`
  - Frontend Protocol Philosophy and current package-boundary intent
- `packages/protocol/src/client-requests.ts`
  - current `ThreadReadResponse`, `TranscriptEntry`, and thread request/response shapes
- `packages/runtime/src/app-server/event-mapper.ts`
  - current live event-to-notification mapping
- `packages/runtime/src/session/context-builder.ts`
  - current transcript construction path
- `packages/runtime/src/app-server/thread-handlers.ts`
  - current thread read/resume behavior and thread-facing handlers
- `packages/runtime/src/tools/defaults.ts`
  - current built-in tool inventory
- `packages/cli/src/tui/app-session-lifecycle.ts`
  - current transcript-based TUI resume hydration
- `packages/web/src/client/lib/thread-hydration.ts`
  - current transcript/message-based Web hydration

### Codex-rs files that define the compatibility target

- `docs/references/codex/codex-rs/app-server-protocol/src/protocol/v2.rs`
  - canonical `ThreadItem` and related DTO definitions
- `docs/references/codex/codex-rs/app-server-protocol/src/protocol/common.rs`
  - canonical request, notification, and server-request method strings
- `docs/references/codex/codex-rs/app-server/src/thread_state.rs`
  - active-turn snapshot ownership and `thread/resume` listener semantics
- `docs/references/codex/codex-rs/app-server/src/bespoke_event_handling.rs`
  - concrete event-to-item mapping patterns for approvals, request-user-input, dynamic tools, file change, and collab tools
- `docs/references/codex/codex-rs/debug-client/src/reader.rs`
  - minimal consumer example showing direct rendering of `ThreadItem` without transcript re-parsing

### What the implementer must extract from those references

Before changing code, freeze the following decisions from the reference files above:

1. Exact method strings for requests, notifications, and server requests
2. Exact field names and casing for `ThreadItem` variants
3. The separation between item lifecycle, item-specific deltas, and interactive server requests
4. The ownership model where active-turn item history is accumulated server-side and surfaced by `thread/resume`
5. The mapping pattern from execution events into concrete `ThreadItem` variants

These references are required input for the migration, not optional background reading.

# Summary

Diligent currently exposes a thread protocol that is only partially aligned with codex-rs.
The largest incompatibilities are:

- thread history is returned as raw-ish `messages` plus `transcript` instead of codex-rs-style `ThreadItem[]`
- live notifications and history hydration use different semantic models
- tool execution is represented as Diligent-specific tool-call payloads instead of codex-rs-compatible `ThreadItem` lifecycle events
- `request_user_input` and approval flows are mixed into Diligent-specific runtime behavior rather than codex-rs-style item lifecycle plus server request protocols
- protocol method and notification names diverge from codex-rs naming

This plan proposes a **single-cutover migration** to make Diligent's thread logic and external protocol names fully compatible with codex-rs's thread model.

This is **not** a gradual migration. The implementation is executed in one coordinated change set, using parallel agents for package-specific workstreams, and lands only when all frontends, runtime, protocol, and tests have been migrated together.

# Goal

Make Diligent's thread-facing protocol and thread state model match codex-rs's thread protocol conventions as closely as possible, including:

1. codex-rs-compatible thread item model (`ThreadItem`)
2. codex-rs-compatible live lifecycle notifications (`item/started`, `item/completed`, typed deltas)
3. codex-rs-compatible request naming for interactive flows (`item/tool/requestUserInput`, `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`)
4. codex-rs-compatible history API semantics (`thread/resume` returns item snapshots rather than raw transcript parsing inputs)
5. a single semantic model shared by runtime, TUI, Web, Desktop, and e2e tests

## Reading guide

If you are reading this document for the first time, use this order:

1. Read **Significance** to understand why this is a major architecture migration rather than a rename.
2. Read **Context** to understand what is broken in the current thread boundary.
3. Read **Decision** and **Canonical Diligent → Codex-RS Item Mapping** to understand the target model.
4. Read **Target External Protocol Surface** and **Target Runtime Architecture** to understand what the code must look like after the cutover.
5. Use **File Manifest**, **One-Shot Execution Plan**, and **Detailed Task List** as the implementation checklist.

This order matters because later sections assume the reader has already accepted the central design move: Diligent thread logic must stop being transcript-reconstruction-oriented and become `ThreadItem`-oriented.

# Decision

## Hard compatibility rule

This migration adopts the following hard rule:

- Every thread-visible item in Diligent must be represented as one existing codex-rs `ThreadItem` variant.
- No Diligent-specific replacement for `ThreadItem` is allowed.
- No custom fallback item variant is allowed.
- General Diligent and plugin tools must use codex-rs `DynamicToolCall` when they do not naturally map to a more specific codex-rs item variant.

This means the compatibility target is:

- **protocol names**: codex-rs-compatible
- **history shape**: codex-rs-compatible
- **live item lifecycle shape**: codex-rs-compatible
- **item ontology**: codex-rs-compatible

## Important interpretation

This plan uses codex-rs `DynamicToolCall` as the canonical bucket for general tools.
That is not considered a Diligent-only fallback because it already exists in codex-rs.

## Architectural thesis

The core architectural thesis behind every implementation decision in this document is:

> A thread boundary is healthy only when the server owns the semantic transformation from execution facts to thread-visible items, and every client consumes those items directly.

Everything else in this plan follows from that thesis.

# Non-Goals

- Do not preserve Diligent's current external thread protocol names for backward compatibility.
- Do not keep `thread/read` as the primary history API after the cutover.
- Do not preserve client-side transcript parsing as a supported long-term path.
- Do not introduce a dual protocol mode.
- Do not land partial compatibility.

# Why this is a one-shot migration

The current divergence is structural rather than local:

- runtime emits one semantic model for live execution
- history APIs expose another semantic model
- CLI and Web reconstruct display state independently
- server requests for approval and user input do not align with codex-rs naming or item ownership

Trying to migrate this gradually would temporarily require:

- two item systems
- two history systems
- two notification naming systems
- compatibility adapters in both runtime and clients

That would increase coupling, not reduce it.

This migration therefore lands as one coordinated cutover with all dependent packages updated together.

# Current State

## History path today

Diligent history hydration currently depends on raw or raw-adjacent transcript forms:

- `ThreadReadResponse.messages`
- `ThreadReadResponse.transcript`
- client-side parsing in Web hydration
- client-side parsing in CLI resume hydration

This causes:

- duplicated display derivation logic
- TUI/Web divergence risk
- coupling between transcript internals and render state

## Live path today

Diligent live execution already has item-like lifecycle notifications, but they are not codex-rs-compatible:

- payloads are Diligent-specific
- tool outputs rely on Diligent render payload conventions
- history and live do not share the same semantic item schema

## Interactive requests today

Diligent has server-request behavior for:

- approval
- `request_user_input`

But naming, item ownership, and history relationship do not follow codex-rs conventions.

# Codex-RS Reference Model

The codex-rs `ThreadItem` variants relevant to Diligent are:

- `UserMessage`
- `AgentMessage`
- `Plan`
- `Reasoning`
- `CommandExecution`
- `FileChange`
- `DynamicToolCall`
- `CollabAgentToolCall`
- `ContextCompaction`

Variants that may remain defined in protocol for compatibility completeness, even if currently unused by Diligent:

- `McpToolCall`
- `WebSearch`
- `ImageView`
- `ImageGeneration`
- `EnteredReviewMode`
- `ExitedReviewMode`

# Canonical Diligent → Codex-RS Item Mapping

## Message and session events

| Diligent source | Codex-RS item |
|---|---|
| user message | `UserMessage` |
| assistant text | `AgentMessage` |
| assistant thinking | `Reasoning` |
| plan output | `Plan` |
| compaction | `ContextCompaction` |

## Built-in tools

| Diligent tool | Codex-RS item | Notes |
|---|---|---|
| `bash` | `CommandExecution` | command-oriented item with streaming output |
| `write` | `FileChange` | file mutation result |
| `edit` | `FileChange` | file mutation result |
| `multi_edit` | `FileChange` | file mutation result |
| `read` | `DynamicToolCall` | general non-command structured tool |
| `ls` | `DynamicToolCall` | general non-command structured tool |
| `glob` | `DynamicToolCall` | general non-command structured tool |
| `grep` | `DynamicToolCall` | general non-command structured tool |
| `skill` | `DynamicToolCall` | general tool invocation |
| `request_user_input` | `DynamicToolCall` | live interaction request plus history snapshot |
| `update_knowledge` | `DynamicToolCall` | general tool invocation |
| plugin/custom tool | `DynamicToolCall` | required by hard compatibility rule |

## Collaboration tools

| Diligent tool | Codex-RS item | Notes |
|---|---|---|
| `spawn_agent` | `CollabAgentToolCall` | maps to codex-rs spawn semantics |
| `send_input` | `CollabAgentToolCall` | maps to codex-rs send-input semantics |
| `wait` | `CollabAgentToolCall` | maps to codex-rs wait semantics |
| `close_agent` | `CollabAgentToolCall` | maps to codex-rs close semantics |

# Target External Protocol Surface

## Request methods

Diligent must rename and reshape thread-facing methods to codex-rs-compatible names and semantics.

### Required request methods

| Current Diligent method | Target codex-rs-compatible method | Notes |
|---|---|---|
| `thread/start` | `thread/start` | keep name, align payload/response shape |
| `thread/read` | `thread/resume` | `thread/read` removed as public history API |
| `thread/list` | `thread/list` | align response DTO shape where needed |
| `thread/delete` | `thread/archive` or keep internal delete out of codex thread surface | decide final exposure explicitly |
| `turn/start` | `turn/start` | align item and request semantics |
| `turn/interrupt` | `turn/interrupt` | align thread/turn payload shape |
| `turn/steer` | keep as Diligent extension only if outside codex thread surface, otherwise codex-compatible naming must be chosen | explicit protocol decision required |

### Required server requests

| Current Diligent server request | Target method |
|---|---|
| approval request for command-like operations | `item/commandExecution/requestApproval` |
| approval request for file changes | `item/fileChange/requestApproval` |
| request_user_input | `item/tool/requestUserInput` |

### Required server notifications

| Current Diligent behavior | Target codex-rs-compatible notification |
|---|---|
| thread created | `thread/started` |
| thread status changes | `thread/status/changed` |
| turn started | `turn/started` |
| turn completed | `turn/completed` |
| item start | `item/started` |
| item complete | `item/completed` |
| assistant text delta | `item/agentMessage/delta` |
| plan delta | `item/plan/delta` |
| reasoning text delta | `item/reasoning/textDelta` |
| reasoning summary delta | `item/reasoning/summaryTextDelta` |
| command output delta | `item/commandExecution/outputDelta` |
| file change delta | `item/fileChange/outputDelta` |
| collab progress | codex-rs-compatible collab progress/update notification naming |
| dynamic tool progress | codex-rs-compatible dynamic-tool progress/update notification naming |

# Protocol Compatibility Decisions

## History endpoint

### Final decision

`thread/resume` becomes the canonical API for restoring a thread.

It returns:

- thread metadata
- current config snapshot fields required by clients
- the resumed thread's current turn snapshot when applicable
- `Turn.items: ThreadItem[]`

It must not require clients to parse raw transcript messages in order to rebuild UI state.

### Consequence

- `thread/read` is removed from normal frontend use
- raw `messages` and `transcript` no longer drive UI hydration
- any retained raw history fields become internal/debug-only and not part of the primary client contract

## Live vs history shape

### Final decision

Live and history do not need the same wire form, but they must share the same item ontology.

- live uses item lifecycle events
- history uses final `ThreadItem[]` snapshots
- both use the same `ThreadItem` schema

## request_user_input

### Final decision

`request_user_input` is represented in two layers:

1. live control layer: `item/tool/requestUserInput`
2. history layer: completed `DynamicToolCall` item

This matches codex-rs's separation between item lifecycle and interactive requests.

## Approval

### Final decision

Approvals are item-specific server requests, not generic tool requests.

- command approvals use `item/commandExecution/requestApproval`
- file mutation approvals use `item/fileChange/requestApproval`

# Target Runtime Architecture

## New ownership model

The runtime becomes the single owner of thread-visible item derivation.

### Runtime responsibilities

- map agent events into codex-rs-compatible `ThreadItem` lifecycle transitions
- accumulate active-turn item state for live subscriptions and resume snapshots
- serialize interactive requests with codex-rs-compatible method names
- produce final `thread/resume` snapshots using the same item model used by live notifications

### Client responsibilities

- apply item lifecycle notifications to state
- render `ThreadItem`
- answer server requests for approvals and user input
- stop parsing raw transcript messages into display state

# Required Runtime Refactor

## 1. Introduce codex-rs-compatible thread domain in `@diligent/protocol`

Create protocol DTOs that match codex-rs names and shapes as closely as possible:

- `ThreadItem`
- `Turn`
- `ThreadResumeResponse`
- item lifecycle notifications
- item-specific delta notifications
- item-specific approval and user-input server requests

This is a rename-and-replace migration, not an additive alias layer.

## 2. Replace transcript-driven hydration with item-driven hydration

Delete the assumption that clients reconstruct state from:

- `Message[]`
- `TranscriptEntry[]`
- tool result parsing in hydration modules

Instead:

- runtime produces canonical `ThreadItem[]`
- CLI and Web consume `ThreadItem[]`
- item lifecycle reducers become the only supported state reconstruction path

## 3. Add a runtime thread item builder

Create a runtime-owned builder that translates current execution and persistence structures into codex-rs-compatible items.

Suggested modules:

- `packages/runtime/src/thread-items/types.ts`
- `packages/runtime/src/thread-items/builder.ts`
- `packages/runtime/src/thread-items/live-mapper.ts`
- `packages/runtime/src/thread-items/history-builder.ts`
- `packages/runtime/src/thread-items/tool-mapping.ts`

Responsibilities:

- map `message_start/delta/end` to `AgentMessage` and `Reasoning`
- map tool execution lifecycle to `CommandExecution`, `FileChange`, `DynamicToolCall`, `CollabAgentToolCall`
- map compaction entries to `ContextCompaction`
- maintain active-turn item snapshots for resume and reconnect

## 4. Rework session resume semantics

Current session persistence and context builders must stop returning raw transcript as the primary resume product.

Instead:

- resume path reconstructs canonical thread items from session entries and active in-memory state
- `ThreadResumeResponse.thread.items` is authoritative
- raw transcript support, if retained, must not be used by Web or CLI

## 5. Rename protocol methods in runtime handlers

Update app-server request and notification routing so that names match codex-rs conventions.

Affected runtime areas include:

- `packages/runtime/src/app-server/server.ts`
- `packages/runtime/src/app-server/thread-handlers.ts`
- `packages/runtime/src/app-server/server-requests.ts`
- `packages/runtime/src/app-server/event-mapper.ts`
- `packages/runtime/src/notification-adapter.ts`
- protocol method/notification constant modules

# Required Frontend Refactor

## CLI

Replace transcript-based resume hydration in TUI with `ThreadItem`-driven hydration.

### Required work

- delete raw transcript parsing from `packages/cli/src/tui/app-session-lifecycle.ts`
- add a codex-rs-style item reducer / renderer adapter
- handle `item/started`, `item/completed`, and typed item deltas directly
- handle codex-compatible server requests for approval and user input

## Web

Replace `thread-hydration.ts` transcript parsing with `ThreadItem` hydration.

### Required work

- remove transcript parsing as the primary model
- build or reuse a shared item reducer between Web and CLI-friendly adapters
- use `thread/resume` as the canonical thread restore operation
- handle codex-compatible item lifecycle notifications and server requests

## Desktop

Desktop uses Web transport and inherits Web behavior. No desktop-specific protocol logic is allowed.

# File Manifest

## `packages/protocol`

| File | Action | Description |
|---|---|---|
| `src/client-requests.ts` | REWRITE | replace thread DTOs with codex-rs-compatible thread request/response types |
| `src/server-notifications.ts` or equivalent | REWRITE | rename notification methods and payloads to codex-rs-compatible names |
| `src/server-requests.ts` or equivalent | REWRITE | codex-compatible requestApproval and requestUserInput request types |
| `src/index.ts` | MODIFY | export new codex-compatible thread protocol surface |
| tests under `test/` | ADD / REWRITE | schema compatibility tests for item payloads and method names |

## `packages/runtime`

| File | Action | Description |
|---|---|---|
| `src/app-server/event-mapper.ts` | REWRITE | emit codex-compatible item lifecycle notifications |
| `src/app-server/thread-handlers.ts` | REWRITE | implement `thread/resume` as item-snapshot API |
| `src/app-server/server.ts` | MODIFY | register codex-compatible method names only |
| `src/app-server/server-requests.ts` | REWRITE | codex-compatible item request names |
| `src/notification-adapter.ts` | REWRITE | normalize runtime/client notification handling around `ThreadItem` |
| `src/session/context-builder.ts` | MODIFY / SPLIT | stop making raw transcript primary; build thread item snapshots |
| `src/session/manager.ts` | MODIFY | preserve active-turn item snapshots and resume state |
| `src/thread-items/*` | CREATE | canonical thread item builder modules |
| `src/tools/render-payload.ts` | MODIFY | map current render payloads into `DynamicToolCall.content_items` or specific items |
| collab modules | MODIFY | map collab tools to `CollabAgentToolCall` lifecycle |
| tests under `test/` | ADD / REWRITE | runtime mapping tests, handler tests, resume tests |

## `packages/cli`

| File | Action | Description |
|---|---|---|
| `src/tui/app-session-lifecycle.ts` | REWRITE | remove transcript parsing; hydrate from `ThreadItem[]` |
| `src/tui/* notification handlers` | REWRITE | codex-compatible notification names and item deltas |
| `src/tui/* approval and input handling` | MODIFY | consume codex-compatible server requests |
| tests under `test/` | ADD / REWRITE | item hydration and protocol rename coverage |

## `packages/web`

| File | Action | Description |
|---|---|---|
| `src/client/lib/thread-hydration.ts` | REWRITE | hydrate state from `ThreadItem[]` only |
| `src/client/lib/use-thread-manager.ts` | MODIFY | call `thread/resume` and apply item snapshots |
| `src/client/lib/* reducers/adapters` | REWRITE | codex-compatible item lifecycle application |
| tests under `test/` | ADD / REWRITE | item-driven hydration and live lifecycle coverage |

## `packages/e2e`

| File | Action | Description |
|---|---|---|
| thread lifecycle tests | REWRITE | codex-compatible method names and payload assertions |
| approval tests | REWRITE | item-specific request methods |
| request_user_input tests | REWRITE | `item/tool/requestUserInput` flow |
| reconnect/resume tests | REWRITE | `thread/resume` item snapshot semantics |

# One-Shot Execution Plan

## Overview

This work is executed as one coordinated migration using parallel agents with clear ownership boundaries.

No agent may implement a compatibility shim that preserves the old thread protocol as a second public mode.

## Parallel workstreams

### Agent A — protocol rewrite

Owns:

- `packages/protocol`
- protocol constants
- protocol schema tests

Deliverables:

- codex-rs-compatible type names
- codex-rs-compatible method names
- codex-rs-compatible `ThreadItem` schemas

### Agent B — runtime thread-item core

Owns:

- `packages/runtime/src/thread-items/*`
- `packages/runtime/src/app-server/event-mapper.ts`
- runtime mapping tests

Deliverables:

- canonical runtime item builder
- live notification mapping
- tool-to-item mapping implementation

### Agent C — runtime resume and server-request cutover

Owns:

- `packages/runtime/src/app-server/thread-handlers.ts`
- `packages/runtime/src/app-server/server.ts`
- `packages/runtime/src/app-server/server-requests.ts`
- session/resume integration

Deliverables:

- `thread/resume`
- item-specific server requests
- method registration cutover

### Agent D — CLI migration

Owns:

- `packages/cli`
- CLI tests

Deliverables:

- item-driven resume hydration
- item lifecycle rendering
- codex-compatible request handling

### Agent E — Web migration

Owns:

- `packages/web`
- Web tests

Deliverables:

- item-driven hydration
- codex-compatible notification handling
- codex-compatible request handling

### Agent F — e2e and final integration

Owns:

- `packages/e2e`
- cross-package integration fixes
- final protocol assertions

Deliverables:

- green end-to-end suite for new protocol only

## Required coordination rules

- Agent A must finish protocol schemas first or provide an agreed frozen draft before B/C/D/E proceed.
- Agents B and C must agree on exact runtime item builder interfaces before frontend agents proceed.
- Agents D and E must use the same item reducer semantics.
- Agent F must not add compatibility shims; it validates the final surface only.

# Detailed Task List

## Task 1 — Protocol replacement

1. Replace Diligent thread DTOs with codex-rs-compatible names and payload shapes.
2. Add `ThreadItem` union matching codex-rs names and field casing.
3. Replace Diligent-specific notification method constants with codex-rs-compatible names.
4. Replace generic approval and user-input request names with codex-compatible item-specific names.
5. Remove old thread-history DTOs from the primary thread API.

## Task 2 — Runtime item builder

1. Add a canonical tool mapping table implementing the hard mapping rules in this document.
2. Convert message events into `UserMessage`, `AgentMessage`, `Reasoning`, and `Plan` items.
3. Convert `bash` into `CommandExecution` start/delta/completed events.
4. Convert file mutation tools into `FileChange` start/completed events.
5. Convert non-special tools into `DynamicToolCall` events and history items.
6. Convert collab tools into `CollabAgentToolCall` events and history items.
7. Convert compaction into `ContextCompaction` items.

## Task 3 — Active turn snapshot ownership

1. Add runtime-owned active-turn item accumulation.
2. Ensure reconnect and resume can return the same semantic item state used by live notifications.
3. Ensure partially completed turns are represented correctly in `thread/resume` snapshots.

## Task 4 — Resume API cutover

1. Implement `thread/resume` as the canonical restore API.
2. Return thread summary plus turn snapshot items.
3. Remove client dependence on `thread/read`.
4. Ensure historical and active in-memory items are both reflected.

## Task 5 — Interactive request cutover

1. Re-map command approvals to `item/commandExecution/requestApproval`.
2. Re-map file mutation approvals to `item/fileChange/requestApproval`.
3. Re-map `request_user_input` to `item/tool/requestUserInput`.
4. Ensure request resolution returns control to the correct in-progress item lifecycle.

## Task 6 — CLI migration

1. Replace transcript hydration with `ThreadItem[]` hydration.
2. Replace old notification names with codex-compatible names.
3. Render `DynamicToolCall`, `CommandExecution`, `FileChange`, `CollabAgentToolCall`, `Reasoning`, and `Plan` directly from item payloads.
4. Rewire approval and question overlays to codex-compatible server requests.

## Task 7 — Web migration

1. Replace transcript hydration with `ThreadItem[]` hydration.
2. Replace old notification names with codex-compatible names.
3. Rewire approval and user-input UI to codex-compatible server requests.
4. Delete old transcript parsing logic once new reducers are in place.

## Task 8 — Final cleanup

1. Remove dead transcript hydration utilities.
2. Remove old protocol constants and request names.
3. Remove compatibility adapters created during implementation if any remain.
4. Update architecture and protocol docs if they reference the old surface.

# Acceptance Criteria

## Protocol

- no public thread-facing API name remains in the old Diligent naming scheme where codex-rs has an existing equivalent
- `thread/resume` is the canonical restore API
- item lifecycle notifications use codex-rs naming
- approval and user-input requests use codex-rs-compatible item-scoped names

## Runtime

- runtime owns all `ThreadItem` derivation
- history and live share the same item ontology
- no frontend parses raw transcript to rebuild display state

## Frontends

- CLI and Web both hydrate solely from `ThreadItem[]`
- CLI and Web both apply live item lifecycle notifications directly
- request_user_input works through codex-compatible request flow
- approval works through item-specific request flow

## Testing

- protocol schema tests pass
- runtime unit tests pass
- CLI tests pass
- Web tests pass
- e2e tests pass
- no old thread protocol tests remain except where explicitly archived or deleted

# Validation Plan

## Protocol validation

- schema tests for all codex-compatible request, response, notification, and server-request payloads
- exact method string assertions for renamed methods

## Runtime validation

- unit tests for each tool-to-item mapping
- tests for active-turn snapshot accumulation
- tests for `thread/resume` with completed and in-progress turns
- tests for `request_user_input` live request plus history snapshot behavior

## Frontend validation

- CLI resume hydration from `ThreadItem[]`
- Web resume hydration from `ThreadItem[]`
- live delta rendering for agent message, reasoning, command execution, file change, dynamic tool, and collab tool items
- approval and user-input request handling

## End-to-end validation

- start thread, run turn, receive item lifecycle, resume thread, verify item snapshot parity
- run `bash`, verify command item streaming and approval
- run file-edit tool, verify file-change approval and final history item
- run `request_user_input`, verify request flow and final dynamic-tool history item
- run collab tools, verify collab item lifecycle and resume visibility

# Risks

## Risk 1 — DynamicToolCall becomes too generic

Mitigation:

- define strict `content_items` conventions for Diligent built-in tools
- test rendering quality for read/list/search/knowledge tools

## Risk 2 — Active-turn resume semantics drift from live semantics

Mitigation:

- one runtime-owned item builder only
- no duplicate client-side derivation logic

## Risk 3 — One-shot cutover breaks all clients at once

Mitigation:

- parallel-agent implementation with frozen protocol draft
- strict integration test gate before merge
- no merge until CLI, Web, runtime, protocol, and e2e all pass together

## Risk 4 — request_user_input and approvals regress during rename

Mitigation:

- explicitly test server-request naming and response correlation
- keep these flows item-owned rather than generic-tool-owned

# Rollout and Merge Policy

Because this is a one-shot migration, merge policy is strict:

- all work lands in a single coordinated branch
- no partial merge of protocol-only or frontend-only work
- no compatibility mode
- no temporary duplicate APIs in the final patch
- final merge requires green tests across touched packages

# Notes for the Implementer

If you are reading this plan for the first time and executing it:

1. Start from protocol surface decisions, not frontend rendering.
2. Freeze the exact codex-compatible method names before editing runtime and clients.
3. Build the runtime `ThreadItem` mapping layer before touching CLI or Web hydration.
4. Treat `thread/resume` as the center of the migration.
5. Treat `request_user_input` and approval as item-scoped server-request flows, not generic tool outputs.
6. Do not preserve old transcript hydration once item hydration works.
7. Do not introduce a Diligent-only item taxonomy.
8. Use `DynamicToolCall` for all general and plugin tools that do not naturally map to a more specific codex-rs item.

This migration succeeds only when the same thread can be:

- streamed live through codex-compatible item lifecycle notifications
- resumed through codex-compatible item snapshots
- rendered by both CLI and Web without any raw transcript parsing
