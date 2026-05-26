/**
 * components/MultiAgentPanel.tsx — Phase 4 / 4B Multi-Agent panel.
 *
 * Phase 4:  Agent registry, task graph, orchestrate input, context bus.
 * Phase 4B: Run Plan / Step Next / Pause / Resume, execution timeline,
 *           active agent indicator, dependency view, retry counts,
 *           failure reasons, final summary.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Network, Play, RefreshCw, XCircle, CheckCircle, Clock,
  AlertTriangle, ChevronDown, ChevronRight, Shield, Zap,
  GitBranch, FlaskConical, Search, Hammer, Send, SkipForward,
  PauseCircle, PlayCircle, ListOrdered, BarChart3,
} from "lucide-react";

const BASE       = import.meta.env.BASE_URL;
const AGENTS_URL = `${BASE}api/agents`;
const TASKS_URL  = `${BASE}api/agents/tasks`;
const ORCH_URL   = `${BASE}api/agents/orchestrate`;
const CTX_URL    = `${BASE}api/agents/context`;
const AUDIT_URL  = `${BASE}api/agents/permissions/audit?denied=true&limit=20`;
const MSGS_URL   = `${BASE}api/agents/messages`;
const planUrl    = (id: string, action: string) => `${BASE}api/agents/plan/${id}/${action}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentInfo {
  id: string; name: string; role: string; description: string;
  capabilities: string[]; permissions: string[];
  riskLimit: "safe" | "review" | "risky";
  executionMode: "read-only" | "proposal" | "test" | "git";
}

interface AgentTask {
  id: string; title: string; description: string; agentId: string;
  dependencies: string[];
  status: "pending" | "ready" | "running" | "waiting_approval" | "validating" |
          "passed" | "done" | "failed" | "skipped" | "blocked" | "rolled_back" | "cancelled";
  priority: "critical" | "high" | "medium" | "low";
  riskScore: number; retryCount: number; maxRetries: number;
  result?: string; error?: string; orchestrationId?: string;
  createdAt: number; completedAt?: number;
}

interface TimelineEvent {
  id: string; orchestrationId: string; timestamp: number; type: string;
  taskId?: string; agentId?: string; message: string;
}

interface AgentMessage {
  id: string; fromAgent: string; toAgent: string; taskId: string;
  orchestrationId: string; type: string; content: string; risk: string; timestamp: number;
}

interface ContextSnapshot {
  projectHealth: { score: number; label: string };
  patches: { pending: number; files: string[] };
  taskGraph: { total: number; pending: number; running: number; done: number; failed: number; ready: number };
  agents: { count: number; ids: string[] };
  autoFix: { hasResult: boolean; autoApplied: number; queued: number; finalValidationPassed?: boolean };
  recentPermissionDenials: Array<{ agentId: string; action: string; timestamp: number }>;
  capturedAt: number;
}

interface PlanSummary {
  state: string; steps: number; totalTasks: number; passed: number;
  failed: number; blocked: number; skipped: number; rolledBack: number;
  durationMs?: number; currentAgentId?: string; activeTaskId?: string;
  message: string;
  agentActions: Array<{ agentId: string; taskTitle: string; status: string; retryCount: number }>;
  timeline: TimelineEvent[];
}

// ─── Styling helpers ──────────────────────────────────────────────────────────

function statusColor(s: AgentTask["status"]): string {
  if (s === "done" || s === "passed") return "hsl(142 71% 55%)";
  if (s === "running" || s === "validating") return "hsl(38 100% 60%)";
  if (s === "failed")           return "hsl(355 80% 60%)";
  if (s === "waiting_approval") return "hsl(264 80% 70%)";
  if (s === "blocked")          return "hsl(355 60% 45%)";
  if (s === "rolled_back")      return "hsl(38 80% 55%)";
  if (s === "skipped" || s === "cancelled") return "hsl(210 15% 40%)";
  if (s === "ready")            return "hsl(194 100% 60%)";
  return "hsl(210 15% 55%)"; // pending
}

function statusIcon(s: AgentTask["status"]) {
  const cls = "w-3.5 h-3.5";
  if (s === "done" || s === "passed") return <CheckCircle  className={cls} style={{ color: statusColor(s) }} />;
  if (s === "running" || s === "validating") return <RefreshCw className={`${cls} animate-spin`} style={{ color: statusColor(s) }} />;
  if (s === "failed")           return <XCircle      className={cls} style={{ color: statusColor(s) }} />;
  if (s === "waiting_approval") return <AlertTriangle className={cls} style={{ color: statusColor(s) }} />;
  if (s === "blocked")          return <XCircle      className={cls} style={{ color: statusColor(s) }} />;
  if (s === "ready")            return <PlayCircle   className={cls} style={{ color: statusColor(s) }} />;
  return <Clock className={cls} style={{ color: statusColor(s) }} />;
}

function timelineIcon(type: string) {
  const cls = "w-3 h-3 flex-shrink-0 mt-0.5";
  if (type.includes("completed")) return <CheckCircle  className={cls} style={{ color: "hsl(142 71% 55%)" }} />;
  if (type.includes("failed"))    return <XCircle      className={cls} style={{ color: "hsl(355 80% 60%)" }} />;
  if (type.includes("started"))   return <Play         className={cls} style={{ color: "hsl(38 100% 60%)" }} />;
  if (type.includes("retry"))     return <RefreshCw    className={cls} style={{ color: "hsl(38 100% 60%)" }} />;
  if (type.includes("approval"))  return <AlertTriangle className={cls} style={{ color: "hsl(264 80% 70%)" }} />;
  if (type.includes("handoff"))   return <SkipForward  className={cls} style={{ color: "hsl(194 100% 60%)" }} />;
  if (type.includes("plan"))      return <Network      className={cls} style={{ color: "hsl(194 100% 60%)" }} />;
  return <Zap className={cls} style={{ color: "hsl(196 30% 50%)" }} />;
}

function riskColor(score: number): string {
  return score >= 70 ? "hsl(355 80% 60%)" : score >= 40 ? "hsl(38 100% 60%)" : "hsl(142 71% 55%)";
}

function agentIcon(id: string) {
  const cls = "w-3.5 h-3.5";
  if (id === "planner")    return <Network     className={cls} />;
  if (id === "builder")    return <Hammer      className={cls} />;
  if (id === "tester")     return <FlaskConical className={cls} />;
  if (id === "researcher") return <Search      className={cls} />;
  if (id === "git")        return <GitBranch   className={cls} />;
  return <Zap className={cls} />;
}

function riskBadge(limit: string) {
  const c = limit === "safe" ? "hsl(142 71% 55%)" : limit === "review" ? "hsl(38 100% 60%)" : "hsl(355 80% 60%)";
  return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: `${c}20`, color: c, border: `1px solid ${c}40` }}>{limit.toUpperCase()}</span>;
}

function modeBadge(mode: string) {
  const c = mode === "read-only" ? "hsl(194 100% 55%)" : mode === "proposal" ? "hsl(264 80% 70%)" : mode === "test" ? "hsl(38 100% 60%)" : "hsl(142 71% 55%)";
  return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: `${c}15`, color: c, border: `1px solid ${c}30` }}>{mode}</span>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActiveAgentBanner({ agentId, taskTitle }: { agentId: string; taskTitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg animate-pulse"
      style={{ background: "hsl(38 100% 60% / 0.08)", border: "1px solid hsl(38 100% 60% / 0.25)" }}>
      <span style={{ color: "hsl(38 100% 65%)" }}>{agentIcon(agentId)}</span>
      <div>
        <p className="text-[10px] font-mono font-semibold" style={{ color: "hsl(38 100% 70%)" }}>
          ● {agentId.toUpperCase()} running
        </p>
        {taskTitle && <p className="text-[10px] opacity-70 truncate max-w-[220px]" style={{ color: "hsl(38 60% 65%)" }}>{taskTitle}</p>}
      </div>
    </div>
  );
}

function SummaryPanel({ summary }: { summary: PlanSummary }) {
  const stateColor = summary.state === "completed" ? "hsl(142 71% 55%)"
    : summary.state === "failed" ? "hsl(355 80% 60%)"
    : summary.state === "paused" ? "hsl(264 80% 70%)"
    : "hsl(38 100% 60%)";

  return (
    <div className="rounded-lg p-3 space-y-2.5" style={{ background: "hsl(220 20% 6%)", border: "1px solid hsl(220 15% 14%)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5" style={{ color: stateColor }} />
          <span className="text-xs font-semibold" style={{ color: stateColor }}>
            {summary.state.toUpperCase()}
          </span>
        </div>
        {summary.durationMs != null && (
          <span className="text-[10px] font-mono opacity-50" style={{ color: "hsl(210 15% 55%)" }}>
            {(summary.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
      <p className="text-[10px]" style={{ color: "hsl(210 15% 55%)" }}>{summary.message}</p>
      <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
        {[
          ["passed",  summary.passed,  "hsl(142 71% 55%)"],
          ["failed",  summary.failed,  "hsl(355 80% 60%)"],
          ["blocked", summary.blocked, "hsl(355 60% 45%)"],
          ["skipped", summary.skipped, "hsl(210 15% 40%)"],
        ].map(([l, v, c]) => (
          <div key={l as string} className="rounded py-1" style={{ background: `${c as string}12` }}>
            <p className="font-bold text-sm" style={{ color: c as string }}>{v as number}</p>
            <p style={{ color: c as string, opacity: 0.7 }}>{l as string}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskCard({
  task, agents, allTasks, onRun, onCancel, busy, activeTaskId,
}: {
  task: AgentTask; agents: AgentInfo[]; allTasks: AgentTask[];
  onRun: (id: string) => void; onCancel: (id: string) => void;
  busy: boolean; activeTaskId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const agent = agents.find(a => a.id === task.agentId);
  const isActive = task.id === activeTaskId;
  const depLabels = task.dependencies.map(d => allTasks.find(t => t.id === d)?.title?.slice(0, 30) ?? d.slice(0, 8));

  const isRunnable = (task.status === "pending" || task.status === "ready") &&
    task.dependencies.every(d => {
      const dep = allTasks.find(t => t.id === d);
      return dep?.status === "done" || dep?.status === "passed";
    });

  return (
    <div className="rounded-lg border transition-all"
      style={{
        background: isActive ? "hsl(38 100% 60% / 0.06)" : "hsl(220 20% 7%)",
        borderColor: isActive ? "hsl(38 100% 60% / 0.3)" : "hsl(220 15% 15%)",
      }}>
      <div className="flex items-start gap-2.5 p-3">
        <div className="mt-0.5 flex-shrink-0">{statusIcon(task.status)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold truncate" style={{ color: "hsl(196 50% 85%)" }}>{task.title}</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ color: riskColor(task.riskScore), background: `${riskColor(task.riskScore)}18` }}>risk {task.riskScore}</span>
            <span className="text-[9px] font-mono opacity-50" style={{ color: "hsl(196 50% 65%)" }}>{task.priority}</span>
            {task.retryCount > 0 && (
              <span className="text-[9px] font-mono px-1.5 rounded" style={{ background: "hsl(38 100% 60% / 0.12)", color: "hsl(38 100% 65%)" }}>
                retry {task.retryCount}/{task.maxRetries}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span style={{ color: "hsl(194 100% 55%)" }}>{agentIcon(task.agentId)}</span>
            <span className="text-[10px] font-mono" style={{ color: "hsl(194 100% 65%)" }}>{agent?.name ?? task.agentId}</span>
            {agent && modeBadge(agent.executionMode)}
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: statusColor(task.status), background: `${statusColor(task.status)}15` }}>{task.status}</span>
          </div>
          {depLabels.length > 0 && (
            <p className="text-[10px] mt-1 opacity-50" style={{ color: "hsl(210 15% 60%)" }}>→ {depLabels.join(", ")}</p>
          )}
          {task.status === "blocked" && task.error && (
            <p className="text-[10px] mt-1" style={{ color: "hsl(355 80% 60%)" }}>✗ {task.error}</p>
          )}
          {task.status === "waiting_approval" && (
            <p className="text-[10px] mt-1" style={{ color: "hsl(264 80% 70%)" }}>⚠ Waiting for approval — high risk task</p>
          )}
          {(task.description || task.result || task.error) && (
            <button type="button" onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-[10px] mt-1.5 opacity-50 hover:opacity-80 transition-opacity"
              style={{ color: "hsl(194 100% 65%)" }}>
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded ? "Less" : "Details"}
            </button>
          )}
          {expanded && (
            <div className="mt-2 space-y-1.5">
              {task.description && <p className="text-[10px] leading-relaxed" style={{ color: "hsl(210 15% 60%)" }}>{task.description}</p>}
              {task.result && (
                <div className="rounded p-2 text-[10px] font-mono overflow-x-auto"
                  style={{ background: "hsl(220 20% 5%)", color: "hsl(142 71% 65%)", whiteSpace: "pre-wrap", maxHeight: 180 }}>
                  {task.result.slice(0, 500)}{task.result.length > 500 ? "\n…" : ""}
                </div>
              )}
              {task.error && (
                <div className="rounded p-2 text-[10px] font-mono" style={{ background: "hsl(355 30% 8%)", color: "hsl(355 80% 65%)" }}>{task.error}</div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          {isRunnable && (
            <button type="button" disabled={busy} onClick={() => onRun(task.id)}
              className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-40"
              style={{ background: "hsl(142 71% 45% / 0.15)", color: "hsl(142 71% 65%)", border: "1px solid hsl(142 71% 45% / 0.35)" }}>
              <Play className="w-2.5 h-2.5" />Run
            </button>
          )}
          {(task.status === "pending" || task.status === "ready") && (
            <button type="button" onClick={() => onCancel(task.id)}
              className="text-[10px] px-2.5 py-1.5 rounded-lg opacity-40 hover:opacity-70 transition-opacity"
              style={{ color: "hsl(355 80% 60%)", border: "1px solid hsl(355 80% 60% / 0.2)" }}>
              Cancel
            </button>
          )}
          {task.status === "failed" && task.retryCount < task.maxRetries && (
            <button type="button" disabled={busy} onClick={() => onRun(task.id)}
              className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-40"
              style={{ background: "hsl(38 100% 60% / 0.1)", color: "hsl(38 100% 65%)", border: "1px solid hsl(38 100% 60% / 0.25)" }}>
              <RefreshCw className="w-2.5 h-2.5" />Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  return (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {events.length === 0 ? (
        <p className="text-[10px] opacity-40 text-center py-4" style={{ color: "hsl(210 15% 55%)" }}>No events yet</p>
      ) : (
        events.map(e => (
          <div key={e.id} className="flex items-start gap-2 px-2 py-1 rounded text-[10px]">
            {timelineIcon(e.type)}
            <div className="flex-1 min-w-0">
              <span style={{ color: "hsl(196 50% 75%)" }}>{e.message}</span>
              {e.agentId && (
                <span className="ml-1.5 font-mono opacity-50" style={{ color: "hsl(194 100% 60%)" }}>[{e.agentId}]</span>
              )}
            </div>
            <span className="font-mono opacity-30 flex-shrink-0" style={{ color: "hsl(210 15% 55%)" }}>
              {new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function ContextWidget({ ctx }: { ctx: ContextSnapshot }) {
  const hc = ctx.projectHealth.label === "healthy" ? "hsl(142 71% 55%)" : ctx.projectHealth.label === "degraded" ? "hsl(38 100% 60%)" : "hsl(355 80% 60%)";
  return (
    <div className="grid grid-cols-2 gap-2 text-[10px]">
      {[
        { label: "HEALTH", value: ctx.projectHealth.score.toString(), sub: ctx.projectHealth.label, color: hc },
        { label: "TASKS", value: ctx.taskGraph.total.toString(), sub: `${ctx.taskGraph.ready} ready`, color: "hsl(194 100% 60%)" },
        { label: "PATCHES", value: ctx.patches.pending.toString(), sub: "pending review", color: "hsl(264 80% 70%)" },
        { label: "AUTOFIX", value: ctx.autoFix.hasResult ? ctx.autoFix.autoApplied.toString() : "—", sub: ctx.autoFix.hasResult ? `${ctx.autoFix.queued} queued` : "no result", color: "hsl(142 71% 55%)" },
      ].map(({ label, value, sub, color }) => (
        <div key={label} className="rounded-lg p-2.5" style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(220 15% 14%)" }}>
          <p className="font-mono opacity-50 mb-1" style={{ color: "hsl(196 30% 55%)" }}>{label}</p>
          <p className="text-lg font-bold" style={{ color }}>{value}</p>
          <p style={{ color, opacity: 0.7 }}>{sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type ActiveView = "plan" | "agents" | "timeline" | "messages";

export default function MultiAgentPanel() {
  const [view, setView]               = useState<ActiveView>("plan");
  const [agents, setAgents]           = useState<AgentInfo[]>([]);
  const [tasks, setTasks]             = useState<AgentTask[]>([]);
  const [ctx, setCtx]                 = useState<ContextSnapshot | null>(null);
  const [denials, setDenials]         = useState<ContextSnapshot["recentPermissionDenials"]>([]);
  const [messages, setMessages]       = useState<AgentMessage[]>([]);
  const [timeline, setTimeline]       = useState<TimelineEvent[]>([]);
  const [summary, setSummary]         = useState<PlanSummary | null>(null);
  const [orchestrationId, setOrchestrationId] = useState<string | null>(null);
  const [planState, setPlanState]     = useState<string>("idle");
  const [activeTaskId, setActiveTaskId] = useState<string | undefined>();
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>();
  const [loading, setLoading]         = useState(true);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [goal, setGoal]               = useState("");
  const [orchestrating, setOrchestrating] = useState(false);
  const [orchMsg, setOrchMsg]         = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const refresh = useCallback(async (orchId?: string) => {
    const oid = orchId ?? orchestrationId;
    try {
      const [aRes, tRes, cRes, dRes] = await Promise.all([
        fetch(AGENTS_URL).then(r => r.json() as Promise<{ ok: boolean; agents: AgentInfo[] }>),
        fetch(oid ? `${TASKS_URL}?orchestrationId=${oid}` : TASKS_URL)
          .then(r => r.json() as Promise<{ ok: boolean; tasks: AgentTask[] }>),
        fetch(CTX_URL).then(r => r.json() as Promise<{ ok: boolean; context: ContextSnapshot }>),
        fetch(AUDIT_URL).then(r => r.json() as Promise<{ ok: boolean; entries: ContextSnapshot["recentPermissionDenials"] }>),
      ]);
      if (aRes.ok) setAgents(aRes.agents);
      if (tRes.ok) setTasks(tRes.tasks);
      if (cRes.ok) setCtx(cRes.context);
      if (dRes.ok) setDenials(dRes.entries);

      if (oid) {
        const [summRes, msgsRes] = await Promise.all([
          fetch(planUrl(oid, "summary")).then(r => r.json() as Promise<{ ok: boolean } & PlanSummary>),
          fetch(`${MSGS_URL}?orchestrationId=${oid}&limit=30`).then(r => r.json() as Promise<{ ok: boolean; messages: AgentMessage[] }>),
        ]);
        if (summRes.ok) {
          setSummary(summRes);
          setPlanState(summRes.state);
          setTimeline(summRes.timeline ?? []);
          setActiveTaskId(summRes.activeTaskId);
          setActiveAgentId(summRes.currentAgentId);
        }
        if (msgsRes.ok) setMessages(msgsRes.messages);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [orchestrationId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while running
  useEffect(() => {
    if (planState !== "running") return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [planState, refresh]);

  const handleOrchestrate = async () => {
    if (!goal.trim()) return;
    setOrchestrating(true);
    setOrchMsg(null);
    setError(null);
    try {
      const res = await fetch(ORCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const data = await res.json() as { ok: boolean; orchestrationId?: string; message?: string };
      if (data.ok && data.orchestrationId) {
        setOrchestrationId(data.orchestrationId);
        setGoal("");
        setOrchMsg(data.message ?? "Orchestration created.");
        setPlanState("idle");
        setSummary(null);
        setTimeline([]);
        setMessages([]);
        await refresh(data.orchestrationId);
      }
    } catch (e) { setError(String(e)); }
    finally { setOrchestrating(false); }
  };

  const planAction = async (action: "run" | "step" | "pause" | "resume") => {
    if (!orchestrationId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(planUrl(orchestrationId, action), { method: "POST" });
      const data = await res.json() as { ok: boolean; error?: string; state?: string };
      if (!data.ok) setError(data.error ?? "Action failed");
      await refresh();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  const handleRunTask = async (taskId: string) => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`${BASE}api/agents/tasks/${taskId}/run`, { method: "POST" });
      await refresh();
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  const handleCancel = async (taskId: string) => {
    try {
      await fetch(`${BASE}api/agents/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      await refresh();
    } catch { /**/ }
  };

  const handleClearTasks = async () => {
    try {
      await fetch(TASKS_URL + (orchestrationId ? `?orchestrationId=${orchestrationId}` : ""), { method: "DELETE" });
      setOrchestrationId(null);
      setSummary(null);
      setTimeline([]);
      setMessages([]);
      setPlanState("idle");
      await refresh();
    } catch { /**/ }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const isRunning  = planState === "running";
  const isPaused   = planState === "paused";
  const isIdle     = planState === "idle" || planState === "completed" || planState === "failed";
  const canRun     = !!orchestrationId && (isIdle || isPaused);
  const canStep    = !!orchestrationId && !isRunning && planState !== "paused";
  const canPause   = isRunning;
  const canResume  = isPaused;
  const activeTask = tasks.find(t => t.id === activeTaskId);

  const pendingTasks  = tasks.filter(t => t.status === "pending" || t.status === "ready");
  const runningTasks  = tasks.filter(t => t.status === "running" || t.status === "validating");
  const approvalTasks = tasks.filter(t => t.status === "waiting_approval");
  const doneTasks     = tasks.filter(t => t.status === "done" || t.status === "passed");
  const failedTasks   = tasks.filter(t => t.status === "failed");
  const blockedTasks  = tasks.filter(t => t.status === "blocked");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full opacity-40" style={{ color: "hsl(194 100% 55%)" }}>
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-mono">Loading agents…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid hsl(220 15% 14%)" }}>
        <Network className="w-4 h-4" style={{ color: "hsl(194 100% 55%)" }} />
        <span className="text-xs font-mono font-semibold tracking-wider" style={{ color: "hsl(196 50% 70%)" }}>AGENTS</span>

        {/* View tabs */}
        <div className="flex items-center gap-0.5 ml-2">
          {(["plan", "agents", "timeline", "messages"] as ActiveView[]).map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              className="text-[10px] px-2 py-1 rounded transition-all font-mono"
              style={{
                background: view === v ? "hsl(194 100% 50% / 0.12)" : "transparent",
                color: view === v ? "hsl(194 100% 65%)" : "hsl(196 30% 45%)",
                border: `1px solid ${view === v ? "hsl(194 100% 50% / 0.3)" : "transparent"}`,
              }}>
              {v === "plan" ? "Plan" : v === "agents" ? "Agents" : v === "timeline" ? <span className="flex items-center gap-1"><ListOrdered className="w-2.5 h-2.5" />Timeline</span> : "Messages"}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        {isRunning && <span className="text-[10px] font-mono animate-pulse" style={{ color: "hsl(38 100% 60%)" }}>● {activeAgentId?.toUpperCase() ?? "RUNNING"}</span>}
        <button type="button" onClick={() => void refresh()}
          className="p-1 rounded opacity-40 hover:opacity-70 transition-opacity"
          style={{ color: "hsl(194 100% 55%)" }}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: "hsl(355 30% 8%)", border: "1px solid hsl(355 80% 55% / 0.3)", color: "hsl(355 80% 65%)" }}>
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{error}
          </div>
        )}

        {/* ── PLAN VIEW ──────────────────────────────────────────────────── */}
        {view === "plan" && (
          <div className="space-y-4">

            {/* Orchestrate input */}
            <section>
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2"
                style={{ color: "hsl(196 30% 45%)" }}>Goal</h3>
              <div className="flex gap-2">
                <textarea value={goal} onChange={e => setGoal(e.target.value)}
                  placeholder="Describe a development goal — PlannerAgent will break it into tasks…"
                  rows={2} className="flex-1 px-3 py-2 rounded-lg text-xs resize-none outline-none"
                  style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(220 15% 18%)", color: "hsl(196 50% 80%)" }}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleOrchestrate(); }} />
                <button type="button" onClick={() => void handleOrchestrate()}
                  disabled={orchestrating || !goal.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
                  style={{ background: "hsl(194 100% 50% / 0.12)", border: "1px solid hsl(194 100% 50% / 0.3)", color: "hsl(194 100% 65%)" }}>
                  {orchestrating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Plan
                </button>
              </div>
              {orchMsg && <p className="text-[10px] mt-2 px-2 py-1 rounded" style={{ background: "hsl(142 71% 45% / 0.08)", color: "hsl(142 71% 60%)" }}>✓ {orchMsg}</p>}
            </section>

            {/* Plan controls */}
            {orchestrationId && (
              <section>
                <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2"
                  style={{ color: "hsl(196 30% 45%)" }}>Plan Controls</h3>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!canRun || busy}
                    onClick={() => void planAction("run")}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-40"
                    style={{ background: "hsl(142 71% 45% / 0.15)", border: "1px solid hsl(142 71% 45% / 0.35)", color: "hsl(142 71% 65%)" }}>
                    {busy && isRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Run Plan
                  </button>
                  <button type="button" disabled={!canStep || busy || isRunning}
                    onClick={() => void planAction("step")}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-40"
                    style={{ background: "hsl(194 100% 50% / 0.10)", border: "1px solid hsl(194 100% 50% / 0.25)", color: "hsl(194 100% 65%)" }}>
                    <SkipForward className="w-3.5 h-3.5" />Step Next
                  </button>
                  {canPause && (
                    <button type="button" disabled={busy} onClick={() => void planAction("pause")}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-40"
                      style={{ background: "hsl(264 80% 60% / 0.10)", border: "1px solid hsl(264 80% 60% / 0.25)", color: "hsl(264 80% 70%)" }}>
                      <PauseCircle className="w-3.5 h-3.5" />Pause
                    </button>
                  )}
                  {canResume && (
                    <button type="button" disabled={busy} onClick={() => void planAction("resume")}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-semibold transition-all disabled:opacity-40"
                      style={{ background: "hsl(38 100% 60% / 0.10)", border: "1px solid hsl(38 100% 60% / 0.25)", color: "hsl(38 100% 65%)" }}>
                      <PlayCircle className="w-3.5 h-3.5" />Resume
                    </button>
                  )}
                  <button type="button" onClick={() => void handleClearTasks()}
                    className="flex items-center gap-1 text-xs px-3 py-2 rounded-lg opacity-40 hover:opacity-70 transition-opacity ml-auto"
                    style={{ color: "hsl(355 80% 60%)", border: "1px solid hsl(355 80% 60% / 0.2)" }}>
                    Clear
                  </button>
                </div>

                {/* Plan state badge */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] font-mono" style={{
                    color: isRunning ? "hsl(38 100% 60%)" : isPaused ? "hsl(264 80% 70%)"
                      : planState === "completed" ? "hsl(142 71% 55%)" : "hsl(210 15% 45%)",
                  }}>
                    {isRunning ? "● RUNNING" : isPaused ? "⏸ PAUSED" : planState === "completed" ? "✓ COMPLETED" : "○ " + planState.toUpperCase()}
                  </span>
                  {orchestrationId && (
                    <span className="text-[9px] font-mono opacity-30" style={{ color: "hsl(210 15% 55%)" }}>
                      {orchestrationId.slice(0, 8)}
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Active agent banner */}
            {activeAgentId && activeTask && (
              <ActiveAgentBanner agentId={activeAgentId} taskTitle={activeTask.title} />
            )}

            {/* Summary */}
            {summary && (summary.state === "completed" || summary.state === "failed" || summary.state === "paused") && (
              <section>
                <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2"
                  style={{ color: "hsl(196 30% 45%)" }}>Run Summary</h3>
                <SummaryPanel summary={summary} />
              </section>
            )}

            {/* Context bus */}
            {ctx && (
              <section>
                <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2"
                  style={{ color: "hsl(196 30% 45%)" }}>Context</h3>
                <ContextWidget ctx={ctx} />
              </section>
            )}

            {/* Task graph */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest"
                  style={{ color: "hsl(196 30% 45%)" }}>Tasks ({tasks.length})</h3>
              </div>
              {tasks.length === 0 ? (
                <div className="rounded-lg p-6 text-center" style={{ background: "hsl(220 20% 6%)", border: "1px dashed hsl(220 15% 18%)" }}>
                  <Network className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "hsl(194 100% 55%)" }} />
                  <p className="text-xs opacity-40" style={{ color: "hsl(210 15% 60%)" }}>Enter a goal above to create a task graph.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {approvalTasks.length > 0 && (
                    <>
                      <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(264 80% 70%)" }}>⚠ Awaiting Approval</p>
                      {approvalTasks.map(t => <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRunTask} onCancel={handleCancel} busy={busy} activeTaskId={activeTaskId} />)}
                    </>
                  )}
                  {runningTasks.length > 0 && (
                    <>
                      <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(38 100% 60%)" }}>● Running</p>
                      {runningTasks.map(t => <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRunTask} onCancel={handleCancel} busy={busy} activeTaskId={activeTaskId} />)}
                    </>
                  )}
                  {pendingTasks.length > 0 && (
                    <>
                      <p className="text-[9px] font-mono uppercase tracking-widest opacity-50" style={{ color: "hsl(210 15% 55%)" }}>Pending</p>
                      {pendingTasks.map(t => <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRunTask} onCancel={handleCancel} busy={busy} activeTaskId={activeTaskId} />)}
                    </>
                  )}
                  {failedTasks.length > 0 && (
                    <>
                      <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(355 80% 60%)" }}>Failed</p>
                      {failedTasks.map(t => <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRunTask} onCancel={handleCancel} busy={busy} activeTaskId={activeTaskId} />)}
                    </>
                  )}
                  {blockedTasks.length > 0 && (
                    <>
                      <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "hsl(355 60% 45%)" }}>Blocked</p>
                      {blockedTasks.map(t => <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRunTask} onCancel={handleCancel} busy={busy} activeTaskId={activeTaskId} />)}
                    </>
                  )}
                  {doneTasks.length > 0 && (
                    <>
                      <p className="text-[9px] font-mono uppercase tracking-widest opacity-50" style={{ color: "hsl(142 71% 55%)" }}>Done</p>
                      {doneTasks.map(t => <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRunTask} onCancel={handleCancel} busy={busy} activeTaskId={activeTaskId} />)}
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ── AGENTS VIEW ───────────────────────────────────────────────── */}
        {view === "agents" && (
          <div className="space-y-3">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest"
              style={{ color: "hsl(196 30% 45%)" }}>Registered Agents ({agents.length})</h3>
            {agents.map(agent => (
              <div key={agent.id} className="rounded-lg border overflow-hidden"
                style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(220 15% 15%)" }}>
                <button type="button"
                  onClick={() => setExpandedAgent(v => v === agent.id ? null : agent.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/5 transition-colors">
                  <span style={{ color: "hsl(194 100% 55%)" }}>{agentIcon(agent.id)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold" style={{ color: "hsl(196 50% 85%)" }}>{agent.name}</span>
                      {modeBadge(agent.executionMode)}{riskBadge(agent.riskLimit)}
                    </div>
                    <p className="text-[10px] opacity-60 mt-0.5" style={{ color: "hsl(210 15% 65%)" }}>{agent.role}</p>
                  </div>
                  {expandedAgent === agent.id ? <ChevronDown className="w-3 h-3 opacity-40" style={{ color: "hsl(194 100% 55%)" }} /> : <ChevronRight className="w-3 h-3 opacity-40" style={{ color: "hsl(194 100% 55%)" }} />}
                </button>
                {expandedAgent === agent.id && (
                  <div className="px-3 pb-3 border-t" style={{ borderColor: "hsl(220 15% 13%)" }}>
                    <p className="text-[10px] mt-2 mb-2 leading-relaxed" style={{ color: "hsl(210 15% 55%)" }}>{agent.description}</p>
                    <p className="text-[9px] font-mono uppercase tracking-widest mb-1 opacity-50" style={{ color: "hsl(196 30% 55%)" }}>Permissions</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {agent.permissions.map(p => (
                        <span key={p} className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                          style={{ background: "hsl(194 100% 50% / 0.08)", color: "hsl(194 100% 60%)", border: "1px solid hsl(194 100% 50% / 0.2)" }}>
                          {p}
                        </span>
                      ))}
                    </div>
                    <p className="text-[9px] font-mono uppercase tracking-widest mb-1 opacity-50" style={{ color: "hsl(196 30% 55%)" }}>Capabilities</p>
                    <ul className="space-y-0.5">
                      {agent.capabilities.map((c, i) => (
                        <li key={i} className="text-[10px] flex gap-1" style={{ color: "hsl(210 15% 55%)" }}>
                          <span className="opacity-40">·</span>{c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
            {denials.length > 0 && (
              <div className="mt-4">
                <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: "hsl(196 30% 45%)" }}>
                  <Shield className="w-3 h-3" style={{ color: "hsl(355 80% 60%)" }} />Permission Denials
                </h3>
                {denials.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[10px] font-mono mb-1"
                    style={{ background: "hsl(355 30% 8%)", border: "1px solid hsl(355 80% 55% / 0.15)" }}>
                    <XCircle className="w-3 h-3" style={{ color: "hsl(355 80% 60%)" }} />
                    <span style={{ color: "hsl(355 80% 70%)" }}>{d.agentId}</span>
                    <span className="opacity-40">→</span>
                    <span style={{ color: "hsl(38 100% 65%)" }}>{d.action}</span>
                    <span className="ml-auto opacity-40" style={{ color: "hsl(210 15% 55%)" }}>{new Date(d.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TIMELINE VIEW ─────────────────────────────────────────────── */}
        {view === "timeline" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest" style={{ color: "hsl(196 30% 45%)" }}>
                Execution Timeline ({timeline.length})
              </h3>
            </div>
            {timeline.length === 0 ? (
              <div className="rounded-lg p-6 text-center" style={{ background: "hsl(220 20% 6%)", border: "1px dashed hsl(220 15% 18%)" }}>
                <ListOrdered className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "hsl(194 100% 55%)" }} />
                <p className="text-xs opacity-40" style={{ color: "hsl(210 15% 60%)" }}>Timeline appears here once plan starts.</p>
              </div>
            ) : (
              <div className="rounded-lg p-3" style={{ background: "hsl(220 20% 6%)", border: "1px solid hsl(220 15% 13%)" }}>
                <TimelinePanel events={timeline} />
              </div>
            )}
          </div>
        )}

        {/* ── MESSAGES VIEW ─────────────────────────────────────────────── */}
        {view === "messages" && (
          <div className="space-y-3">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest" style={{ color: "hsl(196 30% 45%)" }}>
              Agent Messages ({messages.length})
            </h3>
            {messages.length === 0 ? (
              <p className="text-xs opacity-40 text-center py-8" style={{ color: "hsl(210 15% 60%)" }}>No messages yet.</p>
            ) : (
              <div className="space-y-2">
                {[...messages].reverse().map(m => (
                  <div key={m.id} className="rounded-lg p-2.5 text-[10px]"
                    style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(220 15% 15%)" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ color: "hsl(194 100% 60%)" }} className="flex items-center gap-1">
                        {agentIcon(m.fromAgent)}{m.fromAgent}
                      </span>
                      <span className="opacity-30">→</span>
                      <span style={{ color: "hsl(194 100% 60%)" }} className="flex items-center gap-1">
                        {agentIcon(m.toAgent)}{m.toAgent}
                      </span>
                      <span className="ml-auto font-mono opacity-30" style={{ color: "hsl(210 15% 55%)" }}>
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded mr-2"
                      style={{
                        background: m.risk === "risky" ? "hsl(355 80% 60% / 0.15)" : m.risk === "review" ? "hsl(38 100% 60% / 0.15)" : "hsl(142 71% 55% / 0.15)",
                        color: m.risk === "risky" ? "hsl(355 80% 65%)" : m.risk === "review" ? "hsl(38 100% 65%)" : "hsl(142 71% 60%)",
                      }}>
                      {m.type}
                    </span>
                    <span style={{ color: "hsl(210 15% 65%)" }}>{m.content}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
