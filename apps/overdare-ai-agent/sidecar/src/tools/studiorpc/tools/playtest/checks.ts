// @summary Latches adapter-declared verification checks so verdicts never depend on frame history size.
import type { PlaytestCheck, PlaytestCheckBasis, PlaytestCheckStatus, PlaytestFrame } from "./frame";

export interface CheckTransition {
  status: PlaytestCheckStatus;
  atMs: number;
  revision: number;
}

export interface CheckSummaryItem {
  id: string;
  basis: PlaytestCheckBasis;
  description?: string;
  status: PlaytestCheckStatus;
  /** True when the check reported fail at any point, even if it later passed. */
  everFailed: boolean;
  /** Detail published with the most recent pass/fail transition. */
  detail?: Record<string, unknown>;
  transitions: CheckTransition[];
}

export interface BasisCounts {
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

export interface VerificationSummary {
  /**
   * Requirement checks only: passed = every one passed, failed = any one's final status failed,
   * incomplete = some still pending, not_declared = the adapter declared none.
   */
  status: "not_declared" | "passed" | "failed" | "incomplete";
  requirement: BasisCounts;
  auxiliary: BasisCounts;
  checks: CheckSummaryItem[];
}

export interface CheckTracker {
  /** Returns checks whose status changed in this frame. */
  observe(frame: PlaytestFrame, atMs: number): CheckSummaryItem[];
  summary(): VerificationSummary;
}

const MAX_TRANSITIONS_PER_CHECK = 16;

function countBasis(items: CheckSummaryItem[], basis: PlaytestCheckBasis): BasisCounts {
  const scoped = items.filter((item) => item.basis === basis);
  return {
    total: scoped.length,
    passed: scoped.filter((item) => item.status === "pass").length,
    failed: scoped.filter((item) => item.status === "fail").length,
    pending: scoped.filter((item) => item.status === "pending").length,
  };
}

function verificationStatus(requirement: BasisCounts): VerificationSummary["status"] {
  if (requirement.total === 0) return "not_declared";
  if (requirement.failed > 0) return "failed";
  if (requirement.pending > 0) return "incomplete";
  return "passed";
}

/** Shared by live tracking and saved-record validation; a terminal never supplies a check verdict. */
export function summarizeChecks(checks: CheckSummaryItem[]): VerificationSummary {
  const requirement = countBasis(checks, "requirement");
  return {
    status: verificationStatus(requirement),
    requirement,
    auxiliary: countBasis(checks, "auxiliary"),
    checks,
  };
}

export function createCheckTracker(): CheckTracker {
  const items = new Map<string, CheckSummaryItem>();

  const apply = (check: PlaytestCheck, atMs: number, revision: number): CheckSummaryItem | undefined => {
    const existing = items.get(check.id);
    if (existing && existing.basis !== check.basis) {
      throw new Error(`Check ${check.id} changed basis from ${existing.basis} to ${check.basis}`);
    }
    const item: CheckSummaryItem = existing ?? {
      id: check.id,
      basis: check.basis,
      status: "pending",
      everFailed: false,
      transitions: [],
    };
    if (check.description) item.description = check.description;
    if (!existing) items.set(check.id, item);
    const changed = !existing ? check.status !== "pending" : existing.status !== check.status;
    if (!changed) return undefined;
    item.status = check.status;
    if (check.status === "fail") item.everFailed = true;
    if (check.status !== "pending" && check.detail) item.detail = check.detail;
    if (item.transitions.length < MAX_TRANSITIONS_PER_CHECK) {
      item.transitions.push({ status: check.status, atMs, revision });
    }
    return item;
  };

  return {
    observe(frame, atMs) {
      const changed: CheckSummaryItem[] = [];
      for (const check of frame.checks ?? []) {
        const item = apply(check, atMs, frame.revision);
        if (item) changed.push(item);
      }
      return changed;
    },
    summary() {
      const checks = [...items.values()].map((item) => structuredClone(item));
      return summarizeChecks(checks);
    },
  };
}
