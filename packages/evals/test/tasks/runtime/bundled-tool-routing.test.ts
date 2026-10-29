// @summary Contract, assembled-runtime execution, and mutation coverage for bundled-tool-routing

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@diligent/core/message-contract";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import { removeTemporaryRoot } from "../../../src/runner/runtime-workspace";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import { type BundledToolRoutingWorld, bundledToolRoutingTask } from "../../../src/tasks/runtime/bundled-tool-routing";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

describe("bundled-tool-routing", () => {
  test("defines exactly two strict fixture-owned providers and a receipt-free natural prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-runtime-bundled-routing-"));
    try {
      const world = await bundledToolRoutingTask.setup("shared-seed-123", root);
      const again = await bundledToolRoutingTask.setup("shared-seed-123", root);
      expect({ ...again, providerAssembly: [], executions: [] }).toEqual({
        ...world,
        providerAssembly: [],
        executions: [],
      });
      const providers = await bundledToolRoutingTask.createBundledToolProviders!(world);
      expect(providers).toHaveLength(2);
      expect(providers.map((provider) => provider.id)).toEqual([
        "eval-field-journey-provider",
        "eval-archive-collection-provider",
      ]);
      const tools = (await Promise.all(providers.map((provider) => provider.createTools({ cwd: root })))).flat();
      expect(tools.map((tool) => tool.name)).toEqual(["coordinate_field_journey", "schedule_archive_collection"]);
      expect(tools[0]!.parameters.safeParse(world.request).success).toBe(true);
      expect(tools[0]!.parameters.safeParse({ ...world.request, extra: true }).success).toBe(false);
      expect(
        tools[0]!.parameters.safeParse({
          ...world.request,
          route: { ...world.request.route, extra: true },
        }).success,
      ).toBe(false);
      expect(world.clientPrompt).not.toContain(world.receipt);
      expect(world.clientPrompt).not.toContain(world.decoyReceipt);
      expect(world.clientPrompt).not.toMatch(
        /coordinate_field_journey|schedule_archive_collection|assignment_ref|country_code|travel_window|accessibility_support/,
      );
      expect(bundledToolRoutingTask.toolPolicy).toEqual({
        allowedTools: ["coordinate_field_journey", "schedule_archive_collection"],
        allowedCapabilities: ["execute"],
        allowedCommands: [],
      });
      expect(bundledToolRoutingTask.limits).toMatchObject({
        maxTurns: 2,
        maxToolCalls: 1,
        maxChangedFiles: 0,
        maxChangedBytes: 0,
        maxUserInputRequests: 0,
        maxChildAgents: 0,
      });
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("runs natural-intent routing through real runtime assembly for both default profiles", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile);
      expect(bundledToolRoutingTask.evaluate(execution), profile.provider).toEqual({ passed: true });
      expect(execution.world.providerAssembly).toEqual([
        { providerId: "eval-field-journey-provider", cwd: "$WORKSPACE" },
        { providerId: "eval-archive-collection-provider", cwd: "$WORKSPACE" },
      ]);
      expect(execution.world.executions).toEqual([
        {
          providerId: "eval-field-journey-provider",
          toolName: "coordinate_field_journey",
          input: execution.world.request,
        },
      ]);
      expect(execution.providerCalls).toHaveLength(2);
      expect(execution.toolCalls).toHaveLength(1);
      expect(finalText(execution)).toBe(execution.world.receipt);
    }
  });

  test("accepts provider-native progress text beside one exact bundled tool call", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, true);

    expect(bundledToolRoutingTask.evaluate(execution)).toEqual({ passed: true });
  });

  test("accepts a bounded confirmation wrapper around the exclusive intended receipt", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[1]!, false, "Confirmed: ");

    expect(finalText(execution)).toBe(`Confirmed: ${execution.world.receipt}`);
    expect(bundledToolRoutingTask.evaluate(execution)).toEqual({ passed: true });

    const missingReceipt = structuredClone(execution);
    setFinal(missingReceipt, "Confirmed");
    expect(bundledToolRoutingTask.evaluate(missingReceipt)).toMatchObject({
      passed: false,
      code: "bundled_tool_routing.final",
    });
  });

  test("fails only on decoy execution, a missing intended receipt, or a wrong final answer", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[0]!);
    expect(bundledToolRoutingTask.evaluate(baseline)).toEqual({ passed: true });
    const cases: Array<[string, (value: RuntimeEvalExecution<BundledToolRoutingWorld>) => void, string]> = [
      ["decoy selection", selectDecoy, "bundled_tool_routing.decoy"],
      ["decoy execution", addDecoyExecution, "bundled_tool_routing.decoy"],
      ["missing intended call", (value) => value.toolCalls.pop(), "bundled_tool_routing.trace"],
      [
        "intended call failed",
        (value) => (value.toolCalls[0]!.outcome = "runtime_error"),
        "bundled_tool_routing.trace",
      ],
      ["rejected input only", rejectIntendedInput, "bundled_tool_routing.trace"],
      ["final decoy", (value) => setFinal(value, value.world.decoyReceipt), "bundled_tool_routing.final"],
      ["missing final", (value) => value.turns[0]!.messages.pop(), "bundled_tool_routing.final"],
      [
        "final prose",
        (value) => setFinal(value, `${value.world.receipt} complete`),
        "bundled_tool_routing.final_format",
      ],
    ];
    for (const [label, mutate, code] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(bundledToolRoutingTask.evaluate(changed), label).toMatchObject({ passed: false, code });
    }
  });

  test("passes with diagnostics when the intended routing succeeds through a different valid path", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[1]!);
    const retried = structuredClone(baseline);
    const rejected = structuredClone(retried.toolCalls[0]!);
    rejected.toolCallId = "journey-call-rejected";
    rejected.output = { output: "REJECTED_INPUT" };
    const decoyAttempt = {
      ...structuredClone(rejected),
      toolCallId: "decoy-attempt",
      name: "schedule_archive_collection",
    };
    decoyAttempt.outcome = "policy_rejection";
    retried.toolCalls.unshift(rejected, decoyAttempt);
    retried.toolCalls.push({ ...structuredClone(baseline.toolCalls[0]!), toolCallId: "journey-call-repeat" });
    retried.toolCalls.forEach((call, index) => (call.sequence = index + 1));
    setFinal(retried, `\`${retried.world.receipt}\``);
    const result = bundledToolRoutingTask.evaluate(retried);
    expect(result.passed).toBe(true);
    expect(result.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual([
      "bundled_tool_routing.decoy_attempt",
      "bundled_tool_routing.rejected_input_recovered",
      "bundled_tool_routing.repeated_routing",
    ]);
  });
});

async function assembledExecution(
  profile: EvalProfile,
  includeProgressText = false,
  finalPrefix = "",
): Promise<RuntimeEvalExecution<BundledToolRoutingWorld>> {
  const seed = "shared-seed-123";
  let call = 0;
  const result = await runRuntimeEvalExecution({
    task: bundledToolRoutingTask,
    seed,
    profile,
    streamFunction(model, context, options) {
      call += 1;
      const response =
        call === 1
          ? assistantMessage(
              [
                ...(includeProgressText ? [{ type: "text" as const, text: "Arranging the field journey now." }] : []),
                {
                  type: "tool_call",
                  id: "journey-call-1",
                  name: "coordinate_field_journey",
                  input: requestFor(seed),
                },
              ],
              "tool_use",
            )
          : assistantMessage([{ type: "text", text: `${finalPrefix}${token(seed, "JOURNEY_RECEIPT")}` }]);
      return sequenceStream([response])(model, context, options);
    },
  });
  expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
  expect(result.execution.termination).toBe("completed");
  return result.execution as RuntimeEvalExecution<BundledToolRoutingWorld>;
}

function requestFor(seed: string) {
  return {
    assignment_ref: token(seed, "ASSIGNMENT"),
    route: {
      destination: { city: token(seed, "CITY"), country_code: "KR" },
      travel_window: { outbound: "2026-09-17", inbound: "2026-09-21" },
      participants: [
        { identity: token(seed, "LEAD"), duty: "lead" },
        { identity: token(seed, "OBSERVER"), duty: "observer" },
      ],
    },
    service: { cabin: "quiet", accessibility_support: false },
  };
}

function token(seed: string, prefix: string): string {
  return `${prefix}_${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed"}`;
}

function finalText(value: RuntimeEvalExecution<BundledToolRoutingWorld>): string {
  const final = value.turns[0]!.messages.at(-1);
  return final?.role === "assistant" && Array.isArray(final.content)
    ? final.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")
    : "";
}

function selectDecoy(value: RuntimeEvalExecution<BundledToolRoutingWorld>) {
  value.toolCalls[0]!.name = "schedule_archive_collection";
  value.world.executions[0]!.providerId = "eval-archive-collection-provider";
  value.world.executions[0]!.toolName = "schedule_archive_collection";
}

function addDecoyExecution(value: RuntimeEvalExecution<BundledToolRoutingWorld>) {
  value.world.executions.push({
    providerId: "eval-archive-collection-provider",
    toolName: "schedule_archive_collection",
    input: {},
  });
}

function rejectIntendedInput(value: RuntimeEvalExecution<BundledToolRoutingWorld>) {
  (value.toolCalls[0]!.input as { assignment_ref: string }).assignment_ref = "wrong";
  value.toolCalls[0]!.output = { output: "REJECTED_INPUT" };
}

function setFinal(value: RuntimeEvalExecution<BundledToolRoutingWorld>, text: string) {
  const final = value.turns[0]!.messages.at(-1) as Message & { content: Array<{ type: "text"; text: string }> };
  final.content = [{ type: "text", text }];
}
