/**
 * lib/planner/types.ts — Shared types for the Jarvis multi-step planner.
 */

export type PlanStepStatus = "pending" | "running" | "complete" | "failed";
export type PlanStatus = "running" | "paused" | "complete" | "failed" | "cancelled";

export interface PlanStep {
  id: string;
  title: string;
  /** Optional instruction hint to guide Claude on this step */
  hint?: string;
  status: PlanStepStatus;
  result?: string;
  error?: string;
  retryCount: number;
  durationMs?: number;
}

export interface Plan {
  id: string;
  sessionId: string;
  goal: string;
  title: string;
  steps: PlanStep[];
  status: PlanStatus;
  createdAt: number;
  completedAt?: number;
  durationMs?: number;
  summary?: string;
}
