// @summary Hook for fetching aggregate token/cost usage across all sessions
import { useCallback, useEffect, useState } from "react";
import type { UsageSummary } from "../lib/types.js";

const EMPTY_SUMMARY: UsageSummary = {
  sessionCount: 0,
  assistantMessageCount: 0,
  pricedMessageCount: 0,
  unpricedMessageCount: 0,
  totalCost: 0,
  totals: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  },
  modelBreakdown: [],
};

export function useUsageSummary() {
  const [summary, setSummary] = useState<UsageSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSummary(data.summary);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch usage summary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { summary, loading, error, refetch: fetchSummary };
}
