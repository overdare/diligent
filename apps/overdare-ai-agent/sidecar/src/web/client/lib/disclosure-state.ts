// @summary Remembers transcript disclosure (open/closed) state across row remounts and regrouping

import { useCallback, useState } from "react";

// Virtualized rows unmount off-screen, and a lone tool row becomes a group when the next call arrives.
// Keeping the user's choice outside the component lets either remount restore it.
const openStates = new Map<string, boolean>();

export function toolDisclosureKey(toolItemId: string): string {
  return `tool:${toolItemId}`;
}

/** A tool group is identified by its first call so appending calls keeps the same state. */
export function toolGroupDisclosureKey(firstToolItemId: string): string {
  return `tool-group:${firstToolItemId}`;
}

export function getRememberedOpen(key: string): boolean | undefined {
  return openStates.get(key);
}

/** Records a state the reader saw without choosing it, so regrouping does not collapse it under them. */
export function rememberShownOpen(key: string, open: boolean): void {
  if (!openStates.has(key)) openStates.set(key, open);
}

export function useRememberedOpen(key: string, initialOpen: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => openStates.get(key) ?? initialOpen);
  const setOpen = useCallback(
    (next: boolean) => {
      openStates.set(key, next);
      setOpenState(next);
    },
    [key],
  );
  return [open, setOpen];
}
