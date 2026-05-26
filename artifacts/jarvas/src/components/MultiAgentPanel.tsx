/**
 * components/MultiAgentPanel.tsx — Phase 4 Multi-Agent panel.
 *
 * Shows:
 *  - Registered agents (role, permissions, risk limit)
 *  - Task graph (status, agent, dependencies, run button)
 *  - Orchestrate input (submit a goal → creates PlannerAgent task)
 *  - Shared context bus snapshot (health, patches, autofix)
 *  - Recent permission denials (security visibility)
 */

import { useState, useEffect, useCallback } from "react";
import {
  Network, Play, RefreshCw, XCircle, CheckCircle, Clock,
  AlertTriangle, ChevronDown, ChevronRight, Shield, Zap,
  GitBranch, FlaskConical, Search, Hammer, Send,
} from "lucide-react";

const BASE        = import.meta.env.BASE_URL;
const AGENTS_URL  = `${BASE}api/agents`;
const TASKS_URL   = `${BASE}api/agents/tasks`;
const ORCH_URL    = `${BASE}api/agents/orchestrate`;
const CTX_URL     = `${BASE}api/agents/context`;
const AUDIT_URL   = `${BASE}api/agents/permissions/audit?denied=true&limit=20`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentInfo {
  id:            string;
  name:          string;
  role:          string;
  description:   string;
  capabilities:  string[];
  permissions:   string[];
  riskLimit:     "safe" | "review" | "risky";
  executionMode: "read-only" | "proposal" | "test" | "git";
}

interface AgentTask {
  id:              string;
  title:           string;
  description:     string;
  agentId:         string;
  dependencies:    string[];
  status:          "pending" | "running" | "blocked" | "done" | "failed" | "cancelled";
  priority:        "critical" | "high" | "medium" | "low";
  riskScore:       number;
  retryCount:      number;
  maxRetries:      number;
  result?:         string;
  error?:          string;
  orchestrationId?: string;
  createdAt:       number;
  completedAt?:    number;
}

interface ContextSnapshot {
  projectHealth:  { score: number; label: string };
  patches:        { pending: number; files: string[] };
  taskGraph:      { total: number; pending: number; running: number; done: number; failed: number; ready: number };
  agents:         { count: number; ids: string[] };
  autoFix:        { hasResult: boolean; autoApplied: number; queued: number; finalValidationPassed?: boolean };
  recentPermissionDenials: Array<{ agentId: string; action: string; timestamp: number }>;
  capturedAt:     number;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusColor(status: AgentTask["status"]): string {
  return status === "done"      ? "hsl(142 71% 55%)"
       : status === "running"   ? "hsl(38 100% 60%)"
       : status === "failed"    ? "hsl(355 80% 60%)"
       : status === "cancelled" ? "hsl(210 15% 40%)"
       : status === "blocked"   ? "hsl(38 50% 50%)"
       : "hsl(210 15% 55%)"; // pending
}

function statusIcon(status: AgentTask["status"]) {
  if (status === "done")      return <CheckCircle  className="w-3.5 h-3.5" style={{ color: "hsl(142 71% 55%)" }} />;
  if (status === "running")   return <RefreshCw    className="w-3.5 h-3.5 animate-spin" style={{ color: "hsl(38 100% 60%)" }} />;
  if (status === "failed")    return <XCircle      className="w-3.5 h-3.5" style={{ color: "hsl(355 80% 60%)" }} />;
  if (status === "cancelled") return <XCircle      className="w-3.5 h-3.5" style={{ color: "hsl(210 15% 40%)" }} />;
  return <Clock className="w-3.5 h-3.5" style={{ color: "hsl(210 15% 55%)" }} />;
}

function riskColor(score: number): string {
  return score >= 70 ? "hsl(355 80% 60%)"
       : score >= 40 ? "hsl(38 100% 60%)"
       : "hsl(142 71% 55%)";
}

function riskLimitBadge(limit: AgentInfo["riskLimit"]) {
  const color = limit === "safe" ? "hsl(142 71% 55%)"
              : limit === "review" ? "hsl(38 100% 60%)"
              : "hsl(355 80% 60%)";
  return (
    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
      style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
      {limit.toUpperCase()}
    </span>
  );
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

function executionModeBadge(mode: AgentInfo["executionMode"]) {
  const color = mode === "read-only" ? "hsl(194 100% 55%)"
              : mode === "proposal"  ? "hsl(264 80% 70%)"
              : mode === "test"      ? "hsl(38 100% 60%)"
              : "hsl(142 71% 55%)";
  return (
    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
      style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
      {mode}
    </span>
  );
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  agents,
  allTasks,
  onRun,
  onCancel,
  running,
}: {
  task:     AgentTask;
  agents:   AgentInfo[];
  allTasks: AgentTask[];
  onRun:    (id: string) => void;
  onCancel: (id: string) => void;
  running:  string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const agent = agents.find(a => a.id === task.agentId);
  const canRun = task.status === "pending" &&
    task.dependencies.every(d => allTasks.find(t => t.id === d)?.status === "done");
  const depLabels = task.dependencies.map(d => allTasks.find(t => t.id === d)?.title ?? d.slice(0, 8));

  return (
    <div className="rounded-lg border"
      style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(220 15% 15%)" }}>
      <div className="flex items-start gap-2.5 p-3">
        {/* Status icon */}
        <div className="mt-0.5 flex-shrink-0">{statusIcon(task.status)}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold" style={{ color: "hsl(196 50% 85%)" }}>
              {task.title}
            </span>
            {/* Risk badge */}
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ color: riskColor(task.riskScore), background: `${riskColor(task.riskScore)}18` }}>
              risk {task.riskScore}
            </span>
            {/* Priority */}
            <span className="text-[9px] font-mono opacity-50" style={{ color: "hsl(196 50% 65%)" }}>
              {task.priority}
            </span>
          </div>

          {/* Agent + mode */}
          <div className="flex items-center gap-1.5 mt-1">
            <span style={{ color: "hsl(194 100% 55%)" }}>{agentIcon(task.agentId)}</span>
            <span className="text-[10px] font-mono" style={{ color: "hsl(194 100% 65%)" }}>
              {agent?.name ?? task.agentId}
            </span>
            {agent && executionModeBadge(agent.executionMode)}
          </div>

          {/* Dependencies */}
          {depLabels.length > 0 && (
            <p className="text-[10px] mt-1 opacity-50" style={{ color: "hsl(210 15% 60%)" }}>
              Waits for: {depLabels.join(", ")}
            </p>
          )}

          {/* Expand toggle */}
          {(task.description || task.result || task.error) && (
            <button type="button"
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-[10px] mt-1.5 opacity-50 hover:opacity-80 transition-opacity"
              style={{ color: "hsl(194 100% 65%)" }}>
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded ? "Less" : "Details"}
            </button>
          )}

          {expanded && (
            <div className="mt-2 space-y-1.5">
              {task.description && (
                <p className="text-[10px] leading-relaxed" style={{ color: "hsl(210 15% 60%)" }}>
                  {task.description}
                </p>
              )}
              {task.result && (
                <div className="rounded p-2 text-[10px] leading-relaxed font-mono overflow-x-auto"
                  style={{ background: "hsl(220 20% 5%)", color: "hsl(142 71% 65%)", whiteSpace: "pre-wrap", maxHeight: 200 }}>
                  {task.result.slice(0, 600)}{task.result.length > 600 ? "\n…" : ""}
                </div>
              )}
              {task.error && (
                <div className="rounded p-2 text-[10px] font-mono"
                  style={{ background: "hsl(355 30% 8%)", color: "hsl(355 80% 65%)" }}>
                  {task.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          {canRun && (
            <button type="button"
              disabled={running !== null}
              onClick={() => onRun(task.id)}
              className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-40"
              style={{
                background: "hsl(142 71% 45% / 0.15)",
                color: "hsl(142 71% 65%)",
                border: "1px solid hsl(142 71% 45% / 0.35)",
              }}>
              <Play className="w-2.5 h-2.5" />
              Run
            </button>
          )}
          {task.status === "pending" && (
            <button type="button"
              onClick={() => onCancel(task.id)}
              className="text-[10px] px-2.5 py-1.5 rounded-lg opacity-40 hover:opacity-70 transition-opacity"
              style={{ color: "hsl(355 80% 60%)", border: "1px solid hsl(355 80% 60% / 0.2)" }}>
              Cancel
            </button>
          )}
          {task.status === "failed" && task.retryCount < task.maxRetries && (
            <button type="button"
              onClick={() => onRun(task.id)}
              disabled={running !== null}
              className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-40"
              style={{
                background: "hsl(38 100% 60% / 0.1)",
                color: "hsl(38 100% 65%)",
                border: "1px solid hsl(38 100% 60% / 0.25)",
              }}>
              <RefreshCw className="w-2.5 h-2.5" />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Context widget ───────────────────────────────────────────────────────────

function ContextWidget({ ctx }: { ctx: ContextSnapshot }) {
  const healthColor = ctx.projectHealth.label === "healthy" ? "hsl(142 71% 55%)"
                    : ctx.projectHealth.label === "degraded" ? "hsl(38 100% 60%)"
                    : "hsl(355 80% 60%)";
  return (
    <div className="grid grid-cols-2 gap-2 text-[10px]">
      <div className="rounded-lg p-2.5" style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(220 15% 14%)" }}>
        <p className="font-mono opacity-50 mb-1" style={{ color: "hsl(196 30% 55%)" }}>PROJECT HEALTH</p>
        <p className="text-lg font-bold" style={{ color: healthColor }}>{ctx.projectHealth.score}</p>
        <p className="font-mono capitalize" style={{ color: healthColor }}>{ctx.projectHealth.label}</p>
      </div>
      <div className="rounded-lg p-2.5" style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(220 15% 14%)" }}>
        <p className="font-mono opacity-50 mb-1" style={{ color: "hsl(196 30% 55%)" }}>TASK GRAPH</p>
        <div className="space-y-0.5">
          {[
            ["ready",   ctx.taskGraph.ready,   "hsl(194 100% 60%)"],
            ["running", ctx.taskGraph.running, "hsl(38 100% 60%)"],
            ["done",    ctx.taskGraph.done,    "hsl(142 71% 55%)"],
            ["failed",  ctx.taskGraph.failed,  "hsl(355 80% 60%)"],
          ].map(([label, val, col]) => (
            <div key={label as string} className="flex justify-between">
              <span style={{ color: col as string }}>{label as string}</span>
              <span className="font-mono" style={{ color: col as string }}>{val as number}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg p-2.5" style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(220 15% 14%)" }}>
        <p className="font-mono opacity-50 mb-1" style={{ color: "hsl(196 30% 55%)" }}>PATCHES</p>
        <p className="text-lg font-bold" style={{ color: "hsl(264 80% 70%)" }}>{ctx.patches.pending}</p>
        <p style={{ color: "hsl(264 60% 65%)" }}>pending review</p>
      </div>
      <div className="rounded-lg p-2.5" style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(220 15% 14%)" }}>
        <p className="font-mono opacity-50 mb-1" style={{ color: "hsl(196 30% 55%)" }}>AUTOFIX</p>
        {ctx.autoFix.hasResult ? (
          <>
            <p className="font-mono" style={{ color: "hsl(142 71% 55%)" }}>{ctx.autoFix.autoApplied} applied</p>
            <p className="font-mono" style={{ color: "hsl(38 100% 60%)" }}>{ctx.autoFix.queued} queued</p>
          </>
        ) : (
          <p className="opacity-40" style={{ color: "hsl(210 15% 60%)" }}>no result yet</p>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MultiAgentPanel() {
  const [agents, setAgents]   = useState<AgentInfo[]>([]);
  const [tasks, setTasks]     = useState<AgentTask[]>([]);
  const [ctx, setCtx]         = useState<ContextSnapshot | null>(null);
  const [denials, setDenials] = useState<ContextSnapshot["recentPermissionDenials"]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [goal, setGoal]       = useState("");
  const [orchestrating, setOrchestrating] = useState(false);
  const [orchMessage, setOrchMessage]     = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [aRes, tRes, cRes, dRes] = await Promise.all([
        fetch(AGENTS_URL).then(r => r.json() as Promise<{ ok: boolean; agents: AgentInfo[] }>),
        fetch(TASKS_URL).then(r => r.json() as Promise<{ ok: boolean; tasks: AgentTask[] }>),
        fetch(CTX_URL).then(r => r.json() as Promise<{ ok: boolean; context: ContextSnapshot }>),
        fetch(AUDIT_URL).then(r => r.json() as Promise<{ ok: boolean; entries: ContextSnapshot["recentPermissionDenials"] }>),
      ]);
      if (aRes.ok) setAgents(aRes.agents);
      if (tRes.ok) setTasks(tRes.tasks);
      if (cRes.ok) setCtx(cRes.context);
      if (dRes.ok) setDenials(dRes.entries);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleRun = async (taskId: string) => {
    setRunning(taskId);
    setError(null);
    try {
      await fetch(`${BASE}api/agents/tasks/${taskId}/run`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(null);
    }
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

  const handleOrchestrate = async () => {
    if (!goal.trim()) return;
    setOrchestrating(true);
    setOrchMessage(null);
    try {
      const res = await fetch(ORCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const data = await res.json() as { ok: boolean; message?: string };
      if (data.ok) {
        setOrchMessage(data.message ?? "Orchestration created.");
        setGoal("");
        await refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setOrchestrating(false);
    }
  };

  const handleClearTasks = async () => {
    try {
      await fetch(TASKS_URL, { method: "DELETE" });
      await refresh();
    } catch { /**/ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full opacity-40" style={{ color: "hsl(194 100% 55%)" }}>
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-mono">Loading agents…</span>
      </div>
    );
  }

  const pendingTasks  = tasks.filter(t => t.status === "pending");
  const runningTasks  = tasks.filter(t => t.status === "running");
  const doneTasks     = tasks.filter(t => t.status === "done");
  const failedTasks   = tasks.filter(t => t.status === "failed");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid hsl(220 15% 14%)" }}>
        <Network className="w-4 h-4" style={{ color: "hsl(194 100% 55%)" }} />
        <span className="text-xs font-mono font-semibold tracking-wider" style={{ color: "hsl(196 50% 70%)" }}>
          MULTI-AGENT SYSTEM
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          {runningTasks.length > 0 && (
            <span className="animate-pulse" style={{ color: "hsl(38 100% 60%)" }}>
              ● {runningTasks.length} running
            </span>
          )}
          <span style={{ color: "hsl(210 15% 40%)" }}>{agents.length} agents · {tasks.length} tasks</span>
        </div>
        <button type="button" onClick={() => void refresh()}
          className="p-1 rounded opacity-40 hover:opacity-70 transition-opacity"
          style={{ color: "hsl(194 100% 55%)" }}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: "hsl(355 30% 8%)", border: "1px solid hsl(355 80% 55% / 0.3)", color: "hsl(355 80% 65%)" }}>
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ── Orchestrate input ── */}
        <section>
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2.5"
            style={{ color: "hsl(196 30% 45%)" }}>Orchestrate Goal</h3>
          <div className="flex gap-2">
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="Describe a development goal — PlannerAgent will break it into tasks…"
              rows={2}
              className="flex-1 px-3 py-2 rounded-lg text-xs resize-none outline-none"
              style={{
                background: "hsl(220 20% 7%)",
                border: "1px solid hsl(220 15% 18%)",
                color: "hsl(196 50% 80%)",
              }}
              onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleOrchestrate();
              }}
            />
            <button type="button"
              onClick={() => void handleOrchestrate()}
              disabled={orchestrating || !goal.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40"
              style={{
                background: "hsl(194 100% 50% / 0.12)",
                border: "1px solid hsl(194 100% 50% / 0.3)",
                color: "hsl(194 100% 65%)",
              }}>
              {orchestrating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Plan
            </button>
          </div>
          {orchMessage && (
            <p className="text-[10px] mt-2 px-2 py-1 rounded" style={{ background: "hsl(142 71% 45% / 0.08)", color: "hsl(142 71% 60%)" }}>
              ✓ {orchMessage}
            </p>
          )}
        </section>

        {/* ── Context bus ── */}
        {ctx && (
          <section>
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2.5"
              style={{ color: "hsl(196 30% 45%)" }}>Shared Context</h3>
            <ContextWidget ctx={ctx} />
          </section>
        )}

        {/* ── Agents grid ── */}
        <section>
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2.5"
            style={{ color: "hsl(196 30% 45%)" }}>Registered Agents ({agents.length})</h3>
          <div className="space-y-1.5">
            {agents.map(agent => (
              <div key={agent.id}
                className="rounded-lg border overflow-hidden cursor-pointer"
                style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(220 15% 15%)" }}>
                <button type="button"
                  onClick={() => setExpandedAgent(v => v === agent.id ? null : agent.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/5 transition-colors">
                  <span style={{ color: "hsl(194 100% 55%)" }}>{agentIcon(agent.id)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold" style={{ color: "hsl(196 50% 85%)" }}>{agent.name}</span>
                      {executionModeBadge(agent.executionMode)}
                      {riskLimitBadge(agent.riskLimit)}
                    </div>
                    <p className="text-[10px] opacity-60 mt-0.5" style={{ color: "hsl(210 15% 65%)" }}>
                      {agent.role}
                    </p>
                  </div>
                  <div className="text-[10px] font-mono opacity-40" style={{ color: "hsl(210 15% 60%)" }}>
                    {agent.permissions.length}p
                  </div>
                  {expandedAgent === agent.id
                    ? <ChevronDown className="w-3 h-3 opacity-40" style={{ color: "hsl(194 100% 55%)" }} />
                    : <ChevronRight className="w-3 h-3 opacity-40" style={{ color: "hsl(194 100% 55%)" }} />}
                </button>

                {expandedAgent === agent.id && (
                  <div className="px-3 pb-3 border-t" style={{ borderColor: "hsl(220 15% 13%)" }}>
                    <p className="text-[10px] mt-2 mb-2 leading-relaxed" style={{ color: "hsl(210 15% 55%)" }}>
                      {agent.description}
                    </p>
                    <div className="mb-2">
                      <p className="text-[9px] font-mono uppercase tracking-widest mb-1 opacity-50" style={{ color: "hsl(196 30% 55%)" }}>
                        Permissions
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {agent.permissions.map(p => (
                          <span key={p} className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                            style={{ background: "hsl(194 100% 50% / 0.08)", color: "hsl(194 100% 60%)", border: "1px solid hsl(194 100% 50% / 0.2)" }}>
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-mono uppercase tracking-widest mb-1 opacity-50" style={{ color: "hsl(196 30% 55%)" }}>
                        Capabilities
                      </p>
                      <ul className="space-y-0.5">
                        {agent.capabilities.map((c, i) => (
                          <li key={i} className="text-[10px] flex gap-1" style={{ color: "hsl(210 15% 55%)" }}>
                            <span className="opacity-40">·</span>{c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Task graph ── */}
        <section>
          <div className="flex items-center gap-2 mb-2.5">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest"
              style={{ color: "hsl(196 30% 45%)" }}>Task Graph ({tasks.length})</h3>
            <div className="flex-1" />
            {tasks.length > 0 && (
              <button type="button" onClick={() => void handleClearTasks()}
                className="text-[10px] px-2 py-0.5 rounded opacity-40 hover:opacity-70 transition-opacity"
                style={{ color: "hsl(355 80% 60%)", border: "1px solid hsl(355 80% 60% / 0.2)" }}>
                Clear all
              </button>
            )}
          </div>

          {tasks.length === 0 ? (
            <div className="rounded-lg p-6 text-center"
              style={{ background: "hsl(220 20% 6%)", border: "1px dashed hsl(220 15% 18%)" }}>
              <Network className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "hsl(194 100% 55%)" }} />
              <p className="text-xs opacity-40" style={{ color: "hsl(210 15% 60%)" }}>
                No tasks yet — enter a goal above to create a task graph.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* Group by status for clarity */}
              {runningTasks.length > 0 && (
                <p className="text-[9px] font-mono uppercase tracking-widest opacity-50 mt-3 mb-1" style={{ color: "hsl(38 100% 60%)" }}>
                  Running
                </p>
              )}
              {runningTasks.map(t => (
                <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRun} onCancel={handleCancel} running={running} />
              ))}

              {pendingTasks.length > 0 && (
                <p className="text-[9px] font-mono uppercase tracking-widest opacity-50 mt-3 mb-1" style={{ color: "hsl(210 15% 55%)" }}>
                  Pending
                </p>
              )}
              {pendingTasks.map(t => (
                <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRun} onCancel={handleCancel} running={running} />
              ))}

              {failedTasks.length > 0 && (
                <p className="text-[9px] font-mono uppercase tracking-widest opacity-50 mt-3 mb-1" style={{ color: "hsl(355 80% 60%)" }}>
                  Failed
                </p>
              )}
              {failedTasks.map(t => (
                <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRun} onCancel={handleCancel} running={running} />
              ))}

              {doneTasks.length > 0 && (
                <p className="text-[9px] font-mono uppercase tracking-widest opacity-50 mt-3 mb-1" style={{ color: "hsl(142 71% 55%)" }}>
                  Done
                </p>
              )}
              {doneTasks.map(t => (
                <TaskCard key={t.id} task={t} agents={agents} allTasks={tasks} onRun={handleRun} onCancel={handleCancel} running={running} />
              ))}
            </div>
          )}
        </section>

        {/* ── Permission denials ── */}
        {denials.length > 0 && (
          <section>
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2.5 flex items-center gap-1.5"
              style={{ color: "hsl(196 30% 45%)" }}>
              <Shield className="w-3 h-3" style={{ color: "hsl(355 80% 60%)" }} />
              Recent Permission Denials
            </h3>
            <div className="space-y-1">
              {denials.map((d, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[10px] font-mono"
                  style={{ background: "hsl(355 30% 8%)", border: "1px solid hsl(355 80% 55% / 0.15)" }}>
                  <XCircle className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(355 80% 60%)" }} />
                  <span style={{ color: "hsl(355 80% 70%)" }}>{d.agentId}</span>
                  <span className="opacity-40">→</span>
                  <span style={{ color: "hsl(38 100% 65%)" }}>{d.action}</span>
                  <span className="ml-auto opacity-40" style={{ color: "hsl(210 15% 55%)" }}>
                    {new Date(d.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
