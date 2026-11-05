// @summary Last-view restoration persists per workspace independently of a browser origin.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioViewState } from "../../src/claude/view-state";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
test("last view survives a host restart and stays scoped to the workspace and storage namespace", async () => {
  const root = await mkdtemp(join(tmpdir(), "overdare-last-view-"));
  temporary.push(root);
  const first = createStudioViewState({
    cwd: join(root, "one"),
    storageRoot: join(root, "dev"),
    webOrigin: "http://127.0.0.1:10001",
  });
  const request = (origin: string, view?: unknown) =>
    new Request(
      `${origin}/studio/view`,
      view === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({ view }),
          },
    );
  expect(await (await first.handle(request("http://127.0.0.1:10001"))).json()).toEqual({ view: "agent" });
  expect((await first.handle(request("http://127.0.0.1:10001", "claude"))).status).toBe(200);
  const reopened = createStudioViewState({
    cwd: join(root, "one"),
    storageRoot: join(root, "dev"),
    webOrigin: "http://127.0.0.1:10002",
  });
  expect(await (await reopened.handle(request("http://127.0.0.1:10002"))).json()).toEqual({ view: "claude" });
  for (const options of [
    { cwd: join(root, "two"), storageRoot: join(root, "dev") },
    { cwd: join(root, "one"), storageRoot: join(root, "prod") },
  ]) {
    const other = createStudioViewState({ ...options, webOrigin: "http://127.0.0.1:10002" });
    expect(await (await other.handle(request("http://127.0.0.1:10002"))).json()).toEqual({ view: "agent" });
  }
  await reopened.handle(request("http://127.0.0.1:10002", "agent"));
  expect(await (await first.handle(request("http://127.0.0.1:10001"))).json()).toEqual({ view: "agent" });
});
test("view endpoint rejects cross-site writes and arbitrary route names", async () => {
  const root = await mkdtemp(join(tmpdir(), "overdare-view-auth-"));
  temporary.push(root);
  const store = createStudioViewState({ cwd: root, storageRoot: root, webOrigin: "http://127.0.0.1:7777" });
  for (const req of [
    new Request("http://evil.test/studio/view"),
    new Request("http://127.0.0.1:7777/studio/view", {
      method: "POST",
      headers: { Origin: "https://evil.test", "Content-Type": "application/json" },
      body: '{"view":"claude"}',
    }),
    new Request("http://127.0.0.1:7777/studio/view", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: '{"view":"claude"}',
    }),
  ])
    expect((await store.handle(req)).status).toBe(403);
  expect(
    (
      await store.handle(
        new Request("http://127.0.0.1:7777/studio/view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"view":"https://evil.test"}',
        }),
      )
    ).status,
  ).toBe(400);
});
