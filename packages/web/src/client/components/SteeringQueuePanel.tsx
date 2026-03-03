// @summary Thin chip panel showing pending steering messages above InputDock

interface SteeringQueuePanelProps {
  pendingSteers: string[];
}

export function SteeringQueuePanel({ pendingSteers }: SteeringQueuePanelProps) {
  if (pendingSteers.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-text/10 px-4 py-2">
      {pendingSteers.map((text, i) => (
        <span
          key={`${i}-${text.slice(0, 16)}`}
          className="max-w-48 truncate rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-xs text-accent"
        >
          {text}
        </span>
      ))}
    </div>
  );
}
