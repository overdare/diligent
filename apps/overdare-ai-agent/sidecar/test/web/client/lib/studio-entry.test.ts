// @summary Entry restoration preserves explicit navigation and ignores non-agent pages.
import { expect, test } from "bun:test";
import { prepareStudioEntry } from "../../../../src/web/client/lib/studio-entry";

test("root restores Claude while terminal and explicit Back persist their chosen view", async () => {
  const writes: unknown[] = [];
  const redirects: string[] = [];
  const request: typeof fetch = async (_url, options) => {
    if (options?.method === "POST") writes.push(JSON.parse(options.body as string));
    return Response.json({ view: "claude" });
  };
  expect(await prepareStudioEntry("/", "", request, (path) => redirects.push(path))).toBe(false);
  expect(redirects).toEqual(["/claude"]);
  expect(await prepareStudioEntry("/terminal", "", request, (path) => redirects.push(path))).toBe(true);
  expect(await prepareStudioEntry("/", "?view=agent", request, (path) => redirects.push(path))).toBe(true);
  expect(writes).toEqual([{ view: "terminal" }, { view: "agent" }]);
});
test("missing state does not block UI and file previews do not change the preferred view", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    throw new Error("Unavailable");
  };
  expect(
    await prepareStudioEntry("/file-preview", "", request, () => {
      throw new Error("Must not redirect");
    }),
  ).toBe(true);
  expect(calls).toBe(0);
  expect(
    await prepareStudioEntry("/", "", request, () => {
      throw new Error("Must not redirect");
    }),
  ).toBe(true);
});
