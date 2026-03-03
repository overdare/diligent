// @summary React hook for server-driven approval and user-input prompt state and resolution
import type { DiligentServerRequest, DiligentServerRequestResponse, UserInputRequest } from "@diligent/protocol";
import type { RefObject } from "react";
import { useCallback, useState } from "react";
import type { WebRpcClient } from "./rpc-client";

export function useServerRequests(rpcRef: RefObject<WebRpcClient | null>) {
  const [approvalPrompt, setApprovalPrompt] = useState<{
    requestId: number;
    request: DiligentServerRequest;
  } | null>(null);
  const [questionPrompt, setQuestionPrompt] = useState<{
    requestId: number;
    request: UserInputRequest;
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Registered in App.tsx's main useEffect via rpc.onServerRequest(serverRequests.handleServerRequest)
  const handleServerRequest = useCallback((requestId: number, request: DiligentServerRequest): void => {
    if (request.method === "approval/request") {
      setApprovalPrompt({ requestId, request });
      return;
    }
    setAnswers({});
    setQuestionPrompt({ requestId, request: request.params.request });
  }, []);

  const resolveApproval = useCallback(
    (decision: "once" | "always" | "reject"): void => {
      if (!approvalPrompt) return;
      rpcRef.current?.respondServerRequest(approvalPrompt.requestId, {
        method: "approval/request",
        result: { decision },
      });
      setApprovalPrompt(null);
    },
    [rpcRef, approvalPrompt],
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

  return {
    approvalPrompt,
    questionPrompt,
    answers,
    setAnswers,
    handleServerRequest,
    resolveApproval,
    resolveQuestion,
  };
}
