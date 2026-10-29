// @summary Real-runtime overlap, isolation, outcome, and code-mode coverage for parallel synthesis

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { EventStream } from "@diligent/core/event-stream";
import type { AssistantMessage } from "@diligent/core/message-contract";
import { resolveModel, resolveModelForClass } from "@diligent/core/model-registry";
import type { ProviderEvent, ProviderResult, StreamContext, StreamFunction } from "@diligent/core/provider-contract";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import {
  type CollaborationParallelSynthesisWorld,
  collaborationParallelSynthesisTask,
} from "../../../src/tasks/runtime/collaboration-parallel-synthesis";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

const CALL_IDS = {
  spawnNorth: "parallel-spawn-north-1",
  spawnSouth: "parallel-spawn-south-2",
  readNorth: "parallel-read-north-3",
  readSouth: "parallel-read-south-4",
  wait: "parallel-wait-5",
  write: "parallel-write-6",
} as const;

type Execution = RuntimeEvalExecution<CollaborationParallelSynthesisWorld>;

describe("collaboration-parallel-synthesis", () => {
  test("runs two genuinely overlapping children and one ordered synthesis for both providers", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile);
      expect(collaborationParallelSynthesisTask.evaluate(execution), profile.provider).toEqual({ passed: true });
      const ids = spawnedIds(execution);
      const events = execution.turns[0]!.coreEvents.map((entry) => entry.event as Record<string, unknown>);
      const statusIndex = (id: string, status: string) =>
        events.findIndex(
          (event) => event.type === "collab_spawn_end" && event.callId === id && event.status === status,
        );
      expect(Math.max(...ids.map((id) => statusIndex(id, "running")))).toBeLessThan(
        Math.min(...ids.map((id) => statusIndex(id, "completed"))),
      );
      const childModel = resolveModelForClass(
        resolveModel({ provider: profile.provider, modelId: profile.model }),
        "lite",
      );
      for (const id of ids) {
        const calls = execution.providerCalls.filter((call) => call.sessionId === id);
        expect(calls.map((call) => call.model.modelId)).toEqual([childModel.modelId, childModel.modelId]);
      }
    }
  });

  test("passes when a child reads its source inside a code-mode exec script", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, { childExec: true });
    const childReads = execution.toolCalls.filter((call) => call.name === "read");
    expect(childReads.every((call) => call.threadId !== execution.session.threadId)).toBe(true);
    expect(collaborationParallelSynthesisTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("passes semantic briefs, verbose child reports, and recovered child reads and parent writes", async () => {
    const anthropic = DEFAULT_PROFILES.find((candidate) => candidate.provider === "anthropic")!;
    const execution = await assembledExecution(anthropic, {
      generatedIds: true,
      semanticSpawnInputs: true,
      verboseChildReport: true,
      relativeReadRecovery: true,
      relativeEditRecovery: true,
    });
    const result = collaborationParallelSynthesisTask.evaluate(execution);
    expect(result.passed).toBe(true);
    expect(result.diagnostics?.map((diagnostic) => diagnostic.code)).toContain(
      "collaboration_parallel_synthesis.recovery",
    );
  });

  test("accepts a fenced final acknowledgement", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!);
    setFinal(execution, "`PARALLEL_SYNTHESIS_RECORDED`");
    expect(collaborationParallelSynthesisTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("notes briefs that name the other region while reads stay isolated", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!);
    for (const [index, spawn] of execution.toolCalls.filter((call) => call.name === "spawn_agent").entries())
      (spawn.input as { message: string }).message +=
        ` Do not read ${execution.world.sourcePaths[index === 0 ? 1 : 0]}.`;
    expect(collaborationParallelSynthesisTask.evaluate(execution)).toMatchObject({
      passed: true,
      diagnostics: [{ impact: "info", code: "collaboration_parallel_synthesis.cross_region_brief_reference" }],
    });
  });

  test("fails crossed isolation, missing delegation, wrong role, serial joins, wrong artifact, or wrong reply", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[0]!);
    const cases: Array<[string, string, (value: Execution) => void]> = [
      [
        "parent read a source",
        "collaboration_parallel_synthesis.parent_read",
        (value) => {
          const read = value.toolCalls.find((call) => call.toolCallId === CALL_IDS.readNorth)!;
          read.threadId = value.session.threadId;
          delete read.childThreadId;
        },
      ],
      [
        "one child read both regions",
        "collaboration_parallel_synthesis.cross_region",
        (value) => {
          const north = value.toolCalls.find((call) => call.toolCallId === CALL_IDS.readNorth)!;
          const south = value.toolCalls.find((call) => call.toolCallId === CALL_IDS.readSouth)!;
          value.toolCalls.push({ ...structuredClone(south), toolCallId: "extra", threadId: north.threadId });
        },
      ],
      [
        "a source was never read by a child",
        "collaboration_parallel_synthesis.delegation",
        (value) => (value.toolCalls = value.toolCalls.filter((call) => call.toolCallId !== CALL_IDS.readSouth)),
      ],
      [
        "non-exploration role",
        "collaboration_parallel_synthesis.role",
        (value) => {
          const spawn = value.toolCalls.find((call) => call.toolCallId === CALL_IDS.spawnSouth)!;
          (spawn.input as { agent_type: string }).agent_type = "general";
        },
      ],
      [
        "joined before the second spawn",
        "collaboration_parallel_synthesis.not_concurrent",
        (value) => {
          const wait = value.toolCalls.find((call) => call.toolCallId === CALL_IDS.wait)!;
          const south = value.toolCalls.find((call) => call.toolCallId === CALL_IDS.spawnSouth)!;
          [wait.sequence, south.sequence] = [south.sequence, wait.sequence];
          value.toolCalls.sort((left, right) => left.sequence - right.sequence);
        },
      ],
      ["wrong artifact", "collaboration_parallel_synthesis.result", (value) => (value.verifier!.exitCode = 1)],
      [
        "wrong reply",
        "collaboration_parallel_synthesis.final",
        (value) => setFinal(value, `Done: ${value.world.tokens[0]}`),
      ],
    ];
    for (const [name, code, mutate] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(collaborationParallelSynthesisTask.evaluate(changed), name).toMatchObject({ passed: false, code });
    }
  });
});

interface AssembledExecutionOptions {
  generatedIds?: boolean;
  semanticSpawnInputs?: boolean;
  verboseChildReport?: boolean;
  relativeReadRecovery?: boolean;
  relativeEditRecovery?: boolean;
  childExec?: boolean;
}

async function assembledExecution(
  profile: EvalProfile,
  assembledOptions: AssembledExecutionOptions = {},
): Promise<Execution> {
  const seed = "shared-seed-123";
  const result = await runRuntimeEvalExecution({
    task: collaborationParallelSynthesisTask,
    seed,
    profile,
    streamFunction: fixtureStream(profile, seed, assembledOptions),
  });
  expect(
    result.failures.filter((failure) => failure.category !== "task_semantic"),
    JSON.stringify({ failures: result.failures, toolCalls: result.execution.toolCalls }),
  ).toEqual([]);
  return result.execution as Execution;
}

function fixtureStream(
  profile: EvalProfile,
  seed: string,
  assembledOptions: AssembledExecutionOptions,
): StreamFunction {
  let parentCall = 0;
  const childCalls = [0, 0];
  const tokens = [seeded(seed, "NORTH_FACT"), seeded(seed, "SOUTH_FACT")];
  const callIds: Record<keyof typeof CALL_IDS, string> = assembledOptions.generatedIds
    ? {
        spawnNorth: "runtime-spawn-north",
        spawnSouth: "runtime-spawn-south",
        readNorth: "runtime-read-north",
        readSouth: "runtime-read-south",
        wait: "runtime-wait",
        write: "runtime-write",
      }
    : CALL_IDS;
  return (model, context, options) => {
    const childIndex = regionIndex(context);
    if (childIndex !== undefined) {
      const call = ++childCalls[childIndex];
      const recovering = assembledOptions.relativeReadRecovery === true && childIndex === 0;
      const isReadCall = call === 1 || (recovering && call === 2);
      const relativePath = childIndex === 0 ? "regions/north/coordination.fact" : "regions/south/coordination.fact";
      const filePath =
        recovering && call === 1 ? relativePath : join(cwdFromContext(context, "runtime_context"), relativePath);
      const readId = `${childIndex === 0 ? callIds.readNorth : callIds.readSouth}${recovering && call === 1 ? "-relative" : ""}`;
      const response = isReadCall
        ? assistantMessage(
            [
              assembledOptions.childExec
                ? {
                    type: "tool_call",
                    id: readId,
                    name: "exec",
                    input: { code: `return await tools.read({ file_path: ${JSON.stringify(filePath)} });` },
                  }
                : { type: "tool_call", id: readId, name: "read", input: { file_path: filePath } },
            ],
            "tool_use",
          )
        : assistantMessage([
            {
              type: "text",
              text: assembledOptions.verboseChildReport
                ? `Here is the exact file content:\n\n\`\`\`\n${tokens[childIndex]}\n\`\`\``
                : tokens[childIndex]!,
            },
          ]);
      const delay = isReadCall ? 15 + childIndex * 10 + call * 2 : 45 + childIndex * 10;
      return delayedMessage(response, model, options.signal, delay);
    }
    return sequenceStream([parentResponse(++parentCall, profile, context, tokens, callIds, assembledOptions)])(
      model,
      context,
      options,
    );
  };
}

function parentResponse(
  call: number,
  profile: EvalProfile,
  context: StreamContext,
  tokens: string[],
  callIds: Record<keyof typeof CALL_IDS, string>,
  assembledOptions: AssembledExecutionOptions,
) {
  const spawn = (id: string, region: "north" | "south") => ({
    type: "tool_call" as const,
    id,
    name: "spawn_agent",
    input: {
      message: assembledOptions.semanticSpawnInputs
        ? `Retrieve the exact contents of regions/${region}/coordination.fact and return only the contents.`
        : `Read only regions/${region}/coordination.fact exactly once. Return only its exact token.`,
      description: `Retrieve ${region} coordination fact`,
      agent_type: "explore",
    },
  });
  if (call === 1)
    return assistantMessage([spawn(callIds.spawnNorth, "north"), spawn(callIds.spawnSouth, "south")], "tool_use");
  if (call === 2)
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: callIds.wait,
          name: "wait",
          input: { ids: spawnedThreadIds(context), timeout_ms: 30_000 },
        },
      ],
      "tool_use",
    );
  if (call === 3 && assembledOptions.relativeEditRecovery)
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: `${callIds.write}-relative`,
          name: "edit",
          input: { file_path: "parallel-synthesis.txt", old_string: "", new_string: `${tokens[0]}\n${tokens[1]}\n` },
        },
      ],
      "tool_use",
    );
  if (call === 3 || (call === 4 && assembledOptions.relativeEditRecovery))
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: callIds.write,
          name: profile.provider === "anthropic" ? "edit" : "apply_patch",
          input:
            profile.provider === "anthropic"
              ? {
                  file_path: join(cwdFromContext(context, "base"), "parallel-synthesis.txt"),
                  old_string: "",
                  new_string: `${tokens[0]}\n${tokens[1]}\n`,
                  replace_all: false,
                }
              : {
                  patch: `*** Begin Patch\n*** Add File: parallel-synthesis.txt\n+${tokens[0]}\n+${tokens[1]}\n*** End Patch`,
                },
        },
      ],
      "tool_use",
    );
  return assistantMessage([{ type: "text", text: "PARALLEL_SYNTHESIS_RECORDED" }]);
}

function delayedMessage(
  message: AssistantMessage,
  model: Parameters<StreamFunction>[0],
  signal: AbortSignal | undefined,
  delayMs: number,
) {
  const stream = new EventStream<ProviderEvent, ProviderResult>(
    (event) => event.type === "done" || event.type === "error",
    (event) => {
      if (event.type === "done") return { message: event.message };
      throw (event as { type: "error"; error: Error }).error;
    },
  );
  if (signal) stream.attachSignal(signal);
  setTimeout(() => {
    const resolved = { ...message, model };
    stream.push({ type: "start" });
    for (const block of resolved.content) {
      if (block.type !== "tool_call") continue;
      stream.push({ type: "tool_call_start", id: block.id, name: block.name });
      stream.push({ type: "tool_call_end", id: block.id, name: block.name, input: block.input });
    }
    stream.push({ type: "done", stopReason: resolved.stopReason, message: resolved });
  }, delayMs);
  return stream;
}

function regionIndex(context: StreamContext): number | undefined {
  if (!context.systemPrompt.some((section) => section.label === "agent_role")) return undefined;
  const messages = JSON.stringify(context.messages);
  if (messages.includes("regions/north/coordination.fact")) return 0;
  if (messages.includes("regions/south/coordination.fact")) return 1;
  return undefined;
}

function cwdFromContext(context: StreamContext, label: "base" | "runtime_context"): string {
  const content = context.systemPrompt.find((section) => section.label === label)?.content ?? "";
  const match = content.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error(`Missing ${label} cwd in provider context.`);
  return match[1];
}

function spawnedThreadIds(context: StreamContext): [string, string] {
  const ids = [...JSON.stringify(context.messages).matchAll(/\\"thread_id\\":\\"([^\\"]+)\\"/g)].map(
    (match) => match[1]!,
  );
  if (ids.length !== 2 || ids[0] === ids[1]) throw new Error("Missing two distinct spawned child thread ids.");
  return [ids[0]!, ids[1]!];
}

function spawnedIds(execution: RuntimeEvalExecution<CollaborationParallelSynthesisWorld>): [string, string] {
  const result = [CALL_IDS.spawnNorth, CALL_IDS.spawnSouth].map((id) => {
    const trace = execution.toolCalls.find((call) => call.toolCallId === id)!;
    return JSON.parse((trace.output as { output: string }).output).thread_id as string;
  });
  return [result[0]!, result[1]!];
}

function seeded(seed: string, prefix: string): string {
  return `${prefix}_${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed"}`;
}

function setFinal(value: Execution, text: string) {
  const final = value.turns[0]!.messages.at(-1);
  if (!final || final.role !== "assistant") throw new Error("Missing final assistant response.");
  final.content = [{ type: "text", text }];
}
