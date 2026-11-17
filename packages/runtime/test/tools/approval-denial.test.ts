// @summary Tests that built-in writing tools distinguish user rejections from permission-rule denials
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool, ToolContext } from "@diligent/core/tool-contract";
import {
  type ApprovalOutcome,
  createApplyPatchTool,
  createBashTool,
  createEditTool,
  createMultiEditTool,
  createWriteTool,
  type RuntimeToolHost,
} from "@diligent/runtime/tools";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "diligent-approval-denial-"));
  await Bun.write(join(dir, "existing.txt"), "alpha\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function trackingCtx(): { ctx: ToolContext; aborted: () => boolean } {
  let abortCalls = 0;
  return {
    ctx: { toolCallId: "tc", signal: new AbortController().signal, abort: () => abortCalls++ },
    aborted: () => abortCalls > 0,
  };
}

const policyDenial = (breaker: "none" | "stop"): ApprovalOutcome => ({
  decision: "reject",
  source: "policy",
  rule: { permission: "write", pattern: "**/secrets/**", action: "deny" },
  consecutiveDenials: 1,
  breaker,
});

interface ToolCase {
  name: string;
  create: (host: RuntimeToolHost) => Tool;
  args: () => Record<string, unknown>;
}

const toolCases: ToolCase[] = [
  { name: "bash", create: (host) => createBashTool(dir, host), args: () => ({ command: "echo hi" }) },
  { name: "write", create: (host) => createWriteTool(dir, host), args: () => ({ file_path: "new.txt", content: "x" }) },
  {
    name: "edit",
    create: (host) => createEditTool(host),
    args: () => ({ file_path: join(dir, "existing.txt"), old_string: "alpha", new_string: "beta" }),
  },
  {
    name: "multi_edit",
    create: (host) => createMultiEditTool(host),
    args: () => ({ file_path: join(dir, "existing.txt"), edits: [{ old_string: "alpha", new_string: "beta" }] }),
  },
  {
    name: "apply_patch",
    create: (host) => createApplyPatchTool(dir, host),
    args: () => ({ patch: "*** Begin Patch\n*** Add File: added.txt\n+x\n*** End Patch" }),
  },
];

describe.each(toolCases)("$name approval denial", ({ create, args }) => {
  test("a permission-rule denial names the rule and keeps the turn running", async () => {
    const tool = create({ approveWithOutcome: async () => policyDenial("none") });
    const { ctx, aborted } = trackingCtx();
    const result = await tool.execute(tool.parameters.parse(args()), ctx);

    expect(result.output).toContain('Denied by permission rule "**/secrets/**" (write)');
    expect(result.output).not.toContain("Rejected by user");
    expect(result.metadata?.error).toBe(true);
    expect(aborted()).toBe(false);
    expect(await Bun.file(join(dir, "existing.txt")).text()).toBe("alpha\n");
  });

  test("a denial that trips the breaker stops the turn", async () => {
    const tool = create({ approveWithOutcome: async () => policyDenial("stop") });
    const { ctx, aborted } = trackingCtx();
    const result = await tool.execute(tool.parameters.parse(args()), ctx);

    expect(result.output).toContain("This turn is stopping");
    expect(aborted()).toBe(true);
  });

  test("a user rejection stops the turn", async () => {
    const tool = create({ approveWithOutcome: async () => ({ decision: "reject", source: "user" }) });
    const { ctx, aborted } = trackingCtx();
    const result = await tool.execute(tool.parameters.parse(args()), ctx);

    expect(result.output).toContain("[Rejected by user]");
    expect(aborted()).toBe(true);
  });

  test("a host with only the plain approve callback is treated as a user decision", async () => {
    const tool = create({ approve: async () => "reject" });
    const { ctx, aborted } = trackingCtx();
    const result = await tool.execute(tool.parameters.parse(args()), ctx);

    expect(result.output).toContain("[Rejected by user]");
    expect(aborted()).toBe(true);
  });
});
