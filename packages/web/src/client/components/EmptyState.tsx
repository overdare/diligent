// @summary Empty state with example prompt cards shown when no messages exist

interface EmptyStateProps {
  onSelectPrompt: (prompt: string) => void;
}

const EXAMPLE_PROMPTS = [
  {
    label: "Explain this codebase",
    prompt: "Give me an overview of this codebase and its architecture.",
  },
  {
    label: "Find potential bugs",
    prompt: "Are there any obvious bugs or issues in the current code?",
  },
  {
    label: "Write unit tests",
    prompt: "Help me write unit tests for the main functionality.",
  },
  {
    label: "Suggest refactors",
    prompt: "Which files could benefit from refactoring and how?",
  },
];

export function EmptyState({ onSelectPrompt }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-16">
      <h2 className="mb-1 text-lg font-semibold text-text">What can I help you with?</h2>
      <p className="mb-8 text-sm text-muted">Ask a question or pick an example below</p>
      <div className="grid w-full max-w-lg grid-cols-2 gap-3">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onSelectPrompt(p.prompt)}
            className="rounded-lg border border-text/15 bg-surface/50 px-4 py-3 text-left text-sm text-text transition hover:border-accent/40 hover:bg-accent/5"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
