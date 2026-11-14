#!/usr/bin/env bun
// @summary Builds the CLI compiled binary and re-signs macOS outputs when available.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

type BuildCliOptions = {
  target?: string;
  outfile: string;
};

function parseBuildCliOptions(argv: string[]): BuildCliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      target: { type: "string" },
      outfile: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const outfile = values.outfile?.trim();
  if (!outfile) {
    throw new Error("Missing required --outfile <path>");
  }

  return {
    target: values.target?.trim(),
    outfile,
  };
}

function runBuild(options: BuildCliOptions): void {
  const args = ["build", "--compile"];
  if (options.target) {
    args.push(`--target=${options.target}`);
  }
  args.push("packages/cli/src/index.ts", "--outfile", options.outfile);

  const result = spawnSync("bun", args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function shouldCodesign(target: string | undefined): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  return target === undefined || target.startsWith("bun-darwin-");
}

function codesignBinary(outfile: string): void {
  if (!existsSync(outfile)) {
    throw new Error(`Built binary not found: ${outfile}`);
  }

  const result = spawnSync("codesign", ["--force", "--sign", "-", outfile], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main(): void {
  const options = parseBuildCliOptions(process.argv.slice(2));
  runBuild(options);

  if (shouldCodesign(options.target)) {
    codesignBinary(options.outfile);
  }
}

main();
