// @summary Restore the workspace's last agent view before mounting without trapping explicit Back.
import { isStudioView, STUDIO_VIEW_ROUTE } from "../../shared/studio-view";

export async function prepareStudioEntry(
  pathname: string,
  search: string,
  request: typeof fetch,
  replace: (path: string) => void,
): Promise<boolean> {
  if (!["/", "/claude", "/terminal"].includes(pathname)) return true;
  const explicitAgent = pathname === "/" && new URLSearchParams(search).get("view") === "agent";
  try {
    if (pathname === "/" && !explicitAgent) {
      const response = await request(STUDIO_VIEW_ROUTE, { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const state = await response.json();
        if (isStudioView(state.view) && state.view !== "agent") {
          replace(`/${state.view}`);
          return false;
        }
      }
    } else {
      await request(STUDIO_VIEW_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: explicitAgent ? "agent" : pathname.slice(1) }),
        signal: AbortSignal.timeout(3000),
      });
    }
  } catch {
    /* A missing preference endpoint must not prevent ordinary agent use. */
  }
  return true;
}
