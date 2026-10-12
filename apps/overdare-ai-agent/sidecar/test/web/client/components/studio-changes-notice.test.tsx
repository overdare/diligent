// @summary Verifies counts for session-grouped Studio summaries and older single-section summaries.

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioChangesNotice } from "../../../../src/web/client/components/StudioChangesNotice";

test("Studio notice uses the complete count when some session groups are omitted", () => {
  const summary =
    'Total changes: 9\n\nSession: first\n\nAdded (2):\n+ Part "Box" (box)\n\nSession: unknown\n\nModified (1):\n~ Part "Wall" (wall)\n\n2 session groups omitted.';
  const html = renderToStaticMarkup(<StudioChangesNotice summary={summary} />);
  expect(html).toContain("9 changes");
  expect(html).not.toContain("3 changes");
});

test("Studio notice counts repeated session sections and remains compatible with a legacy summary", () => {
  for (const summary of [
    "Session: first\n\nAdded (2):\n\nSession: unknown\n\nAdded (3):",
    "Added (2):\n\nRemoved (3):",
  ]) {
    expect(renderToStaticMarkup(<StudioChangesNotice summary={summary} />)).toContain("5 changes");
  }
  expect(
    renderToStaticMarkup(<StudioChangesNotice summary={"Total changes: 1\n\nSession: unknown\nAdded (1):"} />),
  ).toContain("1 change");
});
