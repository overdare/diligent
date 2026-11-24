// @summary Tests for injecting the MEMORY.md index within configured limits
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMemorySection, loadMemorySection } from "@diligent/runtime/memory";

const INDEX =
  "# Memory Index\n\n- [Combat](combat.md) — server-authoritative hitscan\n- [Publish](publish.md) — last publish state\n";

describe("memory injector", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("injects the memory directory and the index lines", () => {
    const section = buildMemorySection(INDEX, "/project/.diligent/memory");

    expect(section).toContain("Memory directory: /project/.diligent/memory");
    expect(section).toContain("- [Combat](combat.md) — server-authoritative hitscan\n- [Publish](publish.md)");
    expect(section).not.toContain("more lines are not shown");
  });

  it("returns no section for a missing or blank index", () => {
    expect(buildMemorySection("", "/m")).toBe("");
    expect(buildMemorySection("\n  \n", "/m")).toBe("");
  });

  it("stops at the line cap and says how much of the index is not shown", () => {
    const section = buildMemorySection(INDEX, "/m", 8192, 3);

    expect(section).toContain("- [Combat](combat.md)");
    expect(section).not.toContain("- [Publish](publish.md)");
    expect(section).toContain("(MEMORY.md continues; 1 more lines are not shown.)");
  });

  it("keeps the section within the token budget", () => {
    const index = `# Memory Index\n\n${Array.from({ length: 100 }, (_, i) => `- [Item ${i}](item-${i}.md) — ${"x".repeat(60)}`).join("\n")}\n`;

    const section = buildMemorySection(index, "/m", 512);

    expect(section.length).toBeLessThanOrEqual(512 * 4);
    expect(section).toContain("more lines are not shown.)");
    expect(section).toContain("- [Item 0](item-0.md)");
    expect(section).not.toContain("- [Item 99](item-99.md)");
  });

  it("loads MEMORY.md from the memory directory unless memory is disabled", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-inject-"));
    await writeFile(join(tmpDir, "MEMORY.md"), INDEX);

    expect(await loadMemorySection(tmpDir, undefined)).toContain("- [Publish](publish.md) — last publish state");
    expect(await loadMemorySection(tmpDir, { enabled: false })).toBe("");
  });
});
