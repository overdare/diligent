// @summary Shared sizing and virtualization constants for the web message list

export const MESSAGE_ROW_GAP_PX = 4;
export const MESSAGE_LIST_VERTICAL_PADDING_PX = 24;
export const DEFAULT_ESTIMATED_ROW_HEIGHT_PX = 132;
export const COLLAPSED_TOOL_BLOCK_ESTIMATE_PX = 44;
export const EARLIER_HISTORY_HEADER_HEIGHT_PX = 36;

export const VIRTUOSO_VIEWPORT_INCREASE_PX = { bottom: 600, top: 1_500 };
/**
 * While a prepend is pinned, the rows above the viewport down to the new page are rendered so Virtuoso
 * measures them then (absorbed by the pin) instead of when the reader later scrolls into them. Mounting
 * rows is the expensive part of a prepend, so the range covers the new page's estimate with margin, up
 * to this cap.
 */
export const PREPEND_MEASURE_AHEAD_MAX_PX = 20_000;
export const PREPEND_MEASURE_AHEAD_ESTIMATE_MARGIN = 1.5;
export const VIRTUOSO_MIN_OVERSCAN_ITEMS = { bottom: 4, top: 6 };
export const VIRTUOSO_OVERSCAN_PX = { main: 600, reverse: 1_100 };

export const ROW_SIZE_CACHE_LIMIT = 2_000;
