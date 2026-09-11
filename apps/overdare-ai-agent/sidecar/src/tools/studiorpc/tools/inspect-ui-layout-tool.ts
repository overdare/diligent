// @summary Reads current Editor GUI properties and reports estimated layout problems without mutations.
import { z } from "zod";
import { hiddenCoreGuiParam } from "../reserved-ui";
import type { call } from "../rpc";
import type { Tool, ToolResult } from "../types";
import { isRecord } from "./ovdrjm-utils";
import { inspectUiLayout, type UiLayoutScreen } from "./ui-layout-diagnostics";

const TOOL_NAME = "studiorpc_ui_inspect_layout";
const params = z
  .object({
    screenGuid: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Inspect one ScreenGui in StarterGui; omit to inspect all authored screens."),
    hiddenCoreGui: hiddenCoreGuiParam,
    viewport: z
      .object({ width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384) })
      .strict()
      .optional()
      .describe(
        "Layout viewport for authored Scale/Offset calculations. Defaults to the 1386x640 mobile reference; not measured screenshot pixels.",
      ),
    maxFindings: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum findings to return (default 50). Truncation is reported."),
  })
  .strict();

function classOf(node: Record<string, unknown>): unknown {
  return node.InstanceType ?? node.class;
}
function guidOf(node: Record<string, unknown>): unknown {
  return node.ActorGuid ?? node.guid;
}

function screensIn(root: Record<string, unknown>): UiLayoutScreen[] {
  const screens: UiLayoutScreen[] = [];
  const queue = [{ node: root, path: "Game.StarterGui" }];
  for (let index = 0; index < queue.length; index++) {
    if (index >= 10000) throw new Error("StarterGui hierarchy exceeded the inspection limit.");
    const { node, path } = queue[index];
    if (classOf(node) === "ScreenGui") {
      screens.push({ path, root: node });
      continue;
    }
    if (Array.isArray(node.LuaChildren)) {
      for (const child of node.LuaChildren) {
        if (isRecord(child))
          queue.push({ node: child, path: `${path}.${child.Name ?? child.name ?? guidOf(child) ?? "unnamed"}` });
      }
    }
  }
  return screens;
}

export function createInspectUiLayoutTool(callRpc: typeof call): Tool {
  return {
    name: TOOL_NAME,
    description:
      "Inspect the current Editor GUI for reserved mobile control overlap, unrelated overlapping buttons, and viewport exits. " +
      "Read-only: uses level.browse and instance.read, never executes Luau, saves, blocks placement, or edits the scene. " +
      "Run after GUI edits (including Editor Luau), fix relevant findings, then verify a screenshot. " +
      "Coordinates are authored-layout estimates, not rendered pixel measurements or live PlayerGui state. " +
      "Hidden controls require prior script review. Unsupported geometry and incomplete reads are reported rather than treated as clean.",
    parameters: params,
    supportParallel: true,
    async execute(args, ctx): Promise<ToolResult> {
      ctx.signal.throwIfAborted();
      const parsed = params.parse(args);
      const approval = await ctx.approve({
        permission: "read",
        toolName: TOOL_NAME,
        description: "Inspect current Editor UI layout",
        details: parsed,
      });
      if (approval === "reject") return { output: "[Rejected by user]", metadata: { error: true } };
      try {
        ctx.signal.throwIfAborted();
        const options = { signal: ctx.signal };
        const browsed = await callRpc("level.browse", {}, options);
        if (!isRecord(browsed) || !Array.isArray(browsed.level))
          throw new Error("level.browse returned no readable level list.");
        const starter = browsed.level.find((entry: unknown) => isRecord(entry) && classOf(entry) === "StarterGui");
        const guid = isRecord(starter) ? guidOf(starter) : undefined;
        if (typeof guid !== "string" || !guid)
          throw new Error("StarterGui was not returned by Studio; UI layout could not be inspected.");
        ctx.signal.throwIfAborted();
        const read = await callRpc("instance.read", { ActorGuid: guid, Depth: -1 }, options);
        ctx.signal.throwIfAborted();
        const root = isRecord(read) && read.success !== false && isRecord(read.instance) ? read.instance : undefined;
        if (!root || classOf(root) !== "StarterGui")
          throw new Error("instance.read returned no readable StarterGui properties.");
        let screens = screensIn(root);
        if (parsed.screenGuid) {
          screens = screens.filter((screen) => guidOf(screen.root) === parsed.screenGuid);
          if (!screens.length) throw new Error(`ScreenGui ${parsed.screenGuid} was not found in StarterGui.`);
        }
        const report = inspectUiLayout(screens, parsed);
        const result = {
          ...report,
          status: report.skippedElements.length || report.truncated ? "partial" : "complete",
          source: "editor-instance-properties",
          screens: screens.map((screen) => ({ guid: guidOf(screen.root), path: screen.path })),
          hiddenCoreGui: parsed.hiddenCoreGui ?? [],
          limitations: [
            "Authored coordinates are estimates; verify rendered layout with a screenshot.",
            "Reserved controls use reference geometry and caller-provided hidden hints, not measured runtime visibility.",
          ],
        };
        return {
          output: JSON.stringify(result, null, 2),
          metadata: { method: "ui.inspect_layout", readOnly: true, ...result },
          render: {
            inputSummary: "Inspect Editor UI layout",
            outputSummary: `${report.findings.length} layout findings (${result.status})`,
            blocks: [
              {
                type: "summary",
                text: `${report.findings.length} findings across ${report.checkedElements} checked elements. Coordinates are authored estimates. ${report.skippedElements.length} elements could not be fully checked.`,
                tone: report.findings.length || result.status === "partial" ? "warning" : "info",
              },
            ],
          },
        };
      } catch (error) {
        ctx.signal.throwIfAborted();
        const result = {
          status: "unavailable",
          source: "editor-instance-properties",
          message: error instanceof Error ? error.message : String(error),
        };
        return {
          output: JSON.stringify(result, null, 2),
          metadata: { error: true, method: "ui.inspect_layout", readOnly: true, ...result },
        };
      }
    },
  };
}
