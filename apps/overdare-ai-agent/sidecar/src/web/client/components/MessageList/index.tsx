// @summary Scrollable message feed with auto-scroll, scroll-to-bottom button, and inline prompts

import type { KeyboardEvent as ReactKeyboardEvent, WheelEvent as ReactWheelEvent } from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type SizeFunction, Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { CHAT_NEAR_BOTTOM_THRESHOLD_PX } from "../../lib/scroll-utils";
import { isReportableAssistantResponse } from "../AssistantContentBlocks";
import { EmptyState } from "../EmptyState";
import { ScrollToBottom } from "../ScrollToBottom";
import {
  DEFAULT_ESTIMATED_ROW_HEIGHT_PX,
  PREPEND_MEASURE_AHEAD_ESTIMATE_MARGIN,
  PREPEND_MEASURE_AHEAD_MAX_PX,
  VIRTUOSO_MIN_OVERSCAN_ITEMS,
  VIRTUOSO_OVERSCAN_PX,
  VIRTUOSO_VIEWPORT_INCREASE_PX,
} from "./constants";
import { MessageListRowContent } from "./MessageListRowContent";
import { applyCompactingVisibility, buildGroupedRows, buildTrailingRows } from "./row-builder";
import { estimateRowOuterHeight } from "./row-estimates";
import { getMeasuredRowSize, getRowSizeCacheKey, rememberMeasuredRowSize } from "./row-size-cache";
import type {
  EarlierHistoryState,
  MessageListProps,
  VirtualMessageRow,
  VirtuosoMessageListContext,
  VirtuosoScrollBehavior,
} from "./types";
import { VIRTUOSO_COMPONENTS } from "./VirtuosoMessageItem";

const INITIAL_FIRST_ITEM_INDEX = 1_000_000;

/** How long after a prepend the visible row is pinned while Virtuoso measures the new rows. */
const PREPEND_ANCHOR_WINDOW_MS = 1_500;
const WHEEL_LINE_PX = 16;
// Wide content (code blocks, tables) scrolls on its own; the transcript itself must never scroll sideways.
const MESSAGE_SCROLLER_STYLE = { height: "100%", overflowX: "hidden" } as const;

interface PrependAnchor {
  /** A reader at the bottom is pinned to the bottom edge until they wheel away from it. */
  atBottom: boolean;
  key: string;
  /** Viewport offset the row is pinned to. */
  top: number;
  /** Wheel scrolling received since the last restore, applied by the pin instead of the browser. */
  pendingScroll: number;
  until: number;
}

function wheelDeltaPx(event: WheelEvent, scroller: HTMLElement): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * WHEEL_LINE_PX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * scroller.clientHeight;
  return event.deltaY;
}

/** Wheel input over a scrollable block inside a row (tool output, code) belongs to that block. */
function isInsideNestedScroller(target: EventTarget | null, scroller: HTMLElement): boolean {
  for (let element = target instanceof Element ? target : null; element && element !== scroller; ) {
    if (element.scrollHeight > element.clientHeight && /(auto|scroll)/.test(getComputedStyle(element).overflowY)) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

/** The first row fully or partly inside the viewport, used when the pinned row scrolls away. */
function firstVisibleRow(scroller: HTMLElement): HTMLElement | null {
  const viewport = scroller.getBoundingClientRect();
  for (const element of scroller.querySelectorAll<HTMLElement>("[data-message-list-row]")) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom > viewport.top && rect.top < viewport.bottom) return element;
  }
  return null;
}

/**
 * Paging follows the reader: rows rendered far ahead of a pinned prepend (for measurement) do not count,
 * or every page would immediately request the next one.
 */
function firstRowNearViewport(scroller: HTMLElement | null, firstItemIndex: number): boolean {
  const first = scroller?.querySelector<HTMLElement>("[data-message-list-row]");
  if (!scroller || !first || Number(first.dataset.itemIndex) !== firstItemIndex) return false;
  return (
    first.getBoundingClientRect().bottom >= scroller.getBoundingClientRect().top - VIRTUOSO_VIEWPORT_INCREASE_PX.top
  );
}

function rowContainsItem(row: VirtualMessageRow, itemId: string): boolean {
  if (row.kind === "message") return row.item.id === itemId;
  if (row.kind === "toolGroup" || row.kind === "collab") return row.items.some((item) => item.id === itemId);
  return false;
}

/** Reads the still-committed DOM: the top visible row that survives into `nextRows`, and its offset. */
function capturePrependAnchor(
  scroller: HTMLElement | null,
  nextRows: VirtualMessageRow[],
  atBottom: boolean,
): PrependAnchor | null {
  if (!scroller) return null;
  const until = performance.now() + PREPEND_ANCHOR_WINDOW_MS;
  if (atBottom) return { atBottom, key: "", top: 0, pendingScroll: 0, until };
  const nextKeys = new Set(nextRows.map((row) => row.key));
  const viewportTop = scroller.getBoundingClientRect().top;
  for (const element of scroller.querySelectorAll<HTMLElement>("[data-message-list-row]")) {
    const key = element.dataset.messageListRow;
    const rect = element.getBoundingClientRect();
    if (!key || rect.bottom <= viewportTop || !nextKeys.has(key)) continue;
    return { atBottom, key, top: rect.top, pendingScroll: 0, until };
  }
  return null;
}

function MessageListImpl({
  items,
  threadId,
  threadStatus,
  threadCwd,
  hasProvider,
  oauthPending,
  onOpenProviders,
  onQuickConnectChatGPT,
  isCompacting,
  approvalPrompt,
  questionPrompt,
  onLoadChildThread,
  onReportMessage,
  onErrorRecovery,
  hasEarlierHistory = false,
  isLoadingEarlierHistory = false,
  earlierHistoryFailed = false,
  onLoadEarlierHistory,
}: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const pendingAutoscrollFrameRef = useRef<number | null>(null);
  const previousTranscriptKeyRef = useRef<string | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  /** Top viewport extension while a prepend is pinned; 0 when none is. */
  const [measureAheadPx, setMeasureAheadPx] = useState(0);
  const isAtBottomRef = useRef(true);
  const userDetachedFromBottomRef = useRef(false);
  const showScrollBtnRef = useRef(false);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const prependAnchorRef = useRef<PrependAnchor | null>(null);

  const hasPrompt = approvalPrompt || questionPrompt;
  const showEmptyState = items.length === 0 && !hasPrompt;
  const groupedRows = useMemo(() => buildGroupedRows(items), [items]);
  const messageRows = useMemo(() => applyCompactingVisibility(groupedRows, isCompacting), [groupedRows, isCompacting]);
  const statusRows = useMemo(
    () => buildTrailingRows({ items, threadStatus, isCompacting, approvalPrompt, questionPrompt }),
    [items, threadStatus, isCompacting, approvalPrompt, questionPrompt],
  );
  const rows = useMemo(
    () => (showEmptyState ? [] : [...messageRows, ...statusRows]),
    [messageRows, showEmptyState, statusRows],
  );
  const transcriptKey = threadId ?? items[0]?.id ?? rows[0]?.key ?? "empty";
  // Anchor on a rendered row: items[0] can be a kind that never becomes a row.
  const firstRow = rows[0];
  const firstItemId =
    firstRow?.kind === "message"
      ? firstRow.item.id
      : firstRow?.kind === "toolGroup" || firstRow?.kind === "collab"
        ? firstRow.items[0]?.id
        : undefined;
  const pagingRef = useRef({
    transcriptKey,
    firstItemId,
    firstItemIndex: INITIAL_FIRST_ITEM_INDEX,
    paged: false,
    pinEpoch: 0,
    measureAheadPx: 0,
  });
  if (pagingRef.current.transcriptKey !== transcriptKey) {
    pagingRef.current = {
      transcriptKey,
      firstItemId,
      firstItemIndex: INITIAL_FIRST_ITEM_INDEX,
      paged: false,
      pinEpoch: 0,
      measureAheadPx: 0,
    };
  } else if (pagingRef.current.firstItemId !== firstItemId) {
    // Anchor by item id: an older page can merge into the first tool group and change its row key.
    const previousFirstItemId = pagingRef.current.firstItemId;
    const added = previousFirstItemId ? rows.findIndex((row) => rowContainsItem(row, previousFirstItemId)) : -1;
    if (added > 0) {
      pagingRef.current.firstItemIndex -= added;
      pagingRef.current.paged = true;
    }
    // A page that only merges into the first row still resizes it (a lone expanded tool becomes a
    // collapsed group), so it needs the same pin as one that adds rows.
    // Virtuoso offsets prepends by estimated heights; pin the visible row to its real position instead.
    // A reader at the bottom keeps following new output, so they are pinned to the bottom edge.
    if (added >= 0) {
      if (!isAtBottomRef.current) userDetachedFromBottomRef.current = true;
      prependAnchorRef.current = capturePrependAnchor(scrollerRef.current, rows, isAtBottomRef.current);
      pagingRef.current.pinEpoch++;
      let addedEstimate = 0;
      for (const row of rows.slice(0, added + 1)) addedEstimate += row.estimatedSize;
      pagingRef.current.measureAheadPx = Math.min(
        PREPEND_MEASURE_AHEAD_MAX_PX,
        Math.max(
          VIRTUOSO_VIEWPORT_INCREASE_PX.top,
          (scrollerRef.current?.scrollTop ?? 0) +
            addedEstimate * PREPEND_MEASURE_AHEAD_ESTIMATE_MARGIN +
            VIRTUOSO_VIEWPORT_INCREASE_PX.top,
        ),
      );
    }
    pagingRef.current.firstItemId = firstItemId;
  }
  const pinEpoch = pagingRef.current.pinEpoch;
  if (hasEarlierHistory) pagingRef.current.paged = true;
  const firstItemIndex = pagingRef.current.firstItemIndex;
  const earlierHistory: EarlierHistoryState | undefined = isLoadingEarlierHistory
    ? "loading"
    : hasEarlierHistory
      ? earlierHistoryFailed
        ? "failed"
        : "available"
      : pagingRef.current.paged
        ? "start"
        : undefined;
  const heightEstimates = useMemo(
    () => rows.map((row) => getMeasuredRowSize(getRowSizeCacheKey(transcriptKey, row)) ?? estimateRowOuterHeight(row)),
    [rows, transcriptKey],
  );
  const virtuosoContext = useMemo<VirtuosoMessageListContext>(
    () => ({ transcriptKey, earlierHistory, onLoadEarlierHistory }),
    [transcriptKey, earlierHistory, onLoadEarlierHistory],
  );
  const initialTopMostItemIndex = useMemo(
    () => (rows.length > 0 ? { align: "end" as const, index: rows.length - 1 } : 0),
    [rows.length],
  );
  const shouldUseVirtuoso = typeof window !== "undefined";
  const lastCompletedResponseId = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.kind === "assistant" && isReportableAssistantResponse(item)) {
        return item.id;
      }
    }
    return undefined;
  }, [items]);
  const lastItem = items.at(-1);
  // Recovery belongs to the latest failure only; older errors stay as timeline history.
  const actionableErrorId = threadStatus === "idle" && lastItem?.kind === "error" ? lastItem.id : undefined;

  const setScrollButtonVisible = useCallback((visible: boolean) => {
    if (showScrollBtnRef.current === visible) return;
    showScrollBtnRef.current = visible;
    setShowScrollBtn(visible);
  }, []);

  const cancelPendingAutoscroll = useCallback(() => {
    if (pendingAutoscrollFrameRef.current === null || typeof window === "undefined") return;
    window.cancelAnimationFrame(pendingAutoscrollFrameRef.current);
    pendingAutoscrollFrameRef.current = null;
  }, []);

  const detachFromBottom = useCallback(() => {
    cancelPendingAutoscroll();
    isAtBottomRef.current = false;
    userDetachedFromBottomRef.current = true;
    setScrollButtonVisible(true);
  }, [cancelPendingAutoscroll, setScrollButtonVisible]);

  const attachToBottom = useCallback(() => {
    userDetachedFromBottomRef.current = false;
    isAtBottomRef.current = true;
    setScrollButtonVisible(false);
  }, [setScrollButtonVisible]);

  const isFollowingBottom = useCallback(() => isAtBottomRef.current && !userDetachedFromBottomRef.current, []);

  const scrollToBottom = useCallback(
    (behavior: VirtuosoScrollBehavior = "auto") => {
      if (rows.length === 0) return;
      prependAnchorRef.current = null;
      attachToBottom();
      cancelPendingAutoscroll();
      virtuosoRef.current?.scrollToIndex({ align: "end", behavior, index: "LAST" });
      if (behavior !== "auto" || typeof window === "undefined") {
        return;
      }
      pendingAutoscrollFrameRef.current = window.requestAnimationFrame(() => {
        pendingAutoscrollFrameRef.current = null;
        virtuosoRef.current?.autoscrollToBottom();
      });
    },
    [attachToBottom, cancelPendingAutoscroll, rows.length],
  );

  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      if (atBottom) {
        attachToBottom();
        return;
      }
      isAtBottomRef.current = false;
      setScrollButtonVisible(true);
    },
    [attachToBottom, setScrollButtonVisible],
  );

  const followOutput = useCallback((isAtBottom: boolean) => {
    if (!isAtBottom || userDetachedFromBottomRef.current) return false;
    return "auto";
  }, []);

  const loadEarlierIfNearRef = useRef(() => {});
  loadEarlierIfNearRef.current = () => {
    if (!hasEarlierHistory || isLoadingEarlierHistory || earlierHistoryFailed) return;
    if (firstRowNearViewport(scrollerRef.current, firstItemIndex)) onLoadEarlierHistory?.();
  };
  // Checked a frame later so Virtuoso has committed the rows the check reads.
  const scheduleLoadEarlierCheck = useCallback(() => {
    requestAnimationFrame(() => loadEarlierIfNearRef.current());
  }, []);

  // startReached fires once per first-row index; a page whose items all merge into the existing first
  // row leaves the index unchanged, so loading finishing and scrolling re-check as well.
  const handleStartReached = scheduleLoadEarlierCheck;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each listed change can bring the first row near
  useEffect(scheduleLoadEarlierCheck, [
    scheduleLoadEarlierCheck,
    hasEarlierHistory,
    isLoadingEarlierHistory,
    earlierHistoryFailed,
    firstItemIndex,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Virtuoso remounts its scroller per transcript
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        loadEarlierIfNearRef.current();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [transcriptKey, rows.length > 0]);

  const computeItemKey = useCallback((_index: number, row: VirtualMessageRow) => row.key, []);

  const renderRow = useCallback(
    (_index: number, row: VirtualMessageRow) => (
      <MessageListRowContent
        row={row}
        threadCwd={threadCwd}
        onLoadChildThread={onLoadChildThread}
        onReportMessage={onReportMessage}
        lastCompletedResponseId={lastCompletedResponseId}
        actionableErrorId={actionableErrorId}
        onErrorRecovery={onErrorRecovery}
      />
    ),
    [actionableErrorId, lastCompletedResponseId, onErrorRecovery, onLoadChildThread, onReportMessage, threadCwd],
  );

  const measureItemSize = useCallback<SizeFunction>((element, field) => {
    const rect = element.getBoundingClientRect();
    const size = Math.round(field === "offsetHeight" ? rect.height : rect.width);
    if (field === "offsetHeight" && element.dataset.messageListSizeKey) {
      rememberMeasuredRowSize(element.dataset.messageListSizeKey, size);
    }
    return size;
  }, []);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) {
        detachFromBottom();
      }
    },
    [detachFromBottom],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowUp":
        case "PageUp":
        case "Home":
          detachFromBottom();
          break;
      }
    },
    [detachFromBottom],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: pinEpoch changes exactly once per captured anchor
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !prependAnchorRef.current) return;
    // Runs before paint after each commit, after every Virtuoso DOM update (mutation callbacks precede
    // paint), and per frame for late size changes, so neither the prepend nor re-measurement is visible.
    // Virtuoso corrects its estimate-based offset in separate scroll-only steps that look exactly like
    // reader scrolling, so while pinned the pin applies wheel input itself: the row lands where the
    // reader's scrolling alone would put it, and every other change to scrollTop is absorbed.
    const restore = () => {
      const anchor = prependAnchorRef.current;
      if (!anchor) return;
      if (anchor.atBottom) {
        if (anchor.pendingScroll === 0) {
          const bottom = scroller.scrollHeight - scroller.clientHeight;
          if (Math.abs(scroller.scrollTop - bottom) >= 0.5) scroller.scrollTop = bottom;
          return;
        }
        // The reader wheels away from the bottom: from here on, pin the row they are looking at.
        const visible = firstVisibleRow(scroller);
        if (!visible?.dataset.messageListRow) return;
        anchor.atBottom = false;
        anchor.key = visible.dataset.messageListRow;
        anchor.top = visible.getBoundingClientRect().top;
      }
      let row = scroller.querySelector<HTMLElement>(`[data-message-list-row="${CSS.escape(anchor.key)}"]`);
      if (!row) {
        // The reader scrolled the pinned row out of the rendered range; keep pinning a visible one.
        row = firstVisibleRow(scroller);
        if (!row?.dataset.messageListRow) return;
        anchor.key = row.dataset.messageListRow;
        anchor.top = row.getBoundingClientRect().top;
      }
      const target = anchor.top - anchor.pendingScroll;
      anchor.pendingScroll = 0;
      const delta = row.getBoundingClientRect().top - target;
      if (Math.abs(delta) >= 0.5) scroller.scrollTop += delta;
      // Re-read rather than trust the target: scrollTop clamps at either end of the content.
      anchor.top = row.getBoundingClientRect().top;
    };
    const handleWheel = (event: WheelEvent) => {
      const anchor = prependAnchorRef.current;
      if (!anchor || event.ctrlKey || event.deltaY === 0 || isInsideNestedScroller(event.target, scroller)) return;
      event.preventDefault();
      anchor.pendingScroll += wheelDeltaPx(event, scroller);
      restore();
    };
    // Touch, keyboard and scrollbar scrolling cannot be replayed by the pin; hand the position over.
    const release = () => {
      prependAnchorRef.current = null;
    };
    const releaseEvents = ["touchstart", "keydown", "pointerdown"] as const;
    const mutations = new MutationObserver(restore);
    mutations.observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    scroller.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    for (const event of releaseEvents) scroller.addEventListener(event, release, { capture: true, passive: true });
    setMeasureAheadPx(pagingRef.current.measureAheadPx);
    let frame = 0;
    const stop = () => {
      setMeasureAheadPx(0);
      cancelAnimationFrame(frame);
      mutations.disconnect();
      scroller.removeEventListener("wheel", handleWheel, { capture: true });
      for (const event of releaseEvents) scroller.removeEventListener(event, release, { capture: true });
    };
    const tick = () => {
      const anchor = prependAnchorRef.current;
      if (!anchor || performance.now() > anchor.until) {
        prependAnchorRef.current = null;
        stop();
        return;
      }
      restore();
      frame = requestAnimationFrame(tick);
    };
    restore();
    frame = requestAnimationFrame(tick);
    return stop;
  }, [pinEpoch]);

  useEffect(() => {
    const isNewTranscript = previousTranscriptKeyRef.current !== transcriptKey;
    previousTranscriptKeyRef.current = transcriptKey;
    if (!isNewTranscript) {
      return;
    }

    attachToBottom();
    if (shouldUseVirtuoso && rows.length > 0) {
      scrollToBottom("auto");
    }
  }, [attachToBottom, rows.length, scrollToBottom, shouldUseVirtuoso, transcriptKey]);

  useEffect(() => {
    if (!shouldUseVirtuoso || rows.length === 0 || !isFollowingBottom()) {
      return;
    }

    cancelPendingAutoscroll();
    pendingAutoscrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoscrollFrameRef.current = null;
      if (isFollowingBottom()) {
        virtuosoRef.current?.autoscrollToBottom();
      }
    });
  }, [cancelPendingAutoscroll, isFollowingBottom, rows, shouldUseVirtuoso]);

  useEffect(() => {
    return () => {
      cancelPendingAutoscroll();
    };
  }, [cancelPendingAutoscroll]);

  return (
    <div className="relative min-h-0 flex-1 bg-bg-sunken">
      {showEmptyState ? (
        <div className="h-full overflow-y-auto bg-bg-sunken px-7 py-6">
          <EmptyState
            hasProvider={hasProvider}
            oauthPending={oauthPending}
            onOpenProviders={onOpenProviders}
            onQuickConnectChatGPT={onQuickConnectChatGPT}
          />
        </div>
      ) : shouldUseVirtuoso ? (
        <Virtuoso
          key={transcriptKey}
          ref={virtuosoRef}
          components={VIRTUOSO_COMPONENTS}
          context={virtuosoContext}
          data={rows}
          firstItemIndex={firstItemIndex}
          scrollerRef={(element) => {
            scrollerRef.current = element instanceof HTMLElement ? element : null;
          }}
          style={MESSAGE_SCROLLER_STYLE}
          className="bg-bg-sunken [overflow-anchor:none]"
          atBottomStateChange={handleAtBottomStateChange}
          atBottomThreshold={CHAT_NEAR_BOTTOM_THRESHOLD_PX}
          alignToBottom={true}
          computeItemKey={computeItemKey}
          defaultItemHeight={DEFAULT_ESTIMATED_ROW_HEIGHT_PX}
          followOutput={followOutput}
          heightEstimates={heightEstimates}
          increaseViewportBy={
            measureAheadPx > 0
              ? { ...VIRTUOSO_VIEWPORT_INCREASE_PX, top: measureAheadPx }
              : VIRTUOSO_VIEWPORT_INCREASE_PX
          }
          initialTopMostItemIndex={initialTopMostItemIndex}
          itemSize={measureItemSize}
          minOverscanItemCount={VIRTUOSO_MIN_OVERSCAN_ITEMS}
          overscan={VIRTUOSO_OVERSCAN_PX}
          skipAnimationFrameInResizeObserver={true}
          startReached={handleStartReached}
          onKeyDownCapture={handleKeyDown}
          onWheelCapture={handleWheel}
          itemContent={renderRow}
        />
      ) : (
        <div className="h-full overflow-y-auto overflow-x-hidden bg-bg-sunken px-7 py-6">
          <div className="space-y-1">
            {rows.map((row) => (
              <div key={row.key} data-message-list-row={row.key}>
                <MessageListRowContent
                  row={row}
                  threadCwd={threadCwd}
                  onLoadChildThread={onLoadChildThread}
                  onReportMessage={onReportMessage}
                  lastCompletedResponseId={lastCompletedResponseId}
                  actionableErrorId={actionableErrorId}
                  onErrorRecovery={onErrorRecovery}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {showScrollBtn && <ScrollToBottom onClick={() => scrollToBottom("smooth")} />}
    </div>
  );
}

export const MessageList = memo(MessageListImpl);
