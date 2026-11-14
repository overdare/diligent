// @summary Tests CLI stdio app-server mode framing and stdout cleanliness

import { afterEach, describe, expect, it, mock } from "bun:test";
import { PassThrough } from "node:stream";
import { createStdioPeer, redirectConsoleToStderr } from "../src/app-server-stdio";

describe("createStdioPeer", () => {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  afterEach(() => {
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
  });

  it("parses NDJSON requests from stdin and writes NDJSON responses to stdout", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const peer = createStdioPeer(input, output);
    const seen: unknown[] = [];

    peer.onMessage((message) => {
      seen.push(message);
    });

    input.write('{"id":1,"method":"initialize","params":{"clientName":"cli"}}\n');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([{ id: 1, method: "initialize", params: { clientName: "cli" } }]);

    await peer.send({ id: 1, result: { ok: true } });
    expect(output.read()?.toString("utf8")).toBe('{"id":1,"result":{"ok":true}}\n');

    input.end();
  });

  it("redirects console logs to stderr instead of protocol stdout", () => {
    const stderrWrites: string[] = [];
    const stderrSpy = mock((chunk: string) => {
      stderrWrites.push(chunk);
      return true;
    });
    const originalWrite = process.stderr.write;
    process.stderr.write = stderrSpy as typeof process.stderr.write;

    try {
      redirectConsoleToStderr();
      console.log("hello from log");
      expect(stderrWrites.join("")).toContain("hello from log");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
