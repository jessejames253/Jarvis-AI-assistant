/**
 * lib/agents/retryPolicy.ts — Phase 4B bounded retry policy.
 *
 * Rules:
 *  - max 2 retries per task (configurable via task.maxRetries)
 *  - NO retry on permission denial (PermissionDeniedError)
 *  - NO retry on "risky" classified failures
 *  - retry ONLY for "recoverable" failures (network, timeout, dep ordering)
 *  - every retry attempt is logged with classifiedFailure reason
 */

import type { Task } from "./taskGraph";

// ─── Failure classification ───────────────────────────────────────────────────

export type FailureClass =
  | "recoverable"       // safe to retry (timeout, network, transient)
  | "permission_denied" // never retry — agent lacks the required permission
  | "risky"             // never retry — the failure involves a risky operation
  | "unrecoverable";    // never retry — structural error (unknown agent, bad task)

/** Classify an error string into a retry strategy. */
export function classifyFailure(error: string): FailureClass {
  if (/PermissionDenied|permission.denied/i.test(error)) return "permission_denied";
  if (/risky|high.risk|blocked.file|cannot.apply/i.test(error)) return "risky";
  if (
    /timeout|timed.out|network|econnrefused|fetch.failed|socket/i.test(error) ||
    /unmet.depend|dependency.*not.found|dep.*failed/i.test(error) ||
    /429|rate.limit/i.test(error)
  ) return "recoverable";
  // Claude API errors are often transient
  if (/anthropic|overloaded|api.error|500|503/i.test(error)) return "recoverable";
  return "unrecoverable";
}

// ─── Retry decision ───────────────────────────────────────────────────────────

/**
 * Returns true if the task should be retried after this failure.
 * Checks both retry count and failure class.
 */
export function canRetry(task: Task, error: string): boolean {
  if (task.retryCount >= task.maxRetries) return false;
  const cls = classifyFailure(error);
  return cls === "recoverable";
}

/** Human-readable explanation of why a task cannot be retried. */
export function retryDenialReason(task: Task, error: string): string {
  if (task.retryCount >= task.maxRetries)
    return `Retry limit reached (${task.retryCount}/${task.maxRetries})`;
  const cls = classifyFailure(error);
  if (cls === "permission_denied")
    return "Permission denied — retrying would violate agent permissions";
  if (cls === "risky")
    return "Risky failure — requires human review before retry";
  if (cls === "unrecoverable")
    return "Unrecoverable failure — manual intervention required";
  return "Unknown";
}

// ─── Retry log ───────────────────────────────────────────────────────────────

export interface RetryLogEntry {
  taskId:       string;
  attempt:      number;
  error:        string;
  failureClass: FailureClass;
  timestamp:    number;
}

const retryLog: RetryLogEntry[] = [];

/** Record a retry attempt. */
export function logRetry(
  taskId:  string,
  attempt: number,
  error:   string,
): RetryLogEntry {
  const entry: RetryLogEntry = {
    taskId,
    attempt,
    error,
    failureClass: classifyFailure(error),
    timestamp:    Date.now(),
  };
  retryLog.push(entry);
  if (retryLog.length > 500) retryLog.splice(0, retryLog.length - 500);
  return entry;
}

/** Get retry log entries, optionally filtered by task ID. */
export function getRetryLog(taskId?: string): RetryLogEntry[] {
  return taskId
    ? retryLog.filter(e => e.taskId === taskId)
    : retryLog.slice(-100);
}

/** Total retries across all tasks. */
export function getTotalRetries(): number {
  return retryLog.length;
}

/** Clear the retry log (used in tests). */
export function _clearRetryLog(): void {
  retryLog.splice(0, retryLog.length);
}
