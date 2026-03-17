// @summary Auto-resizing textarea capped at maxRows, Shift+Enter for newlines

import { type TextareaHTMLAttributes, useLayoutEffect, useRef } from "react";
import { cn } from "../lib/cn";

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxRows?: number;
}

export function TextArea({ maxRows = 6, className, onChange, value, ...props }: TextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const lineHeight = 24;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxRows)}px`;
  });

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={cn(
        "w-full resize-none overflow-y-auto rounded-md border border-border/20 bg-bg px-3 py-2 text-sm text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
      onChange={onChange}
      {...props}
    />
  );
}
