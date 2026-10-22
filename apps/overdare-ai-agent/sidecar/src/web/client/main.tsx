// @summary React entrypoint mounting the Web CLI app and loading Tailwind/token styles
import "./polyfills";
import "./sentry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FILE_PREVIEW_ROUTE } from "../shared/file-routes";
import { App } from "./App";
import { FilePreview } from "./components/FilePreview";
import { loadFilePreview } from "./lib/file-preview";
import "highlight.js/styles/github-dark.css";
import "./styles/index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

const query = new URLSearchParams(window.location.search);
const page =
  window.location.pathname === FILE_PREVIEW_ROUTE ? (
    <FilePreview path={query.get("path") ?? ""} threadId={query.get("threadId") ?? undefined} load={loadFilePreview} />
  ) : (
    <App />
  );

createRoot(root).render(<StrictMode>{page}</StrictMode>);
