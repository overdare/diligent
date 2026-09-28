# Studio Change Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Collect Studio edits once per project into bounded RAM and deliver them independently to each session without misattributing child RPC calls.

**Architecture:** Product-owned source ingestion feeds a bounded journal; consumer markers and detail descriptors reference journal ranges. Generic runtime async-local execution identity supplies actual/root session IDs and a root-request object for snapshot isolation. Generic context-injection acknowledgment moves automatic markers only after acceptance into live conversation context.

**Tech Stack:** Bun, strict TypeScript, node:async_hooks, existing JSON-RPC tools, bun:test, existing shared context notices.

**Spec:** `docs/superpowers/specs/2026-09-28-studio-change-collector-design.md`

**Ticket/branch:** OVDR-15373 / `feat/ovdr-15373-studio-change-collector`

**Execution status:** Plan and native execution approved on 2026-09-28. All implementation tasks are complete; final whole-branch review and push remain. Local verification: 2,506 package tests, 415 affected sidecar tests, lint, typecheck, and diff checks passed. PR creation remains outside this request.

## Global Constraints

- No new database, archive files, or cursor files are created; existing archives remain untouched.
- One owning process per canonical Studio project; cross-process broadcasting is not implemented.
- Poll approximately once per second; never overlap collection and explicit refresh.
- Retained journal: 16 MiB encoded payload and 10,000 records. This is not an exact RSS bound.
- Input read: 8 MiB per file; recognized source backlog: 64 MiB; process 4 inputs per poll.
- Consumer and identity maps: 4,096 entries each; batch descriptors and retry entries: 256 each.
- Evict oldest journal history regardless of abandoned consumers. Report loss and require Studio state reinspection.
- Preserve actual Origin.SessionId; suppress only explicit own-root MCP records. Keep unknown and legacy origins.
- Child queries never advance a parent's marker. Detail reads never acknowledge new changes.
- Keep existing summary/detail byte budgets and shared Web/TUI presentation.
- English tracked files; tests only under package-level test directories; no hook bypasses.
- Preserve unrelated worktree files and the separate OVDR-15298 worktree.

## Review Focus

1. A resumed child whose parent is not running must resolve persisted ancestry, not inherit another active root.
2. A writer finishing a transaction through an already-rotated handle must not lose or duplicate the complete prefix.
3. Failure to delete an ingested file must not append its transactions again on retry.
4. A gap without surviving edits must still reach both model context and the existing context-notice clients.
5. Reusing a batch ID after partial eviction or restart must fail explicitly rather than show unrelated latest details.

Each condition is covered in its owning task below. They are integration risks, not assumed guarantees of a fixture or dependency.

---

### Task 1: Runtime session execution scope and ancestry

**Files:**

- Create `packages/runtime/src/session/execution-context.ts`.
- Modify `packages/runtime/src/session/manager.ts`, `persistence.ts`, and `packages/runtime/src/index.ts`.
- Test `packages/runtime/test/session/execution-context.test.ts` and strengthen `manager.test.ts` / `persistence.test.ts`.

**Interfaces:**

```ts
export interface SessionExecutionRoot {
  readonly sessionId: string;
  readonly requestId: string;
}
export interface SessionExecutionContext {
  readonly sessionId: string;
  readonly rootSessionId: string;
  readonly resumed: boolean;
  readonly rootRequest: SessionExecutionRoot;
}
export function getSessionExecutionContext(): SessionExecutionContext | undefined;
export function runWithSessionExecutionContext<T>(context: SessionExecutionContext, run: () => T): T;
```

- [x] Write a failing test for interleaved roots and nested children. Use a deferred promise in a test helper, not a sleep. Observe IDs inside actual asynchronous callbacks and assert `A`, `A1`, `B`; outside all scopes assert `undefined`.

```ts
const seen: string[] = [];
let release!: () => void;
const barrier = new Promise<void>(resolve => { release = resolve; });
const contextA: SessionExecutionContext = {
  sessionId: "A", rootSessionId: "A", resumed: false,
  rootRequest: { sessionId: "A", requestId: "request-A" },
};
const contextB: SessionExecutionContext = {
  sessionId: "B", rootSessionId: "B", resumed: false,
  rootRequest: { sessionId: "B", requestId: "request-B" },
};
await Promise.all([
  runWithSessionExecutionContext(contextA, async () => {
    await barrier;
    seen.push(getSessionExecutionContext()!.sessionId);
  }),
  runWithSessionExecutionContext(contextB, async () => {
    seen.push(getSessionExecutionContext()!.sessionId);
    release();
  }),
]);
expect(seen).toEqual(["B", "A"]);
expect(getSessionExecutionContext()).toBeUndefined();
```

- [x] Run `bun test ./packages/runtime/test/session/execution-context.test.ts` and record the missing-scope failure before adding production code.
- [x] Implement `AsyncLocalStorage<SessionExecutionContext>` and wrap `SessionManager.run`. Store the loaded session header on create/resume and resolve root ancestry through validated session IDs and bounded header reads, with cycle detection. Missing/corrupt ancestry fails explicitly; never guess ownership from the ambient active session.

```ts
const storage = new AsyncLocalStorage<SessionExecutionContext>();
export const getSessionExecutionContext = () => storage.getStore();
export const runWithSessionExecutionContext = <T>(context: SessionExecutionContext, run: () => T): T =>
  storage.run(context, run);
```

- [x] Add manager tests that execute a real tool using shared inherited tool objects, then resume a persisted child while another root's scope is active. Assert its observed actual/root IDs and that the persisted parent relationship survives resume.
- [x] Share `rootRequest` only when the ambient scope belongs to the resolved root. A root run or standalone resumed child otherwise creates a fresh root-request object. This object lets product WeakMaps share a baseline without unbounded snapshot caches.
- [x] Run `bun test ./packages/runtime/test/session/execution-context.test.ts ./packages/runtime/test/session/manager.test.ts ./packages/runtime/test/session/persistence.test.ts`.
- [x] Stage only this task's verified files; commit with `feat(runtime): scope tool execution to session identity` and `OVDR-15373` in the body. Do not push an incomplete feature.

### Task 2: Distinguish complete, malformed, and unfinished source records

**Files:**

- Modify `apps/overdare-ai-agent/sidecar/src/tools/studiorpc/tools/edit-log.ts`.
- Create `apps/overdare-ai-agent/sidecar/test/tools/studiorpc/edit-log-parser.test.ts`.
- Strengthen existing `sidecar/test/tools/studiorpc-studio-changes.test.ts` parser tests.

**Interfaces:**

```ts
export interface ParsedEditLog {
  envelopes: EditLogEnvelope[];
  failures: number;
  incomplete: boolean;
  consumedChars: number;
}
export function parseEditLogText(text: string): ParsedEditLog;
export function isStudioEditLogSourceName(name: string): boolean;
```

- [x] Add failing tests for adjacent pretty-printed envelopes, escaped braces inside strings, arrays/JSONL legacy input, malformed balanced records, and an unfinished final object. Derive expected GUIDs directly from literal fixtures.

```ts
const validRecord = JSON.stringify({
  Timestamp: "2026-09-28T00:00:00Z", ActorGuids: ["first"],
  Objects: [{ ActorGuid: "first", Name: "first", InstanceType: "Part", Changes: [] }],
});
const parsed = parseEditLogText(validRecord + '{"Timestamp":');
expect(parsed.envelopes.map(entry => entry.objects[0].guid)).toEqual(["first"]);
expect(parsed.incomplete).toBe(true);
expect(parsed.consumedChars).toBe(validRecord.length);
```

- [x] Run `bun test ./apps/overdare-ai-agent/sidecar/test/tools/studiorpc/edit-log-parser.test.ts` and verify the incomplete-tail assertion fails before implementing the parser contract.
- [x] Reuse existing tolerant envelope conversion. Extend the scanner to track consumed boundaries and unfinished tails rather than silently dropping them. A malformed complete chunk increments failures; non-whitespace garbage is not a successful empty input.
- [x] Restrict source names to case-insensitive `Edit.Log`, previous `Edit.Log.<base36-time>-<counter>.consuming`, and the new collector's documented rotation form. Reject directories, symlinks, path separators, `Play.log`, and unrelated `.consuming` files at the filesystem boundary.
- [x] Decode UTF-8/UTF-16 input with existing decoding utilities. Test a UTF-16 tail split at a code-unit boundary using actual source bytes in Task 4.
- [x] Run parser and existing summary tests. Preserve semantic summary behavior while replacing the previous truncated-tail-is-ignored expectation with explicit incomplete status.
- [x] Commit only the verified parser boundary changes with `fix(overdare): preserve incomplete Studio log records` and `OVDR-15373`.

### Task 3: Bounded RAM journal, independent consumers, and detail batches

**Files:**

- Replace disk-oriented implementation in `sidecar/src/tools/studiorpc/tools/studio-change-store.ts`.
- Create `sidecar/test/tools/studiorpc/studio-change-store.test.ts`.

**Interfaces:**

```ts
export interface StudioChangeStoreLimits {
  maxBytes: number;
  maxRecords: number;
  maxConsumers: number;
  maxIdentities: number;
  maxBatches: number;
}
export interface StudioChangeConsumer {
  sessionId: string;
  rootSessionId: string;
  resumed: boolean;
}
export interface StudioChangeRead {
  fromSeq: number;
  throughSeq: number;
  envelopes: EditLogEnvelope[];
  gaps: string[];
  batchId?: string;
  acknowledge(): void;
}
export class StudioChangeStore {
  constructor(options?: { limits?: Partial<StudioChangeStoreLimits> });
  registerSession(consumer: StudioChangeConsumer): () => void;
  append(envelopes: readonly EditLogEnvelope[]): void;
  recordGap(reason: string): void;
  read(consumer: StudioChangeConsumer): StudioChangeRead;
  readBatch(id: string, consumer: StudioChangeConsumer): EditLogEnvelope[];
  latestBatch(consumer: StudioChangeConsumer): string | undefined;
}
```

`StudioChangeStoreLimits` defines `maxBytes`, `maxRecords`, `maxConsumers`, `maxIdentities`, and `maxBatches`. The returned registration cleanup decrements activity; it does not delete unread state.

- [x] Write failing tests proving A's acknowledgment does not consume B's edits and A1's acknowledgment does not consume A's edits. Use normalized literal envelopes with GUIDs `external`, `child-edit`, and `legacy`.

```ts
const a: StudioChangeConsumer = { sessionId: "A", rootSessionId: "A", resumed: false };
const b: StudioChangeConsumer = { sessionId: "B", rootSessionId: "B", resumed: false };
const external: EditLogEnvelope = {
  timestamp: "2026-09-28T00:00:00Z", subjectGuids: ["external"],
  objects: [{ guid: "external", name: "external", type: "Part", changes: [] }],
};
const store = new StudioChangeStore();
store.append([external]);
const aRead = store.read(a);
aRead.acknowledge();
expect(store.read(a).envelopes).toEqual([]);
expect(store.read(b).envelopes[0].objects[0].guid).toBe("external");
```

- [x] Run `bun test ./apps/overdare-ai-agent/sidecar/test/tools/studiorpc/studio-change-store.test.ts` and record expected missing-journal behavior.
- [x] Implement monotonic sequence/high-water snapshots; filter only `mcp` own-root records and preserve original origin. Resolve known author roots on append; keep unknown authors visible. Idempotent acknowledgment takes the maximum of current and captured sequence, never a later journal head.
- [x] Add limit tests with injected small limits: record and byte eviction, inactive marker/identity LRU eviction, all-active admission rejection, bounded batches, abandoned consumers, and gap-only reads. Assert externally visible gaps/expiration, not concrete default constants.
- [x] Store batch descriptors as bounded sequence/filter references, not copied envelopes. Reject unknown, wrong-consumer, partially evicted, and prior-epoch IDs. An explicit ID never falls back to latest. New sessions read retained history; resumed or evicted delivery state receives a refresh warning.
- [x] Run the journal suite and verify no `.overdare/logs/studio-changes` files were written. Existing archives must remain unchanged.
- [x] Commit the verified journal with `feat(overdare): retain Studio changes in bounded RAM` and `OVDR-15373`.

### Task 4: Single project collector and safe cleanup

**Files:**

- Create `sidecar/src/tools/studiorpc/tools/studio-change-collector.ts`.
- Create `sidecar/test/tools/studiorpc/studio-change-collector.test.ts` and test helpers under `sidecar/test/helpers/`.
- Consume parser from Task 2 and store from Task 3.

**Interfaces:**

```ts
export interface StudioChangeCollectorLimits {
  maxFileBytes: number;
  maxBacklogBytes: number;
  maxRetryEntries: number;
  maxFilesPerPoll: number;
}
export interface StudioChangeSourceFile {
  path: string;
  identity: string;
  bytes: number;
  modifiedMs: number;
}
export interface StudioChangeCollectorOptions {
  store?: StudioChangeStore;
  limits?: Partial<StudioChangeCollectorLimits>;
  io?: {
    list(cwd: string): Promise<StudioChangeSourceFile[]>;
    rotate(path: string): Promise<StudioChangeSourceFile>;
    read(path: string): Promise<Buffer>;
    remove(path: string): Promise<void>;
  };
  schedule?: (tick: () => void, intervalMs: number) => () => void;
}
export class StudioChangeCollector {
  readonly store: StudioChangeStore;
  constructor(cwd: string, options?: StudioChangeCollectorOptions);
  start(): void;
  refresh(): Promise<void>;
  stop(): Promise<void>;
}
export function getStudioChangeCollector(cwd: string): StudioChangeCollector;
export function stopStudioChangeCollector(cwd: string): Promise<void>;
```

`StudioChangeCollectorOptions` contains optional store, filesystem boundary adapter, scheduler, and `limits` overrides for file bytes, backlog bytes, retry entries, and files per poll. The production scheduler uses an unref'ed one-second timer; tests own a deterministic scheduler. These are function options, not configuration fields.

- [x] Write failing tests using a real temporary project: ingestion removes recognized sources but leaves `Play.log`, arbitrary `.consuming`, directories, symlinks, and existing archives untouched. An independent store read for A/B still observes the ingested transaction after deletion.
- [x] Run the collector suite and record its failure before adding collection code.
- [x] Implement a canonical-project singleton, strict source-name discovery, bounded size checks, serialized rotate/read/append/delete, immediate startup refresh, and scheduler lifecycle cleanup. Retain retry entries keyed by validated path/file identity.
- [x] Test deletion failure with a filesystem-boundary adapter: fail removal once while keeping real reading/parsing/journaling. After retry, assert B sees exactly one transaction occurrence and source deletion succeeds.
- [x] Test an actual open file descriptor: write one complete envelope plus half the next envelope, refresh, append the remainder to the rotated handle, refresh again, and assert exactly two transactions. Repeat with UTF-16 bytes. Do not fake completion by replacing collector output.
- [x] Test read/rename errors, malformed input, oversized input, source backlog discard, and retry admission limits. Discard only validated sources and record a gap first. Preserve retryable sources; no swallowed error may become a silent no-edits result.
- [x] Trigger multiple scheduler ticks and refresh calls through a deferred read boundary. Assert a single concurrent read and that `stop()` cancels scheduling and awaits completion without real-time sleeps.
- [x] Run parser, journal, and collector suites together; commit with `feat(overdare): collect Studio logs in the host process` and `OVDR-15373`.

### Task 5: Runtime acceptance, actual RPC origins, and isolated snapshots

**Files:**

- Create `packages/runtime/src/agent/context-acceptance.ts` and `packages/runtime/test/agent/context-acceptance.test.ts`.
- Modify `packages/runtime/src/agent/runtime-agent.ts` and `packages/runtime/src/index.ts`.
- Modify `sidecar/src/tools/studiorpc/index.ts`.
- Strengthen `sidecar/test/tools/studiorpc/edit-origin.test.ts` and snapshot/provider tests in `sidecar/test/tools/studiorpc-studio-changes.test.ts`.

**Interfaces:**

```ts
export function acknowledgeContextInjection(
  injection: AgentContextInjection,
  accepted: () => void,
): AgentContextInjection;
export function acceptContextInjectionMetadata(metadata: Record<string, unknown> | undefined): void;
```

The first helper associates serializable metadata with an idempotent callback in a WeakMap. The second invokes/removes it when RuntimeAgent sees an actual `context_injected` event. No callbacks are serialized and core remains unaware of Studio. Import `AgentContextInjection` from `@diligent/core/agent`.

- [x] Add a failing runtime test that runs a real RuntimeAgent loop with synthetic provider output. Assert acceptance occurs after injection content enters the provider messages, never for a canceled pre-injection run, and only once for a duplicate acceptance event.
- [x] Add a failing provider regression with shared tools and interleaved scopes A/B/A1. Inspect outbound RPC request options, not prompt text: `A1` must stay `A1` after B's prompt hook, and an unscoped direct MCP call must omit sessionId.
- [x] Run runtime acceptance and origin suites before adding production wiring.
- [x] Resolve `meta.sessionId` at RPC invocation using Task 1's scope. Replace mutable provider-wide snapshot state with a WeakMap keyed by `rootRequest`. Transfer bounded prompt metadata from the main prompt hook and remove pending entries on completion. Children share their own root-request baseline; unrelated roots cannot overwrite it.
- [x] Test concurrent root snapshot captures, once-per-root-request child capture, rollback metadata, and existing capture-error warnings. Keep real snapshot file operations in a temporary project; do not bypass them with a fake snapshot function.
- [x] Run runtime session/collab regressions and sidecar origin/snapshot suites. Commit with `fix(overdare): isolate Studio RPC session and snapshot state` and `OVDR-15373`.

### Task 6: Session delivery, RAM details, host lifecycle, and documentation

**Files:**

- Modify `sidecar/src/tools/studiorpc/tools/studio-changes-tool.ts` and `studiorpc/index.ts`.
- Modify owning startup/shutdown in `sidecar/src/server.ts`; add an optional product cleanup callback to `sidecar/src/web/server/index.ts` only if needed to make stop/startup failures awaitable. Do not make the generic web host import Studio modules.
- Verify hosted registry reuse in `sidecar/src/mcp-server.ts`; standalone non-owner creation does not start a second collector.
- Modify `docs/guide/studio-changes.md` and design status to reflect approved/implemented behavior.
- Strengthen `sidecar/test/tools/studiorpc-studio-changes.test.ts`, add `sidecar/test/web/server/studio-change-lifecycle.test.ts`, and extend existing product server tests as needed.

**Interfaces:**

```ts
export function createStudioChangesTool(
  collector: StudioChangeCollector,
  getConsumer: () => StudioChangeConsumer,
): Tool;
```

Keep the tool name and request schema. Automatic main loop hooks call `store.read`, render bounded summaries, and wrap injections in Task 5's acceptance helper. Own-only reads acknowledge immediately; gap-containing reads inject regardless of edit count. Child hooks remain absent.

- [x] Write failing provider/tool tests: A/B independent summaries; group filtering; child query leaves main unread; a returned but unaccepted injection remains unread; failed new query does not acknowledge; details do not acknowledge; gap-only notice is model-visible and has the shared presentation metadata.

```ts
const a = { sessionId: "A", rootSessionId: "A", resumed: false };
const b = { sessionId: "B", rootSessionId: "B", resumed: false };
const store = new StudioChangeStore();
store.append([{
  timestamp: "2026-09-28T00:00:00Z", subjectGuids: ["external"],
  objects: [{ guid: "external", name: "external", type: "Part", changes: [] }],
}]);
const read = store.read(a);
const injection = acknowledgeContextInjection(createPresentableContextInjection({
  source: "studiorpc-studio-changes", content: "External Studio changes",
  presentation: { kind: "studio-changes", title: "Studio changes", content: "External Studio changes" },
}), () => read.acknowledge());
expect(store.read(a).envelopes).toHaveLength(1);
acceptContextInjectionMetadata(injection.metadata);
expect(store.read(a).envelopes).toHaveLength(0);
expect(store.read(b).envelopes).toHaveLength(1);
```

This narrow receipt test is supplemented by the provider integration regression:
use the real provider and its owning collector in a temporary project; execute
the hook in A's actual runtime scope; leave its returned injection unaccepted and
assert A remains unread, then drive a real RuntimeAgent to inject it and assert
only A advances. Otherwise the test would prove only the fixture's acknowledgment.

- [x] Run the named provider/tool tests and confirm failure against the old per-prompt disk-consuming implementation.
- [x] Implement `new` queries using collector refresh/read/summary/acknowledge. Implement details with store batch descriptors and existing `studioChangeDetails`, including GUID/type filters and offset/limit. Remove archive writes, misleading `archivePath`, and source consumption from individual sessions.
- [x] Update old tests that intentionally assert disk archival or deletion-on-finalize; replace them with independent-consumer, temporary-detail, and collection-owned-deletion behavior. Retain output-size, change-folding, multilingual, and pagination coverage.
- [x] Start the collector only for the owning enabled Studio host. Connect stop and startup-failure cleanup to its `stop()` promise; share it with router registries. Test STUDIO_DISABLED, failed startup, idempotent stop, and no remaining scheduler work.
- [x] Document RAM-only loss/restart semantics, root/child origins, independent markers, exact encoding/count bounds versus RSS, single-process ownership, expired details, and old archives left untouched. Update Jira actual scope/results; keep status In Progress.
- [x] Run all affected local suites, then `bun run lint`, `bun run typecheck`, and `git diff --check`. Do not dismiss failures without proving their source. No push if required verification fails.

```sh
bun test ./apps/overdare-ai-agent/sidecar/test/tools/studiorpc-studio-changes.test.ts ./apps/overdare-ai-agent/sidecar/test/tools/studiorpc/ ./apps/overdare-ai-agent/sidecar/test/mcp-server.test.ts ./apps/overdare-ai-agent/sidecar/test/mcp-server-cancellation.test.ts ./apps/overdare-ai-agent/sidecar/test/web/server/
bun test ./packages/runtime/test/session/ ./packages/runtime/test/agent/ ./packages/runtime/test/collab/
bun run lint
bun run typecheck
git diff --check
```

- [ ] Review the entire branch for source-loss, attribution, bounded-state, and acceptance regressions. Repository limit is one subagent at a time; do not spawn a reviewer without the chosen execution workflow's authorization.
- [ ] Stage only ticket-related files and commit with `feat(overdare): deliver collected Studio changes per session` and `OVDR-15373`. Allow normal lint/typecheck/title hooks to run.
- [ ] Inspect final diff, commit history, upstream target, and clean tracked worktree. Push the explicitly requested branch, never main:

```sh
git push -u origin feat/ovdr-15373-studio-change-collector
```

- [ ] Verify the remote branch points to the committed HEAD. Update Jira with actual commits, local test counts, push result, and PR/review still pending. Do not open a PR without a separate request.

## Plan review and execution handoff

The user approved this plan and native execution in the current task. Tasks share
journal, scope, and lifecycle interfaces; implementation uses
`superpowers:executing-plans` with one fresh whole-branch reviewer and no concurrent
implementation workers. Commit and branch push are authorized; PR creation is not.

Coverage check: source safety and bounds are Tasks 2-4; independent delivery and
details are Tasks 3/6; execution attribution and ancestry are Tasks 1/5; accepted
context is Task 5/6; host timers and RAM lifetime are Task 4/6. No product files
were changed merely by writing the plan; implementation followed approval.
