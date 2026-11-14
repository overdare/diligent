// @summary Lazy MCP discovery, service selection, and outcome coverage for mcp-lazy-tool on the real runtime

import { describe, expect, test } from "bun:test";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import { type McpLazyToolWorld, mcpLazyToolTask } from "../../../src/tasks/runtime/mcp-lazy-tool";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

type Execution = RuntimeEvalExecution<McpLazyToolWorld>;

describe("mcp-lazy-tool", () => {
  test("discovers and runs the approved lazy service for both default profiles", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile);
      expect(mcpLazyToolTask.evaluate(execution), profile.provider).toEqual({ passed: true });
    }
  });

  test("passes progress text, unscoped search, and extra searches", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!, true, true, true);
    const result = mcpLazyToolTask.evaluate(execution);
    expect(result.passed).toBe(true);
    expect(result.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual(["mcp_lazy.repeated_search"]);
  });

  test("degrades but passes when a rejected attempt is retried with the right request", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[0]!);
    const run = execution.toolCalls.find((call) => call.name === "mcp_run_tool")!;
    execution.toolCalls.splice(execution.toolCalls.indexOf(run), 0, {
      ...structuredClone(run),
      toolCallId: "rejected",
      output: { output: "REJECTED_INPUT" },
    });
    expect(mcpLazyToolTask.evaluate(execution)).toMatchObject({
      passed: true,
      diagnostics: [{ code: "mcp_lazy.rejected_input_recovered" }],
    });
  });

  test("fails a decoy service, a missing service call, an unconfirmed request, or a wrong reply", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[0]!);
    const run = (value: Execution) => value.toolCalls.find((call) => call.name === "mcp_run_tool")!;
    const cases: Array<[string, string, (value: Execution) => void]> = [
      [
        "decoy service",
        "mcp_lazy.decoy_tool",
        (value) =>
          value.toolCalls.push({
            ...structuredClone(run(value)),
            toolCallId: "decoy",
            input: { server: "fixture-logistics", tool: value.world.decoyTool, args: { archive_ref: "x" } },
          }),
      ],
      ["service never run", "mcp_lazy.tool_selection", (value) => (run(value).outcome = "runtime_error")],
      ["request rejected", "mcp_lazy.arguments", (value) => (run(value).output = { output: "REJECTED_INPUT" })],
      ["confirmation omitted", "mcp_lazy.final", (value) => setFinal(value, "Done.")],
      [
        "extra reply text",
        "mcp_lazy.final_format",
        (value) => setFinal(value, `The unit is booked: ${value.world.receipt}`),
      ],
    ];
    for (const [name, code, mutate] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(mcpLazyToolTask.evaluate(changed), name).toMatchObject({ passed: false, code });
    }
  });
});

async function assembledExecution(
  profile: EvalProfile,
  includeProgressText = false,
  omitSearchServer = false,
  parallelSearch = false,
): Promise<RuntimeEvalExecution<McpLazyToolWorld>> {
  const seed = "shared-seed-123";
  let call = 0;
  const result = await runRuntimeEvalExecution({
    task: mcpLazyToolTask,
    seed,
    profile,
    streamFunction(model, context, options) {
      call += 1;
      const response =
        call === 1
          ? assistantMessage(
              [
                ...(includeProgressText ? [{ type: "text" as const, text: "Discovering the MCP tool." }] : []),
                {
                  type: "tool_call",
                  id: "mcp-search-call-1",
                  name: "mcp_search_tools",
                  input: {
                    query: "sterile expedition rendezvous",
                    ...(omitSearchServer ? {} : { server: "fixture-logistics" }),
                  },
                },
                ...(parallelSearch
                  ? [
                      {
                        type: "tool_call" as const,
                        id: "mcp-search-call-2",
                        name: "mcp_search_tools",
                        input: { query: "field" },
                      },
                    ]
                  : []),
              ],
              "tool_use",
            )
          : call === 2
            ? assistantMessage(
                [
                  ...(includeProgressText ? [{ type: "text" as const, text: "Running the discovered MCP tool." }] : []),
                  {
                    type: "tool_call",
                    id: "mcp-run-call-2",
                    name: "mcp_run_tool",
                    input: {
                      server: "fixture-logistics",
                      tool: "coordinate_sterile_field_unit",
                      args: requestFor(seed),
                    },
                  },
                ],
                "tool_use",
              )
            : assistantMessage([{ type: "text", text: token(seed, "FIELD_UNIT_RECEIPT") }]);
      return sequenceStream([response])(model, context, options);
    },
  });
  expect(
    result.failures.filter((failure) => failure.category !== "task_semantic"),
    JSON.stringify(result.failures),
  ).toEqual([]);
  expect(result.execution.termination).toBe("completed");
  return result.execution as RuntimeEvalExecution<McpLazyToolWorld>;
}

function requestFor(seed: string) {
  return {
    case_ref: token(seed, "FIELD_CASE"),
    deployment: {
      location: { facility: token(seed, "FACILITY"), region_code: "KR-41" },
      operating_window: { opens: "2026-10-06", closes: "2026-10-09" },
      team: [
        { badge: token(seed, "CLINICIAN"), role: "clinician" },
        { badge: token(seed, "TECHNICIAN"), role: "technician" },
      ],
    },
    support: { isolation_grade: "negative_pressure", cold_chain: true },
  };
}

function token(seed: string, prefix: string): string {
  return `${prefix}_${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "seed"}`;
}

function setFinal(value: Execution, text: string) {
  const final = value.turns[0]!.messages.at(-1);
  if (!final || final.role !== "assistant") throw new Error("Missing final assistant response.");
  final.content = [{ type: "text", text }];
}
