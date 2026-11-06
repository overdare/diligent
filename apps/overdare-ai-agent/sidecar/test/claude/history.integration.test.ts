// @summary Official SDK metadata worker respects the selected profile and exact Studio project.
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listClaudeConversations } from "../../src/claude/history";

test("session discovery reads only the project's selected profile and ignores subagents", async () => {
  const root = await mkdtemp(join(tmpdir(), "overdare-history-"));
  try {
    const world = join(root, "world");
    await mkdir(world);
    const profile = join(root, "native-profile");
    const writeSession = async (cwd: string, id: string, title: string, sidechain = false) => {
      const directory = join(profile, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, `${id}.jsonl`),
        `${[
          JSON.stringify({
            type: "user",
            uuid: randomUUID(),
            parentUuid: null,
            sessionId: id,
            cwd,
            timestamp: new Date().toISOString(),
            isSidechain: sidechain,
            message: { role: "user", content: title },
          }),
          JSON.stringify({ type: "custom-title", sessionId: id, customTitle: title }),
        ].join("\n")}\n`,
      );
    };
    const own = randomUUID();
    await writeSession(world, own, "Own conversation");
    await writeSession(join(root, "other"), randomUUID(), "Other project");
    await writeSession(world, randomUUID(), "Subagent", true);
    const options = {
      cwd: world,
      studioId: "owner",
      storageRoot: join(root, "product"),
      env: { ...process.env, CLAUDE_CONFIG_DIR: profile },
    };
    expect((await listClaudeConversations(options)).map((item) => [item.id, item.title])).toEqual([
      [own, "Own conversation"],
    ]);
    expect(await listClaudeConversations({ ...options, profileMode: "isolated" })).toEqual([]);
    expect(process.env.CLAUDE_CONFIG_DIR).not.toBe(profile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
