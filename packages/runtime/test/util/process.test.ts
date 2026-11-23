// @summary Tests for spawning commands in a pseudo-terminal and the Windows unsupported path

import { describe, expect, test } from "bun:test";
import { spawnTerminal, TERMINAL_UNSUPPORTED_MESSAGE } from "../../src/util/process";

const posix = process.platform !== "win32";

describe.if(posix)("spawnTerminal", () => {
  test("delivers all output before exited resolves", async () => {
    let bytes = 0;
    const child = spawnTerminal(["sh", "-c", "head -c 200000 /dev/zero | tr '\\0' x; exit 3"], {
      onData: (data) => {
        bytes += data.length;
      },
    });

    expect(await child.exited).toBe(3);
    expect(bytes).toBe(200_000);
  });

  test("accepts input while running and refuses it once the terminal is closed", async () => {
    let output = "";
    const child = spawnTerminal(["sh", "-c", "read line; printf 'got:%s' \"$line\""], {
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

test("spawnTerminal reports Windows as unsupported instead of spawning", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    expect(() => spawnTerminal(["sh", "-c", "exit 0"], { onData: () => {} })).toThrow(TERMINAL_UNSUPPORTED_MESSAGE);
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
});
