// @summary PermissionEngine implementation — rule matching, last-match-wins, session cache
import type { ApprovalRequest } from "../tool/types";
import type { PermissionAction, PermissionEngine, PermissionRule } from "./types";

/** Extract the matching subject from an approval request (fixes file_path priority bug). */
export function extractSubject(request: ApprovalRequest): string {
  const d = request.details;
  const raw = d?.file_path ?? d?.path ?? d?.command ?? request.toolName;
  return String(raw);
}

/**
 * Generate a wildcard pattern from an approval request for "always" rules.
 * - Commands (details.command): first word + ` **` → `npm test` becomes `npm **`
 * - File paths (details.file_path or details.path): parent dir + `/**` → `/a/b/c.ts` becomes `/a/b/**`
 * - Fallback: exact toolName
 */
export function generatePattern(request: ApprovalRequest): string {
  const d = request.details;
  const filePath = d?.file_path ?? d?.path;
  if (filePath) {
    const s = String(filePath);
    const lastSlash = s.lastIndexOf("/");
    return lastSlash > 0 ? `${s.slice(0, lastSlash)}/**` : s;
  }
  if (d?.command) {
    const cmd = String(d.command);
    const firstSpace = cmd.indexOf(" ");
    return firstSpace > 0 ? `${cmd.slice(0, firstSpace)} **` : cmd;
  }
  return request.toolName;
}

export function createPermissionEngine(configRules: PermissionRule[]): PermissionEngine {
  // Session-scoped rules added by "always" responses (D029)
  const sessionRules: PermissionRule[] = [];

  function evaluate(request: ApprovalRequest): PermissionAction {
    // Config rules first, then session rules — last-match-wins (D027)
    const allRules = [...configRules, ...sessionRules];
    let result: PermissionAction = "prompt"; // default when no rule matches
    const subject = extractSubject(request);
    for (const rule of allRules) {
      if (rule.permission !== request.permission) continue;
      if (wildcardMatch(rule.pattern, subject)) result = rule.action;
    }
    return result;
  }

  function remember(request: ApprovalRequest, action: "allow" | "deny"): void {
    const pattern = generatePattern(request);
    sessionRules.push({ permission: request.permission, pattern, action });
  }

  return { evaluate, remember };
}

/**
 * Hand-rolled wildcard matching.
 * `**` matches any sequence including path separators.
 * `*` matches any sequence except `/`.
 * All other characters are literal.
 */
export function wildcardMatch(pattern: string, subject: string): boolean {
  return matchAt(pattern, 0, subject, 0);
}

function matchAt(pattern: string, pi: number, subject: string, si: number): boolean {
  while (pi < pattern.length) {
    const pc = pattern[pi];

    if (pc === "*") {
      const isDouble = pattern[pi + 1] === "*";
      const next = isDouble ? pi + 2 : pi + 1;

      if (next === pattern.length) {
        // Trailing * or ** — matches remainder of subject
        if (!isDouble) {
          // * must not cross a /
          return !subject.slice(si).includes("/");
        }
        return true;
      }

      // Try consuming 0..n characters in subject
      for (let len = 0; si + len <= subject.length; len++) {
        if (!isDouble && subject.slice(si, si + len).includes("/")) break;
        if (matchAt(pattern, next, subject, si + len)) return true;
      }
      return false;
    }

    if (si >= subject.length || pc !== subject[si]) return false;
    pi++;
    si++;
  }

  return si === subject.length;
}
