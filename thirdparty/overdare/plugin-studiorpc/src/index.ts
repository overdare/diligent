import { z } from "zod"
import { call } from "./rpc.ts"

// ── Method modules ────────────────────────────────────────────────────────────
import * as levelBrowse from "./methods/level.browse.ts"
import * as scriptAdd from "./methods/script.add.ts"
import * as scriptDelete from "./methods/script.delete.ts"
import * as instanceDelete from "./methods/instance.delete.ts"
import * as instancePartAdd from "./methods/instance.part.add.ts"
import * as instanceFrameAdd from "./methods/instance.frame.add.ts"
import * as instanceTextLabelAdd from "./methods/instance.text_label.add.ts"
import * as instanceImageLabelAdd from "./methods/instance.image_label.add.ts"
import * as instanceImageButtonAdd from "./methods/instance.image_button.add.ts"
import * as instanceTextButtonAdd from "./methods/instance.text_button.add.ts"
import * as instanceRemoteEventAdd from "./methods/instance.remote_event.add.ts"
import * as instanceSoundAdd from "./methods/instance.sound.add.ts"
import * as instanceToolAdd from "./methods/instance.tool.add.ts"
import * as instanceVfxPresetAdd from "./methods/instance.vfx_preset.add.ts"
import * as instanceAngularVelocityAdd from "./methods/instance.angular_velocity.add.ts"
import * as instanceLinearVelocityAdd from "./methods/instance.linear_velocity.add.ts"
import * as instanceVectorForceAdd from "./methods/instance.vector_force.add.ts"
import * as gamePlay from "./methods/game.play.ts"
import * as gameStop from "./methods/game.stop.ts"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolContext {
  toolCallId: string
  signal: AbortSignal
  approve: (request: ApprovalRequest) => Promise<ApprovalResponse>
  onUpdate?: (partialResult: string) => void
}

interface ApprovalRequest {
  permission: "read" | "write" | "execute"
  toolName: string
  description: string
  details?: Record<string, unknown>
}

type ApprovalResponse = "once" | "always" | "reject"

interface ToolResult {
  output: string
  metadata?: Record<string, unknown>
}

interface Tool {
  name: string
  description: string
  parameters: z.ZodType
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
  supportParallel?: boolean
}

interface MethodModule {
  method: string
  description: string
  params: z.ZodType
}

// ── Plugin manifest ───────────────────────────────────────────────────────────

export const manifest = {
  name: "@overdare/plugin-studiorpc",
  apiVersion: "1.0",
  version: "0.1.0",
}

// ── Tool factory ──────────────────────────────────────────────────────────────

const methodModules: MethodModule[] = [
  levelBrowse,
  scriptAdd,
  scriptDelete,
  instanceDelete,
  instancePartAdd,
  instanceFrameAdd,
  instanceTextLabelAdd,
  instanceImageLabelAdd,
  instanceImageButtonAdd,
  instanceTextButtonAdd,
  instanceRemoteEventAdd,
  instanceSoundAdd,
  instanceToolAdd,
  instanceVfxPresetAdd,
  instanceAngularVelocityAdd,
  instanceLinearVelocityAdd,
  instanceVectorForceAdd,
  gamePlay,
  gameStop,
]

/**
 * Build the tool name from an RPC method string.
 * "level.browse"        → "studiorpc_level_browse"
 * "instance.part.add"  → "studiorpc_instance_part_add"
 */
function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`
}

export async function createTools(_ctx: { cwd: string }): Promise<Tool[]> {
  const tools: Tool[] = []

  for (const mod of methodModules) {
    const { method, description, params } = mod

    const toolName = toToolName(method)

    tools.push({
      name: toolName,
      description,
      parameters: params,
      async execute(args, ctx) {
        const approval = await ctx.approve({
          permission: "execute",
          toolName,
          description: `Studio RPC: ${method}`,
          details: { method, params: args },
        })

        if (approval === "reject") {
          return {
            output: "[Rejected by user]",
            metadata: { error: true, method },
          }
        }

        const result = await call(method, args as Record<string, unknown>)
        const output =
          typeof result === "string" ? result : JSON.stringify(result, null, 2)

        return {
          output,
          metadata: { method, result },
        }
      },
    })
  }

  return tools
}
