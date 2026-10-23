// @summary Shared sizing and virtualization constants for the web message list

export const MESSAGE_ROW_GAP_PX = 4;
export const MESSAGE_LIST_VERTICAL_PADDING_PX = 24;
export const DEFAULT_ESTIMATED_ROW_HEIGHT_PX = 132;
export const COLLAPSED_TOOL_BLOCK_ESTIMATE_PX = 44;
export const EARLIER_HISTORY_HEADER_HEIGHT_PX = 36;

export const VIRTUOSO_VIEWPORT_INCREASE_PX = { bottom: 600, top: 1_500 };
/**
 * While a prepend is pinned, render everything above the viewport so Virtuoso measures the new rows
 * then (absorbed by the pin) instead of when the reader later scrolls into them. Prepends only happen
 * near the start of the loaded history, so this covers little more than the new page.
 */
export const PREPEND_MEASURE_AHEAD_VIEWPORT_INCREASE_PX = { bottom: 600, top: 20_000 };
export const VIRTUOSO_MIN_OVERSCAN_ITEMS = { bottom: 4, top: 6 };
export const VIRTUOSO_OVERSCAN_PX = { main: 600, reverse: 1_100 };

export const ROW_SIZE_CACHE_LIMIT = 2_000;
