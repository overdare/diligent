// @summary Reusable show-more/less toggle button for expandable content blocks

interface ExpandButtonProps {
  expanded: boolean;
  onToggle: () => void;
  detail?: string;
}

export function ExpandButton({ expanded, onToggle, detail }: ExpandButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full border-t border-border/10 py-1.5 text-center font-mono text-2xs text-muted transition hover:text-text"
    >
      {expanded ? "Show less ▴" : `Show more ▾${detail ? ` (${detail})` : ""}`}
    </button>
  );
}
