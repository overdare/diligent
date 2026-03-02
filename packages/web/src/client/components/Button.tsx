// @summary Variant-based button component for Web CLI actions and modal decisions
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Intent = "primary" | "danger" | "ghost";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: Intent;
  size?: Size;
}

const intentClasses: Record<Intent, string> = {
  primary: "bg-accent text-bg hover:opacity-90",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "bg-surface text-text border border-text/15 hover:border-accent",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

export function Button({ className, intent = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50",
        intentClasses[intent],
        sizeClasses[size],
        className,
      )}
    />
  );
}
