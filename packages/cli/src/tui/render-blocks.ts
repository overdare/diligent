// @summary Terminal text renderer for P040 ToolRenderPayload structured blocks
import type {
  KeyValueBlock,
  ListBlock,
  StatusBadgesBlock,
  SummaryBlock,
  TableBlock,
  ToolRenderBlock,
  ToolRenderPayload,
  TreeBlock,
  TreeNode,
} from "@diligent/protocol";
import { t } from "./theme";

/* ── Tone → ANSI color helper ─────────────────────────────────────── */

function toneAnsi(tone?: string): string {
  switch (tone) {
    case "success":
      return t.success;
    case "warning":
      return t.warn;
    case "danger":
      return t.error;
    case "info":
      return t.accent;
    default:
      return "";
  }
}

/* ── Block section title ──────────────────────────────────────────── */

function blockTitle(title?: string): string[] {
  if (!title) return [];
  return [`${t.bold}${title}${t.reset}`];
}

/* ── SummaryBlock ─────────────────────────────────────────────────── */

function renderSummary(block: SummaryBlock): string[] {
  const color = toneAnsi(block.tone);
  return [`${color}${block.text}${t.reset}`];
}

/* ── KeyValueBlock ────────────────────────────────────────────────── */

function renderKeyValue(block: KeyValueBlock): string[] {
  const lines: string[] = [...blockTitle(block.title)];
  const maxKeyLen = block.items.reduce((max, item) => Math.max(max, item.key.length), 0);
  for (const item of block.items) {
    const paddedKey = item.key.padEnd(maxKeyLen);
    lines.push(`  ${t.dim}${paddedKey}${t.reset}  ${item.value}`);
  }
  return lines;
}

/* ── ListBlock ────────────────────────────────────────────────────── */

function renderList(block: ListBlock): string[] {
  const lines: string[] = [...blockTitle(block.title)];
  block.items.forEach((item, i) => {
    const bullet = block.ordered ? `${i + 1}.` : "•";
    lines.push(`  ${t.dim}${bullet}${t.reset} ${item}`);
  });
  return lines;
}

/* ── TableBlock ───────────────────────────────────────────────────── */

function renderTable(block: TableBlock): string[] {
  const lines: string[] = [...blockTitle(block.title)];
  if (block.columns.length === 0) return lines;

  // Compute max width per column (header vs all rows)
  const colWidths = block.columns.map((col, ci) => {
    const maxRowLen = block.rows.reduce((max, row) => Math.max(max, (row[ci] ?? "").length), 0);
    return Math.max(col.length, maxRowLen);
  });

  const formatRow = (cells: string[]) => cells.map((cell, ci) => cell.padEnd(colWidths[ci] ?? 0)).join("  ");

  // Header row
  lines.push(`  ${t.bold}${formatRow(block.columns)}${t.reset}`);
  // Separator
  const sep = colWidths.map((w) => "─".repeat(w)).join("  ");
  lines.push(`  ${t.dim}${sep}${t.reset}`);
  // Data rows
  for (const row of block.rows) {
    const cells = block.columns.map((_, ci) => row[ci] ?? "");
    lines.push(`  ${formatRow(cells)}`);
  }
  return lines;
}

/* ── TreeBlock ────────────────────────────────────────────────────── */

function renderTreeNode(node: TreeNode, prefix: string, isLast: boolean): string[] {
  const connector = isLast ? "└─ " : "├─ ";
  const lines: string[] = [`${t.dim}${prefix}${connector}${t.reset}${node.label}`];
  const children = node.children as TreeNode[] | undefined;
  if (children && children.length > 0) {
    const childPrefix = prefix + (isLast ? "   " : "│  ");
    children.forEach((child, i) => {
      lines.push(...renderTreeNode(child, childPrefix, i === children.length - 1));
    });
  }
  return lines;
}

function renderTree(block: TreeBlock): string[] {
  const lines: string[] = [...blockTitle(block.title)];
  const nodes = block.nodes as TreeNode[];
  nodes.forEach((node, i) => {
    lines.push(...renderTreeNode(node, "  ", i === nodes.length - 1));
  });
  return lines;
}

/* ── StatusBadgesBlock ────────────────────────────────────────────── */

function renderStatusBadges(block: StatusBadgesBlock): string[] {
  const lines: string[] = [...blockTitle(block.title)];
  const badges = block.items
    .map((item) => {
      const color = toneAnsi(item.tone);
      return `${color}[${item.label}]${t.reset}`;
    })
    .join("  ");
  lines.push(`  ${badges}`);
  return lines;
}

/* ── Single block dispatcher ──────────────────────────────────────── */

function renderBlock(block: ToolRenderBlock): string[] {
  switch (block.type) {
    case "summary":
      return renderSummary(block);
    case "key_value":
      return renderKeyValue(block);
    case "list":
      return renderList(block);
    case "table":
      return renderTable(block);
    case "tree":
      return renderTree(block);
    case "status_badges":
      return renderStatusBadges(block);
    default:
      // Unknown block — skip gracefully
      return [];
  }
}

/* ── Top-level payload renderer ──────────────────────────────────── */

/**
 * Renders a ToolRenderPayload to an array of ANSI terminal lines.
 * Returns an empty array if payload is absent or has no blocks.
 */
export function renderToolPayload(payload: ToolRenderPayload | undefined): string[] {
  if (!payload || payload.blocks.length === 0) return [];
  const lines: string[] = [];
  for (const block of payload.blocks) {
    const blockLines = renderBlock(block);
    if (blockLines.length > 0) {
      if (lines.length > 0) lines.push(""); // blank separator between blocks
      lines.push(...blockLines);
    }
  }
  return lines;
}
