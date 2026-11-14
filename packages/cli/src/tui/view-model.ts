// @summary Stable CLI-local view model exposing renderer-agnostic TUI state for current and future frontends

import type { Mode as ProtocolMode, ThinkingEffort } from "@diligent/protocol";
import type { ChatView } from "./components/chat-view";
import type { InputEditor } from "./components/input-editor";
import type { StatusBar } from "./components/status-bar";

export interface TuiViewModel {
  transcript: {
    getLastUsage: () => { input: number; output: number; cost: number } | null;
    hasActiveQuestion: () => boolean;
  };
  prompt: {
    getText: () => string;
    setText: (text: string) => void;
    setPendingSteers: (steers: string[]) => void;
  };
  status: {
    update: (updates: Record<string, unknown>) => void;
    resetUsage: () => void;
  };
  runtime: {
    getThreadId: () => string | null;
    getIsProcessing: () => boolean;
    getMode: () => ProtocolMode;
    getEffort: () => ThinkingEffort;
  };
}

export function createTuiViewModel(args: {
  chatView: ChatView;
  inputEditor: InputEditor;
  statusBar: StatusBar;
  getThreadId: () => string | null;
  getIsProcessing: () => boolean;
  getMode: () => ProtocolMode;
  getEffort: () => ThinkingEffort;
}): TuiViewModel {
  return {
    transcript: {
      getLastUsage: () => args.chatView.getLastUsage(),
      hasActiveQuestion: () => args.chatView.hasActiveQuestion(),
    },
    prompt: {
      getText: () => args.inputEditor.getText(),
      setText: (text) => args.inputEditor.setText(text),
      setPendingSteers: (steers) => args.chatView.setPendingSteers(steers),
    },
    status: {
      update: (updates) => args.statusBar.update(updates),
      resetUsage: () => args.statusBar.resetUsage(),
    },
    runtime: {
      getThreadId: args.getThreadId,
      getIsProcessing: args.getIsProcessing,
      getMode: args.getMode,
      getEffort: args.getEffort,
    },
  };
}
