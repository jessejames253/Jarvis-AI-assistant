/**
 * components/CollabPanel.tsx — Agent Collaboration v1
 *
 * Goal input → AI plans a multi-agent collaboration:
 *   - Lead agent (primary owner)
 *   - Supporting agents with responsibilities
 *   - Handoff timeline (visual chain)
 *   - Risks with mitigations
 *
 * Read-only planning — no agent work executed.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, Network, Loader2, XCircle, ArrowRight,
  ChevronDown, ChevronRight, Send,
  AlertTriangle, Shield, Star, Layers,
  CheckSquare, Package,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentRef {
  agentId:   string;
  agentName: string;
  role:      string;
  color:     string;
  emoji:     string;
}

interface SupportingAgent extends AgentRef {
  responsibility:  string;
  expectedOutput:  string;
  handoffPosition: number;
}

interface HandoffStep {
  stepNumber:  number;
  fromAgent:   AgentRef | null;
  toAgent:     AgentRef;
  artifact:    string;
  description: string;
}

interface CollaborationRisk {
  description: string;
  severity:    "high" | "medium" | "low";
  mitigation:  string;
}

interface CollaborationPlan {
  goal:             string;
  plannedAt:        string;
  summary:          string;
  leadAgent:        SupportingAgent;
  supportingAgents: SupportingAgent[];
  handoffOrder:     HandoffStep[];
  risks:            CollaborationRisk[];
}

interface CollabPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const MAGENTA = "hsl(320 70% 62%)";
const MUTED   = "hsl(210 15% 38%)";
const GREEN   = "hsl(150 70% 55%)";
const AMBER   = "hsl(38 100% 60%)";
const RED     = "hsl(355 80% 65%)";
const GOLD    = "hsl(45 100% 58%)";

const SEV_COLOR: Record<string, string> = { high: RED, medium: AMBER, low: GREEN };

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({
  title, icon: Icon, color, count, defaultOpen = true, children,
}: {
  title: string; icon: React.ElementType; color: string;
  count?: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl overflow-hidden mb-2.5"
      style={{ border: "1px solid hsl(210 15% 13%)", background: "hsl(220 20% 5.5%)" }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left px-3 py-2.5">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        <span className="flex-1 text-[9px] font-mono font-bold tracking-widest" style={{ color }}>
          {title}
        </span>
        {count !== undefined && (
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
            style={{ background: `${color}18`, border: `1px solid ${color}30`, color }}>
            {count}
          </span>
        )}
        {open
          ? <ChevronDown  className="w-3 h-3" style={{ color: MUTED }} />
          : <ChevronRight className="w-3 h-3" style={{ color: MUTED }} />}
      </button>
      {open && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: "hsl(210 15% 10%)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Agent responsibility card ────────────────────────────────────────────────

function AgentCard({
  agent, isLead, position,
}: {
  agent: SupportingAgent; isLead?: boolean; position?: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl overflow-hidden"
      style={{
        border:     `1px solid ${agent.color}50`,
        background: `${agent.color}08`,
      }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 w-full text-left px-3 py-2.5">
        {/* Position badge */}
        {position !== undefined && (
          <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold"
            style={{ background: `${agent.color}20`, border: `1px solid ${agent.color}50`, color: agent.color }}>
            {position}
          </div>
        )}
        <span className="text-[14px] flex-shrink-0">{agent.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold" style={{ color: agent.color }}>
              {agent.agentName}
            </span>
            {isLead && (
              <Star className="w-2.5 h-2.5 flex-shrink-0" style={{ color: GOLD, fill: GOLD }} />
            )}
          </div>
          <p className="text-[9px] truncate mt-0.5" style={{ color: MUTED }}>
            {agent.responsibility}
          </p>
        </div>
        {open
          ? <ChevronDown  className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />
          : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />}
      </button>
      {open && (
        <div className="border-t px-3 py-2.5 space-y-2" style={{ borderColor: `${agent.color}25` }}>
          <div>
            <p className="text-[8px] font-mono font-bold tracking-widest mb-0.5" style={{ color: `${agent.color}90` }}>
              RESPONSIBILITY
            </p>
            <p className="text-[9px] leading-relaxed" style={{ color: "hsl(196 25% 68%)" }}>
              {agent.responsibility}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <Package className="w-2.5 h-2.5 flex-shrink-0" style={{ color: `${agent.color}90` }} />
              <p className="text-[8px] font-mono font-bold tracking-widest" style={{ color: `${agent.color}90` }}>
                EXPECTED OUTPUT
              </p>
            </div>
            <p className="text-[9px] leading-relaxed" style={{ color: MUTED }}>
              {agent.expectedOutput}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Handoff timeline ─────────────────────────────────────────────────────────

function HandoffTimeline({ steps }: { steps: HandoffStep[] }) {
  const [openStep, setOpenStep] = useState<number | null>(null);
  return (
    <div className="space-y-0">
      {steps.map((step, i) => (
        <div key={i}>
          {/* Step node */}
          <div
            className="flex items-start gap-2.5 cursor-pointer"
            onClick={() => setOpenStep(openStep === i ? null : i)}
          >
            {/* Left spine */}
            <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                style={{
                  background: `${step.toAgent.color}20`,
                  border:     `1px solid ${step.toAgent.color}60`,
                  color:       step.toAgent.color,
                }}>
                {step.stepNumber}
              </div>
              {i < steps.length - 1 && (
                <div className="flex-1 w-px mt-1" style={{ background: "hsl(210 15% 18%)", minHeight: 16 }} />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-3">
              {/* From → To */}
              <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                {step.fromAgent ? (
                  <span className="text-[9px] font-semibold" style={{ color: step.fromAgent.color }}>
                    {step.fromAgent.emoji} {step.fromAgent.agentName}
                  </span>
                ) : (
                  <span className="text-[9px]" style={{ color: MUTED }}>▶ Start</span>
                )}
                <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
                <span className="text-[9px] font-semibold" style={{ color: step.toAgent.color }}>
                  {step.toAgent.emoji} {step.toAgent.agentName}
                </span>
              </div>

              {/* Artifact chip */}
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded inline-block"
                style={{
                  background: `${step.toAgent.color}12`,
                  border:     `1px solid ${step.toAgent.color}30`,
                  color:      `${step.toAgent.color}cc`,
                }}>
                {step.artifact}
              </span>

              {/* Description (expandable) */}
              {openStep === i && (
                <p className="text-[9px] leading-relaxed mt-1.5" style={{ color: MUTED }}>
                  {step.description}
                </p>
              )}
            </div>

            {openStep === i
              ? <ChevronDown  className="w-2.5 h-2.5 flex-shrink-0 mt-1.5" style={{ color: MUTED }} />
              : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0 mt-1.5" style={{ color: MUTED }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function CollabPanel({ isOpen, onClose, apiBase }: CollabPanelProps) {
  const [goal,    setGoal]    = useState("");
  const [plan,    setPlan]    = useState<CollaborationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Load last plan on open
  useEffect(() => {
    if (!isOpen || plan) return;
    void fetch(`${apiBase}api/agents/collaborate/last`)
      .then(r => r.json())
      .then((d: { ok: boolean; plan?: CollaborationPlan }) => {
        if (d.ok && d.plan) {
          setPlan(d.plan);
          setGoal(d.plan.goal);
        }
      })
      .catch(() => {});
  }, [isOpen, apiBase, plan]);

  const submit = useCallback(async () => {
    if (!goal.trim() || loading) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/collaborate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ goal: goal.trim() }),
      });
      const data = await res.json() as { ok: boolean; plan?: CollaborationPlan; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Collaboration planning failed");
      setPlan(data.plan ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase, goal, loading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); }
  };

  const allAgents = plan
    ? [plan.leadAgent, ...plan.supportingAgents].sort((a, b) => a.handoffPosition - b.handoffPosition)
    : [];

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="collab-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Agent collaboration panel"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4" style={{ color: MAGENTA }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: MAGENTA }}>COLLAB</h2>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: `${MAGENTA}18`, border: `1px solid ${MAGENTA}40`, color: MAGENTA }}>
              AI PLAN
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close collab panel"
            className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
            style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
            <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">

          {/* ── Form ─────────────────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b space-y-2.5" style={{ borderColor: "hsl(210 15% 12%)" }}>
            <div>
              <label className="block text-[9px] font-mono font-bold tracking-widest mb-1" style={{ color: MAGENTA }}>
                GOAL
              </label>
              <textarea
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Describe the goal to plan collaboration for…"
                rows={3}
                className="w-full resize-none rounded-lg text-[11px] leading-relaxed placeholder:opacity-40 outline-none transition-all"
                style={{
                  background: "hsl(220 20% 6%)",
                  border:     `1px solid ${goal.trim() ? `${MAGENTA}50` : "hsl(210 15% 20%)"}`,
                  color:      "hsl(196 25% 76%)",
                  padding:    "0.5rem 0.625rem",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <button type="button" onClick={submit}
              disabled={!goal.trim() || loading}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-xl font-bold text-[10px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${MAGENTA}18`, border: `1px solid ${MAGENTA}45`, color: MAGENTA }}>
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> PLANNING…</>
                : <><Send className="w-3.5 h-3.5" /> PLAN COLLABORATION <span style={{ color: MUTED }}>(⌘↵)</span></>}
            </button>
          </div>

          {/* ── Error ────────────────────────────────────────────────────── */}
          {error && (
            <div className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-lg"
              style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
              <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
            </div>
          )}

          {/* ── Empty state ───────────────────────────────────────────────── */}
          {!plan && !loading && !error && (
            <div className="flex flex-col items-center gap-3 py-14 text-center px-6">
              <Network className="w-8 h-8 opacity-10" style={{ color: MAGENTA }} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                Enter a goal above and click <strong style={{ color: MAGENTA }}>PLAN COLLABORATION</strong> to get an AI-designed multi-agent collaboration plan with handoff timeline and responsibilities.
              </p>
            </div>
          )}

          {/* ── Plan output ───────────────────────────────────────────────── */}
          {plan && (
            <div className="px-3 pt-3 pb-8 space-y-0">

              {/* Summary banner */}
              <div className="rounded-xl p-3 mb-3"
                style={{ background: `${MAGENTA}08`, border: `1px solid ${MAGENTA}25` }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Network className="w-3 h-3 flex-shrink-0" style={{ color: MAGENTA }} />
                  <span className="text-[8px] font-mono font-bold tracking-widest" style={{ color: MAGENTA }}>
                    COLLABORATION PLAN
                  </span>
                  <span className="text-[8px] font-mono ml-auto" style={{ color: MUTED }}>
                    {new Date(plan.plannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-[10px] leading-relaxed" style={{ color: "hsl(196 25% 72%)" }}>
                  {plan.summary}
                </p>
                <p className="text-[9px] font-mono mt-1.5 italic" style={{ color: `${MAGENTA}80` }}>
                  "{plan.goal.slice(0, 70)}{plan.goal.length > 70 ? "…" : ""}"
                </p>
              </div>

              {/* Lead agent highlight */}
              <div className="mb-2.5">
                <p className="text-[8px] font-mono font-bold tracking-widest mb-1.5 px-1" style={{ color: MUTED }}>
                  LEAD AGENT
                </p>
                <AgentCard agent={plan.leadAgent} isLead position={plan.leadAgent.handoffPosition} />
              </div>

              {/* Supporting agents */}
              {plan.supportingAgents.length > 0 && (
                <Section title="SUPPORTING AGENTS" icon={Layers} color={MAGENTA}
                  count={plan.supportingAgents.length} defaultOpen>
                  <div className="space-y-2">
                    {plan.supportingAgents
                      .sort((a, b) => a.handoffPosition - b.handoffPosition)
                      .map(agent => (
                        <AgentCard key={agent.agentId} agent={agent} position={agent.handoffPosition} />
                      ))}
                  </div>
                </Section>
              )}

              {/* Handoff timeline */}
              {plan.handoffOrder.length > 0 && (
                <Section title="HANDOFF TIMELINE" icon={ArrowRight} color="hsl(196 80% 58%)"
                  count={plan.handoffOrder.length} defaultOpen>
                  <HandoffTimeline steps={plan.handoffOrder} />
                </Section>
              )}

              {/* Risks */}
              {plan.risks.length > 0 && (
                <Section title="RISKS" icon={AlertTriangle} color={RED}
                  count={plan.risks.length} defaultOpen={false}>
                  <div className="space-y-2">
                    {plan.risks.map((risk, i) => (
                      <div key={i} className="rounded-lg p-2.5"
                        style={{
                          background: `${SEV_COLOR[risk.severity]}08`,
                          border:     `1px solid ${SEV_COLOR[risk.severity]}25`,
                        }}>
                        <div className="flex items-start gap-2 mb-1">
                          <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" style={{ color: SEV_COLOR[risk.severity] }} />
                          <span className="flex-1 text-[9px]" style={{ color: "hsl(196 25% 72%)" }}>
                            {risk.description}
                          </span>
                          <span className="text-[7px] font-mono px-1 rounded flex-shrink-0"
                            style={{
                              background: `${SEV_COLOR[risk.severity]}18`,
                              border:     `1px solid ${SEV_COLOR[risk.severity]}35`,
                              color:       SEV_COLOR[risk.severity],
                            }}>
                            {risk.severity}
                          </span>
                        </div>
                        <div className="flex items-start gap-1 pl-4">
                          <Shield className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
                          <p className="text-[9px] leading-snug" style={{ color: MUTED }}>{risk.mitigation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* All agents summary */}
              {allAgents.length > 0 && (
                <Section title="AGENT ROSTER" icon={CheckSquare} color={MUTED} defaultOpen={false}>
                  <div className="space-y-1">
                    {allAgents.map((a, i) => (
                      <div key={a.agentId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                        style={{ background: `${a.color}08`, border: `1px solid ${a.color}25` }}>
                        <span className="text-[8px] font-mono w-4 text-center" style={{ color: MUTED }}>{i + 1}</span>
                        <span className="text-[10px]">{a.emoji}</span>
                        <span className="flex-1 text-[9px] font-semibold" style={{ color: a.color }}>{a.agentName}</span>
                        {a.agentId === plan.leadAgent.agentId && (
                          <Star className="w-2.5 h-2.5" style={{ color: GOLD, fill: GOLD }} />
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
