/**
 * components/IntelPanel.tsx — Phase 5 Persistent Intelligence Layer UI.
 *
 * Views:
 *   Graph     — architecture nodes by type, risk hotspots highlighted
 *   History   — fix/rollback/error event log
 *   Patterns  — learned patterns and recommendations
 *   Decisions — agent decision reasoning log
 *   Search    — unified memory search
 */

import { useState, useEffect, useCallback } from "react";
import {
  Brain, Network, History, Lightbulb, GitCommit,
  Search, RefreshCw, AlertTriangle, CheckCircle,
  XCircle, RotateCcw, Zap, Shield, Clock, BarChart3,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown,
} from "lucide-react";

const BASE      = import.meta.env.BASE_URL;
const INTEL_URL = `${BASE}api/intel`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArchNode {
  id: string; type: string; name: string; path?: string;
  couplingStrength: number; riskScore: number; description?: string;
}

interface HistoryEvent {
  id: string; type: string; timestamp: number; description: string;
  affectedFiles?: string[]; errorMessage?: string; resolution?: string;
  agentId?: string; isRollback?: boolean;
}

interface Pattern {
  id: string; type: string; description: string; affectedFiles?: string[];
  occurrenceCount: number; confidence: number; riskAdjustment: number;
  recommendation: string;
}

interface DecisionEntry {
  id: string; type: string; timestamp: number; agentId?: string;
  reasoning: string; riskRationale?: string; outcome?: string;
  critical?: boolean;
}

interface GraphSummary {
  nodeCount: number; edgeCount: number;
  byType: Record<string, number>;
  hotspots: ArchNode[];
  lastUpdated: number;
}

interface Stats {
  architecture: { nodes: number; edges: number; byType: Record<string, number> };
  history:      { total: number; byType: Record<string, number> };
  decisions:    { total: number };
  patterns:     { total: number };
}

// ─── Styling helpers ──────────────────────────────────────────────────────────

function riskColor(score: number): string {
  return score >= 70 ? "hsl(355 80% 60%)" : score >= 40 ? "hsl(38 100% 60%)" : "hsl(142 71% 55%)";
}

function riskLabel(score: number): string {
  return score >= 70 ? "HIGH" : score >= 40 ? "MED" : "LOW";
}

function nodeTypeColor(type: string): string {
  const m: Record<string, string> = {
    module: "hsl(194 100% 55%)", api: "hsl(264 80% 70%)",
    agent: "hsl(38 100% 60%)", component: "hsl(142 71% 55%)",
    validation: "hsl(194 80% 65%)", autofix: "hsl(355 70% 60%)",
    orchestration: "hsl(264 60% 65%)", dependency: "hsl(196 30% 50%)",
  };
  return m[type] ?? "hsl(210 15% 55%)";
}

function historyTypeIcon(type: string) {
  const cls = "w-3 h-3 flex-shrink-0 mt-0.5";
  if (type.includes("success") || type === "validation_passed") return <CheckCircle className={cls} style={{ color: "hsl(142 71% 55%)" }} />;
  if (type.includes("failure") || type === "validation_failed" || type === "ts_error" || type === "runtime_error") return <XCircle className={cls} style={{ color: "hsl(355 80% 60%)" }} />;
  if (type === "rollback") return <RotateCcw className={cls} style={{ color: "hsl(38 100% 60%)" }} />;
  if (type === "architecture_decision") return <Brain className={cls} style={{ color: "hsl(264 80% 70%)" }} />;
  if (type === "workflow_run") return <Network className={cls} style={{ color: "hsl(194 100% 55%)" }} />;
  return <Clock className={cls} style={{ color: "hsl(210 15% 55%)" }} />;
}

function historyTypeColor(type: string): string {
  if (type.includes("success") || type === "validation_passed") return "hsl(142 71% 55%)";
  if (type.includes("failure") || type.includes("error")) return "hsl(355 80% 60%)";
  if (type === "rollback") return "hsl(38 100% 60%)";
  if (type === "architecture_decision") return "hsl(264 80% 70%)";
  return "hsl(210 15% 55%)";
}

function patternTypeColor(type: string): string {
  if (type === "unstable_file" || type === "recurring_failure") return "hsl(355 80% 60%)";
  if (type === "high_risk_module" || type === "dep_chain_risk") return "hsl(38 100% 60%)";
  if (type === "successful_patch" || type === "recurring_fix") return "hsl(142 71% 55%)";
  return "hsl(194 100% 55%)";
}

function ts(n: number) {
  return new Date(n).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatsBanner({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
      {[
        { label: "NODES",     value: stats.architecture.nodes,  color: "hsl(194 100% 55%)" },
        { label: "EVENTS",    value: stats.history.total,       color: "hsl(264 80% 70%)" },
        { label: "DECISIONS", value: stats.decisions.total,     color: "hsl(38 100% 60%)" },
        { label: "PATTERNS",  value: stats.patterns.total,      color: "hsl(142 71% 55%)" },
      ].map(({ label, value, color }) => (
        <div key={label} className="rounded-lg py-2" style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
          <p className="font-bold text-sm" style={{ color }}>{value}</p>
          <p className="opacity-60 font-mono" style={{ color }}>{label}</p>
        </div>
      ))}
    </div>
  );
}

function NodeCard({ node, expanded, onToggle }: { node: ArchNode; expanded: boolean; onToggle: () => void }) {
  const tc = nodeTypeColor(node.type);
  const rc = riskColor(node.riskScore);
  return (
    <div className="rounded-lg border overflow-hidden" style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(220 15% 14%)" }}>
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors">
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: `${tc}18`, color: tc, border: `1px solid ${tc}30` }}>
          {node.type}
        </span>
        <span className="flex-1 text-xs font-semibold truncate" style={{ color: "hsl(196 50% 85%)" }}>{node.name}</span>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: `${rc}18`, color: rc }}>
          {riskLabel(node.riskScore)} {node.riskScore}
        </span>
        {expanded ? <ChevronDown className="w-3 h-3 opacity-40" style={{ color: tc }} /> : <ChevronRight className="w-3 h-3 opacity-40" style={{ color: tc }} />}
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 border-t space-y-1.5" style={{ borderColor: "hsl(220 15% 12%)" }}>
          {node.description && <p className="text-[10px] mt-2 leading-relaxed" style={{ color: "hsl(210 15% 55%)" }}>{node.description}</p>}
          {node.path && <p className="text-[10px] font-mono opacity-50" style={{ color: "hsl(194 100% 60%)" }}>{node.path}</p>}
          <div className="flex gap-3 text-[10px]">
            <span style={{ color: "hsl(264 80% 70%)" }}>Coupling: {node.couplingStrength}</span>
            <span style={{ color: rc }}>Risk: {node.riskScore}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ ev }: { ev: HistoryEvent }) {
  const [expanded, setExpanded] = useState(false);
  const c = historyTypeColor(ev.type);
  return (
    <div className="rounded border px-2.5 py-2 text-[10px]"
      style={{ background: ev.isRollback ? "hsl(38 100% 60% / 0.06)" : "hsl(220 20% 7%)", borderColor: ev.isRollback ? "hsl(38 100% 60% / 0.2)" : "hsl(220 15% 14%)" }}>
      <div className="flex items-start gap-2">
        {historyTypeIcon(ev.type)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span style={{ color: c }} className="font-mono text-[9px]">{ev.type}</span>
            {ev.agentId && <span className="opacity-40 font-mono" style={{ color: "hsl(194 100% 55%)" }}>[{ev.agentId}]</span>}
            {ev.isRollback && <span className="text-[9px] font-mono px-1 rounded" style={{ background: "hsl(38 100% 60% / 0.15)", color: "hsl(38 100% 65%)" }}>ROLLBACK</span>}
          </div>
          <p className="mt-0.5 leading-relaxed" style={{ color: "hsl(196 50% 75%)" }}>{ev.description}</p>
          {(ev.affectedFiles?.length || ev.errorMessage || ev.resolution) && (
            <button type="button" onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 mt-1 opacity-40 hover:opacity-70 transition-opacity"
              style={{ color: "hsl(194 100% 60%)" }}>
              {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
              Details
            </button>
          )}
          {expanded && (
            <div className="mt-1.5 space-y-1">
              {ev.affectedFiles?.map((f, i) => <p key={i} className="font-mono opacity-60" style={{ color: "hsl(194 100% 60%)" }}>{f}</p>)}
              {ev.errorMessage && <p className="rounded p-1.5 font-mono" style={{ background: "hsl(355 30% 8%)", color: "hsl(355 80% 65%)" }}>{ev.errorMessage.slice(0, 300)}</p>}
              {ev.resolution && <p style={{ color: "hsl(142 71% 60%)" }}>→ {ev.resolution}</p>}
            </div>
          )}
        </div>
        <span className="font-mono opacity-30 flex-shrink-0" style={{ color: "hsl(210 15% 55%)" }}>{ts(ev.timestamp)}</span>
      </div>
    </div>
  );
}

function PatternCard({ p }: { p: Pattern }) {
  const c = patternTypeColor(p.type);
  return (
    <div className="rounded-lg border p-3 space-y-1.5"
      style={{ background: `${c}06`, borderColor: `${c}25` }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${c}18`, color: c }}>{p.type}</span>
        <span className="text-[10px] font-semibold flex-1" style={{ color: "hsl(196 50% 85%)" }}>×{p.occurrenceCount}</span>
        <span className="text-[9px] font-mono opacity-60" style={{ color: c }}>conf {p.confidence}%</span>
        <span className="text-[9px] font-mono" style={{ color: p.riskAdjustment > 0 ? "hsl(355 80% 60%)" : "hsl(142 71% 55%)" }}>
          {p.riskAdjustment > 0 ? <TrendingUp className="w-3 h-3 inline" /> : <TrendingDown className="w-3 h-3 inline" />}
          {p.riskAdjustment > 0 ? "+" : ""}{p.riskAdjustment} risk
        </span>
      </div>
      {p.affectedFiles?.map((f, i) => (
        <p key={i} className="text-[9px] font-mono opacity-60" style={{ color: "hsl(194 100% 60%)" }}>{f.split("/").slice(-2).join("/")}</p>
      ))}
      <p className="text-[10px] leading-relaxed" style={{ color: "hsl(210 15% 65%)" }}>{p.recommendation}</p>
    </div>
  );
}

function DecisionRow({ d }: { d: DecisionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const c = d.critical ? "hsl(355 80% 60%)" : d.type === "patch_approved" ? "hsl(142 71% 55%)" : "hsl(194 100% 55%)";
  return (
    <div className="rounded border px-2.5 py-2 text-[10px]"
      style={{ background: "hsl(220 20% 7%)", borderColor: d.critical ? `${c}30` : "hsl(220 15% 14%)" }}>
      <div className="flex items-start gap-2">
        {d.critical ? <Shield className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: c }} /> : <Zap className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: c }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px]" style={{ color: c }}>{d.type}</span>
            {d.agentId && <span className="opacity-40 font-mono" style={{ color: "hsl(194 100% 55%)" }}>[{d.agentId}]</span>}
            {d.critical && <span className="text-[9px] font-mono px-1 rounded" style={{ background: `${c}15`, color: c }}>CRITICAL</span>}
          </div>
          <p className="mt-0.5 leading-relaxed" style={{ color: "hsl(196 50% 75%)" }}>{d.reasoning.slice(0, 160)}{d.reasoning.length > 160 ? "…" : ""}</p>
          {(d.riskRationale || d.outcome) && (
            <button type="button" onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 mt-1 opacity-40 hover:opacity-70 transition-opacity"
              style={{ color: "hsl(194 100% 60%)" }}>
              {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
              More
            </button>
          )}
          {expanded && (
            <div className="mt-1.5 space-y-1">
              {d.riskRationale && <p style={{ color: "hsl(38 100% 65%)" }}>Risk: {d.riskRationale}</p>}
              {d.outcome && <p style={{ color: "hsl(142 71% 60%)" }}>Outcome: {d.outcome}</p>}
            </div>
          )}
        </div>
        <span className="font-mono opacity-30 flex-shrink-0" style={{ color: "hsl(210 15% 55%)" }}>{ts(d.timestamp)}</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type IntelView = "graph" | "history" | "patterns" | "decisions" | "search";

export default function IntelPanel() {
  const [view, setView]             = useState<IntelView>("graph");
  const [stats, setStats]           = useState<Stats | null>(null);
  const [graph, setGraph]           = useState<GraphSummary | null>(null);
  const [nodes, setNodes]           = useState<ArchNode[]>([]);
  const [history, setHistory]       = useState<HistoryEvent[]>([]);
  const [rollbacks, setRollbacks]   = useState<HistoryEvent[]>([]);
  const [patterns, setPatterns]     = useState<Pattern[]>([]);
  const [decisions, setDecisions]   = useState<DecisionEntry[]>([]);
  const [searchQ, setSearchQ]       = useState("");
  const [searchResults, setSearchResults] = useState<null | {
    history: Array<{ type: string; description: string; timestamp: number }>;
    decisions: Array<{ type: string; reasoning: string; timestamp: number }>;
    patterns: Array<{ type: string; recommendation: string; confidence: number }>;
  }>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [statsRes, graphRes, nodesRes, histRes, rbRes, patRes, decRes] = await Promise.all([
        fetch(`${INTEL_URL}/stats`).then(r => r.json() as Promise<{ ok: boolean } & Stats>),
        fetch(`${INTEL_URL}/graph`).then(r => r.json() as Promise<{ ok: boolean } & GraphSummary>),
        fetch(`${INTEL_URL}/graph/nodes`).then(r => r.json() as Promise<{ ok: boolean; nodes: ArchNode[] }>),
        fetch(`${INTEL_URL}/history?limit=30`).then(r => r.json() as Promise<{ ok: boolean; events: HistoryEvent[] }>),
        fetch(`${INTEL_URL}/history/rollbacks?limit=20`).then(r => r.json() as Promise<{ ok: boolean; events: HistoryEvent[] }>),
        fetch(`${INTEL_URL}/patterns`).then(r => r.json() as Promise<{ ok: boolean; patterns: Pattern[] }>),
        fetch(`${INTEL_URL}/decisions?limit=30`).then(r => r.json() as Promise<{ ok: boolean; decisions: DecisionEntry[] }>),
      ]);
      if (statsRes.ok) setStats(statsRes);
      if (graphRes.ok) setGraph(graphRes);
      if (nodesRes.ok) setNodes(nodesRes.nodes);
      if (histRes.ok) setHistory(histRes.events);
      if (rbRes.ok) setRollbacks(rbRes.events);
      if (patRes.ok) setPatterns(patRes.patterns);
      if (decRes.ok) setDecisions(decRes.decisions);
    } catch { /**/ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSearch = async () => {
    if (!searchQ.trim()) return;
    try {
      const res = await fetch(`${INTEL_URL}/search?q=${encodeURIComponent(searchQ)}`).then(r => r.json() as Promise<{ ok: boolean; history: unknown[]; decisions: unknown[]; patterns: unknown[] }>);
      if (res.ok) setSearchResults(res as typeof searchResults);
    } catch { /**/ }
  };

  const handleAnalyze = async () => {
    try {
      await fetch(`${INTEL_URL}/patterns/analyze`, { method: "POST" });
      await load();
    } catch { /**/ }
  };

  const handleCompress = async () => {
    try {
      await fetch(`${INTEL_URL}/compress`, { method: "POST" });
      await load();
    } catch { /**/ }
  };

  const toggleNode = (id: string) =>
    setExpandedNodes(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const nodeTypes = ["all", ...Array.from(new Set(nodes.map(n => n.type)))];
  const filteredNodes = nodeTypeFilter === "all" ? nodes : nodes.filter(n => n.type === nodeTypeFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full opacity-40" style={{ color: "hsl(194 100% 55%)" }}>
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-mono">Loading intelligence…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid hsl(220 15% 14%)" }}>
        <Brain className="w-4 h-4" style={{ color: "hsl(264 80% 70%)" }} />
        <span className="text-xs font-mono font-semibold tracking-wider" style={{ color: "hsl(264 60% 70%)" }}>INTELLIGENCE</span>
        <div className="flex items-center gap-0.5 ml-2">
          {(["graph", "history", "patterns", "decisions", "search"] as IntelView[]).map(v => {
            const icons: Record<IntelView, React.ReactNode> = {
              graph: <Network className="w-2.5 h-2.5" />, history: <History className="w-2.5 h-2.5" />,
              patterns: <Lightbulb className="w-2.5 h-2.5" />, decisions: <GitCommit className="w-2.5 h-2.5" />,
              search: <Search className="w-2.5 h-2.5" />,
            };
            return (
              <button key={v} type="button" onClick={() => setView(v)}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-all font-mono"
                style={{
                  background: view === v ? "hsl(264 80% 60% / 0.12)" : "transparent",
                  color: view === v ? "hsl(264 60% 75%)" : "hsl(196 30% 45%)",
                  border: `1px solid ${view === v ? "hsl(264 80% 60% / 0.3)" : "transparent"}`,
                }}>
                {icons[v]}{v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <button type="button" onClick={() => void load()} disabled={refreshing}
          className="p-1 rounded opacity-40 hover:opacity-70 transition-opacity disabled:opacity-20"
          style={{ color: "hsl(264 80% 70%)" }}>
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Stats always shown */}
        {stats && <StatsBanner stats={stats} />}

        {/* ── GRAPH VIEW ────────────────────────────────────────────────── */}
        {view === "graph" && (
          <div className="space-y-4">
            {/* Hotspots */}
            {graph && graph.hotspots.length > 0 && (
              <section>
                <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5"
                  style={{ color: "hsl(355 80% 60%)" }}>
                  <AlertTriangle className="w-3 h-3" />Risk Hotspots
                </h3>
                <div className="space-y-1.5">
                  {graph.hotspots.map(n => (
                    <div key={n.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[10px]"
                      style={{ background: "hsl(355 30% 8%)", border: "1px solid hsl(355 80% 55% / 0.2)" }}>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: `${nodeTypeColor(n.type)}18`, color: nodeTypeColor(n.type) }}>
                        {n.type}
                      </span>
                      <span className="flex-1 font-semibold" style={{ color: "hsl(196 50% 80%)" }}>{n.name}</span>
                      <div className="flex gap-1.5">
                        <span style={{ color: riskColor(n.riskScore) }}>risk {n.riskScore}</span>
                        <span className="opacity-40" style={{ color: "hsl(264 80% 70%)" }}>coup {n.couplingStrength}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Node type filter */}
            <div className="flex flex-wrap gap-1">
              {nodeTypes.map(t => (
                <button key={t} type="button" onClick={() => setNodeTypeFilter(t)}
                  className="text-[9px] font-mono px-2 py-0.5 rounded transition-all"
                  style={{
                    background: nodeTypeFilter === t ? `${nodeTypeColor(t)}18` : "transparent",
                    color: nodeTypeFilter === t ? nodeTypeColor(t) : "hsl(196 30% 45%)",
                    border: `1px solid ${nodeTypeFilter === t ? `${nodeTypeColor(t)}35` : "hsl(220 15% 18%)"}`,
                  }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Nodes */}
            <section>
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2"
                style={{ color: "hsl(196 30% 45%)" }}>
                Architecture Nodes ({filteredNodes.length})
              </h3>
              <div className="space-y-1.5">
                {filteredNodes
                  .sort((a, b) => (b.riskScore + b.couplingStrength) - (a.riskScore + a.couplingStrength))
                  .map(n => (
                    <NodeCard key={n.id} node={n}
                      expanded={expandedNodes.has(n.id)}
                      onToggle={() => toggleNode(n.id)} />
                  ))}
              </div>
            </section>

            {/* Graph stats */}
            {graph && (
              <section>
                <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(196 30% 45%)" }}>By Type</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(graph.byType).map(([type, count]) => (
                    <span key={type} className="text-[9px] font-mono px-2 py-1 rounded"
                      style={{ background: `${nodeTypeColor(type)}12`, color: nodeTypeColor(type), border: `1px solid ${nodeTypeColor(type)}25` }}>
                      {type} ({count})
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── HISTORY VIEW ──────────────────────────────────────────────── */}
        {view === "history" && (
          <div className="space-y-4">
            {rollbacks.length > 0 && (
              <section>
                <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5"
                  style={{ color: "hsl(38 100% 60%)" }}>
                  <RotateCcw className="w-3 h-3" />Rollback History (preserved)
                </h3>
                <div className="space-y-1.5">
                  {rollbacks.map(ev => <EventRow key={ev.id} ev={ev} />)}
                </div>
              </section>
            )}
            <section>
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2"
                style={{ color: "hsl(196 30% 45%)" }}>
                Recent Events ({history.length})
              </h3>
              {history.length === 0 ? (
                <div className="rounded-lg p-6 text-center" style={{ background: "hsl(220 20% 6%)", border: "1px dashed hsl(220 15% 18%)" }}>
                  <History className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "hsl(264 80% 70%)" }} />
                  <p className="text-xs opacity-40" style={{ color: "hsl(210 15% 60%)" }}>No history yet. Events are logged automatically as agents run.</p>
                </div>
              ) : (
                <div className="space-y-1.5">{history.map(ev => <EventRow key={ev.id} ev={ev} />)}</div>
              )}
            </section>
            <button type="button" onClick={() => void handleCompress()}
              className="text-[10px] font-mono px-3 py-1.5 rounded-lg opacity-50 hover:opacity-80 transition-opacity"
              style={{ color: "hsl(210 15% 55%)", border: "1px solid hsl(220 15% 18%)" }}>
              Compress memory (remove duplicates, preserve critical)
            </button>
          </div>
        )}

        {/* ── PATTERNS VIEW ─────────────────────────────────────────────── */}
        {view === "patterns" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest flex-1"
                style={{ color: "hsl(196 30% 45%)" }}>Learned Patterns ({patterns.length})</h3>
              <button type="button" onClick={() => void handleAnalyze()}
                className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg transition-all"
                style={{ background: "hsl(142 71% 45% / 0.10)", border: "1px solid hsl(142 71% 45% / 0.25)", color: "hsl(142 71% 60%)" }}>
                <BarChart3 className="w-3 h-3" />Re-analyze
              </button>
            </div>
            {patterns.length === 0 ? (
              <div className="rounded-lg p-6 text-center" style={{ background: "hsl(220 20% 6%)", border: "1px dashed hsl(220 15% 18%)" }}>
                <Lightbulb className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "hsl(264 80% 70%)" }} />
                <p className="text-xs opacity-40" style={{ color: "hsl(210 15% 60%)" }}>No patterns detected yet. Run Re-analyze after building up event history.</p>
              </div>
            ) : (
              <div className="space-y-2">{patterns.map(p => <PatternCard key={p.id} p={p} />)}</div>
            )}
          </div>
        )}

        {/* ── DECISIONS VIEW ────────────────────────────────────────────── */}
        {view === "decisions" && (
          <div className="space-y-4">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest"
              style={{ color: "hsl(196 30% 45%)" }}>Decision Log ({decisions.length})</h3>
            {decisions.length === 0 ? (
              <div className="rounded-lg p-6 text-center" style={{ background: "hsl(220 20% 6%)", border: "1px dashed hsl(220 15% 18%)" }}>
                <GitCommit className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "hsl(264 80% 70%)" }} />
                <p className="text-xs opacity-40" style={{ color: "hsl(210 15% 60%)" }}>Decisions are logged automatically as agents run and complete tasks.</p>
              </div>
            ) : (
              <div className="space-y-1.5">{decisions.map(d => <DecisionRow key={d.id} d={d} />)}</div>
            )}
          </div>
        )}

        {/* ── SEARCH VIEW ───────────────────────────────────────────────── */}
        {view === "search" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                placeholder="Search across all memory — files, errors, decisions, patterns…"
                className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
                style={{ background: "hsl(220 20% 7%)", border: "1px solid hsl(220 15% 18%)", color: "hsl(196 50% 80%)" }}
                onKeyDown={e => { if (e.key === "Enter") void handleSearch(); }} />
              <button type="button" onClick={() => void handleSearch()}
                disabled={!searchQ.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all"
                style={{ background: "hsl(264 80% 60% / 0.12)", border: "1px solid hsl(264 80% 60% / 0.3)", color: "hsl(264 60% 75%)" }}>
                <Search className="w-3.5 h-3.5" />Search
              </button>
            </div>

            {searchResults && (
              <div className="space-y-4">
                {searchResults.history.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(196 30% 45%)" }}>
                      History ({searchResults.history.length})
                    </h3>
                    {searchResults.history.map((h, i) => (
                      <div key={i} className="rounded border px-2.5 py-2 text-[10px] mb-1.5"
                        style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(220 15% 14%)" }}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono opacity-50" style={{ color: "hsl(194 100% 55%)" }}>{h.type}</span>
                          <span className="flex-1" style={{ color: "hsl(196 50% 75%)" }}>{h.description}</span>
                          <span className="opacity-30 font-mono" style={{ color: "hsl(210 15% 55%)" }}>{ts(h.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </section>
                )}
                {searchResults.decisions.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(196 30% 45%)" }}>
                      Decisions ({searchResults.decisions.length})
                    </h3>
                    {searchResults.decisions.map((d, i) => (
                      <div key={i} className="rounded border px-2.5 py-2 text-[10px] mb-1.5"
                        style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(220 15% 14%)" }}>
                        <span className="font-mono opacity-50 mr-2" style={{ color: "hsl(264 80% 70%)" }}>{d.type}</span>
                        <span style={{ color: "hsl(196 50% 75%)" }}>{d.reasoning.slice(0, 140)}</span>
                      </div>
                    ))}
                  </section>
                )}
                {searchResults.patterns.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(196 30% 45%)" }}>
                      Patterns ({searchResults.patterns.length})
                    </h3>
                    {searchResults.patterns.map((p, i) => (
                      <div key={i} className="rounded border px-2.5 py-2 text-[10px] mb-1.5"
                        style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(220 15% 14%)" }}>
                        <span className="font-mono opacity-50 mr-2" style={{ color: patternTypeColor(p.type) }}>{p.type}</span>
                        <span style={{ color: "hsl(196 50% 75%)" }}>{p.recommendation}</span>
                        <span className="ml-2 opacity-40" style={{ color: "hsl(142 71% 55%)" }}>{p.confidence}%</span>
                      </div>
                    ))}
                  </section>
                )}
                {searchResults.history.length === 0 && searchResults.decisions.length === 0 && searchResults.patterns.length === 0 && (
                  <p className="text-xs text-center opacity-40 py-6" style={{ color: "hsl(210 15% 60%)" }}>No results found for "{searchQ}"</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
