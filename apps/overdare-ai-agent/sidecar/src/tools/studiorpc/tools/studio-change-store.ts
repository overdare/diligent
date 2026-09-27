// @summary Durably stores complete Studio change batches for filtered, paginated follow-up reads.

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "@diligent/runtime";
import type { EditLogEnvelope } from "./edit-log";

interface StoredBatch {
  schemaVersion: 1;
  envelopes: EditLogEnvelope[];
  parseFailures: number;
}

function directory(cwd: string): string {
  return join(resolvePaths(cwd).root, "logs", "studio-changes");
}

export function studioChangeArchivePath(cwd: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid Studio change batch ID");
  return join(directory(cwd), `${id}.json`);
}

export function storeStudioChangeBatch(cwd: string, envelopes: EditLogEnvelope[], parseFailures: number) {
  const id = randomUUID();
  const path = studioChangeArchivePath(cwd, id);
  mkdirSync(directory(cwd), { recursive: true });
  const batch: StoredBatch = { schemaVersion: 1, envelopes, parseFailures };
  const temporary = `${path}.tmp`;
  // Flush before rename: rotated inputs may be deleted only after this succeeds.
  writeFileSync(temporary, JSON.stringify(batch), { encoding: "utf8", flush: true });
  renameSync(temporary, path);
  return { id, path };
}

export function readStudioChangeBatch(cwd: string, id: string): StoredBatch {
  const batch = JSON.parse(readFileSync(studioChangeArchivePath(cwd, id), "utf8")) as StoredBatch;
  if (batch.schemaVersion !== 1 || !Array.isArray(batch.envelopes)) throw new Error("Invalid Studio change archive");
  return batch;
}

export function latestStudioChangeBatch(cwd: string): string | undefined {
  let files: string[];
  try {
    files = readdirSync(directory(cwd));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return files
    .filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))
    .sort((a, b) => statSync(join(directory(cwd), b)).mtimeMs - statSync(join(directory(cwd), a)).mtimeMs)[0]
    ?.slice(0, -5);
}
