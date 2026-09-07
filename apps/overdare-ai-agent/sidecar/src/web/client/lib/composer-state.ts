// @summary Pure composer draft updates and interrupted steering restoration
import type { LocalImageBlock, PendingSteer } from "@diligent/protocol";
import { toWebImageUrl } from "../../shared/image-routes";
import {
  type AgentContextItem,
  getAgentContextItemKey,
  mergeAgentContextItems,
  parseContextFromText,
} from "./agent-native-bridge";

export type PendingImage = LocalImageBlock & { webUrl: string };
export interface ComposerDraft {
  text: string;
  contextItems: AgentContextItem[];
  images: PendingImage[];
}

export const DRAFT_INPUT_KEY = "__draft__";
export const EMPTY_COMPOSER_DRAFT: ComposerDraft = { text: "", contextItems: [], images: [] };

export type ComposerAction =
  | { type: "composer_text"; payload: { threadId: string; text: string } }
  | { type: "composer_context"; payload: { threadId: string; items: AgentContextItem[] } }
  | { type: "composer_remove_context"; payload: { threadId: string; itemKey: string } }
  | {
      type: "composer_images";
      payload: { threadId: string; images: PendingImage[] | ((current: PendingImage[]) => PendingImage[]) };
    };

export function reduceComposerDraft(draft: ComposerDraft, action: ComposerAction): ComposerDraft {
  switch (action.type) {
    case "composer_text":
      if (draft.text === action.payload.text) return draft;
      return { ...draft, text: action.payload.text };
    case "composer_context":
      if (!draft.contextItems.length && !action.payload.items.length) return draft;
      return {
        ...draft,
        contextItems: action.payload.items.length
          ? mergeAgentContextItems(draft.contextItems, action.payload.items)
          : [],
      };
    case "composer_remove_context":
      return {
        ...draft,
        contextItems: draft.contextItems.filter((item) => getAgentContextItemKey(item) !== action.payload.itemKey),
      };
    case "composer_images":
      return {
        ...draft,
        images:
          typeof action.payload.images === "function" ? action.payload.images(draft.images) : action.payload.images,
      };
  }
}

export function restoreInterruptedSteers(draft: ComposerDraft, steers: PendingSteer[]): ComposerDraft {
  if (!steers.length) return draft;
  const parsed = steers.map((steer) => parseContextFromText(steer.content));
  return {
    text: [...parsed.map((item) => item.remainingText), draft.text].filter(Boolean).join("\n\n"),
    contextItems: mergeAgentContextItems(
      parsed.flatMap((item) => item.contextItems),
      draft.contextItems,
    ),
    images: [
      ...steers.flatMap((steer) =>
        (steer.attachments ?? []).map((image) => ({ ...image, webUrl: toWebImageUrl(image.path) })),
      ),
      ...draft.images,
    ],
  };
}
