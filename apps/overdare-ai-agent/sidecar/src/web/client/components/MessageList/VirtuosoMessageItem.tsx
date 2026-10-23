// @summary Stable Virtuoso item wrapper and earlier-history header used as measured list boundaries

import type { Components, ContextProp, ItemProps } from "react-virtuoso";
import { EARLIER_HISTORY_HEADER_HEIGHT_PX, MESSAGE_LIST_VERTICAL_PADDING_PX, MESSAGE_ROW_GAP_PX } from "./constants";
import { getRowSizeCacheKey } from "./row-size-cache";
import type { VirtualMessageRow, VirtuosoMessageListContext } from "./types";

function VirtuosoMessageItem({
  children,
  context,
  item,
  style,
  ...props
}: ItemProps<VirtualMessageRow> & ContextProp<VirtuosoMessageListContext>) {
  return (
    <div
      {...props}
      data-message-list-row={item.key}
      data-message-list-size-key={getRowSizeCacheKey(context.transcriptKey, item)}
      className="flow-root px-7 [overflow-anchor:none]"
      // Padding follows the row, not its index: during a prepend Virtuoso renders a frame with the old
      // indexes, and an index-based edge padding would briefly resize rows the reader is anchored to.
      style={{ ...style, paddingBottom: rowBottomPadding(item) }}
    >
      {children}
    </div>
  );
}

/** The bottom sentinel is always the last row and carries the list's bottom padding. */
export function rowBottomPadding(row: VirtualMessageRow): number {
  return row.kind === "bottom" ? MESSAGE_LIST_VERTICAL_PADDING_PX : MESSAGE_ROW_GAP_PX;
}

// Fixed height: a label change above the rows must not move the anchored transcript.
// The header also carries the list's top padding, so no row changes size when rows are prepended.
function EarlierHistoryHeader({ context }: ContextProp<VirtuosoMessageListContext>) {
  const state = context.earlierHistory;
  return (
    <div className="[overflow-anchor:none]" style={{ paddingBottom: MESSAGE_LIST_VERTICAL_PADDING_PX }}>
      {state ? (
        <div
          className="flex items-center justify-center text-xs text-muted"
          style={{ height: EARLIER_HISTORY_HEADER_HEIGHT_PX }}
        >
          {state === "loading" ? (
            <output>Loading earlier history…</output>
          ) : state === "available" ? (
            <button type="button" className="text-accent" onClick={() => context.onLoadEarlierHistory?.()}>
              Load earlier history
            </button>
          ) : (
            <span>Beginning of conversation</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

export const VIRTUOSO_COMPONENTS = {
  Item: VirtuosoMessageItem,
  Header: EarlierHistoryHeader,
} satisfies Components<VirtualMessageRow, VirtuosoMessageListContext>;
