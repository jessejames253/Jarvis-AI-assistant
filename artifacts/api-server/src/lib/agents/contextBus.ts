/**
 * lib/agents/contextBus.ts — Phase 4 shared context bus.
 *
 * Aggregates state from all subsystems (health, patches, task graph,
 * autofix, permissions) into a single snapshot. Agents use this to
 * understand the current project state before making decisions.
 */

import { getHealth }            from "../dev/health";
import { pendingPatches }       from "../dev/tools";
import { getLastAutoFixResult } from "../dev/autoFixEngine";
import { getTaskGraph }         from "./taskGraph";
import { listAgents }           from "./registry";
import { getPermissionDenials } from "./permissions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SharedContext {
  projectHealth: {
    score:    number;
    label:    string;
  };
  patches: {
    pending: number;
    files:   string[];
  };
  taskGraph: {
    total:   number;
    pending: number;
    running: number;
    done:    number;
    failed:  number;
    ready:   number;
  };
  agents: {
    count: number;
    ids:   string[];
  };
  autoFix: {
    hasResult:              boolean;
    autoApplied:            number;
    queued:                 number;
    finalValidationPassed?: boolean;
    ranAt?:                 number;
  };
  recentPermissionDenials: Array<{
    agentId:   string;
    action:    string;
    timestamp: number;
  }>;
  capturedAt: number;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export async function getSharedContext(): Promise<SharedContext> {
  // Project health (best-effort)
  let projectHealth = { score: 0, label: "unknown" };
  try {
    const h = await getHealth(false);
    projectHealth = { score: h.score, label: h.label };
  } catch { /* use defaults */ }

  // Pending patches
  const patchList = Array.from(pendingPatches.values());
  const patches = {
    pending: patchList.length,
    files: [...new Set(patchList.map(p => p.file.split("/").pop() ?? p.file))],
  };

  // Task graph summary
  const allTasks = getTaskGraph();
  const taskGraph = {
    total:   allTasks.length,
    pending: allTasks.filter(t => t.status === "pending").length,
    running: allTasks.filter(t => t.status === "running").length,
    done:    allTasks.filter(t => t.status === "done").length,
    failed:  allTasks.filter(t => t.status === "failed").length,
    ready:   allTasks.filter(t =>
      t.status === "pending" &&
      t.dependencies.every(d => allTasks.find(x => x.id === d)?.status === "done")
    ).length,
  };

  // Registered agents
  const agentList = listAgents();
  const agents = {
    count: agentList.length,
    ids:   agentList.map(a => a.id),
  };

  // AutoFix result
  const afResult = getLastAutoFixResult();
  const autoFix = afResult
    ? {
        hasResult:              true,
        autoApplied:            afResult.autoApplied,
        queued:                 afResult.queued,
        finalValidationPassed:  afResult.finalValidationPassed,
        ranAt:                  afResult.ranAt,
      }
    : { hasResult: false, autoApplied: 0, queued: 0 };

  // Recent permission denials (for security visibility)
  const denials = getPermissionDenials(10).map(e => ({
    agentId:   e.agentId,
    action:    e.action,
    timestamp: e.timestamp,
  }));

  return {
    projectHealth,
    patches,
    taskGraph,
    agents,
    autoFix,
    recentPermissionDenials: denials,
    capturedAt: Date.now(),
  };
}
