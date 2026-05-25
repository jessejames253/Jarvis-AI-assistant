/**
 * components/PlannerPanel.tsx — Floating mobile-friendly live plan panel.
 *
 * Shown while a plan is running. Anchored to the bottom-left above the input bar.
 * Collapsed: plan title + step dots + cancel.
 * Expanded: full step list with status icons + cancel button.
 *
 * Disappears when plan.status !== "running".
 */

import { useState } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import type { FrontendPlan, PlanStepStatus } from "@/lib/plannerApi";

// ── Dot indicator ─────────────────────────────────────────────────────────────

function StepDot({ status }: { status: PlanStepStatus }) {
  const colors: Record<PlanStepStatus, string> = {
    pending:  "hsl(210 15% 28%)",
    running:  "hsl(194 100% 60%)",
    complete: "hsl(142 71% 55%)",
    failed:   "hsl(355 80% 60%)",
  };
  return (
    <div
      className={`w-2 h-2 rounded-full flex-shrink-0 ${status === "running" ? "animate-pulse" : ""}`}
      style={{ background: colors[status] }}
    />
  );
}

// ── Step row ──────────────────────────────────────────────────────────────────

function ExpandedStep({ step, index }: { step: FrontendPlan["steps"][number]; index: number }) {
  const isRunning = step.status === "running";
  const isFailed  = step.status === "failed";
  const isDone    = step.status === "complete";

  return (
    <div className="flex items-center gap-2 py-1">
      <StepDot status={step.status} />
      <span
        className="text-xs flex-1 min-w-0 truncate"
        style={{
          color: isFailed ? "hsl(355 80% 58%)" : isRunning ? "hsl(194 100% 68%)" : isDone ? "hsl(196 30% 52%)" : "hsl(210 20% 38%)",
          fontFamily: "'Courier New', Courier, monospace",
          textDecoration: isFailed ? "line-through" : "none",
        }}
      >
        <span style={{ color: "hsl(210 20% 32%)", marginRight: "0.3em" }}>{index + 1}.</span>
        {step.title}
      </span>
      {step.durationMs != null && (
        <span className="text-xs flex-shrink-0" style={{ color: "hsl(210 20% 30%)", fontFamily: "monospace", fontSize: "0.65rem" }}>
          {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  plan: FrontendPlan;
  onCancel: () => void;
}

export default function PlannerPanel({ plan, onCancel }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (plan.status !== "running") return null;

  const done    = plan.steps.filter(s => s.status === "complete").length;
  const failed  = plan.steps.filter(s => s.status === "failed").length;
  const total   = plan.steps.length;
  const current = plan.steps.find(s => s.status === "running");

  return (
    <div
      className="fixed bottom-24 left-3 z-50 select-none"
      style={{ maxWidth: 240, fontFamily: "'Courier New', Courier, monospace" }}
    >
      <div
        className="rounded-xl border shadow-2xl overflow-hidden"
        style={{
          background: "hsl(220 20% 5% / 0.94)",
          borderColor: "hsl(194 100% 50% / 0.28)",
          backdropFilter: "blur(10px)",
        }}
      >
        {/* Header — always visible */}
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="text-xs tracking-widest flex-shrink-0" style={{ color: "hsl(196 40% 40%)", fontSize: "0.65rem" }}>
            PLAN
          </span>
          <span className="text-xs flex-1 min-w-0 truncate animate-pulse" style={{ color: "hsl(194 100% 65%)" }}>
            {current ? current.title : plan.title}
          </span>
          <span className="text-xs flex-shrink-0" style={{ color: "hsl(196 30% 38%)", fontSize: "0.65rem" }}>
            {done + failed}/{total}
          </span>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "hsl(196 30% 50%)" }}
          >
            {expanded
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronUp className="w-3 h-3" />
            }
          </button>
          <button
            onClick={onCancel}
            className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "hsl(355 70% 55%)" }}
            aria-label="Cancel plan"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Compact dot strip */}
        {!expanded && (
          <div className="flex items-center gap-1 px-2.5 pb-1.5">
            {plan.steps.map(step => <StepDot key={step.id} status={step.status} />)}
          </div>
        )}

        {/* Expanded step list */}
        {expanded && (
          <>
            <div style={{ height: 1, background: "hsl(210 15% 12%)" }} />
            <div className="px-2.5 py-1.5 flex flex-col">
              {plan.steps.map((step, i) => (
                <ExpandedStep key={step.id} step={step} index={i} />
              ))}
            </div>
            <div style={{ height: 1, background: "hsl(210 15% 12%)" }} />
            <div className="px-2.5 py-1.5">
              <button
                onClick={onCancel}
                className="w-full text-xs py-1 rounded-lg border transition-colors hover:bg-red-500/10"
                style={{ color: "hsl(355 70% 58%)", borderColor: "hsl(355 70% 40% / 0.3)", fontFamily: "'Courier New', Courier, monospace" }}
              >
                Cancel plan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
