# Codex protocol types

These files are the small transitive subset of the official Codex App Server TypeScript
bindings used by this adapter, generated with `codex-cli 0.153.0-alpha.5`:

```sh
codex app-server generate-ts --experimental --out /path/to/temporary-output
```

Keep `ImageGenerationItem.ts`, `ImageGenerationFailure.ts`, `AbsolutePathBuf.ts`, and
`v2/TurnStatus.ts` (flattened here as `TurnStatus.ts`). Apply the repository formatter after
copying; do not hand-edit the declarations. Keep the narrow runtime schemas in `../protocol.ts`
compatible with the CLI versions supported by the product, then rerun the Codex adapter tests.
This is a schema reference version, not a new minimum CLI requirement.

Source: [OpenAI Codex](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol).
The generated bindings are distributed under Apache-2.0; see `LICENSE` and `NOTICE`.

The request/event separation in `../rpc-client.ts` follows the
[official client design](https://github.com/openai/codex/blob/5ecb3afd1bf405149e2159bfda50093b0c1b5fab/codex-rs/app-server-client/src/remote.rs#L255),
but uses Diligent's existing `EventStream` rather than porting Rust channels or embedding the
Codex runtime.
