// @summary React hook for server-driven approval and user-input prompt state and resolution
import type { DiligentServerRequest, DiligentServerRequestResponse, UserInputRequest } from "@diligent/protocol";
import type { RefObject } from "react";
import { useCallback, useRef, useState } from "react";
import type { WebRpcClient } from "./rpc-client";

interface BufferedServerRequest {
  requestId: number;
  request: DiligentServerRequest;
}

export function useServerRequests(
  rpcRef: RefObject<WebRpcClient | null>,
  activeThreadIdRef?: RefObject<string | null>,
  onAttention?: (threadId: string) => void,
) {
  const [approvalPrompt, setApprovalPrompt] = useState<{
    requestId: number;
    request: DiligentServerRequest;
  } | null>(null);
  const [questionPrompt, setQuestionPrompt] = useState<{
    requestId: number;
    request: UserInputRequest;
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Track current approval in a ref so callbacks always see the latest value
  // without needing it in their dependency array (avoids stale closure issues).
  const approvalRef = useRef<{ requestId: number; request: DiligentServerRequest } | null>(null);

  // Buffered server requests for non-active threads — shown when the user switches to that thread.
  // Map key is threadId. Only the latest request per thread is kept; earlier ones are auto-rejected/dismissed.
  const bufferedRef = useRef<Map<string, BufferedServerRequest>>(new Map());

  /** Dismiss a buffered request by sending a safe fallback response. */
  const dismissBuffered = useCallback(
    (entry: BufferedServerRequest): void => {
      if (entry.request.method === "approval/request") {
        rpcRef.current?.respondServerRequest(entry.requestId, {
          method: "approval/request",
          result: { decision: "reject" },
        });
      } else {
        rpcRef.current?.respondServerRequest(entry.requestId, {
          method: "userInput/request",
          result: { answers: {} },
        } as DiligentServerRequestResponse);
      }
    },
    [rpcRef],
  );

  /** Auto-reject a pending approval that is about to be displaced by a new one. */
  const rejectPendingApproval = useCallback((): void => {
    const prev = approvalRef.current;
    if (prev) {
      rpcRef.current?.respondServerRequest(prev.requestId, {
        method: "approval/request",
        result: { decision: "reject" },
      });
      approvalRef.current = null;
    }
  }, [rpcRef]);

  // Registered in App.tsx's main useEffect via rpc.onServerRequest(serverRequests.handleServerRequest)
  const handleServerRequest = useCallback(
    (requestId: number, request: DiligentServerRequest): void => {
      const threadId = request.params?.threadId;

      // Request targets a thread other than the currently viewed one —
      // buffer it so the user sees a marker in the sidebar and can switch to respond.
      if (threadId && activeThreadIdRef?.current && threadId !== activeThreadIdRef.current) {
        // Auto-dismiss previously buffered request for the same thread (only latest kept).
        const prev = bufferedRef.current.get(threadId);
        if (prev) {
          dismissBuffered(prev);
        }
        bufferedRef.current.set(threadId, { requestId, request });
        onAttention?.(threadId);
        return;
      }

      if (request.method === "approval/request") {
        // If there is already a pending approval, auto-reject it before showing
        // the new one. Only one approval dialog can be visible at a time.
        rejectPendingApproval();
        approvalRef.current = { requestId, request };
        setApprovalPrompt({ requestId, request });
        return;
      }
      setAnswers({});
      setQuestionPrompt({ requestId, request: request.params.request });
    },
    [activeThreadIdRef, dismissBuffered, rejectPendingApproval, onAttention],
  );

  const handleServerRequestResolved = useCallback((requestId: number): void => {
    // Clear from active approval
    if (approvalRef.current?.requestId === requestId) {
      approvalRef.current = null;
    }
    setApprovalPrompt((current) => (current?.requestId === requestId ? null : current));
    setQuestionPrompt((current) => (current?.requestId === requestId ? null : current));

    // Clear from buffer if it was resolved server-side (e.g. another client responded)
    for (const [tid, entry] of bufferedRef.current) {
      if (entry.requestId === requestId) {
        bufferedRef.current.delete(tid);
        break;
      }
    }
  }, []);

  const resolveApproval = useCallback(
    (decision: "once" | "always" | "reject"): void => {
      const current = approvalRef.current;
      if (!current) return;
      rpcRef.current?.respondServerRequest(current.requestId, {
        method: "approval/request",
        result: { decision },
      });
      approvalRef.current = null;
      setApprovalPrompt(null);
    },
    [rpcRef],
  );

  const resolveQuestion = useCallback(
    (respondAnswers: Record<string, string>): void => {
      if (!questionPrompt) return;
      rpcRef.current?.respondServerRequest(questionPrompt.requestId, {
        method: "userInput/request",
        result: { answers: respondAnswers },
      } as DiligentServerRequestResponse);
      setQuestionPrompt(null);
    },
    [rpcRef, questionPrompt],
  );

  /** Call when user switches to a thread. Promotes a buffered request to the active dialog. */
  const activateThread = useCallback(
    (threadId: string): void => {
      const buffered = bufferedRef.current.get(threadId);
      if (!buffered) return;

      bufferedRef.current.delete(threadId);

      if (buffered.request.method === "approval/request") {
        // Replace any currently visible approval (auto-reject it first).
        rejectPendingApproval();
        approvalRef.current = buffered;
        setApprovalPrompt(buffered);
      } else {
        // Promote buffered user-input request to the active question prompt.
        setAnswers({});
        setQuestionPrompt({ requestId: buffered.requestId, request: buffered.request.params.request });
      }
    },
    [rejectPendingApproval],
  );

  return {
    approvalPrompt,
    questionPrompt,
    answers,
    setAnswers,
    handleServerRequest,
    handleServerRequestResolved,
    resolveApproval,
    resolveQuestion,
    activateThread,
  };
}
