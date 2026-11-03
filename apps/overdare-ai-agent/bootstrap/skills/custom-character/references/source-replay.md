# Optional saved-source replay

Use [character-source-proof.py](../scripts/character-source-proof.py) when independent
saved-source replay is useful and a local Studio checkout is available:

```sh
python character-source-proof.py --studio-root STUDIO_CHECKOUT verify-source --build-id BUILD_ID
```

The runner copies the saved draft into an isolated user directory, starts the Studio
binary and installs proof only if the original draft is unchanged. Pass `--source-user-dir`
when the source Studio uses a custom user directory. This is external diagnostic evidence;
commit, publication and apply depend on native integrity checks rather than this proof.

The optional [native RPC client](../scripts/character-tools.py) supports local transport
diagnostics with an explicit Studio port. Normal agent work uses bundled Studio tools.
