/**
 * lib/plannerApi.ts — SSE client for the /api/plan/stream endpoint.
 *
 * Mirrors the callChatStream pattern from Chat.tsx but handles plan-specific events.
 * Exports the FrontendPlan and FrontendPlanStep types used throughout the UI.
 */

export type PlanStepStatus = "pending" | "running" | "complete" | "failed";
export type PlanStatus = "running" | "complete" | "failed" | "cancelled";

export interface FrontendPlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
  retryCount: number;
  durationMs?: number;
  error?: string;
}

export interface FrontendPlan {
  id: string;
  title: string;
  goal: string;
  steps: FrontendPlanStep[];
  status: PlanStatus;
  createdAt: number;
  durationMs?: number;
  summary?: string;
  stepsCompleted?: number;
  stepsFailed?: number;
}

// ─── SSE payload types ────────────────────────────────────────────────────────

export interface PlanCreatedPayload   { id: string; title: string; goal: string; steps: FrontendPlanStep[]; createdAt: number }
export interface PlanStepStartPayload { planId: string; stepId: string; stepIndex: number; title: string }
export interface PlanStepDonePayload  { planId: string; stepId: string; stepIndex: number; durationMs: number; summary: string }
export interface PlanStepFailPayload  { planId: string; stepId: string; stepIndex: number; error: string; willRetry: boolean }
export interface PlanDonePayload      { planId: string; durationMs: number; summary: string; stepsCompleted: number; stepsFailed: number }

export type PlanToolEvent =
  | { type: "tool_start"; toolCallId: string; tool: string; label: string }
  | { type: "tool_done";  toolCallId: string; tool: string; durationMs: number; result: unknown }
  | { type: "tool_error"; toolCallId: string; tool: string; durationMs: number; error: string };

export interface PlanStreamCallbacks {
  onPlanCreated:   (payload: PlanCreatedPayload) => void;
  onStepStart:     (payload: PlanStepStartPayload) => void;
  onToken:         (text: string) => void;
  onToolEvent:     (event: PlanToolEvent) => void;
  onStepComplete:  (payload: PlanStepDonePayload) => void;
  onStepFailed:    (payload: PlanStepFailPayload) => void;
  onPlanDone:      (payload: PlanDonePayload) => void;
  onError:         (message?: string) => void;
}

// ─── Plan persistence (localStorage) ─────────────────────────────────────────

const PLAN_KEY_PREFIX = "jarvas_plan_";

export function savePlan(sessionId: string, plan: FrontendPlan): void {
  try {
    localStorage.setItem(PLAN_KEY_PREFIX + sessionId, JSON.stringify(plan));
  } catch { /* storage full */ }
}

export function loadSavedPlan(sessionId: string): FrontendPlan | null {
  try {
    const raw = localStorage.getItem(PLAN_KEY_PREFIX + sessionId);
    if (!raw) return null;
    return JSON.parse(raw) as FrontendPlan;
  } catch {
    return null;
  }
}

export function clearSavedPlan(sessionId: string): void {
  try {
    localStorage.removeItem(PLAN_KEY_PREFIX + sessionId);
  } catch { /* ignore */ }
}

// ─── SSE stream client ────────────────────────────────────────────────────────

export async function callPlanStream(
  goal: string,
  sessionId: string,
  base: string,
  callbacks: PlanStreamCallbacks,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base}api/plan/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, sessionId }),
    });
  } catch {
    callbacks.onError("Network error");
    return;
  }

  if (!res.ok || !res.body) {
    callbacks.onError(`HTTP ${res.status}`);
    return;
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;
        try {
          const ev = JSON.parse(jsonStr) as Record<string, unknown>;
          const t = ev.type as string;

          switch (t) {
            case "plan_created":
              callbacks.onPlanCreated(ev as unknown as PlanCreatedPayload);
              break;
            case "plan_step_start":
              callbacks.onStepStart(ev as unknown as PlanStepStartPayload);
              break;
            case "token":
              if (typeof ev.text === "string") callbacks.onToken(ev.text);
              break;
            case "tool_start":
            case "tool_done":
            case "tool_error":
              callbacks.onToolEvent(ev as unknown as PlanToolEvent);
              break;
            case "plan_step_complete":
              callbacks.onStepComplete(ev as unknown as PlanStepDonePayload);
              break;
            case "plan_step_failed":
              callbacks.onStepFailed(ev as unknown as PlanStepFailPayload);
              break;
            case "plan_done":
              callbacks.onPlanDone(ev as unknown as PlanDonePayload);
              break;
            case "plan_cancelled":
              break;
            case "done":
              break;
            case "error":
              callbacks.onError(ev.message as string | undefined);
              break;
          }
        } catch { /* ignore malformed SSE lines */ }
      }
    }
  } catch {
    callbacks.onError("Stream read error");
  }
}
