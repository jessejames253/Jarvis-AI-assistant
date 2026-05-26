/**
 * components/ReasonPanel.tsx — Repo Reasoning v1
 *
 * Lets the user describe a goal, pick a change type and risk tolerance,
 * then calls Claude (via /api/workspace/reason) to get back:
 *   - A summary + confidence score
 *   - Recommended files (create / modify / review)
 *   - Affected systems with impact levels
 *   - Ordered implementation plan
 *   - Risk cards with mitigations
 *   - Validation plan (typecheck / test / e2e / manual / lint)
 *
 * READ-ONLY: never executes or edits any files.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, Brain, Loader2, XCircle, Send,
  ChevronDown, ChevronRight,
  FileCode2, Zap, AlertTriangle,
  CheckCircle2, Shield, ListOrdered,
  Gauge, FolderOpen, Lightbulb,
  FlaskConical, TestTube2, Eye,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ChangeType    = "feature"|"bugfix"|"refactor"|"api"|"frontend"|"data"|"test"|"docs";
type RiskTolerance = "low"|"medium"|"high";

interface RecommendedFile {
  path:     string;
  role:     "create"|"modify"|"review";
  reason:   string;
  priority: "high"|"medium"|"low";
}
interface AffectedSystem  { name: string; impact: "high"|"medium"|"low"; reason: string }
interface PlanStep        { order: number; title: string; description: string; files: string[] }
interface Risk            { description: string; severity: "high"|"medium"|"low"; mitigation: string }
interface ValidationItem  { type: "typecheck"|"test"|"e2e"|"manual"|"lint"; description: string; command?: string }

interface ReasoningResult {
  goal:               string;
  changeType:         ChangeType;
  riskTolerance:      RiskTolerance;
  reasonedAt:         string;
  confidence:         number;
  summary:            string;
  recommendedFiles:   RecommendedFile[];
  affectedSystems:    AffectedSystem[];
  implementationPlan: PlanStep[];
  risks:              Risk[];
  validationPlan:     ValidationItem[];
}

interface ReasonPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const VIOLET = "hsl(264 80% 68%)";
const MUTED  = "hsl(210 15% 38%)";
const GREEN  = "hsl(150 70% 55%)";
const AMBER  = "hsl(38 100% 60%)";
const RED    = "hsl(355 80% 65%)";
const TEAL   = "hsl(175 70% 58%)";
const BLUE   = "hsl(196 80% 58%)";

const SEVERITY_COLOR: Record<string, string> = { high: RED,   medium: AMBER, low: GREEN };
const IMPACT_COLOR:   Record<string, string> = { high: RED,   medium: AMBER, low: GREEN };
const PRIORITY_COLOR: Record<string, string> = { high: RED,   medium: AMBER, low: GREEN };
const ROLE_COLOR: Record<string, string>     = { create: GREEN, modify: AMBER, review: BLUE };

const VALIDATION_ICON: Record<string, React.ElementType> = {
  typecheck: CheckCircle2,
  test:      TestTube2,
  e2e:       FlaskConical,
  manual:    Eye,
  lint:      Shield,
};

const CHANGE_TYPES: Array<{ value: ChangeType; label: string }> = [
  { value: "feature",  label: "New Feature"  },
  { value: "bugfix",   label: "Bug Fix"      },
  { value: "refactor", label: "Refactor"     },
  { value: "api",      label: "API Change"   },
  { value: "frontend", label: "Frontend UI"  },
  { value: "data",     label: "Data / Store" },
  { value: "test",     label: "Testing"      },
  { value: "docs",     label: "Docs"         },
];

const RISK_LEVELS: Array<{ value: RiskTolerance; label: string; color: string }> = [
  { value: "low",    label: "Low — cautious",   color: GREEN },
  { value: "medium", label: "Medium — balanced", color: AMBER },
  { value: "high",   label: "High — bold",       color: RED   },
];

// ─── Confidence ring ──────────────────────────────────────────────────────────

function ConfidenceRing({ score }: { score: number }) {
  const size  = 52;
  const r     = (size - 8) / 2;
  const circ  = 2 * Math.PI * r;
  const fill  = (score / 100) * circ;
  const color = score >= 70 ? GREEN : score >= 45 ? AMBER : RED;
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(210 15% 12%)" strokeWidth={5} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${fill} ${circ-fill}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
        fontSize={13} fontWeight="bold" fill={color}>{score}</text>
    </svg>
  );
}

// ─── File row ─────────────────────────────────────────────────────────────────

function FileRow({ file }: { file: RecommendedFile }) {
  const [open, setOpen] = useState(false);
  const rc = ROLE_COLOR[file.role]     ?? MUTED;
  const pc = PRIORITY_COLOR[file.priority] ?? MUTED;
  return (
    <div className="border-b last:border-0" style={{ borderColor: "hsl(210 15% 10%)" }}>
      <button type="button" onClick={() => setOpen(v=>!v)}
        className="flex items-center gap-1.5 w-full text-left py-1.5">
        <FileCode2 className="w-3 h-3 flex-shrink-0" style={{ color: rc }} />
        <span className="flex-1 text-[10px] font-mono truncate" style={{ color: "hsl(196 25% 70%)" }}>
          {file.path}
        </span>
        <span className="text-[8px] font-mono px-1 rounded flex-shrink-0"
          style={{ background: `${rc}18`, border: `1px solid ${rc}35`, color: rc }}>
          {file.role}
        </span>
        <span className="text-[8px] font-mono px-1 rounded flex-shrink-0"
          style={{ background: `${pc}18`, border: `1px solid ${pc}35`, color: pc }}>
          {file.priority}
        </span>
        {open ? <ChevronDown className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
               : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />}
      </button>
      {open && (
        <p className="text-[9px] pb-2 pl-5 leading-snug" style={{ color: MUTED }}>{file.reason}</p>
      )}
    </div>
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({ title, icon: Icon, color, count, children, defaultOpen = true }:
  { title: string; icon: React.ElementType; color: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl overflow-hidden mb-2.5"
      style={{ border: "1px solid hsl(210 15% 13%)", background: "hsl(220 20% 5.5%)" }}>
      <button type="button" onClick={() => setOpen(v=>!v)}
        className="flex items-center gap-2 w-full text-left px-3 py-2.5">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        <span className="flex-1 text-[9px] font-mono font-bold tracking-widest" style={{ color }}>{title}</span>
        {count !== undefined && (
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
            style={{ background: `${color}18`, border: `1px solid ${color}30`, color }}>{count}</span>
        )}
        {open ? <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />
               : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />}
      </button>
      {open && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: "hsl(210 15% 10%)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ReasonPanel({ isOpen, onClose, apiBase }: ReasonPanelProps) {
  const [goal,          setGoal]          = useState("");
  const [changeType,    setChangeType]    = useState<ChangeType>("feature");
  const [riskTolerance, setRiskTolerance] = useState<RiskTolerance>("medium");
  const [result,        setResult]        = useState<ReasoningResult | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // Load last reasoning on open
  useEffect(() => {
    if (!isOpen || result) return;
    fetch(`${apiBase}api/workspace/reason/last`)
      .then(r => r.json())
      .then((d: { ok: boolean; result?: ReasoningResult }) => {
        if (d.ok && d.result) {
          setResult(d.result);
          setGoal(d.result.goal);
          setChangeType(d.result.changeType);
          setRiskTolerance(d.result.riskTolerance);
        }
      })
      .catch(() => { /* first time — ignore */ });
  }, [isOpen, apiBase, result]);

  const submit = useCallback(async () => {
    if (!goal.trim() || loading) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/workspace/reason`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ goal: goal.trim(), changeType, riskTolerance }),
      });
      const data = await res.json() as { ok: boolean; result?: ReasoningResult; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Reasoning failed");
      setResult(data.result ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase, goal, changeType, riskTolerance, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); }
  };

  const selectStyle = {
    background: "hsl(220 20% 6%)",
    border:     "1px solid hsl(210 15% 20%)",
    color:      "hsl(196 25% 72%)",
    borderRadius: "0.5rem",
    padding:    "0.375rem 0.5rem",
    fontSize:   "11px",
    width:      "100%",
    outline:    "none",
  } as React.CSSProperties;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="reason-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Repo reasoning panel"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4" style={{ color: VIOLET }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: VIOLET }}>REASON</h2>
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: `${VIOLET}18`, border: `1px solid ${VIOLET}40`, color: VIOLET }}>
              AI
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close reason panel"
            className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
            style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
            <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
          </button>
        </header>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Form ─────────────────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b space-y-3" style={{ borderColor: "hsl(210 15% 12%)" }}>
            {/* Goal */}
            <div>
              <label className="block text-[9px] font-mono font-bold tracking-widest mb-1" style={{ color: VIOLET }}>
                GOAL
              </label>
              <textarea
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe the feature, change, or investigation…"
                rows={3}
                className="w-full resize-none rounded-lg text-[11px] leading-relaxed placeholder:opacity-40 outline-none focus:ring-1 transition-all"
                style={{
                  background:   "hsl(220 20% 6%)",
                  border:       `1px solid ${goal.trim() ? `${VIOLET}50` : "hsl(210 15% 20%)"}`,
                  color:        "hsl(196 25% 76%)",
                  padding:      "0.5rem 0.625rem",
                  fontFamily:   "inherit",
                }}
              />
            </div>

            {/* Change type + risk tolerance row */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[9px] font-mono font-bold tracking-widest mb-1" style={{ color: MUTED }}>
                  CHANGE TYPE
                </label>
                <select value={changeType} onChange={e => setChangeType(e.target.value as ChangeType)} style={selectStyle}>
                  {CHANGE_TYPES.map(ct => (
                    <option key={ct.value} value={ct.value}>{ct.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-mono font-bold tracking-widest mb-1" style={{ color: MUTED }}>
                  RISK TOLERANCE
                </label>
                <select value={riskTolerance} onChange={e => setRiskTolerance(e.target.value as RiskTolerance)} style={selectStyle}>
                  {RISK_LEVELS.map(rl => (
                    <option key={rl.value} value={rl.value}>{rl.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Submit */}
            <button type="button" onClick={submit}
              disabled={!goal.trim() || loading}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-xl font-bold text-[10px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${VIOLET}18`, border: `1px solid ${VIOLET}45`, color: VIOLET }}>
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> REASONING…</>
                : <><Brain className="w-3.5 h-3.5" /> ANALYSE WITH AI <span style={{ color: MUTED }}>(⌘↵)</span></>}
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

          {/* ── Results ──────────────────────────────────────────────────── */}
          {!result && !loading && !error && (
            <div className="flex flex-col items-center gap-3 py-14 text-center px-6">
              <Lightbulb className="w-8 h-8 opacity-10" style={{ color: VIOLET }} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                Describe a goal above and click <strong style={{ color: VIOLET }}>ANALYSE</strong> to get AI-powered reasoning about where the change belongs, what risks exist, and how to validate it.
              </p>
            </div>
          )}

          {result && (
            <div className="px-3 pt-3 pb-6 space-y-0">

              {/* Summary + confidence */}
              <div className="flex gap-3 items-start mb-4 p-3 rounded-xl"
                style={{ background: `${VIOLET}08`, border: `1px solid ${VIOLET}25` }}>
                <ConfidenceRing score={result.confidence} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[8px] font-mono" style={{ color: VIOLET }}>
                      {result.changeType.toUpperCase()} · {result.riskTolerance.toUpperCase()} RISK
                    </span>
                    <span className="text-[8px] font-mono" style={{ color: MUTED }}>
                      {new Date(result.reasonedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-[10px] leading-relaxed" style={{ color: "hsl(196 25% 72%)" }}>
                    {result.summary}
                  </p>
                  <p className="text-[9px] font-mono mt-1.5 italic truncate" style={{ color: `${VIOLET}90` }}>
                    {result.goal}
                  </p>
                </div>
              </div>

              {/* Recommended files */}
              {result.recommendedFiles.length > 0 && (
                <Section title="RECOMMENDED FILES" icon={FileCode2} color={BLUE}
                  count={result.recommendedFiles.length} defaultOpen>
                  <div>
                    {result.recommendedFiles.map((f, i) => <FileRow key={i} file={f} />)}
                  </div>
                </Section>
              )}

              {/* Affected systems */}
              {result.affectedSystems.length > 0 && (
                <Section title="AFFECTED SYSTEMS" icon={Zap} color={AMBER}
                  count={result.affectedSystems.length} defaultOpen>
                  <div className="space-y-2">
                    {result.affectedSystems.map((s, i) => (
                      <div key={i} className="rounded-lg p-2.5"
                        style={{ background: `${IMPACT_COLOR[s.impact]}08`, border: `1px solid ${IMPACT_COLOR[s.impact]}25` }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-semibold" style={{ color: "hsl(196 30% 78%)" }}>{s.name}</span>
                          <span className="text-[8px] font-mono px-1 rounded ml-auto"
                            style={{ background: `${IMPACT_COLOR[s.impact]}18`, border: `1px solid ${IMPACT_COLOR[s.impact]}35`, color: IMPACT_COLOR[s.impact] }}>
                            {s.impact}
                          </span>
                        </div>
                        <p className="text-[9px] leading-snug" style={{ color: MUTED }}>{s.reason}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Implementation plan */}
              {result.implementationPlan.length > 0 && (
                <Section title="IMPLEMENTATION PLAN" icon={ListOrdered} color={TEAL}
                  count={result.implementationPlan.length} defaultOpen>
                  <div className="space-y-2.5">
                    {result.implementationPlan.map(step => (
                      <div key={step.order} className="flex gap-2.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[9px] font-bold"
                          style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}40`, color: TEAL }}>
                          {step.order}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold" style={{ color: "hsl(196 30% 75%)" }}>{step.title}</p>
                          <p className="text-[9px] leading-snug mt-0.5" style={{ color: MUTED }}>{step.description}</p>
                          {step.files.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {step.files.map(f => (
                                <span key={f} className="text-[8px] font-mono px-1 rounded"
                                  style={{ background: `${TEAL}12`, border: `1px solid ${TEAL}25`, color: `${TEAL}cc` }}>
                                  {f.split("/").pop()}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Risks */}
              {result.risks.length > 0 && (
                <Section title="RISKS" icon={AlertTriangle} color={RED}
                  count={result.risks.length} defaultOpen>
                  <div className="space-y-2">
                    {result.risks.map((risk, i) => (
                      <div key={i} className="rounded-lg p-2.5"
                        style={{ background: `${SEVERITY_COLOR[risk.severity]}08`, border: `1px solid ${SEVERITY_COLOR[risk.severity]}25` }}>
                        <div className="flex items-center gap-2 mb-1">
                          <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0" style={{ color: SEVERITY_COLOR[risk.severity] }} />
                          <span className="text-[9px] flex-1" style={{ color: "hsl(196 25% 72%)" }}>{risk.description}</span>
                          <span className="text-[8px] font-mono px-1 rounded flex-shrink-0"
                            style={{ background: `${SEVERITY_COLOR[risk.severity]}18`, border: `1px solid ${SEVERITY_COLOR[risk.severity]}35`, color: SEVERITY_COLOR[risk.severity] }}>
                            {risk.severity}
                          </span>
                        </div>
                        <div className="flex items-start gap-1 mt-1 pl-4">
                          <Shield className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
                          <p className="text-[9px] leading-snug" style={{ color: MUTED }}>{risk.mitigation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Validation plan */}
              {result.validationPlan.length > 0 && (
                <Section title="VALIDATION PLAN" icon={Gauge} color={GREEN}
                  count={result.validationPlan.length} defaultOpen>
                  <div className="space-y-2">
                    {result.validationPlan.map((v, i) => {
                      const Icon = VALIDATION_ICON[v.type] ?? CheckCircle2;
                      return (
                        <div key={i} className="flex gap-2">
                          <Icon className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: GREEN }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[8px] font-mono px-1 rounded"
                                style={{ background: `${GREEN}12`, border: `1px solid ${GREEN}25`, color: `${GREEN}cc` }}>
                                {v.type}
                              </span>
                              <p className="text-[9px]" style={{ color: "hsl(196 25% 70%)" }}>{v.description}</p>
                            </div>
                            {v.command && (
                              <code className="text-[8px] font-mono mt-0.5 block" style={{ color: `${TEAL}bb` }}>
                                $ {v.command}
                              </code>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
