// @summary Inline chat card for tool permission approval (once / always / reject)

import type { ApprovalRequest } from "@diligent/protocol";
import { Button } from "./Button";

interface ApprovalCardProps {
  request: ApprovalRequest;
  onDecide: (decision: "once" | "always" | "reject") => void;
}

export function ApprovalCard({ request, onDecide }: ApprovalCardProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[88%] rounded-lg border border-text/15 bg-surface/60 px-4 py-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Permission request</div>
        <p className="mb-1 text-sm text-text">
          <span className="font-semibold text-accent">{request.toolName}</span>
          {" wants "}
          <span className="font-medium">{request.permission}</span>
        </p>
        {request.description ? (
          <pre className="mb-3 whitespace-pre-wrap rounded border border-text/10 bg-bg/60 px-2 py-1.5 font-mono text-xs text-muted">
            {request.description}
          </pre>
        ) : null}
        <div className="flex gap-2">
          <Button size="sm" intent="ghost" onClick={() => onDecide("once")}>
            Once
          </Button>
          <Button size="sm" onClick={() => onDecide("always")}>
            Always
          </Button>
          <Button size="sm" intent="danger" onClick={() => onDecide("reject")}>
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
