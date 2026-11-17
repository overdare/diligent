// @summary Tests for the /rename command — RPC dispatch for the active thread and the no-thread error

import { describe, expect, it, mock } from "bun:test";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { renameCommand } from "../../../../src/tui/commands/builtin/session";
import type { CommandContext } from "../../../../src/tui/commands/types";
import type { AppServerRpcClient } from "../../../../src/tui/rpc-client";

function makeContext(overrides: Partial<CommandContext>): CommandContext {
  return {
    app: { confirm: async () => true, pick: async () => null, prompt: async () => null, stop: () => {} },
    threadId: null,
    displayLines: () => {},
    displayError: () => {},
    ...overrides,
  } as CommandContext;
}

function appWithRpc(request: (...args: unknown[]) => Promise<unknown>): CommandContext["app"] {
  return {
    confirm: async () => true,
    pick: async () => null,
    prompt: async () => null,
    stop: () => {},
    getRpcClient: () => ({ request }) as unknown as AppServerRpcClient,
  };
}

describe("/rename", () => {
  it("sets the trimmed name on the active thread", async () => {
    const request = mock(async () => ({}));
    const displayLines = mock((_lines: string[]) => {});
    await renameCommand.handler(
      "  Release notes  ",
      makeContext({ app: appWithRpc(request), threadId: "t-1", displayLines }),
    );

    expect(request).toHaveBeenCalledWith(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_NAME_SET, {
      threadId: "t-1",
      name: "Release notes",
    });
    expect(displayLines.mock.calls[0]?.[0]?.join("")).toContain("Thread renamed: Release notes");
  });

  it("clears the name when no name is given", async () => {
    const request = mock(async () => ({}));
    await renameCommand.handler(undefined, makeContext({ app: appWithRpc(request), threadId: "t-1" }));

    expect(request).toHaveBeenCalledWith(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_NAME_SET, {
      threadId: "t-1",
      name: "",
    });
  });

  it("reports an error without a request when there is no active thread", async () => {
    const request = mock(async () => ({}));
    const displayError = mock((_message: string) => {});
    await renameCommand.handler("x", makeContext({ app: appWithRpc(request), threadId: null, displayError }));

    expect(request).not.toHaveBeenCalled();
    expect(displayError).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal instead of throwing", async () => {
    const request = mock(async () => {
      throw new Error("Cannot rename a thread that is currently running");
    });
    const displayError = mock((_message: string) => {});
    await renameCommand.handler("x", makeContext({ app: appWithRpc(request), threadId: "t-1", displayError }));

    expect(displayError).toHaveBeenCalledWith("Cannot rename a thread that is currently running");
  });
});
