import { expect, test } from "bun:test";
import { join } from "node:path";
import { PerformanceStore } from "../../../../src/tools/studiorpc/tools/performance-store";

test("artifact paths use the runtime namespace and cannot escape the generated job directory", () => {
  const previous = process.env.DILIGENT_STORAGE_NAMESPACE;
  process.env.DILIGENT_STORAGE_NAMESPACE = "performance-test";
  try {
    const store = new PerformanceStore("C:/project");
    expect(store.paths("perf-00000000-0000-0000-0000-000000000000").frames).toBe(
      join("C:/project", ".performance-test", "performance", "perf-00000000-0000-0000-0000-000000000000", "frames.csv"),
    );
    expect(() => store.paths("../../outside")).toThrow();
  } finally {
    if (previous === undefined) delete process.env.DILIGENT_STORAGE_NAMESPACE;
    else process.env.DILIGENT_STORAGE_NAMESPACE = previous;
  }
});
