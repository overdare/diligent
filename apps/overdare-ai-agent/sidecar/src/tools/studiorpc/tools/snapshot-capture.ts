// @summary Flushes Studio and captures only a confirmed, current level checkpoint.
import type { TextGenerationFn } from "@diligent/runtime";
import type { call } from "../rpc";
import { isRecord } from "./ovdrjm-utils";
import {
  type CaptureOptions,
  captureSnapshot,
  findSnapshotById,
  nextRequestIndex,
  pruneSnapshots,
  snapshotsDir,
} from "./snapshot";
import { summarizeSnapshot } from "./snapshot-summary";
import { checkResult } from "./v2/result";

export async function saveLevelForSnapshot(callRpc: typeof call, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const result = await callRpc("level.save.file", {}, { signal });
  checkResult("level.save.file", result);
  if (!isRecord(result) || result.success !== true) {
    throw new Error("level.save.file did not confirm success.");
  }
  signal?.throwIfAborted();
}

/** Caller holds the Studio write lock throughout save and copy. */
export async function captureSavedSnapshot(
  cwd: string,
  sessionId: string,
  callRpc: typeof call,
  options: CaptureOptions,
  signal?: AbortSignal,
  generateText?: TextGenerationFn,
) {
  await saveLevelForSnapshot(callRpc, signal);
  const index = nextRequestIndex(snapshotsDir(cwd), sessionId);
  captureSnapshot(cwd, sessionId, index, { ...options, summaryStatus: generateText ? "pending" : "unavailable" });
  pruneSnapshots(cwd, sessionId);
  const snapshot = findSnapshotById(cwd, `${sessionId}_${index}`);
  if (generateText) void summarizeSnapshot(snapshot, generateText);
  return snapshot;
}
