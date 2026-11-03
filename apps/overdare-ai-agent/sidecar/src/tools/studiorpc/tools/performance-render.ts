// @summary Compact shared Web/TUI summaries and an opaque reference to the offline product viewer.
import type { ToolRenderPayload } from "@diligent/protocol";

export function renderPerformanceResult(value: Record<string, unknown>): ToolRenderPayload {
  const summary = `${value.case ?? "Performance capture"} · ${value.state ?? "unknown"}`;
  const render: ToolRenderPayload = { outputSummary: summary, blocks: [{ type: "summary", text: summary }] };
  if (typeof value.jobId === "string")
    render.blocks.push({
      type: "resource",
      resourceType: "overdare.performance_capture",
      resourceId: value.jobId,
      title: "View performance capture",
    });
  const table = (title: string, entries: [string, Record<string, unknown>][]) => {
    if (!entries.length) return;
    render.blocks.push({
      type: "table",
      title,
      columns: ["Metric / unit", "n", "Mean", "p50", "p95", "Max", "Status"],
      rows: entries.map(([name, metric]) => [
        `${name} / ${metric.unit ?? "ms"}`,
        ...["n", "mean", "p50", "p95", "max"].map((key) =>
          typeof metric[key] === "number" ? String(Math.round(metric[key] * 100) / 100) : "unavailable",
        ),
        String(metric.status ?? "unknown"),
      ]),
    });
  };
  if (value.summaries && typeof value.summaries === "object")
    table("Per-frame measurements", Object.entries(value.summaries));
  if (Array.isArray(value.luaScopes))
    table(
      "Lua completed invocations (inclusive)",
      value.luaScopes.map((s) => [s.label, s]),
    );
  if (Array.isArray(value.processes)) {
    for (const process of value.processes)
      table(
        `${process.role ?? "process"} · PID ${process.pid} · OS observations`,
        ["usedCores", "residentBytes", "privateBytes"].flatMap((key) =>
          process[key] ? [[key, process[key]] as [string, Record<string, unknown>]] : [],
        ),
      );
  }
  if (value.quality || value.missingMetrics || value.scenarioOutcome)
    render.blocks.push({
      type: "text",
      title: "Capture quality",
      text: JSON.stringify({
        scenarioOutcome: value.scenarioOutcome,
        missingMetrics: value.missingMetrics,
        quality: value.quality,
      }),
    });
  return render;
}
