/**
 * components/DebugPanel.tsx — Agent debug inspector
 *
 * Collapsed: intent badge · confidence bar · action · LTM chip · tool count · timing
 * Expanded:  reasoning path · LTM facts · tool calls · classification signals
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Brain, Wrench } from "lucide-react";

export interface AgentToolCall {
  tool: string;
  label: string;
  durationMs: number;
  status: "done" | "error";
  result?: unknown;
  error?: string;
}

export interface DebugInfo {
  intent: string;
  secondaryIntent?: string;
  confidence: number;
  signals: string[];
  action: string;
  mode: string;
  memoryUsed: boolean;
  ltmHits?: string[];
  toolCalls?: AgentToolCall[];
  reasoning: string[];
  processingMs: number;
}

interface DebugPanelProps {
  debug: DebugInfo;
}

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

const LTM_CATEGORY_COLORS: Record<string, string> = {
  personal:    "hsl(264 80% 72%)",
  coding:      "hsl(210 100% 70%)",
  projects:    "hsl(142 71% 60%)",
  preferences: "hsl(38 100% 65%)",
};

const TOOL_META: Record<string, { icon: string; color: string }> = {
  get_weather:    { icon: "🌡️", color: "hsl(194 100% 55%)" },
  search_web:     { icon: "🔍", color: "hsl(210 90% 65%)"  },
  calculate:      { icon: "🧮", color: "hsl(55 100% 60%)"  },
  create_reminder:{ icon: "📌", color: "hsl(142 70% 55%)"  },
  list_reminders: { icon: "📋", color: "hsl(142 70% 55%)"  },
  lookup_memory:  { icon: "🧠", color: "hsl(264 80% 70%)"  },
  run_code:       { icon: "⚡", color: "hsl(38 100% 62%)"  },
};

function getIntentStyle(intent: string) {
  return INTENT_STYLES[intent] ?? INTENT_STYLES.general;
}

function IntentBadge({ intent }: { intent: string }) {
  const s = getIntentStyle(intent);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-semibold tracking-wider border"
      style={{ background: s.bg, borderColor: s.border, color: s.text }}
    >
      {intent.toUpperCase()}
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
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-xs" style={{ color }}>{pct}%</span>
    </div>
  );
}

export default function DebugPanel({ debug }: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const ltmHits = debug.ltmHits ?? [];
  const toolCalls = debug.toolCalls ?? [];

  return (
    <div
      className="mt-1 rounded-xl border overflow-hidden cursor-pointer select-none"
      style={{ background: "hsl(220 20% 5% / 0.8)", borderColor: "hsl(210 15% 20%)", fontFamily: "'Courier New', Courier, monospace" }}
      onClick={() => setExpanded((v) => !v)}
      data-testid="debug-panel"
    >
      {/* ── Collapsed header ── */}
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        <span className="text-xs tracking-widest" style={{ color: "hsl(196 40% 40%)" }}>DBG</span>
        <IntentBadge intent={debug.intent} />
        {debug.secondaryIntent && (
          <span className="text-xs" style={{ color: "hsl(210 20% 45%)" }}>↳ {debug.secondaryIntent}</span>
        )}
        <ConfidenceBar value={debug.confidence} />
        <span className="text-xs" style={{ color: "hsl(196 40% 45%)" }}>{debug.mode}</span>

        {/* LTM chip */}
        {ltmHits.length > 0 && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono border"
            style={{ background: "hsl(264 70% 55% / 0.12)", borderColor: "hsl(264 70% 55% / 0.35)", color: "hsl(264 80% 72%)" }}
            title={`${ltmHits.length} LTM fact${ltmHits.length > 1 ? "s" : ""} injected`}
          >
            <Brain className="w-2.5 h-2.5" />{ltmHits.length}
          </span>
        )}

        {/* Tool calls chip */}
        {toolCalls.length > 0 && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono border"
            style={{ background: "hsl(38 100% 55% / 0.1)", borderColor: "hsl(38 100% 55% / 0.3)", color: "hsl(38 100% 65%)" }}
            title={`${toolCalls.length} tool${toolCalls.length > 1 ? "s" : ""} used`}
          >
            <Wrench className="w-2.5 h-2.5" />{toolCalls.length}
          </span>
        )}

        <div className="flex-1" />
        <span className="text-xs font-mono" style={{ color: "hsl(210 20% 40%)" }}>{debug.processingMs}ms</span>
        {expanded
          ? <ChevronUp className="w-3 h-3" style={{ color: "hsl(210 20% 40%)" }} />
          : <ChevronDown className="w-3 h-3" style={{ color: "hsl(210 20% 40%)" }} />
        }
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <>
          <div style={{ height: 1, background: "hsl(210 15% 15%)" }} />

          {/* Reasoning path */}
          <div className="px-3 py-2">
            <p className="text-xs mb-1.5 tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>REASONING PATH</p>
            <div className="flex flex-col gap-1">
              {debug.reasoning.map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-xs font-mono font-bold" style={{ background: "hsl(210 15% 12%)", color: "hsl(194 100% 45%)" }}>
                    {i + 1}
                  </span>
                  <span className="text-xs leading-snug" style={{ color: "hsl(196 40% 60%)" }}>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tool calls */}
          {toolCalls.length > 0 && (
            <>
              <div style={{ height: 1, background: "hsl(210 15% 15%)" }} />
              <div className="px-3 py-2">
                <p className="text-xs mb-1.5 tracking-wider flex items-center gap-1.5" style={{ color: "hsl(196 40% 38%)" }}>
                  <Wrench className="w-3 h-3" style={{ color: "hsl(38 100% 65%)" }} />
                  TOOLS EXECUTED
                </p>
                <div className="flex flex-col gap-1.5">
                  {toolCalls.map((tc, i) => {
                    const meta = TOOL_META[tc.tool] ?? { icon: "⚙️", color: "hsl(196 40% 55%)" };
                    return (
                      <div key={i} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: "hsl(210 15% 8%)" }}>
                        <span style={{ fontSize: "13px", lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-semibold" style={{ color: meta.color }}>{tc.tool}</span>
                            <span
                              className="text-xs font-mono px-1 rounded"
                              style={{
                                background: tc.status === "done" ? "hsl(142 70% 40% / 0.2)" : "hsl(355 80% 55% / 0.2)",
                                color: tc.status === "done" ? "hsl(142 71% 60%)" : "hsl(355 80% 65%)",
                              }}
                            >
                              {tc.status}
                            </span>
                            <span className="text-xs font-mono ml-auto" style={{ color: "hsl(196 40% 40%)" }}>
                              {tc.durationMs < 1000 ? `${tc.durationMs}ms` : `${(tc.durationMs / 1000).toFixed(1)}s`}
                            </span>
                          </div>
                          {tc.error && (
                            <p className="text-xs mt-0.5" style={{ color: "hsl(355 80% 60%)" }}>{tc.error}</p>
                          )}
                          {tc.status === "done" && tc.result != null && (
                            <p className="text-xs mt-0.5 truncate" style={{ color: "hsl(196 40% 50%)" }}>
                              → {typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result).slice(0, 120)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* LTM hits */}
          {ltmHits.length > 0 && (
            <>
              <div style={{ height: 1, background: "hsl(210 15% 15%)" }} />
              <div className="px-3 py-2">
                <p className="text-xs mb-1.5 tracking-wider flex items-center gap-1.5" style={{ color: "hsl(196 40% 38%)" }}>
                  <Brain className="w-3 h-3" style={{ color: "hsl(264 80% 65%)" }} />
                  LONG-TERM MEMORY INJECTED
                </p>
                <div className="flex flex-col gap-1">
                  {ltmHits.map((hit, i) => {
                    const catMatch = hit.match(/^\[(\w+)\]\s*/);
                    const cat = catMatch?.[1] ?? "general";
                    const text = catMatch ? hit.slice(catMatch[0].length) : hit;
                    const color = LTM_CATEGORY_COLORS[cat] ?? "hsl(196 40% 60%)";
                    return (
                      <div key={i} className="flex items-start gap-2">
                        <span className="flex-shrink-0 px-1 rounded text-xs font-mono font-bold uppercase tracking-wider" style={{ background: `${color}18`, color }}>
                          {cat.slice(0, 4)}
                        </span>
                        <span className="text-xs leading-snug" style={{ color: "hsl(196 40% 60%)" }}>{text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Signals */}
          {debug.signals.length > 0 && (
            <>
              <div style={{ height: 1, background: "hsl(210 15% 15%)" }} />
              <div className="px-3 py-2">
                <p className="text-xs mb-1.5 tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>CLASSIFICATION SIGNALS</p>
                <div className="flex flex-col gap-0.5">
                  {debug.signals.map((sig, i) => (
                    <span key={i} className="text-xs" style={{ color: "hsl(196 30% 50%)" }}>· {sig}</span>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Footer */}
          <div style={{ height: 1, background: "hsl(210 15% 15%)" }} />
          <div className="flex items-center gap-4 px-3 py-2 flex-wrap">
            <div>
              <span className="text-xs tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>ACTION </span>
              <span className="text-xs font-mono" style={{ color: "hsl(194 100% 55%)" }}>{debug.action}</span>
            </div>
            <div>
              <span className="text-xs tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>MEM </span>
              <span className="text-xs font-mono font-bold" style={{ color: debug.memoryUsed ? "hsl(142 71% 55%)" : "hsl(210 20% 40%)" }}>
                {debug.memoryUsed ? "ACTIVE" : "—"}
              </span>
            </div>
            <div>
              <span className="text-xs tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>LTM </span>
              <span className="text-xs font-mono font-bold" style={{ color: ltmHits.length > 0 ? "hsl(264 80% 72%)" : "hsl(210 20% 40%)" }}>
                {ltmHits.length > 0 ? `${ltmHits.length} FACT${ltmHits.length > 1 ? "S" : ""}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-xs tracking-wider" style={{ color: "hsl(196 40% 38%)" }}>TOOLS </span>
              <span className="text-xs font-mono font-bold" style={{ color: toolCalls.length > 0 ? "hsl(38 100% 65%)" : "hsl(210 20% 40%)" }}>
                {toolCalls.length > 0 ? toolCalls.length : "—"}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
