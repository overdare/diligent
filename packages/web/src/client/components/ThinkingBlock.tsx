// @summary Collapsible thinking/reasoning block with monospace content

interface ThinkingBlockProps {
  text: string;
}

export function ThinkingBlock({ text }: ThinkingBlockProps) {
  return (
    <details className="mb-2 rounded-lg border border-text/10 bg-bg/40">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 font-mono text-xs text-muted hover:text-text">
        <span className="opacity-60">◈</span>
        <span>Thinking</span>
      </summary>
      <pre className="overflow-x-auto whitespace-pre-wrap border-t border-text/10 px-3 pb-2 pt-2 font-mono text-xs leading-relaxed text-muted">
        {text}
      </pre>
    </details>
  );
}
