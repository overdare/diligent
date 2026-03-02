// @summary Uppercase monospace section label for tool input/output and card headers

interface SectionLabelProps {
  children: React.ReactNode;
}

export function SectionLabel({ children }: SectionLabelProps) {
  return <div className="mb-1 font-mono text-2xs uppercase tracking-wider text-muted">{children}</div>;
}
