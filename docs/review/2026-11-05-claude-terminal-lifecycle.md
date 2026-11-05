# Windows embedded terminal lifecycle audit

Scope: the Studio sidecar, separate Claude/shell hosts, native terminal helper, and inherited-stdio CLI. Tests used disposable processes and temporary profiles; the user's live terminals were left running.

## Observed results

- Concurrent starts share a pending launch. Reconnects reuse the existing process. Invalid conversation selection does not destroy the current process, and session replacement waits for the previous helper to close.
- Explicit stop cancels launch preparation, requests helper shutdown, and forcibly terminates an unresponsive helper after the timeout. Stop and replacement tests pass.
- The Windows helper joins a private kill-on-close Job Object before spawning the terminal child. Native test coverage verifies descendant cleanup after forced helper termination.
- A disposable sidecar-parent fixture was forcibly terminated using Windows `Stop-Process` against that parent PID alone. Its helper, terminal child, and grandchild were no longer alive afterward.
- A disposable inherited-stdio Bun CLI fixture also lost its terminal child and grandchild after forced parent termination. This observation does not prove every termination boundary of the outer Rust launcher.

## Intended retention and limits

Closing a browser view detaches its reader and intentionally retains its process. One Claude process and one independent shell can remain active per Studio. Repeatedly opening either view does not create another process. Switching views must not require terminating either process.

The Windows paths exercised above did not leave orphaned descendants. Unix process-group cleanup and forced termination of the outer native CLI launcher were not established by this audit. This is not a cross-platform guarantee that every descendant will always exit. The explicit process-ending action remains available for stalled or unwanted sessions.
