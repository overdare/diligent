// @summary Collapsible thinking/reasoning block — streams live while thinking, collapses when done

interface ThinkingBlockProps {
  text: string;
  streaming?: boolean;
}

function summarize(text: string): string {
  const first = text.split(/[.\n]/)[0].trim();
  if (!first) return "";
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}

export function ThinkingBlock({ text, streaming = false }: ThinkingBlockProps) {
  if (streaming) {
    return <div className="opacity-30 font-mono text-xs leading-relaxed whitespace-pre-wrap">{text}</div>;
  }

  const summary = summarize(text);

  return (
    <details className="opacity-40 hover:opacity-60 transition-opacity">
      <summary className="cursor-pointer select-none font-mono text-xs list-none inline-flex items-center gap-1.5">
        <span className="text-muted">Thought</span>
        {summary && <span className="text-muted/70 truncate max-w-[40ch]">{summary}</span>}
      </summary>
      <pre className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed">{text}</pre>
    </details>
  );
}
