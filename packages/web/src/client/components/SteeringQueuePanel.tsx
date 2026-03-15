// @summary Pending steering panel rendering queued messages as stacked single lines above InputDock

interface SteeringQueuePanelProps {
  pendingSteers: string[];
}

export function SteeringQueuePanel({ pendingSteers }: SteeringQueuePanelProps) {
  if (pendingSteers.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-text/10 px-4 py-2">
      <div className="space-y-1 font-mono text-xs text-accent/90">
        {pendingSteers.map((text, i) => (
          <div key={`${i}-${text.slice(0, 16)}`} className="truncate">
            ⚑ steering {text}
          </div>
        ))}
      </div>
    </div>
  );
}
