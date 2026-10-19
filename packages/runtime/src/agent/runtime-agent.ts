// @summary RuntimeAgent — Agent subclass carrying an optional AgentRegistry for collab support

import type { AgentOptions } from "@diligent/core/agent";
import { Agent } from "@diligent/core/agent";
import type { Model, SystemSection } from "@diligent/core/provider-contract";
import type { Tool } from "@diligent/core/tool-contract";
// type-only import to avoid circular dependency: collab/registry → agent/runtime-agent → collab/registry
import type { AgentRegistry } from "../collab/registry";
import { CodeModeSession } from "../tools/code-mode/session";
import { acceptContextInjectionMetadata } from "./context-acceptance";

export class RuntimeAgent extends Agent {
  readonly registry?: AgentRegistry;
  /** Code mode cells and store; survives tool refreshes so yielded `exec` cells resume across turns. */
  readonly codeModeSession: CodeModeSession;

  constructor(
    model: Model,
    systemPrompt: SystemSection[],
    tools: Tool[],
    opts?: AgentOptions,
    registry?: AgentRegistry,
    codeModeSession = new CodeModeSession(),
  ) {
    super(model, systemPrompt, tools, opts);
    this.registry = registry;
    this.codeModeSession = codeModeSession;
    this.subscribe((event) => {
      if (event.type !== "context_injected") return;
      for (const injection of event.injections) acceptContextInjectionMetadata(injection.metadata);
    });
  }
}
