/**
 * components/AgentsPanel.tsx — Multi-Agent System v1
 *
 * Shows 6 specialist agent profile cards, then lets the user describe a goal
 * + pick a change type to get an instant agent assignment with confidence score.
 * Read-only: no code is executed from this panel.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, Users, ChevronDown, ChevronRight, Send,
  Loader2, XCircle, CheckCircle2, Zap,
  Building2, Code2, Bug, FlaskConical, Rocket, Brain,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentRole    = "architect"|"coder"|"debugger"|"tester"|"deployment"|"memory";
type ChangeType   = "feature"|"bugfix"|"refactor"|"api"|"frontend"|"data"|"test"|"docs";

interface AgentProfile {
  id:                   string;
  name:                 string;
  role:                 AgentRole;
  description:          string;
  specialties:          string[];
  keywords:             string[];
  preferredChangeTypes: ChangeType[];
  color:                string;
  emoji:                string;
}

interface AssignmentResult {
  agentId:         string;
  agentName:       string;
  role:            AgentRole;
  confidence:      number;
  reason:          string;
  matchedKeywords: string[];
  alternates:      Array<{ agentId: string; agentName: string; confidence: number }>;
  assignedAt:      string;
  request:         { goal: string; changeType: ChangeType; context?: string };
}

interface AgentsPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CYAN   = "hsl(185 75% 52%)";
const MUTED  = "hsl(210 15% 38%)";
const GREEN  = "hsl(150 70% 55%)";
const AMBER  = "hsl(38 100% 60%)";
const RED    = "hsl(355 80% 65%)";

const CONF_COLOR = (n: number) => n >= 70 ? GREEN : n >= 45 ? AMBER : RED;

const ROLE_ICON: Record<AgentRole, React.ElementType> = {
  architect:  Building2,
  coder:      Code2,
  debugger:   Bug,
  tester:     FlaskConical,
  deployment: Rocket,
  memory:     Brain,
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

// ─── Confidence ring ──────────────────────────────────────────────────────────

function ConfidenceRing({ score }: { score: number }) {
  const size = 48, r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = CONF_COLOR(score);
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(210 15% 10%)" strokeWidth={5} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${fill} ${circ-fill}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
        fontSize={12} fontWeight="bold" fill={color}>{score}</text>
    </svg>
  );
}

// ─── Agent card ───────────────────────────────────────────────────────────────

function AgentCard({
  profile,
  active,
  confidence,
}: {
  profile:    AgentProfile;
  active:     boolean;
  confidence?: number;
}) {
  const [open, setOpen] = useState(false);
  const Icon = ROLE_ICON[profile.role] ?? Zap;

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{
        border:     `1px solid ${active ? profile.color + "60" : "hsl(210 15% 13%)"}`,
        background: active ? `${profile.color}0a` : "hsl(220 20% 5%)",
      }}>
      {/* Header row */}
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 w-full text-left px-3 py-2.5">
        {/* Emoji + icon */}
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[13px]"
          style={{ background: `${profile.color}18`, border: `1px solid ${profile.color}35` }}>
          {profile.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold" style={{ color: active ? profile.color : "hsl(196 25% 72%)" }}>
              {profile.name}
            </span>
            {active && (
              <span className="text-[7px] font-mono px-1 rounded-full flex-shrink-0"
                style={{ background: `${profile.color}20`, border: `1px solid ${profile.color}50`, color: profile.color }}>
                ASSIGNED
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {profile.specialties.slice(0, 3).map(s => (
              <span key={s} className="text-[7px] font-mono px-1 rounded"
                style={{ background: "hsl(210 15% 10%)", border: "1px solid hsl(210 15% 17%)", color: MUTED }}>
                {s}
              </span>
            ))}
            {profile.specialties.length > 3 && (
              <span className="text-[7px] font-mono" style={{ color: MUTED }}>
                +{profile.specialties.length - 3}
              </span>
            )}
          </div>
        </div>
        {active && confidence !== undefined && (
          <ConfidenceRing score={confidence} />
        )}
        {!active && (
          open
            ? <ChevronDown  className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />
            : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />
        )}
      </button>

      {/* Expanded description */}
      {open && !active && (
        <div className="border-t px-3 py-2.5 space-y-2"
          style={{ borderColor: "hsl(210 15% 10%)" }}>
          <p className="text-[9px] leading-relaxed" style={{ color: MUTED }}>
            {profile.description}
          </p>
          <div className="flex flex-wrap gap-1">
            {profile.preferredChangeTypes.map(ct => (
              <span key={ct} className="text-[7px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: `${profile.color}12`, border: `1px solid ${profile.color}30`, color: profile.color }}>
                {ct}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function AgentsPanel({ isOpen, onClose, apiBase }: AgentsPanelProps) {
  const [profiles,   setProfiles]   = useState<AgentProfile[]>([]);
  const [assignment, setAssignment] = useState<AssignmentResult | null>(null);
  const [goal,       setGoal]       = useState("");
  const [changeType, setChangeType] = useState<ChangeType>("feature");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [loadingProfiles, setLoadingProfiles] = useState(false);

  // Load profiles on open
  useEffect(() => {
    if (!isOpen || profiles.length > 0) return;
    setLoadingProfiles(true);
    void fetch(`${apiBase}api/agents/profiles`)
      .then(r => r.json())
      .then((d: { ok: boolean; profiles?: AgentProfile[] }) => {
        if (d.ok && d.profiles) setProfiles(d.profiles);
      })
      .catch(() => {})
      .finally(() => setLoadingProfiles(false));
  }, [isOpen, apiBase, profiles.length]);

  // Load last assignment on open
  useEffect(() => {
    if (!isOpen || assignment) return;
    void fetch(`${apiBase}api/agents/assign/last`)
      .then(r => r.json())
      .then((d: { ok: boolean; result?: AssignmentResult }) => {
        if (d.ok && d.result) {
          setAssignment(d.result);
          setGoal(d.result.request.goal);
          setChangeType(d.result.request.changeType);
        }
      })
      .catch(() => {});
  }, [isOpen, apiBase, assignment]);

  const assign = useCallback(async () => {
    if (!goal.trim() || loading) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/assign`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ goal: goal.trim(), changeType }),
      });
      const data = await res.json() as { ok: boolean; result?: AssignmentResult; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Assignment failed");
      setAssignment(data.result ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase, goal, changeType, loading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void assign(); }
  };

  const selectStyle: React.CSSProperties = {
    background: "hsl(220 20% 6%)",
    border:     "1px solid hsl(210 15% 20%)",
    color:      "hsl(196 25% 72%)",
    borderRadius: "0.5rem",
    padding:    "0.375rem 0.5rem",
    fontSize:   "11px",
    width:      "100%",
    outline:    "none",
  };

  const activeProfile = profiles.find(p => p.id === assignment?.agentId);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="agents-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Agents panel"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: CYAN }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: CYAN }}>AGENTS</h2>
            {profiles.length > 0 && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${CYAN}18`, border: `1px solid ${CYAN}40`, color: CYAN }}>
                {profiles.length}
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close agents panel"
            className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
            style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
            <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">

          {/* ── Assignment form ───────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b space-y-3" style={{ borderColor: "hsl(210 15% 12%)" }}>
            <div>
              <label className="block text-[9px] font-mono font-bold tracking-widest mb-1" style={{ color: CYAN }}>
                GOAL
              </label>
              <textarea
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Describe the task or goal to assign…"
                rows={2}
                className="w-full resize-none rounded-lg text-[11px] leading-relaxed placeholder:opacity-40 outline-none transition-all"
                style={{
                  background: "hsl(220 20% 6%)",
                  border:     `1px solid ${goal.trim() ? `${CYAN}50` : "hsl(210 15% 20%)"}`,
                  color:      "hsl(196 25% 76%)",
                  padding:    "0.5rem 0.625rem",
                  fontFamily: "inherit",
                }}
              />
            </div>
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
            <button type="button" onClick={assign}
              disabled={!goal.trim() || loading}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-xl font-bold text-[10px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${CYAN}18`, border: `1px solid ${CYAN}45`, color: CYAN }}>
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> ASSIGNING…</>
                : <><Send className="w-3.5 h-3.5" /> ASSIGN AGENT <span style={{ color: MUTED }}>(⌘↵)</span></>}
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

          {/* ── Assignment result ─────────────────────────────────────────── */}
          {assignment && activeProfile && (
            <div className="px-4 pt-3 pb-2">
              <p className="text-[8px] font-mono font-bold tracking-widest mb-2" style={{ color: MUTED }}>
                ACTIVE ASSIGNMENT
              </p>
              {/* Winner card */}
              <div className="rounded-xl p-3 mb-2"
                style={{ background: `${activeProfile.color}0a`, border: `1px solid ${activeProfile.color}50` }}>
                <div className="flex items-start gap-3">
                  <ConfidenceRing score={assignment.confidence} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] font-bold" style={{ color: activeProfile.color }}>
                        {assignment.agentName}
                      </span>
                      <span className="text-[7px] font-mono px-1 rounded-full flex-shrink-0"
                        style={{ background: `${activeProfile.color}20`, border: `1px solid ${activeProfile.color}50`, color: activeProfile.color }}>
                        ASSIGNED
                      </span>
                    </div>
                    <p className="text-[9px] leading-relaxed" style={{ color: "hsl(196 25% 68%)" }}>
                      {assignment.reason}
                    </p>
                    {/* Matched keywords */}
                    {assignment.matchedKeywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <span className="text-[8px]" style={{ color: MUTED }}>Matched:</span>
                        {assignment.matchedKeywords.slice(0, 6).map(kw => (
                          <span key={kw} className="text-[7px] font-mono px-1 rounded"
                            style={{ background: `${activeProfile.color}12`, border: `1px solid ${activeProfile.color}30`, color: `${activeProfile.color}cc` }}>
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[8px] font-mono mt-1.5 italic truncate" style={{ color: `${activeProfile.color}70` }}>
                      "{assignment.request.goal.slice(0, 60)}{assignment.request.goal.length > 60 ? "…" : ""}"
                    </p>
                  </div>
                </div>
              </div>

              {/* Alternates */}
              {assignment.alternates.length > 0 && (
                <div className="mb-2">
                  <p className="text-[8px] font-mono mb-1" style={{ color: MUTED }}>ALTERNATIVES</p>
                  <div className="space-y-1">
                    {assignment.alternates.map(alt => {
                      const altProfile = profiles.find(p => p.id === alt.agentId);
                      if (!altProfile) return null;
                      return (
                        <div key={alt.agentId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                          style={{ background: "hsl(220 20% 5%)", border: "1px solid hsl(210 15% 11%)" }}>
                          <span className="text-[10px]">{altProfile.emoji}</span>
                          <span className="flex-1 text-[9px]" style={{ color: "hsl(196 25% 60%)" }}>{alt.agentName}</span>
                          <div className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ background: CONF_COLOR(alt.confidence), opacity: 0.7 }} />
                          <span className="text-[8px] font-mono w-6 text-right" style={{ color: CONF_COLOR(alt.confidence) }}>
                            {alt.confidence}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-[8px] font-mono" style={{ color: "hsl(210 15% 28%)" }}>
                {new Date(assignment.assignedAt).toLocaleString()}
              </p>
            </div>
          )}

          {/* ── Agent roster ──────────────────────────────────────────────── */}
          <div className="px-4 py-3">
            <p className="text-[8px] font-mono font-bold tracking-widest mb-2" style={{ color: MUTED }}>
              SPECIALIST ROSTER
            </p>

            {loadingProfiles && (
              <div className="flex items-center gap-2 py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: CYAN }} />
                <span className="text-[10px]" style={{ color: MUTED }}>Loading agents…</span>
              </div>
            )}

            {!loadingProfiles && profiles.length === 0 && (
              <div className="flex items-center gap-2 py-6 justify-center">
                <Users className="w-5 h-5 opacity-10" style={{ color: CYAN }} />
                <span className="text-[10px]" style={{ color: MUTED }}>No agent profiles found.</span>
              </div>
            )}

            {!loadingProfiles && profiles.length > 0 && (
              <div className="space-y-2">
                {profiles.map(profile => (
                  <AgentCard
                    key={profile.id}
                    profile={profile}
                    active={profile.id === assignment?.agentId}
                    confidence={profile.id === assignment?.agentId ? assignment?.confidence : undefined}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Empty assignment state ────────────────────────────────────── */}
          {!assignment && !loading && (
            <div className="px-6 pb-8 pt-2 text-center">
              <CheckCircle2 className="w-7 h-7 mx-auto mb-2 opacity-10" style={{ color: CYAN }} />
              <p className="text-[10px]" style={{ color: MUTED }}>
                Enter a goal above and click <strong style={{ color: CYAN }}>ASSIGN AGENT</strong> to find the best specialist for the job.
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
