// @summary Real provider delivery receipts, independent consumers, RAM detail expiration and group queries
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStream } from "@diligent/core/event-stream";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core/provider-contract";
import { acceptContextInjectionMetadata, RuntimeAgent, runWithSessionExecutionContext } from "@diligent/runtime";
import { createStudioRpcToolProvider } from "../../../src/tools/studiorpc";
import {
  getStudioChangeCollector,
  StudioChangeCollector,
  stopStudioChangeCollector,
} from "../../../src/tools/studiorpc/tools/studio-change-collector";
import { StudioChangeStore } from "../../../src/tools/studiorpc/tools/studio-change-store";
import { captureStudioChanges, createStudioChangesTool } from "../../../src/tools/studiorpc/tools/studio-changes-tool";

test("invalid new query leaves changes unread and multilingual gap notices stay bounded", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log"), log("external"));
  const collector = getStudioChangeCollector(cwd);
  await collector.refresh();
  const tool = createStudioChangesTool(collector, () => a);
  expect((await tool.execute({ limit: 0 }, toolContext())).metadata?.error).toBe(true);
  expect(collector.store.read(a).envelopes).toHaveLength(1);
  for (let index = 0; index < 3; index++) collector.store.recordGap("😀".repeat(1000));
  const result = captureStudioChanges(collector.store.read(a)).result;
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(8000);
  expect(result.output).toContain("inspect current Studio state");
});

const dirs: string[] = [];
function project() {
  const cwd = mkdtempSync(join(tmpdir(), "studio-delivery-"));
  dirs.push(cwd);
  return cwd;
}
const a = { sessionId: "A", rootSessionId: "A", resumed: false };
const b = { sessionId: "B", rootSessionId: "B", resumed: false };
const scope = (consumer = a) => ({
  ...consumer,
  rootRequest: { sessionId: consumer.rootSessionId, requestId: crypto.randomUUID() },
});
const input = (cwd: string, id = "A") => ({
  cwd,
  session_id: id,
  transcript_path: `/${id}.jsonl`,
  hook_event_name: "UserPromptSubmit",
  prompt: "work",
});
const log = (guid: string, sessionId?: string) =>
  JSON.stringify({
    Timestamp: "now",
    ActorGuids: [guid],
    Origin: sessionId ? { Kind: "mcp", SessionId: sessionId } : undefined,
    Objects: [
      {
        ActorGuid: guid,
        InstanceType: "Part",
        Name: guid,
        Changes: [{ Property: "Name", Before: "old", After: guid }],
      },
    ],
  });
const toolContext = () => ({ toolCallId: "changes", signal: new AbortController().signal, abort() {} });
afterEach(async () => {
  for (const cwd of dirs.splice(0)) {
    await stopStudioChangeCollector(cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("returned but unaccepted automatic injection remains unread for A and independent B", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log"), log("external"));
  const provider = createStudioRpcToolProvider({ callRpc: async () => ({}) });
  await provider.onUserPromptSubmit!(input(cwd));
  await provider.onUserPromptSubmit!(input(cwd, "B"));
  const collector = getStudioChangeCollector(cwd);
  await runWithSessionExecutionContext(scope(), async () => {
    const hook = provider.createAgentLoopHooks!({ cwd, agentKind: "main" } as never)[0];
    hook.onPromptStart!({ messages: [] });
    const injection = hook.beforeTurn!({ messages: [], turnId: "one", compactedThisTurn: false })![0];
    expect(injection.content).toContain("external");
    expect(collector.store.read(a).envelopes).toHaveLength(1);
    acceptContextInjectionMetadata(injection.metadata);
    expect(collector.store.read(a).envelopes).toHaveLength(0);
  });
  expect(collector.store.read(b).envelopes).toHaveLength(1);
  expect(existsSync(join(cwd, "Edit.Log"))).toBe(false);
  expect(existsSync(join(cwd, ".overdare", "logs", "studio-changes"))).toBe(false);
});

test("real RuntimeAgent accepts the main summary and emits the shared presentation", async () => {
  const cwd = project();
  writeFileSync(join(cwd, "Edit.Log"), log("external"));
  const provider = createStudioRpcToolProvider({ callRpc: async () => ({}) });
  await provider.onUserPromptSubmit!(input(cwd));
  const model: Model = {
    provider: "anthropic",
    modelId: "synthetic",
    contextWindow: 100_000,
    maxOutputTokens: 4096,
    supportsThinking: false,
  };
  let sampled = false;
  const streamFn: StreamFunction = (_model, context) => {
    expect(
      context.messages.some((message) => message.role === "user" && String(message.content).includes("external")),
    ).toBe(true);
    sampled = true;
    const message = {
      role: "assistant" as const,
      model,
      content: [{ type: "text" as const, text: "done" }],
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "end_turn" as const,
      timestamp: Date.now(),
    };
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done",
      (event) => ({ message: (event as { message: typeof message }).message }),
    );
    queueMicrotask(() => stream.push({ type: "done", message, stopReason: "end_turn" }));
    return stream;
  };
  let presented = false;
  await runWithSessionExecutionContext(scope(), async () => {
    const tools = await provider.createTools({ cwd });
    const hooks = provider.createAgentLoopHooks!({ cwd, agentKind: "main" } as never);
    const agent = new RuntimeAgent(model, [], tools, { llmMsgStreamFn: streamFn, loopHooks: hooks });
    agent.subscribe((event) => {
      if (event.type === "context_injected") presented = event.injections[0].metadata?.presentation !== undefined;
    });
    await agent.prompt("work");
  });
  expect(sampled).toBe(true);
  expect(presented).toBe(true);
  expect(getStudioChangeCollector(cwd).store.read(a).envelopes).toEqual([]);
  expect(getStudioChangeCollector(cwd).store.read(b).envelopes).toHaveLength(1);
});

test("child explicit queries exclude their group but leave the main marker unchanged", async () => {
  const cwd = project();
  const provider = createStudioRpcToolProvider({ callRpc: async () => ({}) });
  const tools = await provider.createTools({ cwd });
  const changes = tools.find((tool) => tool.name === "studiorpc_studio_changes")!;
  const child = { sessionId: "A1", rootSessionId: "A", resumed: false };
  const collector = getStudioChangeCollector(cwd);
  collector.store.registerSession(child)();
  writeFileSync(join(cwd, "Edit.Log"), log("child-edit", "A1") + log("external"));
  await runWithSessionExecutionContext(scope(child), async () => {
    const result = await changes.execute({}, toolContext());
    expect(result.output).toContain("external");
    expect(result.output).not.toContain("child-edit");
    expect(result.metadata?.archivePath).toBeUndefined();
  });
  expect(collector.store.read(a).envelopes.map((entry) => entry.objects[0].guid)).toEqual(["external"]);
  expect(collector.store.read(b).envelopes.map((entry) => entry.objects[0].guid)).toEqual(["child-edit", "external"]);
});

test("gap-only summaries inject and expired details never fall back to a new batch", async () => {
  const cwd = project();
  const provider = createStudioRpcToolProvider({ callRpc: async () => ({}) });
  await provider.onUserPromptSubmit!(input(cwd));
  getStudioChangeCollector(cwd).store.recordGap("History lost; inspect current Studio state.");
  await runWithSessionExecutionContext(scope(), async () => {
    const hook = provider.createAgentLoopHooks!({ cwd, agentKind: "main" } as never)[0];
    hook.onPromptStart!({ messages: [] });
    const injection = hook.beforeTurn!({ messages: [], turnId: "one", compactedThisTurn: false })![0];
    expect(injection.content).toContain("History lost");
    expect(injection.metadata?.presentation).toMatchObject({ kind: "studio-changes" });
  });
  const collector = new StudioChangeCollector(cwd, { store: new StudioChangeStore({ limits: { maxRecords: 1 } }) });
  const changes = createStudioChangesTool(collector, () => a);
  writeFileSync(join(cwd, "Edit.Log"), log("first"));
  const first = await changes.execute({}, toolContext());
  writeFileSync(join(cwd, "Edit.Log"), log("second"));
  await changes.execute({}, toolContext());
  const details = await changes.execute({ view: "details", batchId: first.metadata!.batchId }, toolContext());
  expect(details.metadata?.error).toBe(true);
  expect(details.output).toMatch(/expired/i);
  expect(details.output).not.toContain("second");
  await collector.stop();
});

test("cascade deletion is delivered to B in automatic context and details while A excludes its own edits", async () => {
  const cwd = project();
  const collector = getStudioChangeCollector(cwd);
  collector.store.registerSession(a)();
  collector.store.registerSession(b)();
  const ref = (guid: string, type: string) => ({ ActorGuid: guid, InstanceType: type, Name: guid });
  const records = [
    { Action: "Create", ActorGuids: ["folder"], Objects: [ref("folder", "Folder")] },
    { Action: "Create", ActorGuids: ["part"], Objects: [ref("part", "Part")] },
    {
      Action: "Delete",
      ActorGuids: ["folder"],
      Objects: [{ ...ref("folder", "Folder"), Changes: [{ Property: "Descendants", Removed: [ref("part", "Part")] }] }],
    },
  ].map((record) => ({ ...record, Origin: { Kind: "mcp", SessionId: "A" } }));
  writeFileSync(join(cwd, "Edit.Log"), JSON.stringify(records));
  await collector.refresh();
  const own = await createStudioChangesTool(collector, () => a).execute({}, toolContext());
  expect(own.output).not.toContain("Added");
  const provider = createStudioRpcToolProvider({ callRpc: async () => ({}) });
  await provider.onUserPromptSubmit!(input(cwd, "B"));
  await runWithSessionExecutionContext(scope(b), async () => {
    const hook = provider.createAgentLoopHooks!({ cwd, agentKind: "main" } as never)[0];
    hook.onPromptStart!({ messages: [] });
    const injection = hook.beforeTurn!({ messages: [], turnId: "cascade", compactedThisTurn: false })![0];
    expect(injection.content).toContain("Added then removed (2)");
    expect(injection.content).not.toContain("Added (");
    expect(injection.metadata?.presentation).toMatchObject({ kind: "studio-changes" });
  });
  const tool = createStudioChangesTool(collector, () => b);
  const summary = await tool.execute({}, toolContext());
  expect(summary.output).toContain("Added then removed (2)");
  const details = await tool.execute(
    { view: "details", batchId: summary.metadata!.batchId, guid: "part", changeType: "addedThenRemoved" },
    toolContext(),
  );
  expect(details.output).toContain('+- Part "part" (part)');
  expect((await tool.execute({}, toolContext())).output).not.toContain("Added");
});
