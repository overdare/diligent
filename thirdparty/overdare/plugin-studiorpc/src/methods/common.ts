import { z } from "zod"

/** Shared GUI object properties spread into Frame / TextLabel / ImageLabel / etc. */
export const guiObjectProperties = {
  AnchorPoint: z.object({ x: z.number(), y: z.number() }).optional(),
  BackgroundColor3: z
    .object({ r: z.number(), g: z.number(), b: z.number() })
    .describe("Background color (RGB)")
    .optional(),
  BackgroundTransparency: z
    .number()
    .describe("Background transparency (0~1)")
    .optional(),
  LayoutOrder: z.number().describe("Layout order").optional(),
  Position: z
    .object({
      xscale: z.number(),
      xoffset: z.number(),
      yscale: z.number(),
      yoffset: z.number(),
    })
    .describe("UI position (UDim2)")
    .optional(),
  Rotation: z.number().describe("Rotation angle").optional(),
  Size: z
    .object({
      xscale: z.number(),
      xoffset: z.number(),
      yscale: z.number(),
      yoffset: z.number(),
    })
    .describe("UI size (UDim2)")
    .optional(),
  Visible: z.boolean().describe("Visibility").optional(),
  ZIndex: z.number().describe("Rendering order").optional(),
}
