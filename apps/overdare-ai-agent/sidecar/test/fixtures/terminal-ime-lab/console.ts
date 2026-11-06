// @summary Deterministic interactive ConPTY prompt with a real or parked terminal cursor.
import { StringDecoder } from "node:string_decoder";

const decoder = new StringDecoder("utf8");
let text = "";
let parked = false;
let submitted = "";
process.stdin.setRawMode(true);
function draw() {
  process.stdout.write(
    `\x1b[?25l\x1b[H\x1b[2JConPTY IME control — ${parked ? "parked" : "real"} cursor\r\n` +
      "Type Korean. Enter submits locally. Ctrl+P parks the cursor. Ctrl+L redraws.\r\n" +
      `Submitted locally: ${submitted}\x1b[5;1H> ${text}`,
  );
  if (parked) process.stdout.write("\x1b[7m \x1b[0m\x1b[8;1H");
  else process.stdout.write(`\x1b[5;${3 + Bun.stringWidth(text)}H\x1b[?25h`);
}
process.stdout.on("resize", draw);
process.stdin.on("data", (bytes) => {
  for (const character of decoder.write(bytes)) {
    if (character === "\x03") process.exit(0);
    if (character === "\x10") parked = !parked;
    else if (character === "\x0c") {
      // Redraw without changing input.
    } else if (character === "\r" || character === "\n") {
      submitted = text;
      text = "";
    } else if (character === "\x7f" || character === "\b") text = Array.from(text).slice(0, -1).join("");
    else if (character >= " ") text += character;
  }
  draw();
});
draw();
