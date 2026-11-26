// @summary Markdown memory directory: one frontmatter file per memory plus the MEMORY.md index
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { parseYamlFrontmatter } from "../frontmatter/yaml";
import { MemoryTypeSchema } from "../protocol/index";
import type { MemoryEntry } from "./types";

/**
 * The directory layout matches Claude Code auto memory, so agents of either harness pointed at the
 * same directory share one memory: `MEMORY.md` lists `- [title](<id>.md) — description` lines and each
 * `<id>.md` carries `name`, `description`, and `metadata.type` frontmatter above a Markdown body.
 * Claude Code rewrites `name` into a lowercase ASCII slug, so the frontmatter `name` holds the id and an
 * entry's title lives only in its index link text.
 */
export const MEMORY_INDEX_FILENAME = "MEMORY.md";
/** `- [title](<id>.md)` index lines; a title escapes "[", "]", and "\" with a backslash. */
const INDEX_LINK_PATTERN = /^\s*[-*]\s*\[((?:\\.|[^\]\\])*)\]\((?:\.\/)?([^)\s]+)\.md\)/gm;

const MEMORY_INDEX_HEADER = "# Memory Index";
const MEMORY_FILE_EXTENSION = ".md";
const MEMORY_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u;
const MAX_GENERATED_ID_LENGTH = 48;
const MAX_DESCRIPTION_LENGTH = 150;

export interface MemoryFile {
  /** Parsed entry; absent when the file has no valid frontmatter type. */
  entry?: MemoryEntry;
  /** Raw frontmatter, kept so fields written by other tools survive a rewrite. */
  frontmatter: Record<string, unknown>;
}

const writeQueues = new Map<string, Promise<unknown>>();

/** Ids are file stems: a letter or digit, then letters, digits, ".", "_", or "-"; never the index name. */
export function isMemoryId(id: string): boolean {
  return MEMORY_ID_PATTERN.test(id) && id.toLowerCase() !== MEMORY_INDEX_FILENAME.slice(0, -3).toLowerCase();
}

/** Ids of every memory file in the directory, readable or not. */
export async function listMemoryFileIds(memoryPath: string): Promise<string[]> {
  const names = await readdir(memoryPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  return names
    .filter((name) => name.endsWith(MEMORY_FILE_EXTENSION))
    .map((name) => name.slice(0, -MEMORY_FILE_EXTENSION.length))
    .filter(isMemoryId);
}

/** Read one memory file, or undefined when it does not exist. */
export async function readMemoryFile(memoryPath: string, id: string): Promise<MemoryFile | undefined> {
  const path = memoryFilePath(memoryPath, id);
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info?.isFile()) return undefined;
  return parseMemoryFile(id, await Bun.file(path).text(), path, info.mtime);
}

/** Read every valid memory entry, most recently modified first. Files without valid frontmatter are skipped. */
export async function readMemory(memoryPath: string): Promise<MemoryEntry[]> {
  const [files, titles] = await Promise.all([
    listMemoryFileIds(memoryPath).then((ids) => Promise.all(ids.map((id) => readMemoryFile(memoryPath, id)))),
    readMemoryIndex(memoryPath).then(readIndexTitles),
  ]);
  return files
    .flatMap((file) => (file?.entry ? [{ ...file.entry, name: titles.get(file.entry.id) ?? file.entry.name }] : []))
    .sort((left, right) => right.modified.localeCompare(left.modified) || left.id.localeCompare(right.id));
}

/** Entry titles by id, taken from the index link text; the first non-empty link to an id wins. */
export function readIndexTitles(index: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const match of index.matchAll(INDEX_LINK_PATTERN)) {
    const title = match[1].replace(/\\(.)/g, "$1").trim();
    if (title && !titles.has(match[2])) titles.set(match[2], title);
  }
  return titles;
}

/** Read the MEMORY.md index text, or "" when it does not exist. */
export async function readMemoryIndex(memoryPath: string): Promise<string> {
  const file = Bun.file(join(memoryPath, MEMORY_INDEX_FILENAME));
  return (await file.exists()) ? file.text() : "";
}

export async function writeMemoryIndex(memoryPath: string, index: string): Promise<void> {
  await writeAtomic(join(memoryPath, MEMORY_INDEX_FILENAME), index);
}

/** Write a memory file, keeping unrelated frontmatter fields from `previous`. */
export async function writeMemoryFile(
  memoryPath: string,
  entry: MemoryEntry,
  previous: Record<string, unknown>,
): Promise<void> {
  const rest = { ...previous };
  delete rest.name;
  delete rest.description;
  delete rest.metadata;
  const frontmatter = {
    name: entry.id,
    description: entry.description,
    ...rest,
    metadata: {
      ...(isRecord(previous.metadata) ? previous.metadata : {}),
      type: entry.type,
      modified: entry.modified,
      ...(entry.sessionId ? { originSessionId: entry.sessionId } : {}),
    },
  };
  const text = `---\n${stringifyYaml(frontmatter, { lineWidth: 0 })}---\n\n${entry.content}\n`;
  await writeAtomic(memoryFilePath(memoryPath, entry.id), text);
}

/** Remove a memory file. Returns whether it existed. */
export async function removeMemoryFile(memoryPath: string, id: string): Promise<boolean> {
  const path = memoryFilePath(memoryPath, id);
  if (!(await Bun.file(path).exists())) return false;
  await rm(path, { force: true });
  return true;
}

/** Run a mutation of one memory directory; mutations of the same directory run one at a time in this process. */
export function withMemoryLock<T>(memoryPath: string, run: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(memoryPath) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.catch(() => undefined);
  writeQueues.set(memoryPath, settled);
  void settled.then(() => {
    if (writeQueues.get(memoryPath) === settled) writeQueues.delete(memoryPath);
  });
  return next;
}

export function formatIndexLine(entry: Pick<MemoryEntry, "id" | "name" | "description">): string {
  const title = entry.name.replace(/[[\]\\]/g, (char) => `\\${char}`);
  const description = entry.description.replace(/\s+/g, " ").trim();
  return `- [${title}](${entry.id}${MEMORY_FILE_EXTENSION})${description ? ` — ${description}` : ""}`;
}

/** Replace the index line linking to `id`, or append one. Other lines, including other tools' edits, are kept. */
export function upsertIndexLine(index: string, id: string, line: string): string {
  const pattern = indexLinkPattern(id);
  const lines = index.trim() ? index.replace(/\n+$/, "").split("\n") : [MEMORY_INDEX_HEADER, ""];
  let replaced = false;
  const next = lines.flatMap((current) => {
    if (!pattern.test(current)) return [current];
    if (replaced) return [];
    replaced = true;
    return [line];
  });
  if (!replaced) next.push(line);
  return `${next.join("\n")}\n`;
}

/** Remove every index line linking to `id`. */
export function removeIndexLines(index: string, id: string): string {
  const pattern = indexLinkPattern(id);
  const lines = index.split("\n");
  const next = lines.filter((line) => !pattern.test(line));
  return next.length === lines.length ? index : next.join("\n");
}

/** A one-line summary of memory content for its description. */
export function summarizeMemoryContent(content: string): string {
  const firstLine =
    content
      .split("\n")
      .map((line) => line.replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/, "").trim())
      .find(Boolean) ?? "";
  const line = firstLine.replace(/\s+/g, " ").trim();
  return line.length > MAX_DESCRIPTION_LENGTH ? `${line.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…` : line;
}

/** Derive an unused id from `base`. `taken` holds lowercased ids, since file names may be case-insensitive. */
export function allocateMemoryId(base: string, taken: ReadonlySet<string>): string {
  const slug =
    base
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+/, "")
      .slice(0, MAX_GENERATED_ID_LENGTH)
      .replace(/-+$/, "") || "memory";
  const stem = isMemoryId(slug) ? slug : `memory-${slug}`;
  if (!taken.has(stem)) return stem;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${stem}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function parseMemoryFile(id: string, text: string, path: string, mtime: Date): MemoryFile {
  const parsed = parseYamlFrontmatter(text, path);
  if ("error" in parsed) return { frontmatter: {} };
  const { frontmatter, body } = parsed;
  const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : {};
  const type = MemoryTypeSchema.safeParse(metadata.type ?? frontmatter.type);
  if (!type.success) return { frontmatter };
  const sessionId = asString(metadata.originSessionId);
  return {
    frontmatter,
    entry: {
      id,
      name: asString(frontmatter.name) ?? id,
      description: asString(frontmatter.description) ?? "",
      type: type.data,
      content: body.trim(),
      modified: asTimestamp(metadata.modified ?? frontmatter.modified) ?? mtime.toISOString(),
      ...(sessionId ? { sessionId } : {}),
    },
  };
}

// biome-ignore lint/plugin/no-tiny-function: read, write, and delete must resolve the same file layout
function memoryFilePath(memoryPath: string, id: string): string {
  return join(memoryPath, `${id}${MEMORY_FILE_EXTENSION}`);
}

function indexLinkPattern(id: string): RegExp {
  const escaped = `${id}${MEMORY_FILE_EXTENSION}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\]\\((?:\\./)?${escaped}\\)`);
}

// biome-ignore lint/plugin/no-tiny-function: three frontmatter fields share one coercion rule
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asTimestamp(value: unknown): string | undefined {
  let time: number;
  if (value instanceof Date) {
    time = value.getTime();
  } else {
    time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  }
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await Bun.write(tempPath, text);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
