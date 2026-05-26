/**
 * routes/intel.ts — Phase 5 Persistent Intelligence Layer endpoints.
 *
 *   GET  /intel/graph                — architecture graph summary
 *   GET  /intel/graph/nodes          — list all nodes (filter: ?type=)
 *   GET  /intel/graph/nodes/:id      — single node + edges
 *   POST /intel/graph/nodes          — upsert a node
 *   GET  /intel/graph/hotspots       — top risk hotspots
 *   GET  /intel/history              — project history (filter: ?type=&file=&limit=)
 *   POST /intel/history              — add a history event
 *   GET  /intel/history/rollbacks    — rollback events only
 *   GET  /intel/decisions            — decision log (filter: ?type=&agentId=&limit=)
 *   POST /intel/decisions            — log a decision
 *   GET  /intel/patterns             — learned patterns (filter: ?type=)
 *   GET  /intel/recommendations      — current recommendations (?files=a,b)
 *   GET  /intel/timeline             — unified project timeline (history + decisions)
 *   GET  /intel/search               — search across all memory (?q=)
 *   POST /intel/compress             — run memory compression
 *   GET  /intel/context              — relevant memory for a task (?files=&issueType=)
 *
 * SAFETY: Memory retrieval is always read-only for agents.
 *         Rollback history cannot be deleted through this API.
 */

import { Router } from "express";
import {
  listNodes, getNode, upsertNode, listEdges, getHotspots, getGraphSummary,
  findNodesByName,
}                          from "../lib/memory/architectureGraph";
import {
  addHistoryEvent, getRecentHistory, getByType, getByFile,
  getRollbackHistory, searchHistory, getEventCounts, totalEvents,
}                          from "../lib/memory/projectHistory";
import {
  logDecision, getDecisions, getRecentDecisions, getCriticalDecisions,
  searchDecisions, totalDecisions,
}                          from "../lib/memory/decisionLog";
import {
  getAllPatterns, getPatternsByType, getRecommendations, searchPatterns,
  totalPatterns, analyzeHistory,
}                          from "../lib/memory/patternLearning";
import {
  runFullCompression, searchAllMemory, getRelevantMemory,
}                          from "../lib/memory/contextCompression";
import { getAllEvents }     from "../lib/memory/projectHistory";
import type { HistoryEventType } from "../lib/memory/projectHistory";
import type { DecisionType }     from "../lib/memory/decisionLog";
import type { PatternType }      from "../lib/memory/patternLearning";
import type { NodeType }         from "../lib/memory/architectureGraph";

const router = Router();

// ─── Architecture graph ───────────────────────────────────────────────────────

router.get("/intel/graph", (_req, res) => {
  res.json({ ok: true, ...getGraphSummary() });
});

router.get("/intel/graph/nodes", (req, res) => {
  const { type, q } = req.query as { type?: string; q?: string };
  const nodes = q
    ? findNodesByName(q)
    : listNodes(type as NodeType | undefined);
  res.json({ ok: true, nodes, total: nodes.length });
});

router.get("/intel/graph/nodes/:id", (req, res) => {
  const node = getNode(req.params.id);
  if (!node) { res.status(404).json({ ok: false, error: "Node not found" }); return; }
  const edges = listEdges(req.params.id);
  const inEdges = listEdges(undefined, req.params.id);
  res.json({ ok: true, node, outEdges: edges, inEdges });
});

router.post("/intel/graph/nodes", (req, res) => {
  const { name, type, path, description, couplingStrength, riskScore, owner } = req.body as {
    name?: string; type?: NodeType; path?: string; description?: string;
    couplingStrength?: number; riskScore?: number; owner?: string;
  };
  if (!name || !type) { res.status(400).json({ ok: false, error: "name and type are required" }); return; }
  const node = upsertNode({
    name, type, path, description, owner,
    couplingStrength: couplingStrength ?? 30,
    riskScore:        riskScore ?? 10,
  });
  res.json({ ok: true, node });
});

router.get("/intel/graph/hotspots", (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "10", 10), 50);
  res.json({ ok: true, hotspots: getHotspots(limit) });
});

// ─── Project history ──────────────────────────────────────────────────────────

router.get("/intel/history", (req, res) => {
  const { type, file, limit } = req.query as { type?: string; file?: string; limit?: string };
  const lim = Math.min(parseInt(limit ?? "50", 10), 200);

  const events = file
    ? getByFile(file, lim)
    : type
      ? getByType(type as HistoryEventType, lim)
      : getRecentHistory(lim);

  res.json({ ok: true, events, total: events.length, globalTotal: totalEvents() });
});

router.post("/intel/history", (req, res) => {
  const { type, description, affectedFiles, errorMessage, resolution, patchId, agentId, orchestrationId } = req.body as {
    type?: string; description?: string; affectedFiles?: string[];
    errorMessage?: string; resolution?: string; patchId?: string;
    agentId?: string; orchestrationId?: string;
  };
  if (!type || !description) { res.status(400).json({ ok: false, error: "type and description are required" }); return; }

  const event = addHistoryEvent({
    type:            type as HistoryEventType,
    description,
    affectedFiles,
    errorMessage,
    resolution,
    patchId,
    agentId,
    orchestrationId,
  });
  res.json({ ok: true, event });
});

router.get("/intel/history/rollbacks", (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
  const rollbacks = getRollbackHistory(limit);
  res.json({ ok: true, events: rollbacks, total: rollbacks.length });
});

// ─── Decision log ─────────────────────────────────────────────────────────────

router.get("/intel/decisions", (req, res) => {
  const { type, agentId, taskId, orchestrationId, critical, limit } = req.query as {
    type?: string; agentId?: string; taskId?: string;
    orchestrationId?: string; critical?: string; limit?: string;
  };
  const lim  = Math.min(parseInt(limit ?? "50", 10), 200);
  const decisions = getDecisions({
    type:            type as DecisionType | undefined,
    agentId,
    taskId,
    orchestrationId,
    critical:        critical === "true" ? true : critical === "false" ? false : undefined,
  }, lim);
  res.json({ ok: true, decisions, total: decisions.length, globalTotal: totalDecisions() });
});

router.post("/intel/decisions", (req, res) => {
  const { type, agentId, taskId, patchId, orchestrationId, reasoning, riskRationale, outcome } = req.body as {
    type?: string; agentId?: string; taskId?: string; patchId?: string;
    orchestrationId?: string; reasoning?: string; riskRationale?: string; outcome?: string;
  };
  if (!type || !reasoning) { res.status(400).json({ ok: false, error: "type and reasoning are required" }); return; }

  const entry = logDecision({
    type:            type as DecisionType,
    agentId, taskId, patchId, orchestrationId,
    reasoning, riskRationale, outcome,
  });
  res.json({ ok: true, entry });
});

// ─── Patterns ─────────────────────────────────────────────────────────────────

router.get("/intel/patterns", (req, res) => {
  const { type } = req.query as { type?: string };
  const patterns = type
    ? getPatternsByType(type as PatternType)
    : getAllPatterns();
  res.json({ ok: true, patterns, total: patterns.length });
});

router.get("/intel/recommendations", (req, res) => {
  const { files } = req.query as { files?: string };
  const fileList  = files ? files.split(",").map(f => f.trim()).filter(Boolean) : [];
  const recs = getRecommendations({ files: fileList });
  res.json({ ok: true, recommendations: recs });
});

router.post("/intel/patterns/analyze", (_req, res) => {
  const history  = getAllEvents();
  const patterns = analyzeHistory(history);
  res.json({ ok: true, patterns, total: patterns.length });
});

// ─── Timeline ─────────────────────────────────────────────────────────────────

router.get("/intel/timeline", (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? "60", 10), 200);
  const history   = getRecentHistory(Math.floor(limit / 2));
  const decisions = getRecentDecisions(Math.floor(limit / 2));

  const timeline = [
    ...history.map(h => ({ kind: "history" as const, timestamp: h.timestamp, type: h.type, text: h.description, agentId: h.agentId })),
    ...decisions.map(d => ({ kind: "decision" as const, timestamp: d.timestamp, type: d.type, text: d.reasoning.slice(0, 120), agentId: d.agentId })),
  ].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);

  res.json({ ok: true, timeline, total: timeline.length });
});

// ─── Search ───────────────────────────────────────────────────────────────────

router.get("/intel/search", (req, res) => {
  const { q } = req.query as { q?: string };
  if (!q?.trim()) { res.status(400).json({ ok: false, error: "q is required" }); return; }
  const results = searchAllMemory(q.trim());
  res.json({ ok: true, query: q, ...results });
});

// ─── Compression ─────────────────────────────────────────────────────────────

router.post("/intel/compress", (_req, res) => {
  const result = runFullCompression();
  res.json({ ok: true, ...result });
});

// ─── Context retrieval (for agent injection) ──────────────────────────────────

router.get("/intel/context", (req, res) => {
  const { files, issueType, taskCategory, agentId } = req.query as {
    files?: string; issueType?: string; taskCategory?: string; agentId?: string;
  };
  const fileList = files ? files.split(",").map(f => f.trim()).filter(Boolean) : [];
  const memory = getRelevantMemory({ files: fileList, issueType, taskCategory, agentId });
  res.json({ ok: true, ...memory });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

router.get("/intel/stats", (_req, res) => {
  const graph   = getGraphSummary();
  const counts  = getEventCounts();
  res.json({
    ok: true,
    architecture: { nodes: graph.nodeCount, edges: graph.edgeCount, byType: graph.byType },
    history:   { total: totalEvents(), byType: counts },
    decisions: { total: totalDecisions() },
    patterns:  { total: totalPatterns() },
  });
});

export default router;
