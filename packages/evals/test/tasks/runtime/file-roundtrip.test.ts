// @summary Construct-validity regressions for seeded evidence-based file-roundtrip selection

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamContext } from "@diligent/core/provider-contract";
import { DEFAULT_PROFILES } from "../../../src/profiles";
import { runRuntimeEvalExecution } from "../../../src/runner/runtime-execution";
import { removeTemporaryRoot } from "../../../src/runner/runtime-workspace";
import type { RuntimeEvalExecution } from "../../../src/runtime-task";
import type { EvalProfile } from "../../../src/task";
import { type FileRoundtripWorld, fileRoundtripTask } from "../../../src/tasks/runtime/file-roundtrip";
import { writeFixture } from "../../../src/tasks/runtime/helpers";
import { assistantMessage, sequenceStream } from "../../helpers/fake-stream";

describe("file-roundtrip", () => {
  test("uses a representation-independent semantic verifier for the selected record", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-eval-file-selection-verifier-"));
    try {
      const world = await fileRoundtripTask.setup("shared-seed-123", root);
      const selected = world.records.find((record) => record.path === world.selectedPath)!;
      await writeFixture(root, {
        [world.selectedPath]: `${JSON.stringify({ status: world.pendingStatus, owner: selected.owner, record: selected.id })}\n`,
      });
      expect(await fileRoundtripTask.verify!(world, new AbortController().signal)).toMatchObject({
        argv: ["verify-selected-record", world.selectedPath],
        exitCode: 0,
        timedOut: false,
      });

      await writeFixture(root, {
        [world.selectedPath]: `${JSON.stringify({
          status: world.pendingStatus,
          owner: selected.owner,
          record: selected.id,
          extra: true,
        })}\n`,
      });
      expect((await fileRoundtripTask.verify!(world, new AbortController().signal)).exitCode).toBe(1);
    } finally {
      await removeTemporaryRoot(root);
    }
  });

  test("makes the seeded index decision and exact semantic update for both providers", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile);
      expect(fileRoundtripTask.evaluate(execution)).toEqual({ passed: true });
    }
  });

  test("notes bounded failed reads instead of failing a correct grounded update", async () => {
    for (const profile of DEFAULT_PROFILES) {
      const execution = await assembledExecution(profile, { relativeIndexRecovery: true, extraSafeRead: true });
      const result = fileRoundtripTask.evaluate(execution);
      expect(result.passed).toBe(true);
      expect(diagnosticCodes(result)).toContain("file_roundtrip.failed_call");
    }

    const directoryProbe = await assembledExecution(DEFAULT_PROFILES[1]!, { recordsDirectoryRecovery: true });
    const repeated = structuredClone(directoryProbe);
    const duplicate = structuredClone(repeated.toolCalls[1]!);
    duplicate.toolCallId = "second-failed-read";
    duplicate.input = { file_path: "$WORKSPACE/private" };
    repeated.toolCalls.splice(2, 0, duplicate);
    repeated.toolCalls.forEach((call, index) => {
      call.sequence = index + 1;
    });
    const probe = structuredClone(repeated.toolCalls[0]!);
    probe.toolCallId = "missing-root-instructions";
    probe.input = { file_path: "$WORKSPACE/AGENTS.md" };
    probe.outcome = "runtime_error";
    probe.output = { output: "Error: File not found", metadata: { error: true } };
    repeated.toolCalls.unshift(probe);
    repeated.toolCalls.forEach((call, index) => {
      call.sequence = index + 1;
    });
    const result = fileRoundtripTask.evaluate(repeated);
    expect(result.passed).toBe(true);
    expect(diagnosticCodes(result)).toContain("file_roundtrip.failed_call");
  });

  test("accepts relative paths, an alternative write tool, and a verification read", async () => {
    const execution = await assembledExecution(DEFAULT_PROFILES[1]!);
    const world = execution.world;
    for (const call of execution.toolCalls) {
      const input = call.input as Record<string, unknown>;
      if (typeof input.file_path === "string") input.file_path = input.file_path.replace("$WORKSPACE/", "");
    }
    const write = execution.toolCalls.find((call) => call.capability === "write")!;
    write.name = "write";
    write.input = { file_path: world.selectedPath, content: "{}" };
    const verification = structuredClone(execution.toolCalls.find((call) => call.capability === "read")!);
    verification.toolCallId = "verification-read";
    verification.sequence = execution.toolCalls.length + 1;
    verification.input = { file_path: world.selectedPath };
    execution.toolCalls.push(verification);
    execution.turns[0]!.messages.push(assistantMessageText(`\`${world.expected}\``));

    const result = fileRoundtripTask.evaluate(execution);
    expect(result.passed).toBe(true);
    expect(diagnosticCodes(result)).toContain("file_roundtrip.verification_read");
  });

  test("rejects wrong target, wrong content, decoy mutation, ungrounded update, and wrong answer", async () => {
    const baseline = await assembledExecution(DEFAULT_PROFILES[0]!);
    const world = baseline.world;
    const decoy = world.records.find((record) => record.path !== world.selectedPath)!;

    const wrongTarget = structuredClone(baseline);
    const write = wrongTarget.toolCalls.find((call) => call.capability === "write")!;
    write.input = rewriteWriteTarget(write.input, world.selectedPath, decoy.path);
    expect(fileRoundtripTask.evaluate(wrongTarget)).toMatchObject({
      passed: false,
      code: "file_roundtrip.mutation",
      dimension: "runtime_policy",
    });

    const wrongIntermediateWrite = structuredClone(baseline);
    const successfulWrite = wrongIntermediateWrite.toolCalls.find((call) => call.capability === "write")!;
    const inserted = structuredClone(successfulWrite);
    inserted.toolCallId = "wrong-intermediate-write";
    inserted.input = rewriteWriteTarget(inserted.input, world.selectedPath, decoy.path);
    wrongIntermediateWrite.toolCalls.splice(successfulWrite.sequence - 1, 0, inserted);
    wrongIntermediateWrite.toolCalls.forEach((call, index) => {
      call.sequence = index + 1;
    });
    expect(fileRoundtripTask.evaluate(wrongIntermediateWrite)).toMatchObject({
      passed: false,
      code: "file_roundtrip.mutation",
    });

    const wrongContent = structuredClone(baseline);
    wrongContent.verifier!.exitCode = 1;
    expect(fileRoundtripTask.evaluate(wrongContent)).toMatchObject({
      passed: false,
      code: "file_roundtrip.semantic_result",
      dimension: "semantic_goal",
    });

    const extraMutation = structuredClone(baseline);
    extraMutation.workspace.final.entries.find((entry) => entry.path === decoy.path)!.sha256 = "mutated-decoy";
    expect(fileRoundtripTask.evaluate(extraMutation)).toMatchObject({
      passed: false,
      code: "file_roundtrip.isolation",
    });

    const ungrounded = structuredClone(baseline);
    for (const call of ungrounded.toolCalls) {
      if (call.capability === "read") call.output = { output: "redacted" };
    }
    expect(fileRoundtripTask.evaluate(ungrounded)).toMatchObject({
      passed: false,
      code: "file_roundtrip.grounding",
      dimension: "behavior",
    });

    const wrongAnswer = structuredClone(baseline);
    wrongAnswer.turns[0]!.messages.push(assistantMessageText(`UPDATED=${decoy.id}`));
    expect(fileRoundtripTask.evaluate(wrongAnswer)).toMatchObject({
      passed: false,
      code: "file_roundtrip.answer",
      dimension: "semantic_goal",
    });

    const chattyAnswer = structuredClone(baseline);
    chattyAnswer.turns[0]!.messages.push(assistantMessageText(`Done: ${world.expected}`));
    expect(fileRoundtripTask.evaluate(chattyAnswer)).toMatchObject({
      passed: false,
      code: "file_roundtrip.answer",
      dimension: "format_contract",
    });
  });
});

async function assembledExecution(
  profile: EvalProfile,
  scenario: { relativeIndexRecovery?: boolean; recordsDirectoryRecovery?: boolean; extraSafeRead?: boolean } = {},
): Promise<RuntimeEvalExecution<FileRoundtripWorld>> {
  const seed = "shared-seed-123";
  let providerCall = 0;
  let activeId = "";
  let pendingStatus = "";
  let initialStatus = "";
  const result = await runRuntimeEvalExecution({
    task: fileRoundtripTask,
    profile,
    seed,
    streamFunction(_model, context, options) {
      const cwd = cwdFromContext(context);
      const call = providerCall++;
      const recoveryOffset = scenario.relativeIndexRecovery || scenario.recordsDirectoryRecovery ? 1 : 0;
      if (call === recoveryOffset + 1) {
        const evidence = JSON.stringify(context.messages).replaceAll("\\", "");
        activeId = requiredMatch(evidence, /"active_record"\s*:\s*"([^"]+)"/);
        pendingStatus = requiredMatch(evidence, /"pending_status"\s*:\s*"([^"]+)"/);
      }
      if (call === recoveryOffset + 2) {
        const evidence = JSON.stringify(context.messages).replaceAll("\\", "");
        initialStatus = requiredMatch(evidence, /"status"\s*:\s*"([^"]+)"/);
      }
      const writeCall = recoveryOffset + 2 + Number(scenario.extraSafeRead === true);
      const response =
        call === 0 && scenario.relativeIndexRecovery
          ? toolCall("file-index-relative", "read", { file_path: "records/index.json" })
          : call === 0 && scenario.recordsDirectoryRecovery
            ? toolCall("file-index", "read", { file_path: join(cwd, "records/index.json") })
            : call === 1 && scenario.recordsDirectoryRecovery
              ? toolCall("file-records-directory", "read", { file_path: join(cwd, "records") })
              : call === recoveryOffset
                ? toolCall("file-index", "read", { file_path: join(cwd, "records/index.json") })
                : call === recoveryOffset + 1
                  ? toolCall("file-target", "read", { file_path: join(cwd, `records/${activeId}.json`) })
                  : scenario.extraSafeRead && call === recoveryOffset + 2
                    ? toolCall("file-decoy", "read", {
                        file_path: join(
                          cwd,
                          `records/${activeId === "record-amber" ? "record-cobalt" : "record-amber"}.json`,
                        ),
                      })
                    : call === writeCall
                      ? profile.provider === "anthropic"
                        ? toolCall("file-write", "edit", {
                            file_path: join(cwd, `records/${activeId}.json`),
                            old_string: `  "status": "${initialStatus}"`,
                            new_string: `  "status": "${pendingStatus}"`,
                            replace_all: false,
                          })
                        : toolCall("file-write", "apply_patch", {
                            patch:
                              `*** Begin Patch\n*** Update File: records/${activeId}.json\n@@\n` +
                              `-  "status": "${initialStatus}"\n+  "status": "${pendingStatus}"\n*** End Patch`,
                          })
                      : assistantMessage([{ type: "text", text: `UPDATED=${activeId}` }]);
      return sequenceStream([response])(_model, context, options);
    },
  });
  expect(
    result.failures,
    JSON.stringify({ failures: result.failures, events: result.execution.turns[0]?.coreEvents }),
  ).toEqual([]);
  expect(result.passed).toBe(true);
  return result.execution as RuntimeEvalExecution<FileRoundtripWorld>;
}

function assistantMessageText(text: string) {
  return assistantMessage([{ type: "text", text }]);
}

function diagnosticCodes(result: { diagnostics?: readonly { code: string }[] }): string[] {
  return result.diagnostics?.map((diagnostic) => diagnostic.code) ?? [];
}

function toolCall(id: string, name: string, input: Record<string, unknown>) {
  return assistantMessage([{ type: "tool_call", id, name, input }], "tool_use");
}

function cwdFromContext(context: StreamContext): string {
  const base = context.systemPrompt.find((section) => section.label === "base")?.content ?? "";
  const match = base.match(/^Current working directory: (.+)$/m);
  if (!match?.[1]) throw new Error("Missing runtime cwd in provider context.");
  return match[1];
}

function requiredMatch(value: string, pattern: RegExp): string {
  const match = value.match(pattern)?.[1];
  if (!match) throw new Error(`Missing fixture evidence for ${pattern}.`);
  return match;
}

function rewriteWriteTarget(input: unknown, from: string, to: string): unknown {
  if (typeof input !== "object" || input === null) return input;
  const changed = structuredClone(input) as Record<string, unknown>;
  if (typeof changed.file_path === "string") changed.file_path = changed.file_path.replace(from, to);
  if (typeof changed.patch === "string") changed.patch = changed.patch.replace(from, to);
  return changed;
}
