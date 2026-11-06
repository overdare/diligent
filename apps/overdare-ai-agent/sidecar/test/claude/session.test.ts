// @summary Tests terminal lifecycle, lossless Unicode input and serialized reconnect state.
import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Terminal } from "@xterm/headless";
import { ClaudeTerminalSession } from "../../src/claude/session";

const sessions: ClaudeTerminalSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await Bun.sleep(10);
  }
  throw new Error("Terminal condition timed out");
};
function fixture(helperArgs: string[] = [], beforeLaunch?: (count: number) => Promise<void>) {
  let launches = 0;
  const session = new ClaudeTerminalSession({
    helperPath: process.execPath,
    helperArgs: [resolve(import.meta.dir, "../fixtures/claude-pty-helper.ts"), ...helperArgs],
    scrollback: 3,
    launch: async () => {
      launches++;
      await beforeLaunch?.(launches);
      return {
        program: "fixture",
        args: [],
        cwd: process.cwd(),
        env: {},
        launchDir: "fixture",
        cleanup: async () => {},
      };
    },
  });
  sessions.push(session);
  return { session, launches: () => launches };
}

test("concurrent starts share one child and stale input cannot reach a replacement", async () => {
  const { session, launches } = fixture();
  const [first, same] = await Promise.all([
    session.start({ cols: 80, rows: 24 }),
    session.start({ cols: 80, rows: 24 }),
  ]);
  expect(first.id).toBe(same.id);
  expect(launches()).toBe(1);
  await session.stop();
  expect(session.snapshot().state).toBe("exited");
  const second = await session.start({ cols: 80, rows: 24 });
  expect(second.id).not.toBe(first.id);
  const output: string[] = [];
  const unsubscribe = session.subscribe((event) => {
    if (event instanceof Uint8Array) output.push(new TextDecoder().decode(event));
  });
  await until(() => output.length > 0);
  session.input(first.id!, "STALE");
  session.input(second.id!, "Hello 한글\r\n");
  await until(() => output.join("").includes("Hello 한글"));
  expect(output.join("")).not.toContain("STALE");
  unsubscribe();
  await session.close();
  await expect(session.start({ cols: 80, rows: 24 })).rejects.toThrow("stopped");
});

test("concurrent restarts of an exited but still open helper create only one replacement", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { session, launches } = fixture([], async (count) => {
    if (count > 1) await barrier;
  });
  const first = await session.start({ cols: 80, rows: 24 });
  session.input(first.id!, "EXIT_BUT_LINGER");
  await until(() => session.snapshot().state === "exited");
  const one = session.start({ cols: 80, rows: 24 });
  const two = session.start({ cols: 80, rows: 24 });
  await until(() => launches() >= 2);
  await Bun.sleep(50);
  release();
  const [replacement, same] = await Promise.all([one, two]);
  expect(launches()).toBe(2);
  expect(replacement.id).toBe(same.id);
});

test("reconnect restores bounded screen, ANSI modes and Unicode after scrollback eviction", async () => {
  const { session } = fixture();
  const status = await session.start({ cols: 40, rows: 3 });
  let seen = "";
  let attached = false;
  const unsubscribe = session.subscribe((event) => {
    if (event instanceof Uint8Array) seen += new TextDecoder().decode(event);
    else if (event.type === "status") attached = true;
  });
  await until(() => attached);
  session.input(
    status.id!,
    `\x1b[?2004h${Array.from({ length: 25 }, (_, index) => `line-${index} 한글\r\n`).join("")}`,
  );
  await until(() => seen.includes("line-24"));
  unsubscribe();
  const restored = new Terminal({ cols: 40, rows: 3, allowProposedApi: true });
  let restoredStatus = false;
  const detach = session.subscribe((event) => {
    if (event instanceof Uint8Array) restored.write(event);
    else if (event.type === "status") restoredStatus = true;
  });
  await until(() => restoredStatus);
  await new Promise<void>((resolve) => restored.write("", resolve));
  const lines = Array.from({ length: restored.buffer.active.length }, (_, index) =>
    restored.buffer.active.getLine(index)?.translateToString(true),
  ).join("\n");
  expect(lines).toContain("line-24 한글");
  expect(lines).not.toContain("line-0 ");
  expect(restored.modes.bracketedPasteMode).toBe(true);
  detach();
  restored.dispose();
});

test("host rejects invalid sizes before launching", async () => {
  const { session, launches } = fixture();
  await expect(session.start({ cols: 0, rows: 9000 })).rejects.toThrow("Invalid terminal size");
  expect(launches()).toBe(0);
});

test("stop interrupts a native helper that has not reported ready", async () => {
  const { session } = fixture(["--wait-for-stop"]);
  let output = "";
  session.subscribe((event) => {
    if (event instanceof Uint8Array) output += new TextDecoder().decode(event);
  });
  const started = session.start({ cols: 80, rows: 24 });
  await until(() => output.includes("WAITING_FOR_STOP"));
  await session.stop();
  await started;
  expect(session.snapshot().state).toBe("exited");
}, 3000);

test("stop during launch preparation never starts a native process", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleanups = 0;
  const session = new ClaudeTerminalSession({
    helperPath: "must-not-start",
    launch: async () => {
      await barrier;
      return {
        program: "fixture",
        args: [],
        cwd: process.cwd(),
        env: {},
        launchDir: "fixture",
        cleanup: async () => {
          cleanups++;
        },
      };
    },
  });
  sessions.push(session);
  const started = session.start({ cols: 80, rows: 24 });
  const stopped = session.stop();
  release();
  await Promise.all([started, stopped]);
  expect(session.snapshot().state).toBe("exited");
  expect(cleanups).toBe(1);
});

test("a replacement cannot receive queued output from the stopped process", async () => {
  const helper = `
    import { createInterface } from "node:readline";
    let generation = "";
    for await (const line of createInterface({ input: process.stdin })) {
      const message = JSON.parse(line);
      if (!generation) {
        generation = message.program;
        console.log(JSON.stringify({ type: "ready" }));
        if (generation === "2") console.log(JSON.stringify({ type: "output", data: Buffer.from("NEW").toString("base64") }));
      } else if (message.type === "stop") {
        if (generation === "1") {
          const data = Buffer.from("OLD".repeat(20000)).toString("base64");
          for (let index = 0; index < 30; index++) console.log(JSON.stringify({ type: "output", data }));
        }
        console.log(JSON.stringify({ type: "exit", code: 0 }));
        break;
      }
    }
  `;
  let generation = 0;
  const session = new ClaudeTerminalSession({
    helperPath: process.execPath,
    helperArgs: ["-e", helper],
    scrollback: 3,
    launch: async () => ({
      program: String(++generation),
      args: [],
      cwd: process.cwd(),
      env: {},
      launchDir: "fixture",
      cleanup: async () => {},
    }),
  });
  sessions.push(session);
  let replacement = false;
  let staleBytes = 0;
  let sawNew = false;
  let attached = false;
  session.subscribe((event) => {
    if (event instanceof Uint8Array) {
      const text = new TextDecoder().decode(event);
      if (replacement && text.includes("OLD")) staleBytes += event.length;
      if (text.includes("NEW")) sawNew = true;
    } else if (event.type === "reset" && generation === 1) replacement = true;
    else if (event.type === "status") attached = true;
  });
  await until(() => attached);
  await session.start({ cols: 40, rows: 5 });
  await session.stop();
  await session.start({ cols: 40, rows: 5 });
  await until(() => sawNew);
  expect(staleBytes).toBe(0);
  let replay = "";
  let replayed = false;
  const detach = session.subscribe((event) => {
    if (event instanceof Uint8Array) replay += new TextDecoder().decode(event);
    else if (event.type === "status") replayed = true;
  });
  await until(() => replayed);
  expect(replay).toContain("NEW");
  expect(replay).not.toContain("OLD");
  detach();
}, 10000);

test("authoritative resize precedes output and preserves the platform renderer cursor", async () => {
  const session = new ClaudeTerminalSession({
    helperPath: process.execPath,
    helperArgs: [
      "-e",
      `
      import { createInterface } from "node:readline";
      let started = false;
      for await (const line of createInterface({ input: process.stdin })) {
        const message = JSON.parse(line);
        if (!started) { started = true; console.log(JSON.stringify({ type: "ready" })); }
        else if (message.type === "input") console.log(JSON.stringify({ type: "output", data: message.data }));
        else if (message.type === "stop") break;
      }
    `,
    ],
    launch: async () => ({
      program: "fixture",
      args: [],
      cwd: process.cwd(),
      env: {},
      launchDir: "fixture",
      cleanup: async () => {},
    }),
  });
  sessions.push(session);
  const status = await session.start({ cols: 10, rows: 3 });
  const rendered = new Terminal({
    cols: 10,
    rows: 3,
    allowProposedApi: true,
    ...(process.platform === "win32" ? { windowsPty: { backend: "conpty" as const } } : {}),
  });
  let seen = "";
  let attached = false;
  let resized = false;
  const detach = session.subscribe((event) => {
    if (event instanceof Uint8Array) {
      seen += new TextDecoder().decode(event);
      rendered.write(event);
    } else if (event.type === "status") attached = true;
    else if (event.type === "resize") {
      rendered.write("", () => rendered.resize(event.cols, event.rows));
      resized = true;
    }
  });
  try {
    await until(() => attached);
    session.input(status.id!, Array.from({ length: 8 }, (_, index) => `LINE${index}`).join("\r\n"));
    await until(() => seen.includes("LINE7"));
    session.resize(status.id!, { cols: 10, rows: 5 });
    await until(() => resized);
    await new Promise<void>((resolve) => rendered.write("", resolve));
    const cursor = `\x1b[${rendered.buffer.active.cursorY + 1};${rendered.buffer.active.cursorX + 1}R`;
    session.input(status.id!, "\x1b[6n");
    await until(() => seen.includes(cursor));
    expect(seen).toContain(cursor);
  } finally {
    detach();
    rendered.dispose();
  }
});

test("reconnect preserves native cursor visibility including terminal resets", async () => {
  const { session } = fixture();
  const status = await session.start({ cols: 40, rows: 5 });
  let seen = "";
  let attached = false;
  const detach = session.subscribe((event) => {
    if (event instanceof Uint8Array) seen += new TextDecoder().decode(event);
    else if (event.type === "status") attached = true;
  });
  await until(() => attached);
  try {
    for (const [index, [sequence, mode]] of [
      ["\x1b[?25l", 2],
      ["\x1b[?25h", 1],
      ["\x1b[?25l\x1b[!p", 1],
      ["\x1b[?25l\x1bc", 1],
    ].entries()) {
      const marker = `cursor-${index}`;
      session.input(status.id!, `${sequence}${marker}`);
      await until(() => seen.includes(marker));
      const restored = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
      let replayed = false;
      const unsubscribe = session.subscribe((event) => {
        if (event instanceof Uint8Array) restored.write(event);
        else if (event.type === "status") replayed = true;
      });
      try {
        await until(() => replayed);
        let reply = "";
        restored.onData((data) => {
          reply += data;
        });
        await new Promise<void>((resolve) => restored.write("\x1b[?25$p", resolve));
        expect(reply).toBe(`\x1b[?25;${mode}$y`);
      } finally {
        unsubscribe();
        restored.dispose();
      }
    }
  } finally {
    detach();
  }
});
