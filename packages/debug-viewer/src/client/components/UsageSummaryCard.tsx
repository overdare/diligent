// @summary Sidebar card showing aggregate usage and cost totals
import type { UsageSummary } from "../lib/types.js";

interface UsageSummaryCardProps {
  summary: UsageSummary;
  loading: boolean;
  className?: string;
  modelLimit?: number;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

export function UsageSummaryCard({ summary, loading, className, modelLimit = 3 }: UsageSummaryCardProps) {
  if (loading) {
    return <div className={`usage-summary-card ${className ?? ""}`.trim()}>Loading usage...</div>;
  }

  const topModels = summary.modelBreakdown.slice(0, modelLimit);

  return (
    <div className={`usage-summary-card ${className ?? ""}`.trim()}>
      <div className="usage-summary-title">All Sessions Usage</div>
      <div className="usage-summary-grid">
        <div className="usage-metric">
          <span className="usage-label">Sessions</span>
          <span className="usage-value">{formatNumber(summary.sessionCount)}</span>
        </div>
        <div className="usage-metric">
          <span className="usage-label">Assistant msgs</span>
          <span className="usage-value">{formatNumber(summary.assistantMessageCount)}</span>
        </div>
        <div className="usage-metric">
          <span className="usage-label">Input tokens</span>
          <span className="usage-value">{formatNumber(summary.totals.inputTokens)}</span>
        </div>
        <div className="usage-metric">
          <span className="usage-label">Output tokens</span>
          <span className="usage-value">{formatNumber(summary.totals.outputTokens)}</span>
        </div>
        <div className="usage-metric">
          <span className="usage-label">Cache read</span>
          <span className="usage-value">{formatNumber(summary.totals.cacheReadTokens)}</span>
        </div>
        <div className="usage-metric">
          <span className="usage-label">Cache write</span>
          <span className="usage-value">{formatNumber(summary.totals.cacheWriteTokens)}</span>
        </div>
      </div>

      <div className="usage-total-row">
        <span className="usage-total-label">Total tokens (in+out)</span>
        <span className="usage-total-value">{formatNumber(summary.totals.totalTokens)}</span>
      </div>

      <div className="usage-total-row usage-cost-row">
        <span className="usage-total-label">Estimated cost</span>
        <span className="usage-total-value">{formatUsd(summary.totalCost)}</span>
      </div>

      {summary.unpricedMessageCount > 0 && (
        <div className="usage-note">
          {formatNumber(summary.unpricedMessageCount)} assistant messages had unknown pricing and were excluded from cost.
        </div>
      )}

      {topModels.length > 0 && (
        <div className="usage-models">
          <div className="usage-models-title">Top models by cost</div>
          {topModels.map((model) => (
            <div key={model.model} className="usage-model-row">
              <span className="usage-model-name">{model.model}</span>
              <span className="usage-model-cost">{formatUsd(model.totalCost)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
