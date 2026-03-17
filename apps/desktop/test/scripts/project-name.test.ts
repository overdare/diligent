// @summary Tests for package-driven project name resolution and artifact naming helpers

import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDesktopIconPaths, resolveProjectName, toProjectArtifactName } from "../../scripts/lib/project-name";

test("resolveProjectName reads diligent.projectName from package dir first", () => {
  const dir = join(tmpdir(), `diligent-project-name-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ diligent: { projectName: "Acme Agent" } }));

  try {
    expect(resolveProjectName(dir)).toBe("Acme Agent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("toProjectArtifactName normalizes user-visible project names for filenames", () => {
  expect(toProjectArtifactName("Acme Agent Pro")).toBe("acme-agent-pro");
  expect(toProjectArtifactName("  이름 있는 App! ")).toBe("app");
});

test("resolveDesktopIconPaths reads diligent.desktopIcons and resolves existing files", () => {
  const dir = join(tmpdir(), `diligent-project-icons-${Date.now()}`);
  mkdirSync(join(dir, "icons"), { recursive: true });
  writeFileSync(join(dir, "icons", "icon.png"), "png");
  writeFileSync(join(dir, "icons", "icon.ico"), "ico");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ diligent: { desktopIcons: ["icons/icon.png", "icons/missing.icns", "icons/icon.ico"] } }),
  );

  try {
    expect(resolveDesktopIconPaths(dir)).toEqual([join(dir, "icons", "icon.png"), join(dir, "icons", "icon.ico")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
