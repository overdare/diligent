// @summary Shared typed asset filters matching the RAG API request contract.
import { z } from "zod";

export const assetFilterSchema = z.object({
  assetType: z
    .preprocess(
      (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
      z.enum(["MODEL", "AUDIO", "ANIMATION", "ACTION_SEQUENCE"]),
    )
    .describe("Required asset type: MODEL, AUDIO, ANIMATION, or ACTION_SEQUENCE. Case-insensitive."),
  keywords: z.array(z.string()).optional().describe("Match at least one keyword."),
  categoryId: z.string().optional().describe("Match this category ID."),
});

export type AssetFilter = z.infer<typeof assetFilterSchema>;
