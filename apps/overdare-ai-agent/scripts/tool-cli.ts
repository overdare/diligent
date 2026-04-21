#!/usr/bin/env bun
import { runOverdareToolsCli } from "./lib/overdare-tools-cli.ts";

const exitCode = await runOverdareToolsCli(process.argv.slice(2), {
  stdout: console,
  stderr: console,
});

process.exit(exitCode);
