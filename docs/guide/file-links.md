# File links and previews

Generated Markdown links can point to project files as well as websites. The Web client opens local file links in a new preview tab/window through `/_diligent/file?path=...&threadId=...`. The browser decides whether a new browsing context appears as a tab or window, just as it does for ordinary external links.

## Supported references

```markdown
[Read the documentation](docs/README.md)
[Open an image](<Screenshots/Agent/screen shot.png>)
[Open a Windows file](C:/Users/example/project/docs/README.md)
[Open a macOS file](/Users/example/project/docs/README.md)
[Browse a folder](docs/)
```

Windows backslash paths, repeated drive separators such as `C://Users/...`, and local `file:` URIs are recognized too. The Web client converts them to internal preview navigation; it never asks the browser to open a `file:` URL. Use angle brackets around Markdown destinations containing spaces. URI-encoded filenames are decoded once; route query parameters preserve literal percent signs, Unicode, `#`, and `?` characters.

HTTP(S), protocol-relative web addresses, email links, and anchor-only links retain their existing navigation. Existing persisted-image URLs remain unchanged.

## Where paths are resolved

Paths belong to the **agent server computer**, not necessarily the computer running the browser. Relative references resolve against the originating conversation's project directory; links inside a previewed Markdown document resolve against that document's directory. Preview URLs carry the originating thread ID, so opening a file does not switch the conversation or create a new one.

POSIX paths starting with `/` are absolute filesystem paths. Windows drive paths are supported when the agent runs on Windows. A Windows path cannot address a file on a macOS server. A file on a separate browser computer must be attached or otherwise made available to the agent server.

The runtime canonicalizes both the project directory and the requested path, and requires the target to stay inside the project. This applies to absolute paths, `..`, and symlinks. Local file URI hosts are limited to the empty host or `localhost`; remote shares are not fetched.

## Preview formats

| Kind | Web | TUI |
|---|---|---|
| PNG, JPEG, GIF, WebP, BMP, AVIF | Image preview, subject to browser codec support | File path and media type |
| UTF-8 `.md` / `.markdown` | Rendered Markdown; raw HTML is displayed as text | Terminal Markdown |
| Other UTF-8 text | Plain text/code | Plain text |
| Directory | Navigable entry list | Entry list |
| Other binary content | Download link | File path and media type |

Markdown previews preserve external links and convert local document/image references to preview links. Embedded local images open their own image preview. Executable link schemes are not rendered as clickable links.

Use `/file <path>` in the TUI, for example `/file docs/README.md`. Quoted paths with spaces are supported. Both clients request `file/read` and follow the same resolution and containment rules.

Reads are limited to 10 MiB, including files that grow during a read. Missing files, inaccessible paths, unsupported-platform paths, oversized files, and project boundary violations produce an error in the preview. Files are read when opened, so changes on disk appear after reloading the preview.

## Ownership

`packages/protocol` defines `file/read`. Runtime owns filesystem access, file classification, byte limits, and canonical-path containment. The Web host serves the preview shell using its existing SPA fallback; the preview retrieves file bytes/text over JSON-RPC rather than exposing an unrestricted HTTP filesystem endpoint. Web/TUI own presentation only.
