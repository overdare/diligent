// @summary Tests steering queue rendering in transcript active stack instead of the input editor
import { describe, expect, test } from "bun:test";
import { renderTranscript } from "../../../src/tui/components/transcript-render";
import { TranscriptStore } from "../../../src/tui/components/transcript-store";

function stripAnsi(input: string): string {
  let out = "";
  let i = 0;

  while (i < input.length) {
    if (input.charCodeAt(i) === 27 && input[i + 1] === "[") {
      i += 2;
      while (i < input.length) {
        const ch = input[i];
        if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += input[i];
    i++;
  }

  return out;
}

describe("Transcript steering queue", () => {
  test("renders each pending steering message in active stack", () => {
    const store = new TranscriptStore({ requestRender: () => {} });
    store.setPendingSteers(["change approach", "use tests first"]);
    const lines = renderTranscript(store, 80).map(stripAnsi);
    expect(lines.some((line) => line.includes("⚑ change approach"))).toBe(true);
    expect(lines.some((line) => line.includes("⚑ use tests first"))).toBe(true);
  });

  test("does not render steering indicator when queue is empty", () => {
    const store = new TranscriptStore({ requestRender: () => {} });
    store.setPendingSteers([]);
    const lines = renderTranscript(store, 80).map(stripAnsi);
    expect(lines.some((line) => line.includes("⚑ "))).toBe(false);
  });
});
