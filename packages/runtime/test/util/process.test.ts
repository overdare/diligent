// @summary Tests for launching and draining the built-in POSIX terminal backend

import { describe, expect, test } from "bun:test";
import { defaultTerminalSpawner } from "../../src/util/process";

const posix = process.platform !== "win32";

describe.if(posix)("default terminal spawner", () => {
  test("delivers all output before exited resolves", async () => {
    let bytes = 0;
    const child = defaultTerminalSpawner!(["sh", "-c", "head -c 200000 /dev/zero | tr '\\0' x; exit 3"], {
      onData: (data) => {
        bytes += data.length;
      },
    });

    expect(await child.exited).toBe(3);
    expect(bytes).toBe(200_000);
  });

  test("accepts input while running and refuses it once the terminal is closed", async () => {
    let output = "";
    const child = defaultTerminalSpawner!(["sh", "-c", "read line; printf 'got:%s' \"$line\""], {
      onData: (data) => {
        output += new TextDecoder().decode(data);
      },
    });

    expect(child.write("value\n")).toBe(true);
    expect(await child.exited).toBe(0);
    expect(output).toContain("got:value");
    expect(child.write("late\n")).toBe(false);
  });
});
