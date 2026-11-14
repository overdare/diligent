// @summary Strict contract and evaluator tests for the plan-converge runtime eval

import { describe, expect, test } from "bun:test";
import type { RuntimeEvalExecution, RuntimeToolTrace } from "../../../src/runtime-task";
import { type PlanConvergeWorld, planConvergeTask } from "../../../src/tasks/runtime/plan-converge";

const API_PATH = "facts/api.txt";
const UI_PATH = "facts/ui.txt";
const THREAD_ID = "thread-1";

describe("plan-converge runtime eval", () => {
  test("passes direct discovery, one clarification, and a complete plan", () => {
    expect(planConvergeTask.evaluate(directExecution())).toEqual({ passed: true });
  });

  test("accepts failed path probes, relative reads, and extra safe reads with informational notes", () => {
    const recovered = recoveryExecution();
    recovered.toolCalls[2]!.input = { file_path: API_PATH };
    recovered.toolCalls.splice(3, 0, successfulRead(4, "README.md", "context"));
    recovered.toolCalls.slice(4).forEach((call, index) => (call.sequence = 5 + index));
    const result = planConvergeTask.evaluate(recovered);
    expect(result.passed).toBe(true);
    expect(result.diagnostics?.map((diagnostic) => [diagnostic.code, diagnostic.impact])).toEqual([
      ["plan_converge.read_probe", "info"],
      ["plan_converge.additional_read", "info"],
    ]);
  });

  test("degrades but passes when the question precedes discovery", () => {
    const execution = directExecution();
    execution.toolCalls.at(-1)!.sequence = 0;
    expect(planConvergeTask.evaluate(execution)).toMatchObject({
      passed: true,
      diagnostics: [{ code: "plan_converge.asked_before_discovery" }],
    });
  });

  test("fails missing discovery, a missing clarification, or an incomplete or malformed plan", () => {
    const cases: Array<[string, string, (execution: RuntimeEvalExecution<PlanConvergeWorld>) => void]> = [
      ["facts never read", "plan_converge.discovery", (execution) => execution.toolCalls.splice(0, 1)],
      [
        "question rejected",
        "plan_converge.question",
        (execution) => (execution.toolCalls.at(-1)!.outcome = "policy_rejection"),
      ],
      [
        "question about something else",
        "plan_converge.question",
        (execution) =>
          ((execution.toolCalls.at(-1)!.input as { questions: Array<{ id: string }> }).questions[0]!.id = "other"),
      ],
      [
        "preference omitted from plan",
        "plan_converge.plan_facts",
        (execution) =>
          replaceFinalText(execution, finalText(execution.world).replaceAll(execution.world.preference, "")),
      ],
      [
        "two plan blocks",
        "plan_converge.plan_block",
        (execution) => replaceFinalText(execution, `${finalText(execution.world)}\n${finalText(execution.world)}`),
      ],
      ["fixture changed", "plan_converge.verifier", (execution) => (execution.verifier!.exitCode = 1)],
    ];
    for (const [name, code, mutate] of cases) {
      const execution = directExecution();
      mutate(execution);
      expect(planConvergeTask.evaluate(execution), name).toMatchObject({ passed: false, code });
    }
  });
});

function directExecution(): RuntimeEvalExecution<PlanConvergeWorld> {
  const execution = baseExecution("openai");
  execution.toolCalls = [
    successfulRead(1, API_PATH, execution.world.apiFact),
    successfulRead(2, UI_PATH, execution.world.uiFact),
    successfulQuestion(3, execution.world.preference),
  ];
  return execution;
}

function recoveryExecution(): RuntimeEvalExecution<PlanConvergeWorld> {
  const execution = baseExecution("anthropic");
  execution.toolCalls = [
    failedRelativeRead(1, API_PATH),
    failedRelativeRead(2, UI_PATH),
    successfulRead(3, API_PATH, execution.world.apiFact),
    successfulRead(4, UI_PATH, execution.world.uiFact),
    successfulQuestion(5, execution.world.preference),
  ];
  return execution;
}

function baseExecution(provider: "anthropic" | "openai"): RuntimeEvalExecution<PlanConvergeWorld> {
  const world: PlanConvergeWorld = {
    root: "$WORKSPACE",
    seed: "seed",
    apiFact: "api-hidden",
    uiFact: "ui-hidden",
    preference: "preference-hidden",
    expected: "",
    protectedPaths: [],
    allowedChanges: [],
  };
  const askedQuestion = question();
  return {
    taskId: planConvergeTask.id,
    profile: { provider, model: "test-model", effort: "medium" },
    seed: world.seed,
    startedAt: new Date(0).toISOString(),
    elapsedMs: 1,
    termination: "completed",
    turns: [
      {
        index: 0,
        threadId: THREAD_ID,
        clientPrompt: "plan",
        startedAt: new Date(0).toISOString(),
        elapsedMs: 1,
        termination: "completed",
        coreEvents: [],
        runtimeEvents: [],
        notifications: [],
        messages: [assistant(finalText(world), provider)],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ],
    compactions: [],
    threadCwd: world.root,
    advertisedTools: [],
    threadReads: [],
    protocolActions: [],
    providerCalls: [providerCall(provider)],
    toolCalls: [],
    toolOutputFiles: [],
    approvals: [],
    userInputRequests: [
      {
        id: 1,
        method: "userInput/request",
        params: { threadId: THREAD_ID, request: { questions: [structuredClone(askedQuestion)] } },
      },
    ],
    logs: [],
    session: { threadId: THREAD_ID, lines: [{ id: THREAD_ID }] },
    childSessions: [],
    workspace: { initial: { entries: [] }, final: { entries: [] } },
    runtimeState: { initial: [], final: [], diff: [] },
    verifier: { argv: [], exitCode: 0, elapsedMs: 1, stdout: "", stderr: "", timedOut: false },
    world,
  };
}

function failedRelativeRead(sequence: number, path: string): RuntimeToolTrace {
  const error = `Error: file_path must be absolute: ${path}`;
  return {
    sequence,
    toolCallId: `read-failed-${sequence}`,
    name: "read",
    capability: "read",
    threadId: THREAD_ID,
    input: { file_path: path },
    outcome: "runtime_error",
    error,
    output: { output: error, metadata: { error: true } },
  };
}

function successfulRead(sequence: number, path: string, value: string): RuntimeToolTrace {
  return {
    sequence,
    toolCallId: `read-success-${sequence}`,
    name: "read",
    capability: "read",
    threadId: THREAD_ID,
    input: { file_path: absolute(path) },
    outcome: "success",
    output: { output: `1\t${value}\n2\t` },
  };
}

function successfulQuestion(sequence: number, answer: string): RuntimeToolTrace {
  const askedQuestion = question();
  return {
    sequence,
    toolCallId: `question-${sequence}`,
    name: "request_user_input",
    capability: "user_input",
    threadId: THREAD_ID,
    input: { questions: [askedQuestion] },
    outcome: "success",
    output: { output: `[${askedQuestion.header}] ${askedQuestion.question}\nAnswer: ${answer}` },
  };
}

function question() {
  return {
    id: "rollout_preference",
    header: "Rollout",
    question: "Which rollout preference should the plan use?",
    options: [{ label: "Custom", description: "Supply the unavailable rollout preference." }],
  };
}

function absolute(path: string): string {
  return `$WORKSPACE/${path}`;
}

function finalText(world: PlanConvergeWorld): string {
  return `<proposed_plan>\n${world.apiFact}\n${world.uiFact}\n${world.preference}\n</proposed_plan>`;
}

function replaceFinalText(execution: RuntimeEvalExecution<PlanConvergeWorld>, text: string): void {
  const message = execution.turns[0]!.messages[0]!;
  if (message.role !== "assistant") throw new Error("Expected assistant message.");
  message.content = [{ type: "text", text }];
}

function assistant(text: string, provider: "anthropic" | "openai") {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    model: {
      provider,
      modelId: "test-model",
      contextWindow: 100_000,
      maxOutputTokens: 8_192,
      supportsThinking: false,
    },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn" as const,
    timestamp: 0,
  };
}

function providerCall(provider: "anthropic" | "openai") {
  return {
    sequence: 1,
    model: { provider, modelId: "test-model" },
    systemPrompt: { totalCount: 0, includedCount: 0, omittedCount: 0, items: [] },
    messages: { totalCount: 0, includedCount: 0, omittedCount: 0, items: [] },
    tools: {
      totalCount: 2,
      includedCount: 2,
      omittedCount: 0,
      items: [
        { name: "read", description: "", inputSchema: {} },
        { name: "request_user_input", description: "", inputSchema: {} },
      ],
    },
    streamOptions: {},
    bounds: {
      maxSourceItems: 1,
      maxNestedItems: 1,
      maxObjectProperties: 1,
      maxStringChars: 1,
      maxDepth: 1,
      truncatedStrings: 0,
      omittedNestedItems: 0,
      omittedObjectProperties: 0,
    },
  } as unknown as RuntimeEvalExecution<PlanConvergeWorld>["providerCalls"][number];
}
