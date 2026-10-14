// @summary Bind product-provider tests to a synthetic runtime scope, never a production fallback ID
import type { AgentLoopHook } from "@diligent/core/agent";
import {
  type BundledToolProvider,
  runWithSessionExecutionContext,
  type SessionExecutionContext,
} from "@diligent/runtime";

export function bindStudioTestSession(provider: BundledToolProvider) {
  let cwd = "";
  let scope: SessionExecutionContext = {
    sessionId: "sess",
    rootSessionId: "sess",
    resumed: false,
    rootRequest: { sessionId: "sess", requestId: "initial" },
  };
  return {
    ...provider,
    async onUserPromptSubmit(input: Parameters<NonNullable<BundledToolProvider["onUserPromptSubmit"]>>[0]) {
      cwd = input.cwd;
      scope = {
        sessionId: input.session_id,
        rootSessionId: input.session_id,
        resumed: false,
        rootRequest: { sessionId: input.session_id, requestId: crypto.randomUUID() },
      };
      return provider.onUserPromptSubmit!(input);
    },
    async createTools(input: Parameters<BundledToolProvider["createTools"]>[0]) {
      return (await provider.createTools(input)).map((tool) => ({
        ...tool,
        execute: (...args: Parameters<typeof tool.execute>) =>
          runWithSessionExecutionContext(scope, () => tool.execute(...args)),
      }));
    },
    createAgentLoopHooks(
      input: Parameters<NonNullable<BundledToolProvider["createAgentLoopHooks"]>>[0],
    ): AgentLoopHook[] {
      return (provider.createAgentLoopHooks?.({ ...input, cwd: input.cwd ?? cwd }) ?? []).map((hook) => ({
        ...hook,
        onPromptStart: (context) => runWithSessionExecutionContext(scope, () => hook.onPromptStart?.(context)),
        beforeTurn: (context) => runWithSessionExecutionContext(scope, () => hook.beforeTurn?.(context)),
      }));
    },
  };
}
