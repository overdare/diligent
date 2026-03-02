// @summary Auto-resizing textarea capped at maxRows, Shift+Enter for newlines

import { type TextareaHTMLAttributes, useEffect, useRef } from "react";
import { cn } from "../lib/cn";

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxRows?: number;
}

export function TextArea({ maxRows = 6, className, onChange, ...props }: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 24;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxRows)}px`;
  }

  useEffect(() => {
    resize();
  });

  return (
    <textarea
      ref={ref}
      rows={1}
      className={cn(
        "w-full resize-none overflow-y-hidden rounded-md border border-text/20 bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      onChange={(e) => {
        onChange?.(e);
        resize();
      }}
      {...props}
    />
  );
}
