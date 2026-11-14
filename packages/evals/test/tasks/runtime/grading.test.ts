// @summary Tests that exact-reply grading ignores cosmetic presentation but still rejects changed wording

import { describe, expect, test } from "bun:test";
import { isExactReply } from "../../../src/tasks/runtime/grading";

const EXPECTED = "PARALLEL_SYNTHESIS_RECORDED";

describe("isExactReply", () => {
  test("accepts the required reply wrapped in cosmetic punctuation or markup", () => {
    for (const reply of [
      `${EXPECTED}.`,
      `  ${EXPECTED}!\n`,
      `\`${EXPECTED}\``,
      `**${EXPECTED}**`,
      `"${EXPECTED}."`,
      `“${EXPECTED}”`,
      `\`\`\`text\n${EXPECTED}\n\`\`\``,
    ])
      expect(isExactReply(reply, EXPECTED), reply).toBe(true);
  });

  test("rejects typos, extra words, and other content", () => {
    for (const reply of [
      "PARALLEL_SYNTHESIS_RECORDEDD",
      `Done: ${EXPECTED}`,
      `${EXPECTED} (both facts written)`,
      "NORTH_FACT",
    ])
      expect(isExactReply(reply, EXPECTED), reply).toBe(false);
  });
});
