// @summary Real-runtime routing, isolation, outcome, and code-mode coverage for custom-agent-routing

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
import { type CustomAgentRoutingWorld, customAgentRoutingTask } from "../../../src/tasks/runtime/custom-agent-routing";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

const CALL_IDS = {
  spawn: "route-spawn-call-1",
  read: "route-read-call-2",
  wait: "route-wait-call-3",
  write: "route-write-call-4",
} as const;

type Execution = RuntimeEvalExecution<CustomAgentRoutingWorld>;

describe("custom-agent-routing", () => {
  test("routes through the discovered custom agent on the real collaboration runtime for both providers", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile);
      expect(customAgentRoutingTask.evaluate(execution), profile.provider).toEqual({ passed: true });
      expect(execution.world.clientPrompt).not.toContain(execution.world.releasePath);
      const childModel = resolveModelForClass(
        resolveModel({ provider: profile.provider, modelId: profile.model }),
        "lite",
      );
      const childId = execution.childSessions[0]!.threadId;
      const childCalls = execution.providerCalls.filter((call) => call.sessionId === childId);
      expect(childCalls.map((call) => call.model.modelId)).toEqual([childModel.modelId, childModel.modelId]);
    }
  });

  test("passes when the specialist reads the capsule inside a code-mode exec script", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, { childExec: true });
    expect(execution.toolCalls.find((call) => call.name === "read")?.threadId).not.toBe(execution.session.threadId);
    expect(customAgentRoutingTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("passes alternative wording, omitted optional inputs, wrapped child reports, and interleaved waits", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, {
      generatedIds: true,
      includeProgressText: true,
      liveSpawnWording: true,
      waitBeforeChildTrace: true,
      omitWaitTimeout: true,
      wrappedChildReport: true,
    });
    expect(customAgentRoutingTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("degrades but passes after recovered write attempts for either provider", async () => {
    const anthropic = DEFAULT_PROFILES.find((candidate) => candidate.provider === "anthropic")!;
    const openai = DEFAULT_PROFILES.find((candidate) => candidate.provider === "openai")!;
    for (const execution of [
      await assembledExecution(anthropic, { relativeWriteRecovery: true }),
      await assembledExecution(openai, { invalidPatchRecovery: true }),
    ]) {
      expect(customAgentRoutingTask.evaluate(execution)).toMatchObject({
        passed: true,
        diagnostics: [{ code: "custom_agent_routing.recovery" }],
      });
    }
  });

  test("fails direct reads, decoy access or routing, missing delegation, wrong artifact, or wrong reply", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[0]!);
    const cases: Array<[string, string, (value: Execution) => void]> = [
      [
        "parent read",
        "custom_agent_routing.parent_read",
        (value) => (value.toolCalls.find((call) => call.name === "read")!.threadId = value.session.threadId),
      ],
      [
        "decoy read",
        "custom_agent_routing.decoy_access",
        (value) =>
          value.toolCalls.push({
            ...structuredClone(value.toolCalls.find((call) => call.name === "read")!),
            input: { file_path: value.world.decoyPath },
          }),
      ],
      [
        "decoy specialist",
        "custom_agent_routing.decoy_specialist",
        (value) =>
          (value.toolCalls.find((call) => call.name === "spawn_agent")!.input = {
            message: "help",
            agent_type: value.world.decoyAgent.name,
          }),
      ],
      [
        "generic specialist",
        "custom_agent_routing.routing",
        (value) =>
          (value.toolCalls.find((call) => call.name === "spawn_agent")!.input = {
            message: "help",
            agent_type: "general",
          }),
      ],
      [
        "capsule never retrieved",
        "custom_agent_routing.delegation",
        (value) => (value.toolCalls = value.toolCalls.filter((call) => call.name !== "read")),
      ],
      ["wrong artifact", "custom_agent_routing.result", (value) => (value.verifier!.exitCode = 1)],
      ["leaked reply", "custom_agent_routing.final", (value) => setFinal(value, value.world.releaseToken)],
    ];
    for (const [name, code, mutate] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(customAgentRoutingTask.evaluate(changed), name).toMatchObject({ passed: false, code });
    }
  });
});

interface AssembledExecutionOptions {
  generatedIds?: boolean;
  includeProgressText?: boolean;
  liveSpawnWording?: boolean;
  waitBeforeChildTrace?: boolean;
  maximumWaitTimeout?: boolean;
  trailingPatchNewline?: boolean;
  omitSpawnDescription?: boolean;
  omitWaitTimeout?: boolean;
  wrappedChildReport?: boolean;
  relativeWriteRecovery?: boolean;
  invalidPatchRecovery?: boolean;
  childExec?: boolean;
}

async function assembledExecution(
  profile: EvalProfile,
  assembledOptions: AssembledExecutionOptions = {},
): Promise<RuntimeEvalExecution<CustomAgentRoutingWorld>> {
  const seed = "shared-seed-123";
  const result = await runRuntimeEvalExecution({
    task: customAgentRoutingTask,
    seed,
    profile,
    streamFunction: fixtureStream(profile, seed, assembledOptions),
  });
  expect(
    result.failures.filter((failure) => failure.category !== "task_semantic"),
    JSON.stringify({ failures: result.failures, toolCalls: result.execution.toolCalls }),
  ).toEqual([]);
  return result.execution as RuntimeEvalExecution<CustomAgentRoutingWorld>;
}

function fixtureStream(
  profile: EvalProfile,
  seed: string,
  assembledOptions: AssembledExecutionOptions,
): StreamFunction {
  let parentCall = 0;
  let childCall = 0;
  const token = `RELEASE_CAPSULE_${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed"}`;
  let callIds: Record<keyof typeof CALL_IDS, string>;
  if (assembledOptions.generatedIds) {
    callIds = { spawn: "runtime-spawn", read: "runtime-read", wait: "runtime-wait", write: "runtime-write" };
  } else {
    callIds = CALL_IDS;
  }
  let childReport: string;
  if (assembledOptions.wrappedChildReport) {
    childReport = `Here is the exact capsule content:\n\n\`\`\`\n${token}\n\`\`\`\n\nComplete capsule identifier: ${token}.`;
  } else {
    childReport = token;
  }
  return (model, context, options) => {
    const child = context.systemPrompt.some((section) => section.label === "agent_role");
    let response: AssistantMessage;
    if (!child) {
      response = parentResponse(++parentCall, profile, context, token, callIds, assembledOptions);
    } else if (++childCall !== 1) {
      response = assistantMessage([{ type: "text", text: childReport }]);
    } else if (assembledOptions.childExec) {
      response = assistantMessage(
        [
          {
            type: "tool_call",
            id: callIds.read,
            name: "exec",
            input: {
              code: `return await tools.read({ file_path: ${JSON.stringify(join(cwdFromContext(context, "runtime_context"), "vault/current-release.capsule"))} });`,
            },
          },
        ],
        "tool_use",
      );
    } else {
      response = assistantMessage(
        [
          {
            type: "tool_call",
            id: callIds.read,
            name: "read",
            input: {
              file_path: join(cwdFromContext(context, "runtime_context"), "vault/current-release.capsule"),
            },
          },
        ],
        "tool_use",
      );
    }
    if (child || parentCall !== 2 || assembledOptions.waitBeforeChildTrace) {
      return sequenceStream([response])(model, context, options);
    }
    return delayedMessage(response, model, options.signal);
  };
}

function delayedMessage(message: AssistantMessage, model: Parameters<StreamFunction>[0], signal?: AbortSignal) {
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
  }, 10);
  return stream;
}

function parentResponse(
  call: number,
  profile: EvalProfile,
  context: StreamContext,
  token: string,
  callIds: Record<keyof typeof CALL_IDS, string>,
  assembledOptions: AssembledExecutionOptions,
) {
  if (call === 1) {
    let progressTextParts: { type: "text"; text: string }[];
    if (assembledOptions.includeProgressText) {
      progressTextParts = [{ type: "text" as const, text: "I will delegate this to the release specialist." }];
    } else {
      progressTextParts = [];
    }
    let spawnMessage: string;
    let spawnDescription: string;
    if (assembledOptions.liveSpawnWording) {
      spawnMessage =
        "Retrieve the current release authorization capsule for this workspace. Inspect only the available release-authorization context and report the capsule without modifying files.";
      spawnDescription = "Retrieve release authorization capsule";
    } else {
      spawnMessage =
        "Read only vault/current-release.capsule exactly once. Return only the capsule token, without commentary or a trailing newline.";
      spawnDescription = "Retrieve current release authorization";
    }
    return assistantMessage(
      [
        ...progressTextParts,
        {
          type: "tool_call",
          id: callIds.spawn,
          name: "spawn_agent",
          input: {
            message: spawnMessage,
            ...(!assembledOptions.omitSpawnDescription && {
              description: spawnDescription,
            }),
            agent_type: "release-authorization-liaison",
          },
        },
      ],
      "tool_use",
    );
  }
  if (call === 2) {
    let timeoutMs: number;
    if (assembledOptions.maximumWaitTimeout) {
      timeoutMs = 3_600_000;
    } else if (assembledOptions.liveSpawnWording) {
      timeoutMs = 900_000;
    } else {
      timeoutMs = 30_000;
    }
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: callIds.wait,
          name: "wait",
          input: {
            ids: [spawnedThreadId(context)],
            ...(!assembledOptions.omitWaitTimeout && {
              timeout_ms: timeoutMs,
            }),
          },
        },
      ],
      "tool_use",
    );
  }
  if (call === 3 && assembledOptions.relativeWriteRecovery)
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: "route-write-recovery-call",
          name: "edit",
          input: {
            file_path: "release-authorization.txt",
            old_string: "",
            new_string: `${token}\n`,
            replace_all: false,
          },
        },
      ],
      "tool_use",
    );
  if (call === 3 && assembledOptions.invalidPatchRecovery)
    return assistantMessage(
      [
        {
          type: "tool_call",
          id: "route-patch-recovery-call",
          name: "apply_patch",
          input: {
            patch: `*** Begin Patch\n*** Add File: release-authorization.txt\n+${token}\n*** End of File\n*** End Patch`,
          },
        },
      ],
      "tool_use",
    );
  if (call === (assembledOptions.relativeWriteRecovery || assembledOptions.invalidPatchRecovery ? 4 : 3)) {
    let progressText: { type: "text"; text: string }[];
    if (assembledOptions.includeProgressText) {
      progressText = [{ type: "text" as const, text: "I will record the specialist result." }];
    } else {
      progressText = [];
    }
    let input: { file_path: string; old_string: string; new_string: string; replace_all: boolean } | { patch: string };
    if (profile.provider === "anthropic") {
      input = {
        file_path: join(cwdFromContext(context, "base"), "release-authorization.txt"),
        old_string: "",
        new_string: `${token}\n`,
        replace_all: false,
      };
    } else {
      input = {
        patch: `*** Begin Patch\n*** Add File: release-authorization.txt\n+${token}\n*** End Patch${assembledOptions.trailingPatchNewline ? "\n" : ""}`,
      };
    }
    return assistantMessage(
      [
        ...progressText,
        {
          type: "tool_call",
          id: callIds.write,
          name: profile.provider === "anthropic" ? "edit" : "apply_patch",
          input,
        },
      ],
      "tool_use",
    );
  }
  return assistantMessage([{ type: "text", text: "RELEASE_AUTHORIZATION_RECORDED" }]);
}

function cwdFromContext(context: StreamContext, label: "base" | "runtime_context"): string {
  const content = context.systemPrompt.find((section) => section.label === label)?.content ?? "";
  const match = content.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error(`Missing ${label} cwd in provider context.`);
  return match[1];
}

function spawnedThreadId(context: StreamContext): string {
  const match = JSON.stringify(context.messages).match(/\\"thread_id\\":\\"([^\\"]+)\\"/);
  if (!match?.[1]) throw new Error("Missing spawned child thread id in parent context.");
  return match[1];
}

function setFinal(value: Execution, text: string): void {
  const final = value.turns[0]!.messages.at(-1);
  if (final?.role !== "assistant") throw new Error("Missing final assistant response.");
  final.content = [{ type: "text", text }];
}
