// @summary Read-only official Claude session metadata worker; never runs an agent or inference.
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

export async function runClaudeHistoryWorker(cwd: string): Promise<void> {
  if (!cwd) throw new Error("A project directory is required.");
  const sessions = await listSessions({ dir: cwd, includeWorktrees: false, includeProgrammatic: false, limit: 200 });
  console.info(
    JSON.stringify(
      sessions.map((item) => ({
        id: item.sessionId,
        title: (item.customTitle || item.summary || item.firstPrompt || "Untitled conversation").slice(0, 240),
        updatedAt: item.lastModified,
        cwd: item.cwd,
      })),
    ),
  );
}

if (import.meta.main) await runClaudeHistoryWorker(process.argv[2] ?? "");
