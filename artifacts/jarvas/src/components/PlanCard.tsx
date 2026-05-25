/**
 * components/PlanCard.tsx — Inline plan card rendered inside an assistant message.
 *
 * Shows the plan title, step-by-step progress, and final summary.
 * Rendered in MessageBubble when message.plan is set.
 */

import type { FrontendPlan, FrontendPlanStep, PlanStepStatus } from "@/lib/plannerApi";

// ─── Step status icon ─────────────────────────────────────────────────────────

function StepIcon({ status }: { status: PlanStepStatus }) {
  if (status === "complete") {
    return (
      <span className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-xs"
        style={{ background: "hsl(142 60% 40% / 0.2)", color: "hsl(142 71% 60%)" }}>
        ✓
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-xs"
        style={{ background: "hsl(355 80% 40% / 0.2)", color: "hsl(355 80% 62%)" }}>
        ✕
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex-shrink-0 w-4 h-4 rounded-full border-2 animate-spin"
        style={{ borderColor: "hsl(194 100% 55%)", borderTopColor: "transparent" }}
      />
    );
  }
  // pending
  return (
    <span className="flex-shrink-0 w-4 h-4 rounded-full border"
      style={{ borderColor: "hsl(210 15% 28%)" }}
    />
  );
}

// ─── Single step row ──────────────────────────────────────────────────────────

function StepRow({ step, index }: { step: FrontendPlanStep; index: number }) {
  const isRunning = step.status === "running";
  const isDone    = step.status === "complete";
  const isFailed  = step.status === "failed";

  return (
    <div className={`flex items-center gap-2.5 py-1 ${isRunning ? "opacity-100" : isDone || isFailed ? "opacity-80" : "opacity-45"}`}>
      <StepIcon status={step.status} />
      <span
        className="text-sm flex-1 min-w-0 truncate"
        style={{
          color: isFailed ? "hsl(355 80% 62%)" : isRunning ? "hsl(194 100% 70%)" : isDone ? "hsl(196 30% 55%)" : "hsl(210 20% 40%)",
          textDecoration: isFailed ? "line-through" : "none",
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: "0.78rem",
        }}
      >
        <span style={{ color: "hsl(210 20% 35%)", marginRight: "0.4em" }}>{String(index + 1).padStart(2, "0")}.</span>
        {step.title}
      </span>
      {step.durationMs != null && (
        <span className="flex-shrink-0 text-xs" style={{ color: "hsl(210 20% 32%)", fontFamily: "monospace", fontSize: "0.7rem" }}>
          {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ plan }: { plan: FrontendPlan }) {
  const total  = plan.steps.length;
  const done   = plan.steps.filter(s => s.status === "complete").length;
  const failed = plan.steps.filter(s => s.status === "failed").length;
  const pct    = Math.round(((done + failed) / total) * 100);

  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "hsl(210 15% 15%)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: failed > 0
              ? "hsl(38 100% 55%)"
              : plan.status === "complete"
                ? "hsl(142 60% 45%)"
                : "hsl(194 100% 50%)",
          }}
        />
      </div>
      <span className="text-xs flex-shrink-0" style={{ color: "hsl(196 30% 45%)", fontFamily: "monospace", fontSize: "0.7rem" }}>
        {done}/{total}
      </span>
    </div>
  );
}

// ─── Main PlanCard ────────────────────────────────────────────────────────────

export default function PlanCard({ plan }: { plan: FrontendPlan }) {
  const isRunning  = plan.status === "running";
  const isComplete = plan.status === "complete";
  const isFailed   = plan.status === "failed";

  const statusColor = isComplete ? "hsl(142 71% 55%)" : isFailed ? "hsl(355 80% 60%)" : "hsl(194 100% 60%)";
  const statusLabel = isComplete ? "COMPLETE" : isFailed ? "FAILED" : "RUNNING";

  return (
    <div
      className="rounded-xl border mb-3 overflow-hidden"
      style={{ background: "hsl(220 20% 6% / 0.6)", borderColor: "hsl(210 15% 18%)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "hsl(210 15% 13%)" }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono tracking-widest flex-shrink-0" style={{ color: "hsl(196 40% 40%)" }}>
            PLAN
          </span>
          <span className="text-xs font-mono truncate" style={{ color: "hsl(196 50% 65%)" }}>
            {plan.title}
          </span>
        </div>
        <span
          className={`text-xs font-mono flex-shrink-0 ml-2 ${isRunning ? "animate-pulse" : ""}`}
          style={{ color: statusColor, fontSize: "0.65rem" }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Steps */}
      <div className="px-3 pt-2 pb-1">
        <ProgressBar plan={plan} />
        <div className="flex flex-col">
          {plan.steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i} />
          ))}
        </div>
      </div>

      {/* Summary (when done) */}
      {plan.summary && (
        <div className="px-3 py-2 border-t" style={{ borderColor: "hsl(210 15% 13%)" }}>
          <p className="text-xs" style={{ color: "hsl(196 30% 50%)", fontFamily: "'Courier New', Courier, monospace", lineHeight: "1.5" }}>
            {plan.summary}
          </p>
        </div>
      )}
    </div>
  );
}
