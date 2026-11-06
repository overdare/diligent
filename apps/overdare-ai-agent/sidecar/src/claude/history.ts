// @summary Project-scoped Claude conversation metadata using the official SDK in an isolated worker.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type ClaudeLaunchOptions, claudeConfigDirectory } from "./launch";

export interface ClaudeConversation {
  id: string;
  title: string;
  updatedAt: number;
}
export const isConversationId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);

export async function listClaudeConversations(options: ClaudeLaunchOptions): Promise<ClaudeConversation[]> {
  const sourceEnv = options.env ?? process.env;
  const worker = resolve(import.meta.dir, "history-worker.ts");
  const args = existsSync(worker) ? [worker, resolve(options.cwd)] : ["claude-sessions", resolve(options.cwd)];
  const env = Object.fromEntries(
    Object.entries(sourceEnv).filter(
      ([key, value]) => value !== undefined && !/^(CLAUDE|ANTHROPIC|OTEL_|SENTRY)/i.test(key),
    ),
  ) as Record<string, string>;
  env.CLAUDE_CONFIG_DIR = claudeConfigDirectory(options);
  env.SENTRY_DSN = "";
  const output = await new Promise<string>((resolveOutput, reject) => {
    execFile(
      process.execPath,
      args,
      { env, windowsHide: true, timeout: 15_000, maxBuffer: 512 * 1024 },
      (error, stdout) =>
        error
          ? reject(new Error("Could not load Claude conversations. Try refreshing the list."))
          : resolveOutput(stdout),
    );
  });
  const records: unknown = JSON.parse(output);
  if (!Array.isArray(records)) throw new Error("Invalid Claude conversation list.");
  return records
    .filter(
      (item) =>
        isConversationId(item.id) &&
        typeof item.title === "string" &&
        Number.isFinite(item.updatedAt) &&
        (!item.cwd || sameDirectory(item.cwd, options.cwd)),
    )
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function sameDirectory(left: string, right: string): boolean {
  const normalize = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
  return normalize(left) === normalize(right);
}
