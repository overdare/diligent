// @summary React entrypoint mounting the Web CLI app and loading Tailwind/token styles
import "./polyfills";
import "./sentry";
import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FILE_PREVIEW_ROUTE } from "../shared/file-routes";
import { App } from "./App";
import { FilePreview } from "./components/FilePreview";
import { loadFilePreview } from "./lib/file-preview";
import { prepareStudioEntry } from "./lib/studio-entry";

const ClaudeTerminal = lazy(() =>
  import("./components/ClaudeTerminal").then((module) => ({ default: module.ClaudeTerminal })),
);
import "highlight.js/styles/github-dark.css";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

function StudioPage() {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  const [ready, setReady] = useState<string | null>(null);
  const key = location.pathname + location.search;
  useEffect(() => {
    const changed = () => setLocation({ pathname: window.location.pathname, search: window.location.search });
    const clicked = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || !["/", "/claude", "/terminal"].includes(url.pathname) || url.hash)
        return;
      event.preventDefault();
      // Stay in the same browser document. Native terminal processes belong to
      // the sidecar, and navigating the panel must never await their exit.
      window.history.pushState(null, "", url.pathname + url.search);
      changed();
    };
    window.addEventListener("popstate", changed);
    document.addEventListener("click", clicked);
    return () => {
      window.removeEventListener("popstate", changed);
      document.removeEventListener("click", clicked);
    };
  }, []);
  useEffect(() => {
    let active = true;
    void prepareStudioEntry(location.pathname, location.search, fetch, (path) => {
      if (!active) return;
      window.history.replaceState(null, "", path);
      setLocation({ pathname: window.location.pathname, search: window.location.search });
    }).then((mount) => {
      if (active && mount) setReady(key);
    });
    return () => {
      active = false;
    };
  }, [key, location.pathname, location.search]);
  if (ready !== key) return <div className="h-screen bg-bg-sunken" />;
  const query = new URLSearchParams(location.search);
  return location.pathname === "/claude" ? (
    <ClaudeTerminal key="claude" />
  ) : location.pathname === "/terminal" ? (
    <ClaudeTerminal key="shell" mode="shell" />
  ) : location.pathname === FILE_PREVIEW_ROUTE ? (
    <FilePreview path={query.get("path") ?? ""} threadId={query.get("threadId") ?? undefined} load={loadFilePreview} />
  ) : (
    <App />
  );
}

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<div className="h-screen bg-bg-sunken" />}>
      <StudioPage />
    </Suspense>
  </StrictMode>,
);
