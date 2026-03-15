// @summary Renderer-agnostic dialog orchestration for confirmations, approvals, and inline user-input prompts

import type {
  ApprovalRequest,
  ApprovalResponse,
  UserInputQuestion,
  UserInputRequest,
  UserInputResponse,
} from "@diligent/runtime";
import type { AppRuntimeState } from "./app-runtime-state";
import { ApprovalDialog } from "./components/approval-dialog";
import { ConfirmDialog, type ConfirmDialogOptions } from "./components/confirm-dialog";
import { QuestionInput } from "./components/question-input";
import type { OverlayStack } from "./framework/overlay";
import type { TUIRenderer } from "./framework/renderer";
import type { Component } from "./framework/types";

export interface AppDialogsDeps {
  overlayStack: OverlayStack;
  renderer: TUIRenderer;
  runtime: AppRuntimeState;
  setActiveInlineQuestion: (component: (Component & { handleInput(data: string): void }) | null) => void;
  restoreFocus: () => void;
}

export class AppDialogs {
  constructor(private deps: AppDialogsDeps) {}

  async confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = new ConfirmDialog(options, (confirmed) => {
        handle.hide();
        this.deps.restoreFocus();
        this.deps.renderer.requestRender();
        resolve(confirmed);
      });
      const handle = this.deps.overlayStack.show(dialog, { anchor: "center" });
      this.deps.renderer.requestRender();
    });
  }

  async handleApprove(request: ApprovalRequest): Promise<ApprovalResponse> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (response: ApprovalResponse) => {
        if (settled) return;
        settled = true;
        this.deps.setActiveInlineQuestion(null);
        this.deps.renderer.requestRender();
        resolve(response);
      };

      const dialog = new ApprovalDialog(
        {
          toolName: request.toolName,
          permission: request.permission,
          description: request.description,
          details: request.details?.command
            ? String(request.details.command)
            : (request.details?.file_path ?? request.details?.path)
              ? String(request.details.file_path ?? request.details.path)
              : undefined,
        },
        finish,
      );

      this.deps.setActiveInlineQuestion(dialog);
      this.deps.renderer.requestRender();
    });
  }

  async handleAsk(request: UserInputRequest): Promise<UserInputResponse> {
    const answers: Record<string, string | string[]> = {};
    for (const question of request.questions) {
      if (this.deps.runtime.activeUserInputResolved) {
        answers[question.id] = "";
        continue;
      }
      answers[question.id] = await this.showInlineQuestionInput(question);
    }
    return { answers };
  }

  private async showInlineQuestionInput(question: UserInputQuestion): Promise<string | string[]> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: string | string[] | null) => {
        if (settled) return;
        settled = true;
        this.deps.setActiveInlineQuestion(null);
        this.deps.runtime.activeQuestionCancel = null;
        this.deps.renderer.requestRender();
        if (Array.isArray(value)) {
          resolve(value);
          return;
        }
        resolve(value ?? "");
      };

      const input = new QuestionInput(
        {
          header: question.header,
          question: question.question,
          options: question.options,
          allowMultiple: question.allow_multiple,
          allowOther: question.is_other,
          masked: question.is_secret,
          placeholder: question.is_secret ? "enter value…" : undefined,
        },
        (value) => finish(value),
      );

      this.deps.runtime.activeQuestionCancel = () => finish(null);
      this.deps.setActiveInlineQuestion(input);
      this.deps.renderer.requestRender();
    });
  }
}
