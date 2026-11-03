// @summary Bounded, offline frame bars, explicit Lua label intervals and independent OS process charts.
import { useEffect, useMemo, useState } from "react";
import type { PerformanceReadParams, PerformanceView, PerformanceViewReport } from "../../shared/performance-protocol";
import { loadPerformanceView, relativeMilliseconds } from "../lib/performance-view";

const format = (value: number | null | undefined) => (value == null ? "unavailable" : value.toFixed(2));
const palette = ["#67c6f0", "#b69afa", "#fac878", "#75d6ad", "#f396b8", "#a8c879"];
const inputClass = "rounded border border-border bg-surface-dark px-2 py-1 text-text";
const buttonClass = "rounded border border-border px-3 py-1 text-text hover:bg-fill-secondary disabled:opacity-40";
const sectionClass = "space-y-3 rounded-lg border border-border p-4";
const WINDOW = 200;
type Summary = PerformanceViewReport["summaries"][string];
function memoryMiB(value: Summary): Summary {
  return {
    ...value,
    unit: "MiB",
    ...Object.fromEntries(
      (["mean", "p50", "p95", "max"] as const).map((key) => [key, value[key] == null ? null : value[key] / 1048576]),
    ),
  };
}

function Statistics({
  rows,
  baseline,
  comparison,
}: {
  rows: [string, Summary][];
  baseline?: Record<string, Summary>;
  comparison?: PerformanceView["comparison"];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left font-mono text-xs">
        <thead>
          <tr>
            {["Metric / unit", "n", "Mean", "p50", "p95", "Max", "Status"].map((s) => (
              <th key={s} className="whitespace-nowrap p-2 text-muted">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, s]) => (
            <tr key={name} className="border-t border-border">
              <td className="p-2">
                {name} / {s.unit}
              </td>
              <td className="p-2">
                {s.n}
                {baseline && <span className="block text-muted">Base {baseline[name]?.n ?? "unavailable"}</span>}
              </td>
              {(["mean", "p50", "p95", "max"] as const).map((statistic) => (
                <td key={statistic} className="p-2 whitespace-nowrap">
                  {format(s[statistic])}
                  {baseline && (
                    <span className="block text-muted">
                      Base {format(baseline[name]?.[statistic])}
                      <br />Δ {format(comparison?.deltas?.[name]?.[statistic]?.absolute)}
                    </span>
                  )}
                </td>
              ))}
              <td className="p-2" title={s.reason}>
                {s.status}
                {s.invalidSamples ? ` (${s.invalidSamples} invalid)` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FrameDetails({ data, selected }: { data: PerformanceView; selected: number }) {
  const frame = data.frames[selected];
  const scopes = useMemo(
    () =>
      data.luaScopes
        .filter((s) => s.frameId === frame?.frameId)
        .sort((a, b) =>
          BigInt(a.beginMonotonicNs) < BigInt(b.beginMonotonicNs)
            ? -1
            : BigInt(a.beginMonotonicNs) > BigInt(b.beginMonotonicNs)
              ? 1
              : 0,
        ),
    [data.luaScopes, frame],
  );
  if (!frame)
    return <p className="text-muted">No native frame samples. Process observations may still be available.</p>;
  const labels = data.luaSummaries.filter((s) => scopes.some((scope) => scope.labelId === s.labelId));
  const duration = Math.max(relativeMilliseconds(frame.endMonotonicNs, frame.beginMonotonicNs), 0.001);
  return (
    <section className={sectionClass}>
      <h3 className="font-semibold">
        Frame {frame.frameId} · {format(frame.frame_ms)} ms
      </h3>
      <p className="text-xs text-muted">
        LuaMachine: {format(frame.validity.lua_machine_ms ? null : frame.lua_machine_ms)} ms · Slate GT:{" "}
        {format(frame.validity.slate_gt_ms ? null : frame.slate_gt_ms)} ms. Per-frame totals; not task intervals or
        additive frame components.
      </p>
      {Object.keys(frame.validity).length > 0 && (
        <p className="text-xs text-warning">Invalid measurements: {JSON.stringify(frame.validity)}</p>
      )}
      <p className="text-xs text-muted">
        Explicit Lua labels · completed synchronous invocations · inclusive durations may overlap. Rows are labels, not
        a call tree.
      </p>
      {labels.length ? (
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 1000 ${labels.length * 30 + 24}`}
            className="min-w-[600px] w-full"
            role="img"
            aria-label="Selected frame Lua label timeline"
          >
            <text x="210" y="12" fill="#9ca3af" fontSize="11">
              0 ms
            </text>
            <text x="940" y="12" fill="#9ca3af" fontSize="11">
              {format(duration)} ms
            </text>
            {labels.map((label, index) => (
              <g key={label.labelId}>
                <text x="0" y={index * 30 + 42} fill="#ddd" fontSize="12">
                  <title>{label.label}</title>
                  {label.label.slice(0, 27)}
                </text>
                {scopes
                  .filter((s) => s.labelId === label.labelId)
                  .map((s, i) => {
                    const left = Math.max(0, relativeMilliseconds(s.beginMonotonicNs, frame.beginMonotonicNs));
                    const right = Math.min(duration, relativeMilliseconds(s.endMonotonicNs, frame.beginMonotonicNs));
                    return (
                      <rect
                        key={`${s.beginMonotonicNs}-${i}`}
                        x={210 + (left / duration) * 780}
                        y={index * 30 + 26}
                        width={Math.max(1, ((right - left) / duration) * 780)}
                        height="21"
                        rx="2"
                        fill={palette[label.labelId % palette.length]}
                      >
                        <title>
                          {label.label}: {format(s.elapsed_ms)} ms · +{format(left)} ms
                        </title>
                      </rect>
                    );
                  })}
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <p className="text-sm text-muted">No completed Lua labels in this frame.</p>
      )}
    </section>
  );
}

function ProcessCharts({ data }: { data: PerformanceView }) {
  const origin = Math.min(...data.processSamples.map((s) => s.monotonicMs));
  return (
    <section className={sectionClass}>
      <h3 className="font-semibold">Process CPU and memory</h3>
      <p className="text-xs text-muted">
        Independent OS worker clock · approximately 1 second sampling · not frame aligned. CPU bars cover the preceding
        observed interval. No CPU percentage is inferred.
      </p>
      {!data.processes.length && <p className="text-muted">No verified process observations.</p>}
      {data.processes.map((process) => {
        const samples = data.processSamples
          .filter((s) => s.pid === process.pid && s.startTimeUtc === process.startTimeUtc)
          .sort((a, b) => a.monotonicMs - b.monotonicMs);
        const span = Math.max(1000, ...samples.map((s) => s.monotonicMs - origin));
        const maxCpu = Math.max(1, ...samples.map((s) => (s.status === "ok" ? (s.usedCores ?? 0) : 0)));
        const maxMemory = Math.max(
          1,
          ...samples.flatMap((s) => (s.status === "ok" ? [s.residentBytes ?? 0, s.privateBytes ?? 0] : [])),
        );
        const x = (ms: number) => 65 + ((ms - origin) / span) * 925;
        return (
          <div key={`${process.pid}-${process.startTimeUtc}`} className="space-y-2 border-t border-border pt-3">
            <h4>
              {process.role || "process"} · PID {process.pid}{" "}
              <span className="text-xs text-muted">
                {process.startTimeUtc} · {process.missingSamples} missing
              </span>
            </h4>
            <svg
              viewBox="0 0 1000 245"
              className="w-full"
              role="img"
              aria-label={`CPU and memory for PID ${process.pid}`}
            >
              <text x="0" y="15" fill="#9ca3af" fontSize="12">
                {format(maxCpu)} cores
              </text>
              <path d="M65 100H990 M65 215H990" stroke="#555" />
              {samples.map((s) =>
                s.status === "ok" && s.usedCores != null && s.intervalSeconds != null ? (
                  <rect
                    key={s.monotonicMs}
                    x={x(Math.max(origin, s.monotonicMs - s.intervalSeconds * 1000))}
                    y={100 - (s.usedCores / maxCpu) * 75}
                    width={Math.max(
                      1,
                      x(s.monotonicMs) - x(Math.max(origin, s.monotonicMs - s.intervalSeconds * 1000)),
                    )}
                    height={Math.max(1, (s.usedCores / maxCpu) * 75)}
                    fill={palette[0]}
                    opacity="0.8"
                  >
                    <title>
                      +{format((s.monotonicMs - origin) / 1000)} s: {format(s.usedCores)} cores over{" "}
                      {format(s.intervalSeconds)} s
                    </title>
                  </rect>
                ) : null,
              )}
              <text x="0" y="130" fill="#9ca3af" fontSize="12">
                {format(maxMemory / 1048576)} MiB
              </text>
              {(["residentBytes", "privateBytes"] as const).map((key, ki) => (
                <g key={key}>
                  {samples.map((s, i) => {
                    const value = s[key],
                      previous = samples[i - 1];
                    if (s.status !== "ok" || value == null) return null;
                    const y = 215 - (value / maxMemory) * 75;
                    return (
                      <g key={s.monotonicMs}>
                        {previous?.status === "ok" && previous[key] != null && (
                          <line
                            x1={x(previous.monotonicMs)}
                            y1={215 - (previous[key] / maxMemory) * 75}
                            x2={x(s.monotonicMs)}
                            y2={y}
                            stroke={palette[ki + 1]}
                            strokeWidth="2"
                          />
                        )}
                        <circle cx={x(s.monotonicMs)} cy={y} r="3" fill={palette[ki + 1]}>
                          <title>
                            {key}: {format(value / 1048576)} MiB
                          </title>
                        </circle>
                      </g>
                    );
                  })}
                </g>
              ))}
              <text x="65" y="240" fill="#9ca3af" fontSize="12">
                0 s (OS clock)
              </text>
              <text x="850" y="240" fill="#9ca3af" fontSize="12">
                {format(span / 1000)} s
              </text>
            </svg>
            <p className="text-xs">
              <span style={{ color: palette[1] }}>Resident memory</span> ·{" "}
              <span style={{ color: palette[2] }}>Private memory</span>
            </p>
            <Statistics
              rows={[
                ["usedCores", process.usedCores],
                ["resident memory", memoryMiB(process.residentBytes)],
                ["private memory", memoryMiB(process.privateBytes)],
              ]}
            />
          </div>
        );
      })}
    </section>
  );
}

export function PerformanceCaptureView({ data }: { data: PerformanceView }) {
  const [selected, setSelected] = useState(0);
  const [start, setStart] = useState(0);
  const [filter, setFilter] = useState("");
  const frames = data.frames.slice(start, start + WINDOW);
  const max = Math.max(1, ...frames.map((f) => f.frame_ms));
  const select = (index: number) => {
    setSelected(index);
    if (index < start || index >= start + WINDOW)
      setStart(Math.min(Math.floor(index / WINDOW) * WINDOW, Math.max(0, data.frames.length - WINDOW)));
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{data.report.case}</h2>
        <p className="break-all text-xs text-muted">
          {data.report.jobId} · {data.report.state} · scenario: {data.report.scenarioOutcome} · average FPS:{" "}
          {format(data.report.averageFps)}
        </p>
      </div>
      <Statistics
        rows={Object.entries(data.report.summaries)}
        baseline={data.baselineReport?.summaries}
        comparison={data.comparison}
      />
      {data.comparison && (
        <section className={sectionClass}>
          <h3>Baseline comparison: {data.comparison.status}</h3>
          <p className="text-xs text-muted">
            Missing: {data.comparison.missingConditions.join(", ") || "none"} · Different:{" "}
            {data.comparison.conditionDifferences.join(", ") || "none"}. No performance verdict is inferred.
          </p>
          <details>
            <summary>Baseline conditions</summary>
            <pre className="whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(data.baselineReport?.conditions, null, 2)}
            </pre>
          </details>
        </section>
      )}
      <section className={sectionClass}>
        <h3 className="font-semibold">Frame time · ms</h3>
        {data.frames.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label>
                Selected frame index{" "}
                <input
                  aria-label="Selected frame index"
                  className={`${inputClass} w-24`}
                  type="number"
                  min="1"
                  max={data.frames.length}
                  value={selected + 1}
                  onChange={(e) => select(Math.max(0, Math.min(data.frames.length - 1, Number(e.target.value) - 1)))}
                />
              </label>
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  select(data.frames.reduce((best, f, i) => (f.frame_ms > data.frames[best]!.frame_ms ? i : best), 0))
                }
              >
                Slowest frame
              </button>
              <span>
                Showing {start + 1}–{Math.min(start + WINDOW, data.frames.length)} of {data.frames.length}
              </span>
            </div>
            {/* biome-ignore lint/a11y/useSemanticElements: SVG groups cannot be HTML fieldsets. */}
            <svg viewBox="0 0 1000 140" className="w-full" role="group" aria-label="Frame time bars">
              <text x="0" y="12" fontSize="12" fill="#9ca3af">
                {format(max)} ms
              </text>
              {frames.map((f, i) => (
                // biome-ignore lint/a11y/useSemanticElements: SVG bars need SVG elements with equivalent keyboard controls.
                <rect
                  key={f.frameId}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select frame ${f.frameId}: ${format(f.frame_ms)} ms`}
                  x={(i / frames.length) * 1000}
                  y={135 - (f.frame_ms / max) * 110}
                  width={Math.max(1, 1000 / frames.length - 1)}
                  height={Math.max(2, (f.frame_ms / max) * 110)}
                  fill={start + i === selected ? palette[2] : palette[0]}
                  onClick={() => select(start + i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      select(start + i);
                    }
                  }}
                >
                  <title>
                    Frame {f.frameId} · {format(f.frame_ms)} ms
                  </title>
                </rect>
              ))}
            </svg>
            <label className="flex items-center gap-3 text-xs">
              Browse frames
              <input
                className="min-w-0 flex-1"
                aria-label="Frame window"
                type="range"
                min="0"
                max={Math.max(0, data.frames.length - WINDOW)}
                value={Math.min(start, Math.max(0, data.frames.length - WINDOW))}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </label>
          </>
        )}
      </section>
      <FrameDetails data={data} selected={selected} />
      <section className={sectionClass}>
        <h3 className="font-semibold">All Lua labels</h3>
        <input
          className={inputClass}
          placeholder="Filter labels"
          aria-label="Filter Lua labels"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Statistics
          rows={data.luaSummaries
            .filter((s) => s.label.toLowerCase().includes(filter.toLowerCase()))
            .map((s) => [s.label, s])}
          baseline={data.baselineLuaSummaries && Object.fromEntries(data.baselineLuaSummaries.map((s) => [s.label, s]))}
          comparison={data.luaComparison}
        />
        {!data.luaSummaries.length && <p className="text-muted">No explicit Lua labels were captured.</p>}
      </section>
      <ProcessCharts data={data} />
      <section className={sectionClass}>
        <h3 className="font-semibold">Capture quality and conditions</h3>
        <p className="text-xs text-warning">
          Missing metrics: {data.report.missingMetrics.join(", ") || "none"} · Stop:{" "}
          {data.report.stopReason || "unspecified"}
        </p>
        {[
          ["Quality", data.report.quality],
          ["Lua quality", data.manualScopes],
          ["Conditions", data.report.conditions],
          ["Latest observations (not frame aligned; freshness may be unknown)", data.report.latestObserved],
        ].map(([title, value]) => (
          <details key={String(title)}>
            <summary className="cursor-pointer text-sm">{String(title)}</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted">
              {JSON.stringify(value ?? {}, null, 2)}
            </pre>
          </details>
        ))}
      </section>
    </div>
  );
}

export function PerformanceViewer({
  jobId,
  threadId,
  load = loadPerformanceView,
}: {
  jobId: string;
  threadId?: string;
  load?: (params: PerformanceReadParams) => Promise<PerformanceView>;
}) {
  const [data, setData] = useState<PerformanceView | null>(null);
  const [error, setError] = useState("");
  const [baseline, setBaseline] = useState("");
  const [request, setRequest] = useState<{ baseline?: string }>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    void load({ jobId, threadId, ...request }).then(
      (result) => {
        if (active) {
          setData(result);
          setLoading(false);
        }
      },
      (reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [jobId, threadId, request, load]);
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setRequest(baseline.trim() ? { baseline: baseline.trim() } : {});
        }}
      >
        <input
          className={`${inputClass} min-w-0 flex-1`}
          aria-label="Baseline capture job ID"
          placeholder="Optional baseline job ID"
          value={baseline}
          onChange={(e) => setBaseline(e.target.value)}
        />
        <button className={buttonClass} type="submit" disabled={loading}>
          Load / refresh
        </button>
      </form>
      {loading && <output>Loading saved capture…</output>}
      {error && (
        <p role="alert" className="break-words text-warning">
          {error}
        </p>
      )}
      {data && <PerformanceCaptureView key={data.report.jobId} data={data} />}
    </div>
  );
}
