// @summary Multi-turn chat example: agent maintains message history internally across turns
import * as readline from "node:readline";
import { Agent } from "../agent/agent";
import { createAnthropicStream } from "../llm/provider/anthropic";
import { c } from "./common/colors";

const DEFAULT_MODEL = "haiku";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY is required to run this example");
}

const agent = new Agent(DEFAULT_MODEL, [{ label: "system", content: "You are a helpful assistant." }], [], {
  llmMsgStreamFn: createAnthropicStream(apiKey),
});

agent.subscribe((event) => {
  if (event.type === "message_start") {
    process.stdout.write(`${c.cyan}assistant${c.reset}${c.dim}>${c.reset} `);
  }
  if (event.type === "message_delta" && event.delta.type === "text_delta") {
    process.stdout.write(event.delta.delta);
  }
  if (event.type === "message_end") {
    process.stdout.write("\n");
  }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log(`${c.dim}Multi-turn chat. Type ${c.reset}${c.bold}exit${c.reset}${c.dim} to quit.${c.reset}\n`);

function prompt() {
  rl.question(`${c.green}you${c.reset}${c.dim}>${c.reset} `, async (input) => {
    input = input.trim();

    if (!input) {
      prompt();
      return;
    }

    if (input === "exit") {
      console.log(`\n${c.dim}Bye. (${agent.getMessages().length} messages in history)${c.reset}`);
      rl.close();
      return;
    }

    await agent
      .prompt({ role: "user", content: [{ type: "text", text: input }], timestamp: Date.now() })
      .catch((err: unknown) => {
        console.error(`\n${c.yellow}error:${c.reset}`, err);
      });

    prompt();
  });
}

prompt();
