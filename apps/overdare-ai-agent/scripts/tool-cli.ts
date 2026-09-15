#!/usr/bin/env bun
import { runOverdareToolsCli } from "./lib/overdare-tools-cli.ts";

process.env.DILIGENT_STORAGE_NAMESPACE ??= "overdare";

const exitCode = await runOverdareToolsCli(process.argv.slice(2), {
  stdout: console,
  stderr: console,
});

process.exit(exitCode);
