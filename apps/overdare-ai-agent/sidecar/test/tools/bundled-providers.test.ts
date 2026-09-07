// @summary Tests studio-disabled gating of the bundled tool provider assembly.

import { describe, expect, test } from "bun:test";
import { createStudioBundledToolProviders } from "../../src/tools";

const STUDIO_RPC_ID = "@overdare/studiorpc-tools";
const IMAGE_GENERATION_ID = "@overdare/image-generation-tools";

describe("createStudioBundledToolProviders", () => {
  test("includes the studiorpc provider by default", () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project" });
    expect(providers.some((p) => p.id === STUDIO_RPC_ID)).toBe(true);
    expect(providers.some((p) => p.id === IMAGE_GENERATION_ID)).toBe(true);
  });

  test("omits the studiorpc provider when studioDisabled is set", () => {
    const providers = createStudioBundledToolProviders({ cwd: "/tmp/project", studioDisabled: true });
    expect(providers.some((p) => p.id === STUDIO_RPC_ID)).toBe(false);
    expect(providers.some((p) => p.id === IMAGE_GENERATION_ID)).toBe(true);
    // the rest of the bundled providers are still present
    expect(providers.length).toBeGreaterThan(0);
  });
});
