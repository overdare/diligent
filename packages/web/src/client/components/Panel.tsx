// @summary Surface panel component used for top bars, chat stream, and input areas
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Panel(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("rounded-lg border border-text/10 bg-surface shadow-panel", props.className)} />;
}
