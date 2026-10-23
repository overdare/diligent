# File Link Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open generated filesystem links in a new Web preview without navigating to a filesystem URL or treating project paths as ordinary website routes.

**Architecture:** Add a transport-neutral `file/read` contract and runtime handler, consumed by a dedicated Web preview page and a TUI `/file` command. Web Markdown links are rewritten synchronously to a same-origin preview route so normal browser new-tab behavior and popup permissions remain intact. Resolve files against the originating thread's project and validate canonical paths before reading.

**Tech Stack:** Bun, TypeScript, Zod, React, Marked, existing JSON-RPC clients.

**Spec:** User-approved conversation and OVDR-16094. Preserve HTTP(S) links; support changing POSIX/Windows absolute paths, project-relative paths, and existing file URIs; preview images, Markdown, text, and directories. Do not use `file://` for Web navigation. The user explicitly requested implementation, a ticket, and a new branch; execute in the current checkout, preserving unrelated work.

## Global Constraints

- All tracked content is English; Jira descriptions are Korean.
- Tests live under package-level `test/`; public JSON-RPC behavior lives under `packages/e2e/app-server/`.
- The server computer owns filesystem paths. Canonical paths must remain inside the originating project, including symlinks.
- Use a bounded 10 MiB file read; report absent, inaccessible, unsupported-platform, and oversized files clearly.
- Browser-supported raster images use base64 payloads; UTF-8 Markdown/text use string payloads; other bytes are downloadable.
- Preview Markdown must escape raw HTML and reject executable URL schemes. Normal web links and anchors retain their meaning.
- Directory listings allow navigating to entries. Document-relative links retain the document directory and thread context.

## Review Focus

- Encoded spaces, Unicode, percent signs, fragments, and query-like characters must survive route round trips.
- Windows drive paths must never be mistaken for external protocols or relative POSIX names.
- A symlink or `..` cannot expose a file outside the thread project.
- Opening previews must not create/resume a conversation or change its active thread.
- Reconnection, missing files, loading, and unmount must produce stable preview states without stale responses.

### Task 1: Shared file reads and thin-client previews

**Files:**
- Create: `packages/runtime/src/client/file-link.ts`, `packages/runtime/src/app-server/file-handlers.ts`.
- Modify: protocol methods/request schemas, runtime client exports/request dispatch.
- Create: Web `shared/file-routes.ts`, client `components/FilePreview.tsx` and `lib/file-preview.ts`.
- Modify: Web Markdown rendering, `MarkdownContent.tsx`, and `main.tsx`.
- Create: TUI `commands/builtin/file.ts`; register it in built-in commands.
- Add: runtime normalization tests, app-server file/read e2e tests, Web routing/preview tests, and TUI command tests.
- Add: `docs/guide/file-links.md` and architecture routing entry.

**Interfaces:**
- `parseFileLink(href: string): { path: string; fragment?: string } | null` is browser-safe and distinguishes files from URL schemes and anchors.
- `file/read({ path: string, threadId?: string })` returns a discriminated union with `kind`, canonical `path`, and `name`; text/Markdown carry `content`, image/binary carry `dataBase64` and `mediaType`, directories carry named entries.
- `toFilePreviewUrl(href, { threadId?, basePath? })` rewrites only local links to `/_diligent/file?...`; nested previews retain thread and document directory.
- `FilePreview` consumes only `file/read`; it never invokes thread lifecycle methods.

- [x] **Step 1:** Add failing behavior tests for link rewriting and public file/read results (file content/bytes, directory entries, origin thread, containment, missing files, size limit). Run them and confirm missing feature failures.
- [x] **Step 2:** Implement the shared parser, protocol schemas, bounded runtime handler, and dispatch. Run normalization and file/read e2e tests; expect PASS.
- [x] **Step 3:** Add failing Web tests for target URLs, preview content/error/loading, escaped Markdown, nested links, and thread propagation. Implement the preview route/page and rendering; expect PASS.
- [x] **Step 4:** Add failing TUI tests proving `/file` requests the correct path/thread and displays the returned content/errors. Implement and register the command; expect PASS.
- [x] **Step 5:** Document supported paths and limitations. Run affected suites, typecheck, lint, and Web build; inspect actual browser preview using synthetic project fixtures.
- [x] **Step 6:** Review the whole change with one fresh reviewer; fix important findings with regression tests. Commit only task files with `OVDR-16094` in the commit body, update Jira with final results, and leave the issue In Progress. Do not push or create a PR without a user request.
