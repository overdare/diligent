// @summary Tests for CLI app presentation helpers used by the composition root
import { describe, expect, test } from "bun:test";
import { buildShutdownMessage, buildTurnTimingLine, buildWelcomeBanner } from "../src/tui/app-presenter";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("app-presenter", () => {
  test("buildWelcomeBanner includes model and directory hints", () => {
    const lines = buildWelcomeBanner({
      version: "0.1.0",
      modelId: "test-model",
      cwd: "/tmp/project",
      terminalColumns: 80,
      yolo: false,
    });

    const text = stripAnsi(lines.join("\n"));
    expect(text).toContain("diligent (v0.1.0)");
    expect(text).toContain("model:     test-model");
    expect(text).toContain("directory: /tmp/project");
  });

  test("buildTurnTimingLine omits output when no timings are available", () => {
    expect(buildTurnTimingLine({ loopMs: null, thinkingMs: 0 })).toContain("Thought 0ms");
  });

  test("buildShutdownMessage includes resume command when session exists", () => {
    const text = stripAnsi(buildShutdownMessage("thread-123"));
    expect(text).toContain("Resume this session with:");
    expect(text).toContain("diligent --resume thread-123");
  });
});
