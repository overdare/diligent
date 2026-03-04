// @summary Groups consecutive collab events, always collapsed by default

import type { RenderItem } from "../lib/thread-store";
import { CollabEventBlock } from "./CollabEventBlock";

type CollabItem = Extract<RenderItem, { kind: "collab" }>;

interface CollabGroupProps {
  items: CollabItem[];
}

export function CollabGroup({ items }: CollabGroupProps) {
  return (
    <>
      {items.map((item) => (
        <CollabEventBlock key={item.id} item={item} />
      ))}
    </>
  );
}
