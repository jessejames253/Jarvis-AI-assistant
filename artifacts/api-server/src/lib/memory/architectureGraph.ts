/**
 * lib/memory/architectureGraph.ts — Phase 5 persistent architecture graph.
 *
 * Maintains a live graph of:
 *   - modules / API routes / agents / dependencies / UI components
 *   - validation, AutoFix, and orchestration systems
 *
 * Tracks: imports, exports, ownership, coupling strength, risk hotspots.
 *
 * Pre-populated with the known Jarvis architecture on first boot.
 * Persisted to /tmp so the graph survives server restarts.
 */

import { randomUUID }  from "crypto";
import { PersistentStore } from "./memoryStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeType =
  | "module"       // TypeScript source file
  | "api"          // Express route group
  | "agent"        // Registered agent
  | "dependency"   // External npm package
  | "component"    // React UI component
  | "validation"   // Validation / health system
  | "autofix"      // AutoFix system
  | "orchestration"; // Orchestration / execution engine

export type EdgeType =
  | "imports" | "exports" | "depends_on"
  | "owns" | "validates" | "calls" | "orchestrates";

export interface ArchNode {
  id:              string;
  type:            NodeType;
  name:            string;
  path?:           string;
  exports?:        string[];
  imports?:        string[];
  owner?:          string;
  /** How many other nodes directly depend on this one (0-100 normalized). */
  couplingStrength: number;
  /** Historical risk score based on failure frequency (0-100). */
  riskScore:       number;
  description?:    string;
  lastModified?:   number;
  metadata?:       Record<string, unknown>;
}

export interface ArchEdge {
  id:       string;
  from:     string;  // node id
  to:       string;  // node id
  type:     EdgeType;
  strength: number;  // 0-100
  label?:   string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const nodeStore = new PersistentStore<ArchNode>("/tmp/jarvis_arch_nodes.json", 500);
const edgeStore = new PersistentStore<ArchEdge>("/tmp/jarvis_arch_edges.json", 2000);

// ─── Seed with known Jarvis architecture ──────────────────────────────────────

function seedIfEmpty(): void {
  if (nodeStore.count() > 0) return;

  const nodes: Omit<ArchNode, "id">[] = [
    // ── Agents ──────────────────────────────────────────────────────────────
    { type: "agent", name: "PlannerAgent",    path: "src/agents/plannerAgent.ts",    couplingStrength: 50, riskScore: 10, description: "Breaks user goals into task graphs", owner: "orchestrator" },
    { type: "agent", name: "BuilderAgent",    path: "src/agents/builderAgent.ts",    couplingStrength: 60, riskScore: 40, description: "Proposes code patches", owner: "orchestrator" },
    { type: "agent", name: "TesterAgent",     path: "src/agents/testerAgent.ts",     couplingStrength: 50, riskScore: 20, description: "Runs type-check validation", owner: "orchestrator" },
    { type: "agent", name: "ResearchAgent",   path: "src/agents/researchAgent.ts",   couplingStrength: 30, riskScore: 10, description: "Gathers context and insights", owner: "orchestrator" },
    { type: "agent", name: "GitAgent",        path: "src/agents/gitAgent.ts",        couplingStrength: 40, riskScore: 30, description: "Handles checkpoints and rollbacks", owner: "orchestrator" },

    // ── Orchestration ────────────────────────────────────────────────────────
    { type: "orchestration", name: "Orchestrator",     path: "src/lib/agents/orchestrator.ts",    couplingStrength: 90, riskScore: 35, description: "runPlan / stepNext / pause / resume — sequential supervised execution" },
    { type: "orchestration", name: "TaskGraph",        path: "src/lib/agents/taskGraph.ts",       couplingStrength: 80, riskScore: 20, description: "Dependency-aware task graph with 12 status types" },
    { type: "orchestration", name: "AgentRegistry",    path: "src/lib/agents/registry.ts",        couplingStrength: 70, riskScore: 10, description: "Singleton agent registry" },
    { type: "orchestration", name: "ContextBus",       path: "src/lib/agents/contextBus.ts",      couplingStrength: 60, riskScore: 10, description: "Shared context snapshot aggregator" },
    { type: "orchestration", name: "ExecutionState",   path: "src/lib/agents/executionState.ts",  couplingStrength: 50, riskScore: 15, description: "Timeline events and run state management" },

    // ── Modules ──────────────────────────────────────────────────────────────
    { type: "module", name: "Permissions",    path: "src/lib/agents/permissions.ts", couplingStrength: 85, riskScore: 5,  description: "assertPermission + audit log — safety boundary" },
    { type: "module", name: "AgentMessages",  path: "src/lib/agents/agentMessages.ts", couplingStrength: 40, riskScore: 5, description: "Agent-to-agent message bus" },
    { type: "module", name: "RetryPolicy",    path: "src/lib/agents/retryPolicy.ts", couplingStrength: 30, riskScore: 5,  description: "classifyFailure + canRetry + logRetry" },

    // ── Validation / AutoFix ─────────────────────────────────────────────────
    { type: "validation", name: "DevHealth",  path: "src/lib/dev/health.ts",         couplingStrength: 75, riskScore: 20, description: "tsc --noEmit health check, 0-100 score, 30s cache" },
    { type: "autofix",    name: "AutoFix",    path: "src/lib/dev/autofix.ts",         couplingStrength: 65, riskScore: 45, description: "6-gate guarded patch pipeline: snapshot→write→tsc→health→commit/rollback" },
    { type: "module",     name: "Improvements", path: "src/lib/dev/improvements.ts", couplingStrength: 60, riskScore: 40, description: "AI-driven improvement proposal generator" },

    // ── API Routes ───────────────────────────────────────────────────────────
    { type: "api", name: "AgentsAPI",   path: "src/routes/agents.ts",    couplingStrength: 55, riskScore: 20, description: "Phase 4/4B multi-agent REST endpoints" },
    { type: "api", name: "IntelAPI",    path: "src/routes/intel.ts",     couplingStrength: 30, riskScore: 5,  description: "Phase 5 intelligence/memory REST endpoints" },
    { type: "api", name: "DevAPI",      path: "src/routes/dev.ts",       couplingStrength: 50, riskScore: 25, description: "Health, autofix, improvement endpoints" },
    { type: "api", name: "ChatAPI",     path: "src/routes/chat.ts",      couplingStrength: 60, riskScore: 15, description: "Main conversation endpoint" },

    // ── Memory ───────────────────────────────────────────────────────────────
    { type: "module", name: "SessionMemory",    path: "src/lib/memory.ts",                     couplingStrength: 55, riskScore: 10, description: "Chat session LTM, auto-summarization" },
    { type: "module", name: "ArchGraph",        path: "src/lib/memory/architectureGraph.ts",   couplingStrength: 35, riskScore: 5,  description: "Phase 5: live architecture graph" },
    { type: "module", name: "ProjectHistory",   path: "src/lib/memory/projectHistory.ts",      couplingStrength: 35, riskScore: 5,  description: "Phase 5: fix/rollback/error history" },
    { type: "module", name: "PatternLearning",  path: "src/lib/memory/patternLearning.ts",     couplingStrength: 30, riskScore: 5,  description: "Phase 5: pattern detection + recommendations" },
    { type: "module", name: "DecisionLog",      path: "src/lib/memory/decisionLog.ts",         couplingStrength: 30, riskScore: 5,  description: "Phase 5: decision reasoning log" },

    // ── UI Components ─────────────────────────────────────────────────────────
    { type: "component", name: "DevAgentPanel",   path: "jarvas/src/components/DevAgentPanel.tsx",  couplingStrength: 80, riskScore: 10, description: "Main dev overlay panel with 6 tabs" },
    { type: "component", name: "MultiAgentPanel", path: "jarvas/src/components/MultiAgentPanel.tsx", couplingStrength: 50, riskScore: 10, description: "Phase 4B agents/plan/timeline/messages tabs" },
    { type: "component", name: "IntelPanel",      path: "jarvas/src/components/IntelPanel.tsx",     couplingStrength: 35, riskScore: 5,  description: "Phase 5 intelligence/memory panel" },
    { type: "component", name: "Chat",            path: "jarvas/src/components/Chat.tsx",            couplingStrength: 70, riskScore: 10, description: "Main chat UI with speech integration" },
  ];

  const idMap: Record<string, string> = {};
  for (const n of nodes) {
    const node: ArchNode = { ...n, id: randomUUID(), lastModified: Date.now() };
    nodeStore.set(node);
    idMap[n.name] = node.id;
  }

  // Edges — key relationships
  const edges: Array<{ from: string; to: string; type: EdgeType; strength: number; label?: string }> = [
    { from: "Orchestrator",   to: "PlannerAgent",   type: "orchestrates", strength: 90 },
    { from: "Orchestrator",   to: "BuilderAgent",   type: "orchestrates", strength: 85 },
    { from: "Orchestrator",   to: "TesterAgent",    type: "orchestrates", strength: 80 },
    { from: "Orchestrator",   to: "ResearchAgent",  type: "orchestrates", strength: 70 },
    { from: "Orchestrator",   to: "GitAgent",       type: "orchestrates", strength: 75 },
    { from: "Orchestrator",   to: "TaskGraph",      type: "depends_on",   strength: 95 },
    { from: "Orchestrator",   to: "ExecutionState", type: "depends_on",   strength: 80 },
    { from: "Orchestrator",   to: "AgentMessages",  type: "depends_on",   strength: 70 },
    { from: "Orchestrator",   to: "RetryPolicy",    type: "depends_on",   strength: 60 },
    { from: "Orchestrator",   to: "Permissions",    type: "depends_on",   strength: 85 },
    { from: "BuilderAgent",   to: "AutoFix",        type: "calls",        strength: 70 },
    { from: "TesterAgent",    to: "DevHealth",      type: "calls",        strength: 80 },
    { from: "TesterAgent",    to: "AutoFix",        type: "calls",        strength: 65 },
    { from: "GitAgent",       to: "DevHealth",      type: "calls",        strength: 50 },
    { from: "AutoFix",        to: "DevHealth",      type: "depends_on",   strength: 90 },
    { from: "AutoFix",        to: "Improvements",   type: "depends_on",   strength: 80 },
    { from: "AgentsAPI",      to: "Orchestrator",   type: "calls",        strength: 95 },
    { from: "AgentsAPI",      to: "TaskGraph",      type: "calls",        strength: 90 },
    { from: "AgentsAPI",      to: "AgentRegistry",  type: "calls",        strength: 85 },
    { from: "IntelAPI",       to: "ArchGraph",      type: "calls",        strength: 90 },
    { from: "IntelAPI",       to: "ProjectHistory", type: "calls",        strength: 90 },
    { from: "IntelAPI",       to: "PatternLearning",type: "calls",        strength: 85 },
    { from: "IntelAPI",       to: "DecisionLog",    type: "calls",        strength: 85 },
    { from: "DevAPI",         to: "DevHealth",      type: "calls",        strength: 90 },
    { from: "DevAPI",         to: "AutoFix",        type: "calls",        strength: 85 },
    { from: "ChatAPI",        to: "SessionMemory",  type: "depends_on",   strength: 90 },
    { from: "DevAgentPanel",  to: "MultiAgentPanel",type: "owns",         strength: 80 },
    { from: "DevAgentPanel",  to: "IntelPanel",     type: "owns",         strength: 80 },
    { from: "MultiAgentPanel",to: "AgentsAPI",      type: "calls",        strength: 85 },
    { from: "IntelPanel",     to: "IntelAPI",       type: "calls",        strength: 85 },
    { from: "Chat",           to: "ChatAPI",        type: "calls",        strength: 90 },
    { from: "Chat",           to: "SessionMemory",  type: "depends_on",   strength: 70 },
    { from: "Permissions",    to: "AgentRegistry",  type: "validates",    strength: 75 },
    { from: "ContextBus",     to: "DevHealth",      type: "calls",        strength: 70 },
    { from: "ContextBus",     to: "TaskGraph",      type: "calls",        strength: 70 },
  ];

  for (const e of edges) {
    const fromId = idMap[e.from];
    const toId   = idMap[e.to];
    if (!fromId || !toId) continue;
    const { from: _fn, to: _tn, ...rest } = e;
    edgeStore.set({ id: randomUUID(), from: fromId, to: toId, ...rest });
  }
}

seedIfEmpty();

// ─── Node API ─────────────────────────────────────────────────────────────────

export function getNode(id: string): ArchNode | undefined {
  return nodeStore.get(id);
}

export function listNodes(type?: NodeType): ArchNode[] {
  return type ? nodeStore.filter(n => n.type === type) : nodeStore.all();
}

export function upsertNode(params: Omit<ArchNode, "id"> & { id?: string }): ArchNode {
  const id   = params.id ?? randomUUID();
  const node = { ...params, id, lastModified: Date.now() } as ArchNode;
  return nodeStore.set(node);
}

export function updateNodeRisk(id: string, riskDelta: number): ArchNode | null {
  const node = nodeStore.get(id);
  if (!node) return null;
  const newRisk = Math.min(100, Math.max(0, node.riskScore + riskDelta));
  return nodeStore.patch(id, { riskScore: newRisk, lastModified: Date.now() });
}

export function getHotspots(limit = 10): ArchNode[] {
  return nodeStore.all()
    .sort((a, b) => (b.riskScore + b.couplingStrength) - (a.riskScore + a.couplingStrength))
    .slice(0, limit);
}

export function getNodeByPath(path: string): ArchNode | undefined {
  return nodeStore.filter(n => n.path === path)[0];
}

// ─── Edge API ─────────────────────────────────────────────────────────────────

export function listEdges(fromId?: string, toId?: string): ArchEdge[] {
  return edgeStore.filter(e =>
    (!fromId || e.from === fromId) && (!toId || e.to === toId),
  );
}

export function upsertEdge(params: Omit<ArchEdge, "id"> & { id?: string }): ArchEdge {
  const id   = params.id ?? randomUUID();
  const edge = { ...params, id } as ArchEdge;
  return edgeStore.set(edge);
}

export function getGraphSummary(): {
  nodeCount:  number;
  edgeCount:  number;
  byType:     Record<string, number>;
  hotspots:   ArchNode[];
  lastUpdated: number;
} {
  const all    = nodeStore.all();
  const byType = all.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});

  return {
    nodeCount:  nodeStore.count(),
    edgeCount:  edgeStore.count(),
    byType,
    hotspots:   getHotspots(5),
    lastUpdated: all.reduce((max, n) => Math.max(max, n.lastModified ?? 0), 0),
  };
}

export function findNodesByName(query: string): ArchNode[] {
  const q = query.toLowerCase();
  return nodeStore.filter(
    n => n.name.toLowerCase().includes(q) ||
         (n.path?.toLowerCase().includes(q) ?? false) ||
         (n.description?.toLowerCase().includes(q) ?? false),
  );
}
