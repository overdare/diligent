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
  primary: "border border-transparent bg-fill-primary text-text hover:bg-fill-active",
  danger: "border border-transparent bg-danger text-text hover:opacity-90",
  ghost:
    "border border-border/100 bg-fill-secondary text-text hover:border-border-strong/100 hover:bg-fill-ghost-hover",
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
