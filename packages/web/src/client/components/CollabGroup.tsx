// @summary Groups consecutive collab events, always collapsed by default

import { useState } from "react";
import type { RenderItem } from "../lib/thread-store";
import { CollabEventBlock } from "./CollabEventBlock";

type CollabItem = Extract<RenderItem, { kind: "collab" }>;

interface CollabGroupProps {
  items: CollabItem[];
}

export function CollabGroup({ items }: CollabGroupProps) {
  const [open, setOpen] = useState(false);

  const latest = items[items.length - 1];
  const hiddenCount = Math.max(items.length - 1, 0);

  return (
    <div className="pb-4">
      {latest ? <CollabEventBlock key={latest.id} item={latest} /> : null}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="-mt-2 mb-1 ml-1 text-2xs text-muted hover:text-accent"
        >
          {open ? "▾ collapse" : `▸ show earlier events (${hiddenCount})`}
        </button>
      ) : null}
      {open && hiddenCount > 0 ? (
        <div className="mt-2 space-y-0">
          {items.slice(0, -1).map((item) => (
            <CollabEventBlock key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
