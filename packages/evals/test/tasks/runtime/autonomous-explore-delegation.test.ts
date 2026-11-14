// @summary Real-runtime delegation, isolation, and code-mode coverage for autonomous-explore-delegation

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { StreamContext, StreamFunction } from "@diligent/core/provider-contract";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import {
  type AutonomousExploreDelegationWorld,
  autonomousExploreDelegationTask,
} from "../../../src/tasks/runtime/autonomous-explore-delegation";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

type Execution = RuntimeEvalExecution<AutonomousExploreDelegationWorld>;
const SEED = "shared-seed-123";

describe("autonomous-explore-delegation", () => {
  test("passes when one explore child reads every region with direct reads or in one exec script", async () => {
    for (const transport of ["direct", "exec"] as const) {
      const execution = await assembledExecution(transport);
      expect(autonomousExploreDelegationTask.evaluate(execution), transport).toEqual({ passed: true });
    }
  });

  test("fails a parent source read, a non-explore delegate, missing values, or misordered values", async () => {
    const baseline = await assembledExecution("direct");
    const cases: Array<[string, string, (value: Execution) => void]> = [
      [
        "parent read",
        "autonomous_explore.parent_read",
        (value) => {
          const read = value.toolCalls.find((call) => call.name === "read")!;
          read.threadId = value.session.threadId;
          delete read.childThreadId;
        },
      ],
      [
        "general delegate",
        "autonomous_explore.spawn",
        (value) => (value.toolCalls.find((call) => call.name === "spawn_agent")!.input = { message: "find" }),
      ],
      [
        "value omitted",
        "autonomous_explore.synthesis",
        (value) => setFinal(value, value.world.facts.slice(1).join("\n")),
      ],
      [
        "values misordered",
        "autonomous_explore.order",
        (value) => setFinal(value, [...value.world.facts].reverse().join("\n")),
      ],
    ];
    for (const [name, code, mutate] of cases) {
      const changed = structuredClone(baseline);
      mutate(changed);
      expect(autonomousExploreDelegationTask.evaluate(changed), name).toMatchObject({ passed: false, code });
    }
  });
});

async function assembledExecution(transport: "direct" | "exec"): Promise<Execution> {
  let parentCall = 0;
  let childCall = 0;
  let facts: string[] = [];
  const stream: StreamFunction = (model, context, options) => {
    const child = context.systemPrompt.some((section) => section.label === "agent_role");
    if (child) {
      childCall += 1;
      const cwd = cwdFromContext(context, "runtime_context");
      const paths = Array.from({ length: 6 }, (_, index) =>
        join(cwd, `reference-map/region-${index + 1}`, sourceFile(index)),
      );
      if (childCall === 1)
        return sequenceStream([
          assistantMessage(
            transport === "exec"
              ? [
                  {
                    type: "tool_call",
                    id: "explore-exec",
                    name: "exec",
                    input: {
                      code: `const out = []; for (const file_path of ${JSON.stringify(paths)}) out.push(await tools.read({ file_path })); return out.join("\\n");`,
                    },
                  },
                ]
              : paths.map((file_path, index) => ({
                  type: "tool_call" as const,
                  id: `explore-read-${index}`,
                  name: "read",
                  input: { file_path },
                })),
            "tool_use",
          ),
        ])(model, context, options);
      return sequenceStream([assistantMessage([{ type: "text", text: facts.join("\n") }])])(model, context, options);
    }
    parentCall += 1;
    const response =
      parentCall === 1
        ? assistantMessage(
            [
              {
                type: "tool_call",
                id: "explore-spawn",
                name: "spawn_agent",
                input: { message: "Find every region_marker under reference-map/.", agent_type: "explore" },
              },
            ],
            "tool_use",
          )
        : parentCall === 2
          ? assistantMessage(
              [{ type: "tool_call", id: "explore-wait", name: "wait", input: { ids: [spawnedThreadId(context)] } }],
              "tool_use",
            )
          : assistantMessage([{ type: "text", text: facts.join("\n") }]);
    return sequenceStream([response])(model, context, options);
  };
  const result = await runRuntimeEvalExecution({
    task: {
      ...autonomousExploreDelegationTask,
      async setup(seed, root) {
        const world = await autonomousExploreDelegationTask.setup(seed, root);
        facts = world.facts;
        return world;
      },
    },
    seed: SEED,
    profile: DEFAULT_PROFILES[0]!,
    streamFunction: stream,
  });
  expect(result.failures, JSON.stringify(result.execution.toolCalls)).toEqual([]);
  return result.execution as Execution;
}

function sourceFile(index: number): string {
  return ["primary.txt", "routing.md", "marker.conf", "entry.txt", "reference.md", "routing.conf"][index]!;
}

function cwdFromContext(context: StreamContext, label: "base" | "runtime_context"): string {
  const content = context.systemPrompt.find((section) => section.label === label)?.content ?? "";
  const match = content.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error(`Missing ${label} cwd in provider context.`);
  return match[1];
}

function spawnedThreadId(context: StreamContext): string {
  const match = JSON.stringify(context.messages).match(/\\"thread_id\\":\\"([^\\"]+)\\"/);
  if (!match?.[1]) throw new Error("Missing spawned child thread id.");
  return match[1];
}

function setFinal(value: Execution, text: string): void {
  const final = value.turns[0]!.messages.at(-1);
  if (!final || final.role !== "assistant") throw new Error("Missing final assistant response.");
  final.content = [{ type: "text", text }];
}
