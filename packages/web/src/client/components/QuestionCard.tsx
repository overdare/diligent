// @summary Inline chat card for agent user-input questions with text/password fields

import type { UserInputRequest } from "@diligent/protocol";
import { Button } from "./Button";
import { Input } from "./Input";
import { SectionLabel } from "./SectionLabel";
import { SystemCard } from "./SystemCard";

interface QuestionCardProps {
  request: UserInputRequest;
  answers: Record<string, string>;
  onAnswerChange: (id: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function QuestionCard({ request, answers, onAnswerChange, onSubmit, onCancel }: QuestionCardProps) {
  return (
    <SystemCard>
      <SectionLabel>Input required</SectionLabel>
      <div className="space-y-3">
        {request.questions.map((question) => (
          <div key={question.id} className="space-y-1">
            <label htmlFor={question.id} className="text-sm font-semibold text-text">
              {question.header}
            </label>
            <p className="text-xs text-muted">{question.question}</p>
            {question.options.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {question.options.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onAnswerChange(question.id, opt.label)}
                    className={`rounded-md border px-3 py-1.5 text-xs transition ${
                      answers[question.id] === opt.label
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-text/15 bg-bg/40 text-muted hover:border-text/30 hover:text-text"
                    }`}
                    title={opt.description}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : null}
            <Input
              id={question.id}
              aria-label={question.header}
              type={question.is_secret ? "password" : "text"}
              placeholder={question.options.length > 0 ? "Or type a custom answer…" : undefined}
              value={answers[question.id] ?? ""}
              onChange={(e) => onAnswerChange(question.id, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" intent="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSubmit}>
          Submit
        </Button>
      </div>
    </SystemCard>
  );
}
