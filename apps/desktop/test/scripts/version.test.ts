// @summary Regression tests for packaging version helpers and temporary Tauri config generation.

import { expect, test } from "bun:test";
import { patchProtocolVersionContent, patchTauriConfigContent, toTauriVersion } from "../../scripts/lib/version";

test("toTauriVersion strips pre-release and build metadata", () => {
  expect(toTauriVersion("1.2.3-beta.1+build.5")).toBe("1.2.3");
  expect(toTauriVersion("2.0.0")).toBe("2.0.0");
});

test("patchProtocolVersionContent updates only the diligent version constant", () => {
  const source = ['export const DILIGENT_VERSION = "0.1.0";', 'export const OTHER = "keep";'].join("\n");

  const patched = patchProtocolVersionContent(source, "1.2.3-beta.1");

  expect(patched).toContain('export const DILIGENT_VERSION = "1.2.3-beta.1";');
  expect(patched).toContain('export const OTHER = "keep";');
});

test("patchTauriConfigContent returns a temporary config payload without mutating source text", () => {
  const source = JSON.stringify(
    {
      version: "0.0.1",
      productName: "Diligent",
      app: {
        windows: [
          { label: "main", title: "Diligent" },
          { label: "secondary", title: "Secondary" },
        ],
      },
      bundle: {
        icon: ["icons/original.png"],
      },
    },
    null,
    2,
  );

  const patched = patchTauriConfigContent(source, "1.2.3-beta.1", {
    projectName: "Acme Desktop",
    desktopIcons: [".diligent-packaging-icons/icon.png"],
  });

  expect(source).toContain('"version": "0.0.1"');

  const parsed = JSON.parse(patched) as {
    version: string;
    productName: string;
    app: { windows: Array<{ label: string; title: string }> };
    bundle: { icon: string[] };
  };

  expect(parsed.version).toBe("1.2.3");
  expect(parsed.productName).toBe("Acme Desktop");
  expect(parsed.app.windows).toEqual([
    { label: "main", title: "Acme Desktop" },
    { label: "secondary", title: "Secondary" },
  ]);
  expect(parsed.bundle.icon).toEqual([".diligent-packaging-icons/icon.png"]);
  expect(patched.endsWith("\n")).toBe(true);
});
