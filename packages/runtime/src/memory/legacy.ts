// @summary Moves a pre-rename knowledge store into the memory directory
import { mkdir, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { MEMORY_FILENAME } from "./store";

const LEGACY_DIR = "knowledge";
const LEGACY_FILENAME = "knowledge.jsonl";

/**
 * Move `<root>/knowledge/knowledge.jsonl` to the memory store. An existing memory store is never overwritten;
 * the legacy store is then left in place for the user.
 */
export async function migrateLegacyKnowledgeStore(root: string, memoryPath: string): Promise<void> {
  const legacyDir = join(root, LEGACY_DIR);
  const legacyPath = join(legacyDir, LEGACY_FILENAME);
  if (!(await Bun.file(legacyPath).exists())) return;
  const memoryFile = join(memoryPath, MEMORY_FILENAME);
  if (await Bun.file(memoryFile).exists()) return;
  await mkdir(memoryPath, { recursive: true });
  // A concurrent startup may have moved the store first.
  await rename(legacyPath, memoryFile).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  // A legacy directory that still holds other files is left for the user.
  await rmdir(legacyDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
  });
}
