// @summary Inline chat card for agent user-input questions with text/password fields

import type { UserInputRequest } from "@diligent/protocol";
import { Button } from "./Button";
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
      <div className="space-y-4">
        {request.questions.map((question) => {
          const selected = answers[question.id] ?? "";
          const hasOptions = question.options.length > 0;
          const selectedIsOption = hasOptions && question.options.some((o) => o.label === selected);

          return (
            <div key={question.id}>
              <p className="mb-2 text-sm font-semibold text-text">{question.question}</p>

              {/* Numbered option rows */}
              {hasOptions
                ? question.options.map((opt, i) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => onAnswerChange(question.id, opt.label)}
                      className={`flex w-full items-baseline gap-3 rounded px-2 py-1 text-left text-sm transition ${
                        selected === opt.label
                          ? "bg-accent/10 text-text"
                          : "text-muted hover:bg-surface/60 hover:text-text"
                      }`}
                    >
                      <span className="w-4 shrink-0 text-right font-mono text-xs opacity-40">{i + 1}</span>
                      <span className="flex-1">{opt.label}</span>
                      {opt.description ? <span className="shrink-0 text-xs opacity-40">{opt.description}</span> : null}
                    </button>
                  ))
                : null}

              {/* Custom / free-text input row */}
              <div className="flex items-center gap-3 px-2 py-1">
                {hasOptions ? (
                  <span className="w-4 shrink-0 text-right font-mono text-xs opacity-40">
                    {question.options.length + 1}
                  </span>
                ) : null}
                <div className="flex flex-1 flex-col">
                  <input
                    id={question.id}
                    aria-label={question.header}
                    type={question.is_secret ? "password" : "text"}
                    placeholder={hasOptions ? "or type a custom answer…" : "Type your answer…"}
                    value={selectedIsOption ? "" : selected}
                    onChange={(e) => onAnswerChange(question.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSubmit();
                    }}
                    className="bg-transparent text-sm text-text placeholder:text-muted/50 focus:outline-none"
                  />
                  <div className="border-b border-text/10" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2">
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
