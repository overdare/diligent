// @summary Inline chat card for tool permission approval (once / always / reject)

import type { ApprovalRequest } from "@diligent/protocol";
import { Button } from "./Button";
import { SectionLabel } from "./SectionLabel";
import { SystemCard } from "./SystemCard";

interface ApprovalCardProps {
  request: ApprovalRequest;
  onDecide: (decision: "once" | "always" | "reject") => void;
}

export function ApprovalCard({ request, onDecide }: ApprovalCardProps) {
  return (
    <SystemCard>
      <SectionLabel>Permission request</SectionLabel>
      <p className="mb-1 text-sm text-text">
        <span className="font-semibold text-accent">{request.toolName}</span>
        {" wants "}
        <span className="font-medium">{request.permission}</span>
      </p>
      {request.description ? (
        <pre className="mb-3 whitespace-pre-wrap rounded border border-text/10 bg-bg/40 px-2 py-1.5 font-mono text-xs text-muted">
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
    </SystemCard>
  );
}
