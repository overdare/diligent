// @summary Outer wrapper card for system-level inline cards (approval, question)

interface SystemCardProps {
  children: React.ReactNode;
}

export function SystemCard({ children }: SystemCardProps) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-assistant rounded-lg border border-text/15 bg-surface/60 px-4 py-3">{children}</div>
    </div>
  );
}
