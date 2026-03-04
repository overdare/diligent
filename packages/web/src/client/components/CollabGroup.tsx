// @summary Groups consecutive collab events, collapsing child tools when there are many items

import type { RenderItem } from "../lib/thread-store";
import { CollabEventBlock } from "./CollabEventBlock";

const MAX_VISIBLE = 4;

type CollabItem = Extract<RenderItem, { kind: "collab" }>;

interface CollabGroupProps {
  items: CollabItem[];
}

export function CollabGroup({ items }: CollabGroupProps) {
  const shouldCollapse = items.length > MAX_VISIBLE;

  return (
    <>
      {items.map((item) => (
        <CollabEventBlock key={item.id} item={item} defaultCollapsed={shouldCollapse} />
      ))}
    </>
  );
}
