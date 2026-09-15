// @summary Packaging verifies manifest ownership against actual skill assets.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBootstrapSkills } from "../../../../scripts/bootstrap-skills-manifest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(name = "official") {
  const root = mkdtempSync(join(tmpdir(), "bootstrap-manifest-"));
  roots.push(root);
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Test\n---\nBody`);
  return root;
}
function manifest(root: string, skills: unknown[], revoked: unknown[] = []) {
  writeFileSync(join(root, "skills-manifest.json"), JSON.stringify({ schemaVersion: 1, skills, revoked }));
}
test("rejects a newly added skill omitted from the manifest", () => {
  const root = fixture();
  manifest(root, []);
  expect(() => validateBootstrapSkills(root)).toThrow("unlisted");
});
test("rejects missing assets, name mismatches, traversal, and active/revoked overlap", () => {
  const root = fixture();
  for (const entry of [
    { name: "missing", entry: "missing" },
    { name: "other", entry: "official" },
    { name: "bad", entry: "../bad" },
  ]) {
    manifest(root, [entry]);
    expect(() => validateBootstrapSkills(root)).toThrow();
  }
  const entry = { name: "official", entry: "official" };
  manifest(root, [entry], [entry]);
  expect(() => validateBootstrapSkills(root)).toThrow();
});
test("accepts valid inventory and explicit revocations without source files", () => {
  const root = fixture();
  manifest(root, [{ name: "official", entry: "official" }], [{ name: "retired", entry: "retired" }]);
  expect(validateBootstrapSkills(root).skills.map((e) => e.name)).toEqual(["official"]);
});
test("repository bundle obeys its manifest contract", () => {
  const root = join(import.meta.dir, "../../bootstrap");
  const result = validateBootstrapSkills(root);
  expect(new Set(result.skills.map((e) => e.name)).size).toBe(result.skills.length);
});
