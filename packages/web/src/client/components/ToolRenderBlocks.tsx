// @summary Renders structured P040 ToolRenderPayload blocks (summary, key_value, list, table, tree, status_badges)

import { cn } from "../lib/cn";
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

/* ── Tone → Tailwind class maps ──────────────────────────────────── */

const TONE_BG: Record<string, string> = {
  default: "bg-text/5 text-text/80",
  success: "bg-success/10 text-success",
  warning: "bg-warn/10 text-warn",
  danger: "bg-danger/10 text-danger",
  info: "bg-accent/10 text-accent",
};

const TONE_TEXT: Record<string, string> = {
  default: "text-text/80",
  success: "text-success",
  warning: "text-warn",
  danger: "text-danger",
  info: "text-accent",
};

function toneText(tone?: string) {
  return TONE_TEXT[tone ?? "default"] ?? TONE_TEXT.default;
}

function toneBg(tone?: string) {
  return TONE_BG[tone ?? "default"] ?? TONE_BG.default;
}

/* ── Block title shared element ──────────────────────────────────── */

function BlockTitle({ title }: { title?: string }) {
  if (!title) return null;
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>;
}

/* ── SummaryBlock ─────────────────────────────────────────────────── */

function RenderSummary({ block }: { block: SummaryBlock }) {
  return (
    <div className={cn("rounded-md px-3 py-2 text-sm font-medium", toneBg(block.tone))}>
      {block.text}
    </div>
  );
}

/* ── KeyValueBlock ────────────────────────────────────────────────── */

function RenderKeyValue({ block }: { block: KeyValueBlock }) {
  return (
    <div>
      <BlockTitle title={block.title} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {block.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list from tool result
          <div key={i} className="contents">
            <dt className="text-xs font-medium text-muted">{item.key}</dt>
            <dd className="font-mono text-xs text-text/80">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── ListBlock ────────────────────────────────────────────────────── */

function RenderList({ block }: { block: ListBlock }) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <div>
      <BlockTitle title={block.title} />
      <Tag className={cn("space-y-0.5 pl-4 text-xs text-text/80", block.ordered ? "list-decimal" : "list-disc")}>
        {block.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list from tool result
          <li key={i}>{item}</li>
        ))}
      </Tag>
    </div>
  );
}

/* ── TableBlock ───────────────────────────────────────────────────── */

function RenderTable({ block }: { block: TableBlock }) {
  return (
    <div className="overflow-x-auto">
      <BlockTitle title={block.title} />
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-text/10">
            {block.columns.map((col, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static columns from tool result
              <th key={i} className="pb-1 pr-4 text-left font-semibold text-muted last:pr-0">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows from tool result
            <tr key={ri} className="border-b border-text/5 last:border-0">
              {row.map((cell, ci) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static cells from tool result
                <td key={ci} className="py-0.5 pr-4 font-mono text-text/80 last:pr-0">
                  {cell}
                </td>
              ))}
              {/* Fill missing cells if row is shorter than columns */}
              {row.length < block.columns.length &&
                Array.from({ length: block.columns.length - row.length }).map((_, ci) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fill cells
                  <td key={`fill-${ci}`} className="py-0.5 pr-4 last:pr-0" />
                ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── TreeBlock ────────────────────────────────────────────────────── */

function TreeNodeItem({ node, depth }: { node: TreeNode; depth: number }) {
  const indent = depth * 12;
  const children = node.children as TreeNode[] | undefined;
  const hasChildren = children && children.length > 0;
  return (
    <>
      <div className="flex items-center gap-1 py-px font-mono text-xs text-text/80" style={{ paddingLeft: indent }}>
        <span className="text-muted">{hasChildren ? "▾" : "·"}</span>
        <span>{node.label}</span>
      </div>
      {children?.map((child, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static tree from tool result
        <TreeNodeItem key={i} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function RenderTree({ block }: { block: TreeBlock }) {
  // Cast nodes to TreeNode[] — z.lazy() inference makes children: unknown[]
  const nodes = block.nodes as TreeNode[];
  return (
    <div>
      <BlockTitle title={block.title} />
      <div className="rounded-md border border-text/10 bg-bg/40 px-2 py-1">
        {nodes.map((node, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static nodes from tool result
          <TreeNodeItem key={i} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}

/* ── StatusBadgesBlock ────────────────────────────────────────────── */

function RenderStatusBadges({ block }: { block: StatusBadgesBlock }) {
  return (
    <div>
      <BlockTitle title={block.title} />
      <div className="flex flex-wrap gap-1.5">
        {block.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static badges from tool result
          <span
            key={i}
            className={cn("rounded px-2 py-0.5 text-xs font-medium", toneBg(item.tone))}
          >
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Single block dispatcher ──────────────────────────────────────── */

function RenderBlock({ block }: { block: ToolRenderBlock }) {
  switch (block.type) {
    case "summary":
      return <RenderSummary block={block} />;
    case "key_value":
      return <RenderKeyValue block={block} />;
    case "list":
      return <RenderList block={block} />;
    case "table":
      return <RenderTable block={block} />;
    case "tree":
      return <RenderTree block={block} />;
    case "status_badges":
      return <RenderStatusBadges block={block} />;
    default:
      // Unknown block kind — graceful fallback (unknown future block types)
      return null;
  }
}

/* ── Top-level payload renderer ──────────────────────────────────── */

interface ToolRenderBlocksProps {
  payload: ToolRenderPayload;
  className?: string;
}

export function ToolRenderBlocks({ payload, className }: ToolRenderBlocksProps) {
  if (!payload.blocks || payload.blocks.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {payload.blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ordered blocks from tool result
        <RenderBlock key={i} block={block} />
      ))}
    </div>
  );
}
