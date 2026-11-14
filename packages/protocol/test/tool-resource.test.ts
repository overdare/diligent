// @summary Host-owned resource references survive protocol validation without embedding raw viewer data.
import { expect, test } from "bun:test";
import { ToolRenderPayloadSchema } from "../src/tool-render";

test("retains typed opaque resource references and rejects missing identity", () => {
  const block = {
    type: "resource",
    resourceType: "sample-host.performance_capture",
    resourceId: "perf-job",
    title: "View capture",
  };
  expect(ToolRenderPayloadSchema.parse({ blocks: [block] }).blocks).toEqual([block]);
  expect(ToolRenderPayloadSchema.safeParse({ blocks: [{ ...block, resourceId: "" }] }).success).toBe(false);
});
