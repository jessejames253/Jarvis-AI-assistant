/**
 * components/DebugPanel.tsx — Agent debug inspector
 *
 * Shows what happened inside the Jarvas agent system for a given response:
 *   - Intent detected and confidence level
 *   - Secondary intent (if any)
 *   - Reasoning path (step-by-step)
 *   - Action taken by the tool
 *   - Mode the assistant was in
 *   - Whether memory context was used
 *   - Which signals triggered the intent
 *   - Processing time in milliseconds
 *
 * Starts collapsed (just the intent badge + action summary).
 * Click anywhere to expand the full reasoning path.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface DebugInfo {
  intent: string;
  secondaryIntent?: string;
  confidence: number;
  signals: string[];
  action: string;
  mode: string;
  memoryUsed: boolean;
  reasoning: string[];
  processingMs: number;
}

interface DebugPanelProps {
  debug: DebugInfo;
}

// Intent badge colours (matching the futuristic palette)
const INTENT_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  casual:        { bg: "hsl(142 60% 40% / 0.15)", border: "hsl(142 60% 40% / 0.4)", text: "hsl(142 71% 60%)" },
  identity:      { bg: "hsl(264 70% 60% / 0.15)", border: "hsl(264 70% 60% / 0.4)", text: "hsl(264 80% 75%)" },
  coding:        { bg: "hsl(210 90% 55% / 0.15)", border: "hsl(210 90% 55% / 0.4)", text: "hsl(210 100% 70%)" },
  research:      { bg: "hsl(38 95% 55% / 0.15)",  border: "hsl(38 95% 55% / 0.4)",  text: "hsl(38 100% 65%)"  },
  memory_update: { bg: "hsl(180 60% 45% / 0.15)", border: "hsl(180 60% 45% / 0.4)", text: "hsl(180 70% 60%)"  },
  math:          { bg: "hsl(55 95% 55% / 0.15)",  border: "hsl(55 95% 55% / 0.4)",  text: "hsl(55 100% 65%)"  },
  planning:      { bg: "hsl(330 70% 60% / 0.15)", border: "hsl(330 70% 60% / 0.4)", text: "hsl(330 80% 72%)"  },
  definition:    { bg: "hsl(194 90% 45% / 0.15)", border: "hsl(194 90% 45% / 0.4)", text: "hsl(194 100% 60%)" },
  general:       { bg: "hsl(210 15% 45% / 0.15)", border: "hsl(210 15% 45% / 0.4)", text: "hsl(210 20% 65%)"  },
};

function getIntentStyle(intent: string) {
  return INTENT_STYLES[intent] ?? INTENT_STYLES.general;
}

function IntentBadge({ intent }: { intent: string }) {
  const style = getIntentStyle(intent);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold tracking-wider border"
      style={{ background: style.bg, borderColor: style.border, color: style.text }}
    >
      {intent.toUpperCase().replace("_", "_")}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 80 ? "hsl(142 71% 50%)" :
    pct >= 55 ? "hsl(38 100% 60%)" :
    "hsl(0 70% 60%)";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="font-mono text-xs" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

export default function DebugPanel({ debug }: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="mt-1 rounded-xl border overflow-hidden cursor-pointer select-none"
      style={{
        background: "hsl(220 20% 5% / 0.8)",
        borderColor: "hsl(210 15% 20%)",
        fontFamily: "'Courier New', Courier, monospace",
      }}
      onClick={() => setExpanded((v) => !v)}
      data-testid="debug-panel"
    >
      {/* ── Collapsed header (always visible) ── */}
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        {/* Label */}
        <span className="text-xs tracking-widest" style={{ color: "hsl(196 40% 40%)" }}>
          DBG
        </span>

        {/* Intent badge */}
        <IntentBadge intent={debug.intent} />

        {/* Secondary intent */}
        {debug.secondaryIntent && (
          <span className="text-xs" style={{ color: "hsl(210 20% 45%)" }}>
            ↳ {debug.secondaryIntent}
          </span>
        )}

        {/* Confidence bar */}
        <ConfidenceBar value={debug.confidence} />

        {/* Mode */}
        <span className="text-xs" style={{ color: "hsl(196 40% 45%)" }}>
          {debug.mode}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Timing */}
        <span className="text-xs font-mono" style={{ color: "hsl(210 20% 40%)" }}>
          {debug.processingMs}ms
        </span>

        {/* Expand toggle */}
        {expanded
          ? <ChevronUp className="w-3 h-3" style={{ color: "hsl(210 20% 40%)" }} />
          : <ChevronDown className="w-3 h-3" style={{ color: "hsl(210 20% 40%)" }} />
        }
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <>
          {/* Divider */}
          <div style={{ height: 1, background: "hsl(210 15% 15%)" }} />

          {/* Reasoning path */}
          <div className="px-3 py-2">
            <p className="text-xs mb-1.5 tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>
              REASONING PATH
            </p>
            <div className="flex flex-col gap-1">
              {debug.reasoning.map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span
                    className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-xs font-mono font-bold"
                    style={{ background: "hsl(210 15% 12%)", color: "hsl(194 100% 45%)" }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-xs leading-snug" style={{ color: "hsl(196 40% 60%)" }}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Signals */}
          {debug.signals.length > 0 && (
            <>
              <div style={{ height: 1, background: "hsl(210 15% 15%)" }} />
              <div className="px-3 py-2">
                <p className="text-xs mb-1.5 tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>
                  CLASSIFICATION SIGNALS
                </p>
                <div className="flex flex-col gap-0.5">
                  {debug.signals.map((sig, i) => (
                    <span key={i} className="text-xs" style={{ color: "hsl(196 30% 50%)" }}>
                      · {sig}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Footer row */}
          <div style={{ height: 1, background: "hsl(210 15% 15%)" }} />
          <div className="flex items-center gap-4 px-3 py-2 flex-wrap">
            <div>
              <span className="text-xs tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>
                ACTION{" "}
              </span>
              <span className="text-xs font-mono" style={{ color: "hsl(194 100% 55%)" }}>
                {debug.action}
              </span>
            </div>
            <div>
              <span className="text-xs tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>
                MEMORY{" "}
              </span>
              <span
                className="text-xs font-mono font-bold"
                style={{ color: debug.memoryUsed ? "hsl(142 71% 55%)" : "hsl(210 20% 40%)" }}
              >
                {debug.memoryUsed ? "ACTIVE" : "—"}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
