// @summary Copy-to-clipboard button with transient "copied!" feedback

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  className?: string;
}

export function CopyButton({ text, className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`rounded px-1.5 py-0.5 font-mono text-2xs text-muted transition hover:bg-text/10 hover:text-text ${className}`}
    >
      {copied ? "copied!" : "copy"}
    </button>
  );
}
