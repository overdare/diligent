// @summary Outer wrapper card for system-level inline cards (approval, question)

interface SystemCardProps {
  children: React.ReactNode;
}

export function SystemCard({ children }: SystemCardProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-assistant rounded-xl border border-border/100 bg-surface-default px-5 py-4 shadow-panel">
        {children}
      </div>
    </div>
  );
}
