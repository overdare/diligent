// @summary Maps protocol user-input requests onto native VS Code quick-pick/input-box UX
import type { UserInputRequestParams, UserInputRequestResult } from "@diligent/protocol";
import * as vscode from "vscode";

export async function resolveUserInputRequest(params: UserInputRequestParams): Promise<UserInputRequestResult> {
  const answers: Record<string, string | string[]> = {};

  for (const question of params.request.questions) {
    if (question.allow_multiple) {
      const picked = await vscode.window.showQuickPick(
        question.options.map((option) => ({ label: option.label, description: option.description })),
        {
          placeHolder: question.question,
          canPickMany: true,
          ignoreFocusOut: true,
        },
      );
      answers[question.id] = picked?.map((item) => item.label) ?? [];
      continue;
    }

    const picked = await vscode.window.showQuickPick(
      question.options.map((option) => ({ label: option.label, description: option.description })),
      {
        placeHolder: question.question,
        ignoreFocusOut: true,
      },
    );

    if (picked) {
      answers[question.id] = picked.label;
      continue;
    }

    const typed = await vscode.window.showInputBox({
      prompt: question.question,
      placeHolder: question.header,
      password: question.is_secret === true,
      ignoreFocusOut: true,
    });
    answers[question.id] = typed ?? "";
  }

  return { answers };
}
