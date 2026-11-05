// @summary Real-console acceptance fixture for browser keyboard, IME text, resize, and interruption.
import { StringDecoder } from "node:string_decoder";

const decoder = new StringDecoder("utf8");
let line = "";
process.stdin.setRawMode(true);
console.log("\x1b[32mConsole fixture ready\x1b[0m");
process.stdout.on("resize", () => console.log(`RESIZED ${process.stdout.columns}x${process.stdout.rows}`));
process.stdin.on("data", (bytes) => {
  for (const character of decoder.write(bytes)) {
    if (character === "\x03") {
      console.log("INTERRUPTED");
      line = "";
    } else if (character === "\r" || character === "\n") {
      if (line === "FOCUS ON") console.log("\x1b[?1004hFOCUS_REPORTING_ON");
      else if (line === "FOCUS OFF") console.log("\x1b[?1004lFOCUS_REPORTING_OFF");
      else if (line) console.log(`ECHO ${line}`);
      line = "";
    } else line += character;
  }
});
