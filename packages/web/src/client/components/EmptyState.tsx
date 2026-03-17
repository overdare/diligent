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
      <div className="mb-8 rounded-xl border border-border/100 bg-surface-default px-8 py-7 text-center shadow-panel">
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-accent/75">Diligent workspace</div>
        <h2 className="mb-2 text-xl font-semibold text-text">What can I help you with?</h2>
        <p className="text-sm leading-6 text-muted">Ask a question or pick an example below</p>
      </div>
      <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onSelectPrompt(p.prompt)}
            className="rounded-xl border border-border/100 bg-surface-dark px-5 py-4 text-left text-sm text-text transition hover:border-accent/40 hover:bg-surface-light"
          >
            <div className="font-medium text-text-soft">{p.label}</div>
            <div className="mt-1 text-xs leading-5 text-muted">{p.prompt}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
