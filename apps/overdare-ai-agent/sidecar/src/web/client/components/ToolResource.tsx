// @summary Opens a host-owned saved resource on demand, with an opaque reference fallback for other clients.
import type { ResourceBlock } from "@diligent/protocol";
import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { PerformanceJobIdSchema } from "../../shared/performance-protocol";
import { Modal } from "./Modal";

const Viewer = lazy(() => import("./PerformanceViewer").then((module) => ({ default: module.PerformanceViewer })));

export function ToolResource({ block }: { block: ResourceBlock }) {
  const [open, setOpen] = useState(false);
  const supported =
    block.resourceType === "overdare.performance_capture" && PerformanceJobIdSchema.safeParse(block.resourceId).success;
  const pagePath = typeof window === "undefined" ? "" : window.location.pathname.slice(1);
  const threadId = pagePath && !pagePath.includes("/") ? pagePath : undefined;
  return (
    <div className="space-y-2 rounded border border-border p-3">
      {supported ? (
        <button
          type="button"
          className="text-sm text-text-secondary underline underline-offset-4"
          onClick={() => setOpen(true)}
        >
          {block.title}
        </button>
      ) : (
        <p>{block.title}</p>
      )}
      <p className="break-all font-mono text-xs text-muted">{block.resourceId}</p>
      {open &&
        createPortal(
          <Modal title="Performance capture" wide onCancel={() => setOpen(false)}>
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                className="rounded border border-border px-3 py-1 text-sm"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <Suspense fallback={<output>Loading viewer…</output>}>
              <Viewer jobId={block.resourceId} threadId={threadId} />
            </Suspense>
          </Modal>,
          document.body,
        )}
    </div>
  );
}
