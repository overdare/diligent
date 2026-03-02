// @summary Text input component with consistent focus ring and semantic surface styles
import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-md border border-text/20 bg-surface px-3 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        props.className,
      )}
    />
  );
}
