// @summary Runtime eval for a seeded index-grounded semantic update among decoy records

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeEvalTask, RuntimeVerifierResult } from "../../runtime-task";
import { isRecord } from "../core/helpers";
import {
  finalAssistantText,
  RuntimeGrade,
  successfulReadsOf,
  successfulWritesTo,
  tracePaths,
  unwrapReply,
} from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  writeFixture,
} from "./helpers";

const INDEX_PATH = "records/index.json";
const RECORD_IDS = ["record-amber", "record-cobalt", "record-jade"] as const;

export interface FileRoundtripRecord {
  id: string;
  path: string;
  owner: string;
  initialStatus: string;
  content: string;
  hash: string;
}

export interface FileRoundtripWorld extends RuntimeFixtureWorld {
  indexPath: string;
  indexContent: string;
  indexHash: string;
  recordPaths: string[];
  records: FileRoundtripRecord[];
  selectedRecordId: string;
  selectedPath: string;
  pendingStatus: string;
  clientPrompt: string;
}

export const fileRoundtripTask: RuntimeEvalTask<FileRoundtripWorld> = {
  id: "file-roundtrip",
  description: "Use a seeded index to select and semantically update exactly one record among decoys.",
  fixtureVersion: "file-roundtrip-v1",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 6,
    maxToolCalls: 5,
    maxChangedFiles: 1,
    maxChangedBytes: 1_024,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "apply_patch", "edit"],
    allowedCapabilities: ["read", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const fixture = fixtureFor(seed);
    await writeFixture(root, {
      [fixture.indexPath]: fixture.indexContent,
      ...Object.fromEntries(fixture.records.map((record) => [record.path, record.content])),
    });
    return {
      root,
      seed,
      expected: `UPDATED=${fixture.selectedRecordId}`,
      protectedPaths: [
        fixture.indexPath,
        ...fixture.records.filter((record) => record.path !== fixture.selectedPath).map((record) => record.path),
      ],
      allowedChanges: [fixture.selectedPath],
      ...fixture,
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [{ kind: "turn", mode: "default", message: world.clientPrompt }],
  verify: verifySelectedRecord,
  snapshotWorld: async (world) => ({
    selected: await exactFile(world.root, world.selectedPath),
    protected: await Promise.all(
      world.protectedPaths.map(async (path) => ({ path, content: await exactFile(world.root, path) })),
    ),
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("file_roundtrip");
    const world = input.world;
    if (input.verifier?.timedOut)
      return grade.fail(
        "verifier_timeout",
        "The deterministic selected-record verifier timed out.",
        "harness_terminal",
      );
    const successfulWrites = input.toolCalls.filter(
      (call) => call.capability === "write" && call.outcome === "success",
    );
    if (successfulWrites.some((call) => tracePaths(call, input.threadCwd).some((path) => path !== world.selectedPath)))
      return grade.fail(
        "mutation",
        "A successful mutation targeted a file other than the index-selected record.",
        "runtime_policy",
      );
    for (const path of world.protectedPaths) {
      const initial = input.workspace.initial.entries.find((entry) => entry.path === path);
      const final = input.workspace.final.entries.find((entry) => entry.path === path);
      if (JSON.stringify(initial) !== JSON.stringify(final))
        return grade.fail(
          "isolation",
          "An index or decoy record changed outside the selected mutation boundary.",
          "runtime_policy",
        );
    }
    const selected = input.workspace.final.entries.find((entry) => entry.path === world.selectedPath);
    if (selected?.kind !== "file" || input.verifier?.exitCode !== 0)
      return grade.fail("semantic_result", "The deterministic selected-record verifier did not pass.", "semantic_goal");

    const selectedWrites = successfulWritesTo(input, world.selectedPath);
    const finalWrite = selectedWrites.at(-1);
    const groundingRead = input.toolCalls.find(
      (call) =>
        call.capability === "read" &&
        call.outcome === "success" &&
        outputContains(call.output, world.selectedRecordId, world.pendingStatus),
    );
    if (!groundingRead || (finalWrite && groundingRead.sequence > finalWrite.sequence))
      return grade.fail(
        "grounding",
        "The record update was not preceded by a successful read exposing the index selection and pending status.",
        "behavior",
      );

    const answer = finalAssistantText(input);
    if (!answer.includes(world.expected))
      return grade.fail("answer", "The final answer did not identify the index-selected record.", "semantic_goal");
    if (unwrapReply(answer) !== world.expected)
      return grade.fail("answer", `The final answer must be exactly ${world.expected}.`, "format_contract");

    const firstWrite = selectedWrites[0];
    if (firstWrite && groundingRead.sequence > firstWrite.sequence)
      grade.note("ungrounded_first_write", "The record was first written before the index evidence was read.");
    if (successfulReadsOf(input, world.selectedPath).length === 0)
      grade.note("target_not_read", "The selected record was updated without reading it first.", { impact: "info" });
    if (selectedWrites.length > 1)
      grade.note("repeated_write", `The selected record was written ${selectedWrites.length} times.`);
    const fixturePaths = new Set([world.indexPath, ...world.recordPaths, "records"]);
    if (
      input.toolCalls.some(
        (call) =>
          call.capability === "read" &&
          call.outcome === "success" &&
          tracePaths(call, input.threadCwd).some((path) => !fixturePaths.has(path)),
      )
    )
      grade.note("read_outside_fixture", "A successful read addressed a path outside the index and records.", {
        impact: "info",
      });
    if (finalWrite && input.toolCalls.some((call) => call.capability === "read" && call.sequence > finalWrite.sequence))
      grade.note("verification_read", "The model read files after its final write.", { impact: "info" });
    const failed = input.toolCalls.filter((call) => call.outcome !== "success");
    if (failed.length > 0)
      grade.note("failed_call", `Observed ${failed.length} failed or rejected tool call(s) before completion.`);
    if (
      input.childSessions.length !== 0 ||
      input.compactions.length !== 0 ||
      input.protocolActions.length !== 0 ||
      input.userInputRequests.length !== 0
    )
      grade.note(
        "unexpected_runtime_activity",
        "Child, compaction, protocol action, or user-input evidence appeared.",
        {
          impact: "info",
        },
      );
    return grade.pass();
  },
};

function fixtureFor(seed: string) {
  const selectedIndex = Number.parseInt(sha256Text(seed).slice(0, 8), 16) % RECORD_IDS.length;
  const selectedRecordId = RECORD_IDS[selectedIndex]!;
  const pendingStatus = seededToken(seed, "PENDING_STATUS");
  const records = RECORD_IDS.map((id, index) => {
    const record = {
      record: id,
      owner: seededToken(seed, `OWNER_${index}`),
      status: seededToken(seed, `INITIAL_STATUS_${index}`),
    };
    const content = `${JSON.stringify(record, null, 2)}\n`;
    return {
      id,
      path: `records/${id}.json`,
      owner: record.owner,
      initialStatus: record.status,
      content,
      hash: sha256Text(content),
    };
  });
  const indexContent = `${JSON.stringify({ active_record: selectedRecordId, pending_status: pendingStatus }, null, 2)}\n`;
  return {
    indexPath: INDEX_PATH,
    indexContent,
    indexHash: sha256Text(indexContent),
    recordPaths: records.map((record) => record.path),
    records,
    selectedRecordId,
    selectedPath: `records/${selectedRecordId}.json`,
    pendingStatus,
    clientPrompt:
      "Review records/index.json to determine which record is active and which pending status applies. Update only the referenced record so its status matches the pending status while preserving its record and owner fields. Leave every other file unchanged. Reply with only UPDATED=<active record id>.",
  };
}

async function verifySelectedRecord(world: FileRoundtripWorld): Promise<RuntimeVerifierResult> {
  const started = performance.now();
  let valid = true;
  let stderr = "";
  try {
    const selected = world.records.find((record) => record.path === world.selectedPath);
    if (!selected) throw new Error("Selected record fixture is missing.");
    const parsed: unknown = JSON.parse(await readFile(join(world.root, world.selectedPath), "utf8"));
    valid = isExactRecord(parsed, selected.id, selected.owner, world.pendingStatus);
    for (const path of world.protectedPaths) {
      const expected =
        path === world.indexPath ? world.indexContent : world.records.find((record) => record.path === path)?.content;
      if (expected === undefined || (await readFile(join(world.root, path), "utf8")) !== expected) {
        valid = false;
      }
    }
    if (!valid) stderr = "Selected semantics or protected fixture bytes diverged.";
  } catch (error) {
    valid = false;
    stderr = error instanceof Error ? error.message : String(error);
  }
  return {
    argv: ["verify-selected-record", world.selectedPath],
    exitCode: valid ? 0 : 1,
    elapsedMs: Math.round(performance.now() - started),
    stdout: valid ? "selected record semantics matched" : "",
    stderr,
    timedOut: false,
  };
}

function outputContains(output: unknown, ...values: string[]): boolean {
  const text = JSON.stringify(output);
  return values.every((value) => text.includes(value));
}

function isExactRecord(value: unknown, id: string, owner: string, status: string): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join(",") === "owner,record,status" &&
    value.record === id &&
    value.owner === owner &&
    value.status === status
  );
}
