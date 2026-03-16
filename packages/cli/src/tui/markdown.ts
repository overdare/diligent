// @summary Renders Markdown to ANSI-styled terminal text
import { Marked, Renderer, type Token } from "marked";
import { charDisplayWidth, displayWidth } from "./framework/string-width";
import { t } from "./theme";

type TableAlign = "left" | "center" | "right" | null | undefined;

type TableCellToken = {
  text?: string;
  tokens?: Token[];
  align?: TableAlign;
};

type ListItemToken = {
  tokens?: Token[];
  task?: boolean;
  checked?: boolean;
};

type MarkdownToken = Token & {
  tokens?: Token[];
};

const ANSI_CSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_OSC_RE, "").replace(ANSI_CSI_RE, "");
}

function readEscapeSequence(value: string, start: number): { sequence: string; nextIndex: number } {
  if (value[start] !== "\x1b") {
    return { sequence: value[start] ?? "", nextIndex: start + 1 };
  }

  const next = value[start + 1];
  if (!next) {
    return { sequence: "\x1b", nextIndex: start + 1 };
  }

  if (next === "[") {
    let index = start + 2;
    while (index < value.length && !/[A-Za-z]/.test(value[index])) {
      index++;
    }
    if (index < value.length) {
      index++;
    }
    return { sequence: value.slice(start, index), nextIndex: index };
  }

  if (next === "]") {
    let index = start + 2;
    while (index < value.length) {
      if (value[index] === "\x07") {
        index++;
        break;
      }
      if (value[index] === "\x1b" && value[index + 1] === "\\") {
        index += 2;
        break;
      }
      index++;
    }
    return { sequence: value.slice(start, index), nextIndex: index };
  }

  return { sequence: value.slice(start, start + 2), nextIndex: start + 2 };
}

function getListContinuationIndent(line: string): string {
  const listPrefixMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)/);
  if (listPrefixMatch) {
    return " ".repeat(displayWidth(stripAnsi(listPrefixMatch[1])));
  }

  const leadingWhitespace = line.match(/^\s+/)?.[0] ?? "";
  return leadingWhitespace;
}

function wrapAnsiLine(line: string, width: number): string[] {
  if (width <= 0 || displayWidth(stripAnsi(line)) <= width) {
    return [line];
  }

  let continuationIndent = getListContinuationIndent(line);
  let indentWidth = displayWidth(stripAnsi(continuationIndent));
  if (indentWidth >= width) {
    continuationIndent = "";
    indentWidth = 0;
  }

  const wrapped: string[] = [];
  let current = "";
  let currentWidth = 0;
  const continuationLimit = Math.max(1, width - indentWidth);

  for (let index = 0; index < line.length; ) {
    if (line[index] === "\x1b") {
      const { sequence, nextIndex } = readEscapeSequence(line, index);
      current += sequence;
      index = nextIndex;
      continue;
    }

    const codePoint = line.codePointAt(index);
    if (codePoint === undefined) {
      index++;
      continue;
    }
    const char = String.fromCodePoint(codePoint);
    const charWidth = charDisplayWidth(codePoint);

    if (currentWidth > 0 && currentWidth + charWidth > width) {
      wrapped.push(current);
      current = continuationIndent;
      currentWidth = indentWidth;
    }

    if (currentWidth > indentWidth && currentWidth - indentWidth + charWidth > continuationLimit) {
      wrapped.push(current);
      current = continuationIndent;
      currentWidth = indentWidth;
    }

    current += char;
    currentWidth += charWidth;
    index += char.length;
  }

  wrapped.push(current);
  return wrapped;
}

function wrapRenderedText(rendered: string, width: number): string {
  if (width <= 0) {
    return rendered;
  }

  return rendered
    .split("\n")
    .flatMap((line) => wrapAnsiLine(line, width))
    .join("\n");
}

function repeat(char: string, count: number): string {
  return count > 0 ? char.repeat(count) : "";
}

function padText(value: string, width: number, align: TableAlign): string {
  const visible = displayWidth(stripAnsi(value));
  const remaining = Math.max(0, width - visible);

  if (align === "right") {
    return `${repeat(" ", remaining)}${value}`;
  }

  if (align === "center") {
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return `${repeat(" ", left)}${value}${repeat(" ", right)}`;
  }

  return `${value}${repeat(" ", remaining)}`;
}

function renderListItem(parser: Renderer["parser"], item: ListItemToken, marker: string): string {
  const tokens = (item.tokens ?? []) as MarkdownToken[];
  const parsed = tokens
    .map((token) => {
      if (token.type === "text") {
        return parser.parseInline(token.tokens ?? []).replace(/\n+$/, "");
      }

      if (token.type === "paragraph") {
        return parser.parseInline(token.tokens ?? []).replace(/\n+$/, "");
      }

      const chunk = parser.parse([token]).replace(/\n+$/, "");
      if (token.type === "list") {
        return `\n${chunk}`;
      }
      return chunk;
    })
    .join("")
    .replace(/^\n+/, "");

  const lines = parsed
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => line.replace(/<input[^>]*>\s*/g, "").trimEnd())
    .filter((line, index, all) => !(line === "" && index === all.length - 1));

  const taskPrefix = item.task ? `[${item.checked ? "x" : " "}] ` : "";
  if (lines.length === 0) {
    return `${marker} ${taskPrefix}`.trimEnd();
  }

  const [first, ...rest] = lines;
  const nested = rest.map((line) => (line ? `  ${line}` : "")).join("\n");
  return nested ? `${marker} ${taskPrefix}${first}\n${nested}` : `${marker} ${taskPrefix}${first}`;
}

function terminalHyperlink(label: string, href: string): string {
  const safeHref = href.trim();
  if (!safeHref) {
    return label;
  }
  const osc8Open = `\u001b]8;;${safeHref}\u0007`;
  const osc8Close = "\u001b]8;;\u0007";
  return `${osc8Open}${label}${osc8Close}`;
}

function renderAlertBlock(kind: string, bodyLines: string[]): string[] {
  const normalized = kind.toUpperCase();
  const style = {
    NOTE: { icon: "ℹ", color: t.accent },
    TIP: { icon: "✓", color: t.success },
    IMPORTANT: { icon: "✱", color: t.accent },
    WARNING: { icon: "⚠", color: t.warn },
    CAUTION: { icon: "⛔", color: t.error },
  }[normalized] ?? { icon: "•", color: t.accent };

  const header = `${style.color}${t.bold}${style.icon} ${normalized}${t.boldOff}${t.reset}`;
  const lines = bodyLines.length > 0 ? bodyLines : [""];
  return [header, ...lines.map((line) => `${t.dim}│${t.reset} ${line}`), ""];
}

function applyGfmPostProcessing(rendered: string): string {
  let text = rendered;

  text = text.replace(/<details>\s*<summary>(.*?)<\/summary>\s*([\s\S]*?)<\/details>/gi, (_, summary, body) => {
    const title = String(summary ?? "").trim();
    const detailsBody = String(body ?? "")
      .trim()
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => `  ${line}`)
      .join("\n");

    if (!detailsBody) {
      return `${t.bold}▸ ${title}${t.boldOff}`;
    }

    return `${t.bold}▸ ${title}${t.boldOff}\n${detailsBody}`;
  });

  const lines = text.split("\n");
  const out: string[] = [];
  const footnotes = new Map<string, string>();

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const plainLine = stripAnsi(line);
    const alertMatch = line.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
    if (alertMatch) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "") {
        body.push(lines[index]);
        index += 1;
      }
      out.push(...renderAlertBlock(alertMatch[1], body));
      while (index < lines.length && lines[index].trim() === "") {
        index += 1;
      }
      continue;
    }

    const footnoteMatch = plainLine.match(/^\[\^?([^\]]+)\]:\s*(.*)$/);
    if (footnoteMatch) {
      footnotes.set(footnoteMatch[1], footnoteMatch[2]);
      index += 1;
      continue;
    }

    out.push(line.replace(/\[\^([^\]]+)\]/g, (_, id) => `${t.dim}[${id}]${t.reset}`));
    index += 1;
  }

  if (footnotes.size > 0) {
    out.push("", `${t.bold}Footnotes${t.boldOff}`);
    for (const [id, content] of footnotes.entries()) {
      out.push(`  ${t.dim}[${id}]${t.reset} ${content}`);
    }
  }

  return out.join("\n");
}

const renderer = new Renderer();

renderer.heading = function (token) {
  const text = this.parser.parseInline(token.tokens);

  if (token.depth === 1) {
    return `\n${t.bold}${t.underline}${text}${t.underlineOff}${t.boldOff}\n\n`;
  }

  if (token.depth === 2) {
    return `\n${t.bold}${text}${t.boldOff}\n\n`;
  }

  if (token.depth === 3) {
    return `\n${t.underline}${text}${t.underlineOff}\n\n`;
  }

  return `\n${text}\n\n`;
};

renderer.paragraph = function (token) {
  const text = this.parser.parseInline(token.tokens);
  return `${t.text}${text}${t.reset}\n`;
};

renderer.strong = function (token) {
  const text = this.parser.parseInline(token.tokens);
  return `${t.bold}${text}${t.boldOff}`;
};

renderer.em = function (token) {
  const text = this.parser.parseInline(token.tokens);
  return `${t.italic}${text}${t.italicOff}`;
};

renderer.codespan = (token) => `${t.info}${token.text}${t.reset}`;

renderer.code = (token) => {
  const header = token.lang ? `${t.dim}[${token.lang}]${t.reset}\n` : "";
  const indented = token.text
    .split("\n")
    .map((line: string) => `  ${line}`)
    .join("\n");
  return `\n${header}${t.textMuted}${indented}${t.reset}\n\n`;
};

renderer.list = function (token) {
  const orderedStart = Number(token.start ?? 1);
  const start = token.ordered && Number.isFinite(orderedStart) ? orderedStart : 1;
  const lines: string[] = [];

  for (let index = 0; index < token.items.length; index++) {
    const item = token.items[index] as ListItemToken;
    const marker = token.ordered ? `${start + index}.` : "-";
    lines.push(renderListItem(this.parser, item, marker));
  }

  return `${lines.join("\n")}\n\n`;
};

renderer.listitem = function (token) {
  return renderListItem(this.parser, token as ListItemToken, "-");
};

renderer.link = function (token) {
  const text = this.parser.parseInline(token.tokens);
  const href = token.href;
  const label = text === href ? href : text;
  return terminalHyperlink(`${t.accent}${label}${t.reset}`, href);
};

renderer.image = (token) => {
  const label = token.text && token.text.trim().length > 0 ? token.text : token.href;
  return terminalHyperlink(`${t.accent}${label}${t.reset}`, token.href);
};

renderer.blockquote = function (token) {
  const text = this.parser.parse(token.tokens);
  const lines = text
    .trim()
    .split("\n")
    .map((line: string) => `${t.textMuted}│ ${line}${t.reset}`)
    .join("\n");
  return `${lines}\n\n`;
};

renderer.table = function (token) {
  const headers = token.header as TableCellToken[];
  const rows = token.rows as TableCellToken[][];

  const allRows: TableCellToken[][] = [headers, ...rows];
  const columnCount = headers.length;
  const widths = new Array<number>(columnCount).fill(1);

  const renderedRows = allRows.map((row) =>
    row.map((cell) => (cell.tokens ? this.parser.parseInline(cell.tokens) : (cell.text ?? ""))),
  );

  for (const row of renderedRows) {
    for (let index = 0; index < columnCount; index++) {
      const text = row[index] ?? "";
      widths[index] = Math.max(widths[index], displayWidth(stripAnsi(text)));
    }
  }

  const alignments = headers.map((cell) => cell.align ?? "left");

  const top = `┌${widths.map((width) => repeat("─", width + 2)).join("┬")}┐`;
  const middle = `├${widths.map((width) => repeat("─", width + 2)).join("┼")}┤`;
  const bottom = `└${widths.map((width) => repeat("─", width + 2)).join("┴")}┘`;

  const renderRow = (cells: string[], rowAlignments: TableAlign[]) => {
    const segments = widths.map((width, index) => {
      const value = cells[index] ?? "";
      return ` ${padText(value, width, rowAlignments[index])} `;
    });
    return `│${segments.join("│")}│`;
  };

  const output: string[] = [top, renderRow(renderedRows[0] ?? [], alignments), middle];

  for (let index = 1; index < renderedRows.length; index++) {
    output.push(renderRow(renderedRows[index], alignments));
    if (index < renderedRows.length - 1) {
      output.push(middle);
    }
  }

  output.push(bottom);
  return `${t.textMuted}${output.join("\n")}${t.reset}\n\n`;
};

renderer.hr = () => `\n${t.textMuted}${"─".repeat(40)}${t.reset}\n\n`;

renderer.br = () => "\n";

renderer.del = function (token) {
  const text = this.parser.parseInline(token.tokens);
  return `~~${text}~~`;
};

renderer.html = (token) => token.text;

renderer.text = (token) => token.text;

renderer.space = () => "";

const marked = new Marked({ renderer, async: false });

export function renderMarkdown(text: string, width: number): string {
  try {
    const result = marked.parse(text) as string;
    const postProcessed = applyGfmPostProcessing(result)
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
    return wrapRenderedText(postProcessed, width);
  } catch {
    return text;
  }
}
