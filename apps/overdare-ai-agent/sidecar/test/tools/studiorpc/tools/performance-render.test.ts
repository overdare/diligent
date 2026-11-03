// @summary Both clients receive integrated distributions, missing values and the same opaque capture identity.
import { expect, test } from "bun:test";
import { ToolRenderPayloadSchema } from "@diligent/protocol";
import { renderPerformanceResult } from "../../../../src/tools/studiorpc/tools/performance-render";

test("renders frame, Lua and OS distributions without embedding raw samples", () => {
  const metric = { n: 2, mean: 4, p50: 0, p95: 8, max: 8, unit: "ms", status: "partial" };
  const render = ToolRenderPayloadSchema.parse(
    renderPerformanceResult({
      jobId: "perf-job",
      case: "combat",
      state: "partial",
      summaries: { frame_ms: metric },
      luaScopes: [{ ...metric, label: "server.AI" }],
      processes: [{ pid: 7, role: "dedicated_server", usedCores: { ...metric, unit: "cores", mean: null } }],
      frames: [{ secret: "raw sample must not be in transcript" }],
      quality: { dropped: 2 },
    }),
  );
  expect(render.blocks).toContainEqual({
    type: "resource",
    resourceType: "overdare.performance_capture",
    resourceId: "perf-job",
    title: "View performance capture",
  });
  const tables = render.blocks.filter((block) => block.type === "table");
  expect(tables).toHaveLength(3);
  expect(tables[0]?.rows[0]).toEqual(["frame_ms / ms", "2", "4", "0", "8", "8", "partial"]);
  expect(tables[2]?.rows[0]?.[2]).toBe("unavailable");
  expect(JSON.stringify(render)).not.toContain("raw sample");
  expect(JSON.stringify(render)).toContain("dropped");
});
