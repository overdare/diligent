// @summary Parses eval commands and optional provider, task, capability, model, seed, report, and auth options

import { MODEL_CAPABILITIES, type ModelCapability } from "./capabilities";
import type { EvalProvider } from "./task";

export type EvalCommand = "core" | "runtime" | "capabilities" | "chatgpt-login";

export interface EvalCliOptions {
  command: EvalCommand;
  provider?: EvalProvider;
  task?: string;
  capability?: ModelCapability;
  model?: string;
  seed?: string;
  reportPath?: string;
  /** Never open a browser for ChatGPT OAuth; missing or rejected credentials fail the run. */
  nonInteractive?: boolean;
  /** Dedicated file-backed ChatGPT OAuth store instead of the developer's Diligent auth store. */
  chatgptAuthFile?: string;
  help: boolean;
}

const COMMANDS: readonly EvalCommand[] = ["core", "runtime", "capabilities", "chatgpt-login"];

export function parseCliOptions(args: string[]): EvalCliOptions {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { command: "core", help: true };
  }
  const command = COMMANDS.find((candidate) => candidate === args[0]);
  if (!command) {
    throw new Error(`Unknown eval command "${args[0]}". Expected ${COMMANDS.join(", ")}.`);
  }

  const options: EvalCliOptions = { command, help: false };
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    switch (arg) {
      case "--provider": {
        const value = requireValue(args, ++index, arg);
        if (value !== "openai" && value !== "anthropic" && value !== "gemini" && value !== "chatgpt") {
          throw new Error(`Invalid provider "${value}". Expected openai, anthropic, gemini, or chatgpt.`);
        }
        options.provider = value;
        break;
      }
      case "--task":
        options.task = requireValue(args, ++index, arg);
        break;
      case "--capability": {
        const value = requireValue(args, ++index, arg);
        const capability = MODEL_CAPABILITIES.find((candidate) => candidate === value);
        if (!capability) {
          throw new Error(`Invalid capability "${value}". Expected ${MODEL_CAPABILITIES.join(", ")}.`);
        }
        options.capability = capability;
        break;
      }
      case "--model":
        options.model = requireValue(args, ++index, arg);
        break;
      case "--seed":
        options.seed = requireValue(args, ++index, arg);
        break;
      case "--report":
        options.reportPath = requireValue(args, ++index, arg);
        break;
      case "--non-interactive":
        options.nonInteractive = true;
        break;
      case "--chatgpt-auth-file":
        options.chatgptAuthFile = requireValue(args, ++index, arg);
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown eval option "${arg}".`);
    }
  }

  if (options.task && options.command !== "core" && options.command !== "runtime") {
    throw new Error("--task applies only to the core and runtime suites.");
  }
  if (options.capability && options.command !== "capabilities") {
    throw new Error("--capability applies only to the capabilities suite.");
  }
  return options;
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}.`);
  return value;
}
