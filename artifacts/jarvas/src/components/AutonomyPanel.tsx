/**
 * AutonomyPanel.tsx — Phase 6 supervised autonomy UI.
 *
 * Displays:
 * - Cycle type selector + budget settings + Start button
 * - Active cycle status (current task, budget used vs remaining)
 * - Patches proposed / applied
 * - Approvals waiting
 * - Stop / Pause / Resume controls
 * - Final report
 * - Recent audit log
 */

import { useState, useEffect, useCallback } from "react";
import { getApiBase } from "@/lib/apiConfig";

const API = (path: string) => `${getApiBase()}api${path}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BudgetConfig {
  maxTasks:           number;
  maxPatchProposals:  number;
  maxAppliedPatches:  number;
  maxRetries:         number;
  maxFiles:           number;
  maxLines:           number;
  maxRuntimeMs:       number;
  maxAutoFixAttempts: number;
}

interface BudgetSummary {
  config:    BudgetConfig;
  usage:     Record<string, unknown>;
  remaining: Record<string, number>;
  exhausted: boolean;
}

interface CycleReport {
  cycleId:            string;
  type:               string;
  state:              string;
  tasksCompleted:     number;
  tasksFailed:        number;
  patchesProposed:    number;
  patchesApplied:     number;
  patchesRolledBack:  number;
  budgetSummary:      BudgetSummary;
  memoryEvidenceUsed: string[];
  durationMs:         number;
  summary:            string;
  auditEntries:       number;
  stoppedReason?:     string;
}

interface ImprovementCycle {
  id:                string;
  type:              string;
  state:             string;
  budget:            BudgetConfig;
  startedAt?:        number;
  completedAt?:      number;
  tasks:             string[];
  patchesProposed:   number;
  patchesApplied:    number;
  patchesRolledBack: number;
  memoryEvidence:    string[];
  report?:           CycleReport;
  currentTaskTitle?: string;
  currentAgentId?:   string;
  approvalsPending:  number;
  stoppedReason?:    string;
  budgetSnapshot?:   BudgetSummary;
}

interface ProposedImprovement {
  title:           string;
  description:     string;
  cycleType:       string;
  expectedBenefit: string;
  riskScore:       number;
  confidence:      number;
  affectedFiles:   string[];
  testPlan:        string;
  rollbackPlan:    string;
  memoryEvidence:  string[];
}

interface AuditEntry {
  id:               string;
  cycleId:          string;
  type:             string;
  timestamp:        number;
  agentId?:         string;
  reasoning:        string;
  memoryEvidence?:  string[];
  critical?:        boolean;
}

const CYCLE_LABELS: Record<string, string> = {
  fix_ts_errors:            "Fix TypeScript Errors",
  reduce_risk_hotspots:     "Reduce Risk Hotspots",
  improve_unstable_modules: "Improve Unstable Modules",
  clean_unused_code:        "Clean Unused Code",
  improve_tests:            "Improve Tests",
  improve_documentation:    "Improve Documentation",
  strengthen_validation:    "Strengthen Validation",
};

const STATE_COLOR: Record<string, string> = {
  running:   "hsl(142 70% 50%)",
  paused:    "hsl(40 90% 55%)",
  completed: "hsl(194 100% 55%)",
  stopped:   "hsl(0 70% 55%)",
  failed:    "hsl(0 90% 50%)",
  idle:      "hsl(196 30% 45%)",
};

const AUDIT_ICON: Record<string, string> = {
  cycle_started:      "▶",
  cycle_completed:    "✓",
  cycle_stopped:      "■",
  cycle_paused:       "⏸",
  cycle_resumed:      "▶",
  cycle_failed:       "✗",
  task_started:       "→",
  task_completed:     "✓",
  task_failed:        "✗",
  patch_proposed:     "~",
  patch_applied:      "✓",
  patch_rejected:     "✗",
  patch_rolled_back:  "↩",
  approval_requested: "⚠",
  approval_granted:   "✓",
  approval_denied:    "✗",
  budget_exceeded:    "🛑",
  policy_blocked:     "🔒",
  validation_passed:  "✓",
  validation_failed:  "✗",
  memory_retrieved:   "◈",
  permission_checked: "🔑",
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  root: {
    display:        "flex",
    flexDirection:  "column" as const,
    height:         "100%",
    padding:        "16px",
    gap:            "12px",
    overflowY:      "auto" as const,
    background:     "transparent",
    color:          "hsl(196 80% 80%)",
    fontFamily:     "monospace",
    fontSize:       "13px",
  },
  card: {
    background:   "hsl(220 25% 8%)",
    border:       "1px solid hsl(194 100% 50% / 0.15)",
    borderRadius: "8px",
    padding:      "14px 16px",
    display:      "flex",
    flexDirection: "column" as const,
    gap:          "10px",
  },
  sectionTitle: {
    fontSize:     "11px",
    fontWeight:   700,
    letterSpacing: "0.08em",
    color:        "hsl(194 100% 55%)",
    textTransform: "uppercase" as const,
    marginBottom: "2px",
  },
  label: {
    fontSize: "11px",
    color:    "hsl(196 30% 50%)",
    marginBottom: "3px",
  },
  select: {
    background:   "hsl(220 25% 12%)",
    border:       "1px solid hsl(194 100% 50% / 0.25)",
    borderRadius: "6px",
    padding:      "7px 10px",
    color:        "hsl(196 80% 80%)",
    fontFamily:   "monospace",
    fontSize:     "13px",
    width:        "100%",
    cursor:       "pointer",
  },
  input: {
    background:   "hsl(220 25% 12%)",
    border:       "1px solid hsl(194 100% 50% / 0.25)",
    borderRadius: "6px",
    padding:      "5px 8px",
    color:        "hsl(196 80% 80%)",
    fontFamily:   "monospace",
    fontSize:     "12px",
    width:        "100%",
  },
  btnPrimary: {
    background:   "hsl(194 100% 50% / 0.18)",
    border:       "1px solid hsl(194 100% 50% / 0.5)",
    borderRadius: "6px",
    padding:      "9px 18px",
    color:        "hsl(194 100% 70%)",
    fontFamily:   "monospace",
    fontSize:     "13px",
    fontWeight:   700,
    cursor:       "pointer",
    letterSpacing: "0.05em",
  },
  btnDanger: {
    background:   "hsl(0 70% 40% / 0.18)",
    border:       "1px solid hsl(0 70% 50% / 0.4)",
    borderRadius: "6px",
    padding:      "7px 14px",
    color:        "hsl(0 70% 70%)",
    fontFamily:   "monospace",
    fontSize:     "12px",
    cursor:       "pointer",
  },
  btnSecondary: {
    background:   "hsl(40 80% 40% / 0.15)",
    border:       "1px solid hsl(40 80% 50% / 0.35)",
    borderRadius: "6px",
    padding:      "7px 14px",
    color:        "hsl(40 90% 70%)",
    fontFamily:   "monospace",
    fontSize:     "12px",
    cursor:       "pointer",
  },
  meter: (pct: number, color: string) => ({
    height:       "6px",
    borderRadius: "3px",
    background:   "hsl(220 25% 16%)",
    position:     "relative" as const,
    overflow:     "hidden" as const,
    marginTop:    "3px",
  }),
  meterFill: (pct: number, color: string) => ({
    position:   "absolute" as const,
    top:        0, left: 0, bottom: 0,
    width:      `${Math.min(100, pct)}%`,
    background: color,
    borderRadius: "3px",
    transition: "width 0.4s ease",
  }),
  badge: (color: string) => ({
    display:      "inline-block",
    padding:      "2px 8px",
    borderRadius: "4px",
    fontSize:     "10px",
    fontWeight:   700,
    background:   `${color}22`,
    color,
    border:       `1px solid ${color}55`,
    letterSpacing: "0.05em",
  }),
  row: {
    display:        "flex",
    alignItems:     "center",
    gap:            "8px",
    flexWrap:       "wrap" as const,
  },
  auditRow: (critical?: boolean) => ({
    display:     "flex",
    gap:         "8px",
    padding:     "5px 0",
    borderBottom: "1px solid hsl(194 100% 50% / 0.06)",
    background:  critical ? "hsl(40 80% 50% / 0.05)" : "transparent",
    borderLeft:  critical ? "2px solid hsl(40 80% 50%)" : "2px solid transparent",
    paddingLeft: critical ? "6px" : "0",
  }),
  proposalCard: {
    background:   "hsl(220 25% 10%)",
    border:       "1px solid hsl(194 100% 50% / 0.12)",
    borderRadius: "6px",
    padding:      "10px 12px",
    display:      "flex",
    flexDirection: "column" as const,
    gap:          "4px",
    cursor:       "pointer",
  },
  grid2: {
    display:             "grid",
    gridTemplateColumns: "1fr 1fr",
    gap:                 "10px",
  },
} as const;

// ─── Meter component ──────────────────────────────────────────────────────────

function Meter({ used, max, color }: { used: number; max: number; color: string }) {
  const pct = max > 0 ? (used / max) * 100 : 0;
  const danger = pct >= 90;
  const fill   = danger ? "hsl(0 70% 55%)" : color;
  return (
    <div style={S.meter(pct, fill)}>
      <div style={S.meterFill(pct, fill)} />
    </div>
  );
}

// ─── Budget stat ─────────────────────────────────────────────────────────────

function BudgetStat({
  label, used, max, color,
}: { label: string; used: number; max: number; color: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
        <span style={{ color: "hsl(196 30% 55%)" }}>{label}</span>
        <span style={{ color: used >= max ? "hsl(0 70% 60%)" : color }}>
          {used} / {max}
        </span>
      </div>
      <Meter used={used} max={max} color={color} />
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function AutonomyPanel() {
  const [cycle,       setCycle]       = useState<ImprovementCycle | null>(null);
  const [cycleType,   setCycleType]   = useState<string>("fix_ts_errors");
  const [proposals,   setProposals]   = useState<ProposedImprovement[]>([]);
  const [auditLog,    setAuditLog]    = useState<AuditEntry[]>([]);
  const [allCycles,   setAllCycles]   = useState<ImprovementCycle[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [view,        setView]        = useState<"start" | "active" | "report" | "audit" | "history">("start");
  const [showBudget,  setShowBudget]  = useState(false);
  const [budget,      setBudget]      = useState<Partial<BudgetConfig>>({});
  const [expandProposal, setExpandProposal] = useState<string | null>(null);

  // ── Polling ────────────────────────────────────────────────────────────────

  const fetchActive = useCallback(async () => {
    try {
      const r = await fetch(API("/autonomy/active"));
      const d = await r.json();
      if (d.active) {
        setCycle(d.active);
        if (["running", "paused"].includes(d.active.state)) setView("active");
        else if (d.active.report) setView("report");
      }
    } catch { /* silent */ }
  }, []);

  const fetchProposals = useCallback(async () => {
    try {
      const r = await fetch(API("/autonomy/proposals"));
      const d = await r.json();
      setProposals(d.proposals ?? []);
    } catch { /* silent */ }
  }, []);

  const fetchAudit = useCallback(async (cycleId?: string) => {
    try {
      const url = cycleId ? API(`/autonomy/audit/${cycleId}`) : API("/autonomy/audit?limit=40");
      const r   = await fetch(url);
      const d   = await r.json();
      setAuditLog(d.entries ?? []);
    } catch { /* silent */ }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(API("/autonomy/cycles?limit=20"));
      const d = await r.json();
      setAllCycles(d.cycles ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchActive();
    fetchProposals();
    fetchHistory();
    const poll = setInterval(() => {
      if (view === "active") fetchActive();
    }, 3000);
    return () => clearInterval(poll);
  }, [view, fetchActive, fetchProposals, fetchHistory]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(API("/autonomy/cycles"), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: cycleType, budget }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to start cycle");
      setCycle(d.cycle);
      setView("active");
      fetchAudit(d.cycle.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleControl(action: "pause" | "stop" | "resume") {
    if (!cycle) return;
    setLoading(true);
    try {
      const r = await fetch(API(`/autonomy/cycles/${cycle.id}/${action}`), { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `Failed to ${action}`);
      setCycle(d.cycle);
      if (action === "stop" && d.cycle.report) {
        setView("report");
        fetchAudit(d.cycle.id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      fetchActive();
    }
  }

  function useProposal(p: ProposedImprovement) {
    setCycleType(p.cycleType);
    setView("start");
    setExpandProposal(null);
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  const tabs = [
    { key: "start",   label: "Start" },
    { key: "active",  label: cycle?.state === "running" ? "● Active" : "Active" },
    { key: "report",  label: "Report" },
    { key: "audit",   label: "Audit" },
    { key: "history", label: "History" },
  ] as const;

  const cyan     = "hsl(194 100% 55%)";
  const gold     = "hsl(40 90% 55%)";
  const green    = "hsl(142 70% 50%)";
  const red      = "hsl(0 70% 55%)";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "14px", color: cyan, letterSpacing: "0.05em" }}>
            ⚙ SUPERVISED AUTONOMY
          </div>
          <div style={{ fontSize: "11px", color: "hsl(196 30% 45%)", marginTop: "2px" }}>
            Bounded, user-approved improvement cycles
          </div>
        </div>
        {cycle && (
          <span style={S.badge(STATE_COLOR[cycle.state] ?? "hsl(196 30% 45%)")}>
            {cycle.state.toUpperCase()}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "hsl(0 70% 20% / 0.4)", border: "1px solid hsl(0 70% 40%)", borderRadius: "6px", padding: "8px 12px", color: "hsl(0 70% 70%)", fontSize: "12px" }}>
          ✗ {error}
          <button onClick={() => setError(null)} style={{ marginLeft: "8px", background: "none", border: "none", color: "inherit", cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => {
              setView(t.key as typeof view);
              if (t.key === "audit") fetchAudit(cycle?.id);
              if (t.key === "history") fetchHistory();
            }}
            style={{
              background:  view === t.key ? "hsl(194 100% 50% / 0.12)" : "transparent",
              border:      `1px solid ${view === t.key ? "hsl(194 100% 50% / 0.35)" : "transparent"}`,
              borderRadius: "5px",
              padding:     "5px 12px",
              color:       view === t.key ? cyan : "hsl(196 30% 45%)",
              fontFamily:  "monospace",
              fontSize:    "11px",
              fontWeight:  view === t.key ? 700 : 400,
              cursor:      "pointer",
              letterSpacing: "0.04em",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── START VIEW ── */}
      {view === "start" && (
        <>
          {/* Proposals */}
          {proposals.length > 0 && (
            <div style={S.card}>
              <div style={S.sectionTitle}>Memory-Suggested Improvements</div>
              {proposals.map(p => (
                <div key={p.title} style={S.proposalCard} onClick={() => setExpandProposal(expandProposal === p.title ? null : p.title)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: "hsl(196 80% 80%)" }}>{p.title}</span>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <span style={S.badge(p.riskScore >= 50 ? red : p.riskScore >= 25 ? gold : green)}>
                        risk {p.riskScore}
                      </span>
                      <span style={S.badge(cyan)}>{p.confidence}%</span>
                    </div>
                  </div>
                  {expandProposal === p.title && (
                    <>
                      <div style={{ fontSize: "11px", color: "hsl(196 30% 55%)", marginTop: "4px" }}>{p.description}</div>
                      <div style={{ fontSize: "11px", color: green }}>✓ {p.expectedBenefit}</div>
                      <div style={{ fontSize: "11px", color: "hsl(196 30% 50%)" }}>📋 Test: {p.testPlan}</div>
                      <div style={{ fontSize: "11px", color: "hsl(196 30% 50%)" }}>↩ Rollback: {p.rollbackPlan}</div>
                      {p.memoryEvidence.length > 0 && (
                        <div style={{ fontSize: "11px", color: gold }}>◈ Evidence: {p.memoryEvidence[0]}</div>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); useProposal(p); }}
                        style={{ ...S.btnPrimary, fontSize: "11px", padding: "5px 12px", alignSelf: "flex-start", marginTop: "4px" }}
                      >
                        Use this type →
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Cycle selector */}
          <div style={S.card}>
            <div style={S.sectionTitle}>Start Improvement Cycle</div>
            <div>
              <div style={S.label}>Cycle type</div>
              <select value={cycleType} onChange={e => setCycleType(e.target.value)} style={S.select}>
                {Object.entries(CYCLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Budget toggle */}
            <button
              onClick={() => setShowBudget(b => !b)}
              style={{ background: "none", border: "none", color: "hsl(196 30% 50%)", cursor: "pointer", fontFamily: "monospace", fontSize: "11px", textAlign: "left" as const, padding: "0" }}
            >
              {showBudget ? "▼" : "▶"} Budget settings (optional — default conservative)
            </button>

            {showBudget && (
              <div style={S.grid2}>
                {([
                  ["maxTasks",           "Max tasks",             3, 1, 20],
                  ["maxPatchProposals",  "Max patch proposals",   3, 1, 20],
                  ["maxAppliedPatches",  "Max applied patches",   2, 0, 10],
                  ["maxRetries",         "Max retries",           2, 0, 10],
                  ["maxFiles",           "Max files changed",     2, 1, 20],
                  ["maxLines",           "Max lines changed",    80, 10, 2000],
                ] as Array<[keyof BudgetConfig, string, number, number, number]>).map(([k, label, def, min, max]) => (
                  <div key={k}>
                    <div style={S.label}>{label}</div>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={(budget[k] ?? def) as number}
                      onChange={e => setBudget(b => ({ ...b, [k]: Number(e.target.value) }))}
                      style={S.input}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Safety notice */}
            <div style={{ fontSize: "11px", color: "hsl(196 30% 40%)", background: "hsl(194 100% 50% / 0.04)", borderRadius: "5px", padding: "8px" }}>
              🔒 Auth, payments, migrations, env files, permissions.ts, and rollback infrastructure are always protected and cannot be modified by any autonomy cycle.
            </div>

            <button
              onClick={handleStart}
              disabled={loading || cycle?.state === "running"}
              style={{
                ...S.btnPrimary,
                opacity: loading || cycle?.state === "running" ? 0.5 : 1,
                cursor:  loading || cycle?.state === "running" ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Starting…" : "▶ Start Cycle"}
            </button>
          </div>
        </>
      )}

      {/* ── ACTIVE VIEW ── */}
      {view === "active" && (
        <>
          {!cycle ? (
            <div style={{ ...S.card, color: "hsl(196 30% 45%)" }}>No cycle is currently active.</div>
          ) : (
            <>
              {/* Current task */}
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={S.sectionTitle}>{CYCLE_LABELS[cycle.type] ?? cycle.type}</div>
                  <span style={S.badge(STATE_COLOR[cycle.state] ?? "hsl(196 30% 45%)")}>
                    {cycle.state.toUpperCase()}
                  </span>
                </div>

                {cycle.currentTaskTitle && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: green, animation: "pulse 1.5s infinite" }} />
                    <span style={{ color: "hsl(196 80% 75%)" }}>{cycle.currentTaskTitle}</span>
                    {cycle.currentAgentId && (
                      <span style={S.badge(cyan)}>{cycle.currentAgentId}</span>
                    )}
                  </div>
                )}

                {cycle.approvalsPending > 0 && (
                  <div style={{ background: "hsl(40 80% 50% / 0.1)", border: "1px solid hsl(40 80% 50% / 0.4)", borderRadius: "6px", padding: "8px 12px", color: "hsl(40 90% 70%)", fontSize: "12px" }}>
                    ⚠ {cycle.approvalsPending} approval{cycle.approvalsPending > 1 ? "s" : ""} waiting — see Audit tab for details
                  </div>
                )}

                {cycle.stoppedReason && (
                  <div style={{ fontSize: "11px", color: "hsl(196 30% 50%)" }}>
                    ℹ {cycle.stoppedReason}
                  </div>
                )}
              </div>

              {/* Budget */}
              <div style={S.card}>
                <div style={S.sectionTitle}>Budget Used</div>
                <div style={S.grid2}>
                  <BudgetStat
                    label="Tasks"
                    used={cycle.tasks.length}
                    max={cycle.budget.maxTasks}
                    color={cyan}
                  />
                  <BudgetStat
                    label="Patches Applied"
                    used={cycle.patchesApplied}
                    max={cycle.budget.maxAppliedPatches}
                    color={green}
                  />
                  <BudgetStat
                    label="Patch Proposals"
                    used={cycle.patchesProposed}
                    max={cycle.budget.maxPatchProposals}
                    color={gold}
                  />
                </div>
              </div>

              {/* Stats */}
              <div style={{ ...S.card, flexDirection: "row", flexWrap: "wrap", gap: "16px" }}>
                <div style={{ textAlign: "center" as const }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: cyan }}>{cycle.tasks.length}</div>
                  <div style={{ fontSize: "10px", color: "hsl(196 30% 45%)" }}>TASKS RUN</div>
                </div>
                <div style={{ textAlign: "center" as const }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: green }}>{cycle.patchesApplied}</div>
                  <div style={{ fontSize: "10px", color: "hsl(196 30% 45%)" }}>PATCHES APPLIED</div>
                </div>
                <div style={{ textAlign: "center" as const }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: gold }}>{cycle.patchesProposed}</div>
                  <div style={{ fontSize: "10px", color: "hsl(196 30% 45%)" }}>PROPOSED</div>
                </div>
                <div style={{ textAlign: "center" as const }}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: red }}>{cycle.patchesRolledBack}</div>
                  <div style={{ fontSize: "10px", color: "hsl(196 30% 45%)" }}>ROLLED BACK</div>
                </div>
              </div>

              {/* Controls */}
              <div style={{ ...S.row }}>
                {cycle.state === "running" && (
                  <button onClick={() => handleControl("pause")} disabled={loading} style={S.btnSecondary}>
                    ⏸ Pause
                  </button>
                )}
                {cycle.state === "paused" && (
                  <button onClick={() => handleControl("resume")} disabled={loading} style={S.btnPrimary}>
                    ▶ Resume
                  </button>
                )}
                {["running", "paused"].includes(cycle.state) && (
                  <button onClick={() => handleControl("stop")} disabled={loading} style={S.btnDanger}>
                    ■ Stop
                  </button>
                )}
                {cycle.report && (
                  <button onClick={() => setView("report")} style={{ ...S.btnPrimary, fontSize: "11px" }}>
                    View Report →
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ── REPORT VIEW ── */}
      {view === "report" && (
        <>
          {!cycle?.report ? (
            <div style={{ ...S.card, color: "hsl(196 30% 45%)" }}>
              No report available yet. Start and complete a cycle first.
            </div>
          ) : (
            <>
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={S.sectionTitle}>Cycle Report</div>
                  <span style={S.badge(STATE_COLOR[cycle.report.state] ?? "hsl(196 30% 45%)")}>
                    {cycle.report.state.toUpperCase()}
                  </span>
                </div>

                <div style={{ fontWeight: 600, color: "hsl(196 80% 80%)", lineHeight: "1.4" }}>
                  {cycle.report.summary}
                </div>

                {cycle.report.stoppedReason && (
                  <div style={{ fontSize: "11px", color: gold }}>ℹ {cycle.report.stoppedReason}</div>
                )}

                <div style={{ ...S.grid2, marginTop: "4px" }}>
                  {[
                    ["Tasks Completed",    cycle.report.tasksCompleted,   cyan],
                    ["Tasks Failed",       cycle.report.tasksFailed,      red],
                    ["Patches Proposed",   cycle.report.patchesProposed,  gold],
                    ["Patches Applied",    cycle.report.patchesApplied,   green],
                    ["Patches Rolled Back",cycle.report.patchesRolledBack, red],
                    ["Audit Entries",      cycle.report.auditEntries,     cyan],
                  ].map(([label, val, color]) => (
                    <div key={label as string} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "hsl(196 30% 50%)", fontSize: "11px" }}>{label as string}</span>
                      <span style={{ color: color as string, fontWeight: 700 }}>{val as number}</span>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: "11px", color: "hsl(196 30% 45%)" }}>
                  Duration: {Math.round((cycle.report.durationMs ?? 0) / 1000)}s
                </div>
              </div>

              {/* Budget summary */}
              {cycle.report.budgetSummary && (
                <div style={S.card}>
                  <div style={S.sectionTitle}>Budget Summary</div>
                  <div style={S.grid2}>
                    <BudgetStat
                      label="Tasks"
                      used={cycle.report.budgetSummary.usage?.tasks as number ?? 0}
                      max={cycle.report.budgetSummary.config.maxTasks}
                      color={cyan}
                    />
                    <BudgetStat
                      label="Applied Patches"
                      used={cycle.report.budgetSummary.usage?.appliedPatches as number ?? 0}
                      max={cycle.report.budgetSummary.config.maxAppliedPatches}
                      color={green}
                    />
                    <BudgetStat
                      label="Retries"
                      used={cycle.report.budgetSummary.usage?.retries as number ?? 0}
                      max={cycle.report.budgetSummary.config.maxRetries}
                      color={gold}
                    />
                  </div>
                </div>
              )}

              {/* Memory evidence */}
              {cycle.report.memoryEvidenceUsed.length > 0 && (
                <div style={S.card}>
                  <div style={S.sectionTitle}>Memory Evidence Used</div>
                  {cycle.report.memoryEvidenceUsed.map((e, i) => (
                    <div key={i} style={{ fontSize: "11px", color: "hsl(196 30% 55%)", display: "flex", gap: "6px" }}>
                      <span style={{ color: gold }}>◈</span> {e}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => { setCycle(null); setView("start"); }}
                style={{ ...S.btnPrimary, alignSelf: "flex-start" }}
              >
                ▶ Start New Cycle
              </button>
            </>
          )}
        </>
      )}

      {/* ── AUDIT VIEW ── */}
      {view === "audit" && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={S.sectionTitle}>Audit Trail</div>
            <button
              onClick={() => fetchAudit(cycle?.id)}
              style={{ background: "none", border: "none", color: cyan, cursor: "pointer", fontSize: "11px" }}
            >
              ↻ Refresh
            </button>
          </div>

          {auditLog.length === 0 ? (
            <div style={{ color: "hsl(196 30% 40%)", fontSize: "11px" }}>
              No audit entries yet. Start a cycle to see the trail.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
              {auditLog.map(e => (
                <div key={e.id} style={S.auditRow(e.critical)}>
                  <span style={{ fontSize: "12px", color: cyan, minWidth: "16px" }}>
                    {AUDIT_ICON[e.type] ?? "•"}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "10px", color: "hsl(194 100% 45%)", fontWeight: 700 }}>{e.type}</span>
                      {e.agentId && <span style={S.badge(gold)}>{e.agentId}</span>}
                      {e.critical && <span style={S.badge("hsl(40 80% 55%)")}>CRITICAL</span>}
                    </div>
                    <div style={{ fontSize: "11px", color: "hsl(196 30% 55%)", marginTop: "2px" }}>{e.reasoning}</div>
                    {e.memoryEvidence && e.memoryEvidence.length > 0 && (
                      <div style={{ fontSize: "10px", color: "hsl(40 70% 55%)", marginTop: "2px" }}>
                        ◈ {e.memoryEvidence[0]}
                      </div>
                    )}
                    <div style={{ fontSize: "10px", color: "hsl(196 30% 35%)", marginTop: "2px" }}>
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY VIEW ── */}
      {view === "history" && (
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={S.sectionTitle}>Cycle History</div>
            <button onClick={fetchHistory} style={{ background: "none", border: "none", color: cyan, cursor: "pointer", fontSize: "11px" }}>
              ↻ Refresh
            </button>
          </div>

          {allCycles.length === 0 ? (
            <div style={{ color: "hsl(196 30% 40%)", fontSize: "11px" }}>No cycles run yet.</div>
          ) : (
            allCycles.map(c => (
              <div
                key={c.id}
                style={{ ...S.proposalCard, cursor: "default" }}
                onClick={() => { setCycle(c); setView(c.report ? "report" : "active"); fetchAudit(c.id); }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600 }}>{CYCLE_LABELS[c.type] ?? c.type}</span>
                  <span style={S.badge(STATE_COLOR[c.state] ?? "hsl(196 30% 45%)")}>{c.state}</span>
                </div>
                <div style={{ fontSize: "11px", color: "hsl(196 30% 50%)" }}>
                  {c.tasks.length} tasks · {c.patchesApplied} patches applied
                  {c.startedAt ? ` · ${new Date(c.startedAt).toLocaleString()}` : ""}
                </div>
                {c.report?.summary && (
                  <div style={{ fontSize: "11px", color: "hsl(196 30% 55%)" }}>{c.report.summary}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

export default AutonomyPanel;
