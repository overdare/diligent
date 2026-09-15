// @summary Regression coverage for the supplied AI agent logo asset

import { expect, test } from "bun:test";

const agentLogoUrl = new URL("../../../../src/web/client/icons/agent-logo.svg", import.meta.url);

test("agent logo preserves the supplied 24px white five-part mark", async () => {
  const svg = await Bun.file(agentLogoUrl).text();

  expect(svg).toContain('width="24" height="24" viewBox="0 0 24 24"');
  expect(svg.match(/fill="white"/g)).toHaveLength(5);
  expect(svg).toContain('d="M10.0117 14.0977L11.5 23.0498H10.5L7.0498 17L1 13.5498V12.5L10.0117 14.0977Z"');
  expect(svg).toContain('d="M16.9502 7.0498L23 10.5V11.5498L13.9883 9.95215L12.5 1H13.5L16.9502 7.0498Z"');
});
