# Claude Code host implementation plan

## Requirements

- Run the user's unmodified, locally installed Claude Code interactively inside the existing OVERDARE WebView, with the existing web design tokens.
- Append a rendered Studio prompt to Claude Code's own system prompt. Do not replace the native prompt or collect/copy Claude credentials.
- Reuse the normal Claude profile and its native login by default, as requested on 2026-11-05. Run in the actual Studio project directory (for example `Documents/hey`), not a hidden metadata folder or a global hashed workspace. Keep appended prompts and MCP bindings per launch. Offer a product/environment-specific isolated profile when explicitly selected. Pass environment overrides only to child processes; never copy credentials.
- Launch with Claude Code's native `--permission-mode auto`, including resumed conversations. This supersedes the initial permission-bypass request. Keep the permission mode session-only and defer availability and approval decisions to native Claude; never fall back to bypassing permissions.
- Reuse OVERDARE MCP tools and lazy skills. Host-prompt connections must neither advertise nor execute `ensure_system_prompt`, nor instruct the model to call it.
- Bind an embedded connection to its owning Studio. A closed or missing owner must never redirect edits to a different Studio.
- Preserve ordinary external MCP clients. Expose a native-terminal launch path using the same launch preparation as the web host.
- Support UTF-8/IME, terminal sizing, interruption, disconnect/reconnect, explicit stop/restart, bounded output, and process-tree cleanup. Do not log terminal content or forward it to analytics.
- Package the PTY host and updated MCP router with the versioned runtime so existing stable launchers can use the feature.
- On opening the terminal, start automatically and resume the most recently modified conversation in the current project. Keep an already-running process on reconnect. Provide a project-scoped conversation picker and an explicit new-conversation action.

## Conversation navigation follow-up

1. Use the official SDK's read-only session metadata API in a short-lived worker with the selected native profile environment. Do not parse internal transcripts, copy credentials, or run inference through the SDK.
2. Validate selected conversation IDs against the current project's list. Pass only validated UUIDs to the installed native CLI's `--resume`; serialize selection and process replacement to prevent concurrent launches.
3. Auto-start once per view attachment after the initial status arrives. Preserve explicit Stop until another user action or a new view attachment. Add an OVERDARE-styled searchable picker, refresh, latest, and new-session actions.
4. Cover project/profile scoping, missing/corrupt history, launch flags, duplicate/reconnecting views, switch races, and browser selection. Build/install and verify native CLI resume without modifying user conversations.

## Architecture

The product sidecar owns Claude launch preparation and session lifecycle. A dedicated Rust `overdare-terminal` helper transports PTY bytes and resize/input/stop messages over local stdio; on Windows it uses ConPTY. The browser uses xterm.js and a separate, authenticated product WebSocket endpoint, not Diligent's conversation protocol. A bundled `overdare-mcp` runs with an immutable Studio binding and host-supplied prompt mode. Ordinary router behavior remains unchanged.

The web host preserves a live process when a view disconnects, replays bounded output on reconnect, and stops sessions on host shutdown. Native CLI launch uses the same profile, prompt, MCP configuration, and workspace preparation, with inherited terminal stdio.

## Implementation order

1. Add regression tests and implement strict Studio binding and host-prompt MCP mode.
2. Add launch-preparation tests and implement isolated profiles, rendered prompt adaptation, executable discovery, and shared CLI launch.
3. Implement and exercise the Rust PTY helper, including cleanup and UTF-8 transport.
4. Implement authenticated terminal sessions and the OVERDARE-styled browser view.
5. Package native helpers; document operation and boundaries.
6. Run focused and broader tests, type/lint/build checks, real Windows PTY/Claude startup, browser visual/input/reconnect verification, and Studio MCP checks. Record remaining external authentication requirements honestly.

## Completion evidence

Tests must prove prompt append arguments and isolation, blocked prompt reload even by direct tool call, immutable Studio routing after owner loss, terminal lifecycle/reconnect/backpressure, and native PTY input/output/resize/exit. Verify the packaged Windows runtime and inspect the rendered terminal. A successful startup test is not evidence of a successful model turn; record those separately.

## Acceptance record

The implementation was exercised on Windows with the official unmodified Claude Code 2.1.220 executable, xterm.js 6, the Rust ConPTY helper, Chrome, and Studio's native CEF panel.

- Focused host, history, launch, plugin, session, relay, renderer, view restoration, and header/sidebar regressions passed. They cover scoped history, immutable Studio ownership, authentication/origin checks, launch races, independent shell/Claude processes, reconnect snapshots, authoritative resize, and navigation without process replacement.
- Official CLI probes used disposable profiles and loopback API/MCP fixtures to verify plugin validation, agent conversion, MCP health, cursor selection, and the Stop hook. A successful or failed save caused one hook call without an extra model turn. These local probes performed no upstream inference.
- A separate authenticated model turn used the owning Studio MCP connection to create, inspect, delete, and confirm removal of a temporary Folder. This established actual editing independently of onboarding and synthetic model fixtures.
- Native cursor comparison isolated the preedit displacement: disabling telemetry bypassed Claude's cached native-cursor flag, leaving a drawn inverse cursor and a parked real caret. A per-launch native-cursor override aligned the real caret with the prompt while preserving explicit parent preferences.
- Controlled browser composition regressions cover modifier virtual-key codes, composing letter/Process/Hangul keys, direct IME events, stale composition-end payloads, focus protocol output, repeated syllables, and immediate English/Enter/Backspace transitions. These are DOM-event tests, not native IME automation.
- The user separately confirmed native Windows composition and commitment of Korean text, including Korean/English switching, in the actual Studio panel. This covers the reported scenario rather than every possible IME.
- Windows process lifecycle checks and their platform limits are recorded in [the lifecycle review](../../review/2026-11-05-claude-terminal-lifecycle.md).
- Versioned development bundles were built and tested after extraction. Packaged acceptance covered official CLI onboarding, plugin validation, embedded MCP health, and last-view restoration after sidecar restart. The final bundle's native Studio panel retained the conversation while switching between the shared agent icon, shell, and Claude.

The product guide describes the final behavior. Local runtime paths, process IDs, conversation IDs, and intermediate bundle hashes are intentionally omitted from this review record.
