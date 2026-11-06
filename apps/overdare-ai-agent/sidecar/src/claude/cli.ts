// @summary Native terminal entrypoint sharing the embedded host's launch preparation.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createStudioRegistry } from "../studio-registry";
import { isConversationId, listClaudeConversations } from "./history";
import { prepareClaudeLaunch } from "./launch";

export async function runClaudeCli(argv: string[]): Promise<number> {
  if (argv.includes("--help")) {
    console.info(
      "OVERDARE Claude Code\n\nclaude [--studio-id=<id>] [--new | --resume=<id> | --list-sessions]\n\nAutomatically continues the latest conversation for a running Studio. Use --list-sessions to choose an older conversation, --resume=<id> to open it, or --new to start fresh. Shares native login, product skills, and appends Studio instructions. Set OVERDARE_CLAUDE_PROFILE_MODE=isolated for a separate profile.",
    );
    return 0;
  }
  if (
    argv.some(
      (arg) =>
        !arg.startsWith("--studio-id=") && !arg.startsWith("--resume=") && arg !== "--new" && arg !== "--list-sessions",
    ) ||
    argv.filter((arg) => arg.startsWith("--studio-id=")).length > 1 ||
    argv.filter((arg) => arg.startsWith("--resume=") || arg === "--new" || arg === "--list-sessions").length > 1
  )
    throw new Error("Expected claude [--studio-id=<id>] [--new | --resume=<id> | --list-sessions].");
  const id = argv.find((arg) => arg.startsWith("--studio-id="))?.slice("--studio-id=".length);
  const records = await createStudioRegistry().list();
  const record = id ? records.find((item) => item.id === id) : records.length === 1 ? records[0] : undefined;
  if (!record)
    throw new Error(
      `Select a running Studio with --studio-id=<id>.\n${records.map((item) => `${item.id}  ${item.displayName}  ${item.cwd}`).join("\n") || "No Studio is open."}`,
    );
  const options = { cwd: record.cwd, studioId: record.id };
  const conversations = argv.includes("--new") ? [] : await listClaudeConversations(options);
  if (argv.includes("--list-sessions")) {
    for (const item of conversations)
      console.info(`${item.id}\t${new Date(item.updatedAt).toISOString()}\t${item.title}`);
    return 0;
  }
  const resume = argv.find((arg) => arg.startsWith("--resume="))?.slice("--resume=".length);
  if (resume !== undefined && (!isConversationId(resume) || !conversations.some((item) => item.id === resume)))
    throw new Error("Conversation not found in this Studio project.");
  const latest = resume ?? conversations[0]?.id;
  const launch = await prepareClaudeLaunch({
    ...options,
    conversation: { mode: latest ? "resume" : "new", id: latest ?? randomUUID() },
  });
  try {
    const child = spawn(launch.program, launch.args, { cwd: launch.cwd, env: launch.env, stdio: "inherit" });
    const stop = () => child.kill();
    process.once("SIGTERM", stop);
    try {
      return await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
    } finally {
      process.removeListener("SIGTERM", stop);
    }
  } finally {
    await launch.cleanup();
  }
}
