// @summary Uppercase monospace section label for tool input/output and card headers

interface SectionLabelProps {
  children: React.ReactNode;
}

export function SectionLabel({ children }: SectionLabelProps) {
  return <div className="mb-2 font-mono text-2xs uppercase tracking-[0.18em] text-text-secondary">{children}</div>;
}
