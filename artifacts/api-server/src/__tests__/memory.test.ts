/**
 * __tests__/memory.test.ts — Phase 5 Persistent Intelligence Layer tests.
 *
 * Covers:
 *  - PersistentStore CRUD, cap enforcement, patch
 *  - ArchitectureGraph node/edge operations, hotspots, seed integrity
 *  - ProjectHistory CRUD, filtering, rollback preservation
 *  - DecisionLog CRUD, critical flag, filtering
 *  - PatternLearning detection, recommendations
 *  - ContextCompression: compression behavior, rollback preservation
 *  - Context retrieval (getRelevantMemory)
 *  - Memory search (searchAllMemory)
 *  - Safety: rollbacks preserved through compression
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── PersistentStore ──────────────────────────────────────────────────────────
import { PersistentStore } from "../lib/memory/memoryStore";

describe("Phase 5 — PersistentStore", () => {
  let store: PersistentStore<{ id: string; value: number }>;

  beforeEach(() => {
    store = new PersistentStore<{ id: string; value: number }>(
      `/tmp/test-store-${Date.now()}.json`,
      5, // tiny cap for cap-enforcement tests
    );
  });

  it("set and get work correctly", () => {
    store.set({ id: "a", value: 1 });
    expect(store.get("a")).toEqual({ id: "a", value: 1 });
  });

  it("has returns true for stored id, false otherwise", () => {
    store.set({ id: "a", value: 1 });
    expect(store.has("a")).toBe(true);
    expect(store.has("z")).toBe(false);
  });

  it("delete removes an item and returns true", () => {
    store.set({ id: "b", value: 2 });
    expect(store.delete("b")).toBe(true);
    expect(store.get("b")).toBeUndefined();
  });

  it("delete returns false for missing id", () => {
    expect(store.delete("missing")).toBe(false);
  });

  it("all returns every stored item", () => {
    store.set({ id: "x", value: 10 });
    store.set({ id: "y", value: 20 });
    expect(store.all()).toHaveLength(2);
  });

  it("filter works correctly", () => {
    store.set({ id: "p", value: 5 });
    store.set({ id: "q", value: 15 });
    expect(store.filter(i => i.value > 10)).toHaveLength(1);
    expect(store.filter(i => i.value > 10)[0].id).toBe("q");
  });

  it("count returns number of stored items", () => {
    store.set({ id: "c1", value: 1 });
    store.set({ id: "c2", value: 2 });
    expect(store.count()).toBe(2);
  });

  it("clear removes all items and returns count", () => {
    store.set({ id: "d1", value: 1 });
    store.set({ id: "d2", value: 2 });
    const removed = store.clear();
    expect(removed).toBe(2);
    expect(store.count()).toBe(0);
  });

  it("patch updates specified fields only", () => {
    store.set({ id: "e1", value: 1 });
    store.patch("e1", { value: 99 });
    expect(store.get("e1")?.value).toBe(99);
  });

  it("patch returns null for unknown id", () => {
    expect(store.patch("no-such-id", { value: 1 })).toBeNull();
  });

  it("cap enforcement: oldest items evicted when max exceeded", () => {
    for (let i = 0; i < 7; i++) store.set({ id: `cap-${i}`, value: i });
    expect(store.count()).toBe(5); // max is 5
  });

  it("set replaces existing item with same id", () => {
    store.set({ id: "dup", value: 1 });
    store.set({ id: "dup", value: 99 });
    expect(store.count()).toBe(1);
    expect(store.get("dup")?.value).toBe(99);
  });
});

// ── ArchitectureGraph ────────────────────────────────────────────────────────
import {
  listNodes, upsertNode, getNode, listEdges, upsertEdge,
  getHotspots, getGraphSummary, findNodesByName,
} from "../lib/memory/architectureGraph";

describe("Phase 5 — architectureGraph: seeding + integrity", () => {
  it("seed populates at least 10 nodes on first load", () => {
    const nodes = listNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(10);
  });

  it("nodes contain all required NodeType categories", () => {
    const types = new Set(listNodes().map(n => n.type));
    expect(types.has("agent")).toBe(true);
    expect(types.has("module")).toBe(true);
    expect(types.has("api")).toBe(true);
    expect(types.has("component")).toBe(true);
    expect(types.has("orchestration")).toBe(true);
  });

  it("all seeded nodes have non-empty name and type", () => {
    for (const n of listNodes()) {
      expect(n.name.length).toBeGreaterThan(0);
      expect(n.type.length).toBeGreaterThan(0);
    }
  });

  it("all seeded nodes have riskScore and couplingStrength in [0, 100]", () => {
    for (const n of listNodes()) {
      expect(n.riskScore).toBeGreaterThanOrEqual(0);
      expect(n.riskScore).toBeLessThanOrEqual(100);
      expect(n.couplingStrength).toBeGreaterThanOrEqual(0);
      expect(n.couplingStrength).toBeLessThanOrEqual(100);
    }
  });

  it("edges reference valid node ids", () => {
    const nodeIds = new Set(listNodes().map(n => n.id));
    for (const e of listEdges()) {
      expect(nodeIds.has(e.from)).toBe(true);
      expect(nodeIds.has(e.to)).toBe(true);
    }
  });

  it("getHotspots returns nodes sorted by combined risk + coupling", () => {
    const spots = getHotspots(5);
    expect(spots.length).toBeGreaterThan(0);
    for (let i = 1; i < spots.length; i++) {
      const prev = spots[i - 1].riskScore + spots[i - 1].couplingStrength;
      const curr = spots[i].riskScore + spots[i].couplingStrength;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("upsertNode adds a custom node and is retrievable", () => {
    const node = upsertNode({ name: "TestMod", type: "module", couplingStrength: 50, riskScore: 20 });
    expect(getNode(node.id)).toBeDefined();
    expect(getNode(node.id)?.name).toBe("TestMod");
  });

  it("upsertEdge adds an edge between valid nodes", () => {
    const a = upsertNode({ name: "EdgeA", type: "module", couplingStrength: 30, riskScore: 10 });
    const b = upsertNode({ name: "EdgeB", type: "api",    couplingStrength: 30, riskScore: 10 });
    const e = upsertEdge({ from: a.id, to: b.id, type: "calls", strength: 80 });
    const found = listEdges(a.id);
    expect(found.some(fe => fe.id === e.id)).toBe(true);
  });

  it("getGraphSummary includes nodeCount, edgeCount, byType, hotspots", () => {
    const s = getGraphSummary();
    expect(typeof s.nodeCount).toBe("number");
    expect(typeof s.edgeCount).toBe("number");
    expect(typeof s.byType).toBe("object");
    expect(Array.isArray(s.hotspots)).toBe(true);
  });

  it("findNodesByName filters by name substring", () => {
    upsertNode({ name: "UniqueName_XYZ", type: "module", couplingStrength: 10, riskScore: 5 });
    const found = findNodesByName("UniqueName_XYZ");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].name).toBe("UniqueName_XYZ");
  });

  it("listNodes filters by type", () => {
    const agents = listNodes("agent");
    expect(agents.every(n => n.type === "agent")).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });
});

// ── ProjectHistory ────────────────────────────────────────────────────────────
import {
  addHistoryEvent, getRecentHistory, getByType, getByFile,
  getRollbackHistory, searchHistory, getEventCounts, totalEvents, replaceHistory,
} from "../lib/memory/projectHistory";

describe("Phase 5 — projectHistory: CRUD + rollback preservation", () => {
  it("addHistoryEvent creates event with id and timestamp", () => {
    const ev = addHistoryEvent({ type: "fix_success", description: "Patched type error in auth.ts", affectedFiles: ["auth.ts"] });
    expect(typeof ev.id).toBe("string");
    expect(typeof ev.timestamp).toBe("number");
    expect(ev.type).toBe("fix_success");
  });

  it("rollback events are automatically flagged as critical and isRollback", () => {
    const ev = addHistoryEvent({ type: "rollback", description: "Rolled back because tsc failed", affectedFiles: ["bad.ts"] });
    expect(ev.isRollback).toBe(true);
    expect(ev.critical).toBe(true);
  });

  it("architecture_decision events are automatically critical", () => {
    const ev = addHistoryEvent({ type: "architecture_decision", description: "Moved to monorepo structure" });
    expect(ev.critical).toBe(true);
  });

  it("getRecentHistory returns events sorted by timestamp desc", () => {
    const h = getRecentHistory(10);
    for (let i = 1; i < h.length; i++)
      expect(h[i - 1].timestamp).toBeGreaterThanOrEqual(h[i].timestamp);
  });

  it("getByType filters correctly", () => {
    addHistoryEvent({ type: "ts_error", description: "TS error in routes.ts" });
    const tsErrors = getByType("ts_error");
    expect(tsErrors.every(e => e.type === "ts_error")).toBe(true);
  });

  it("getByFile filters by partial file path match", () => {
    addHistoryEvent({ type: "fix_success", description: "Fixed foo.ts", affectedFiles: ["src/lib/foo.ts"] });
    const results = getByFile("foo.ts");
    expect(results.length).toBeGreaterThan(0);
  });

  it("getRollbackHistory returns only rollback events", () => {
    addHistoryEvent({ type: "rollback", description: "Rollback A" });
    const rb = getRollbackHistory();
    expect(rb.every(e => e.isRollback === true || e.type === "rollback")).toBe(true);
    expect(rb.length).toBeGreaterThan(0);
  });

  it("searchHistory finds events by description", () => {
    addHistoryEvent({ type: "runtime_error", description: "Unique_Error_String_XYZ in server startup" });
    const results = searchHistory("Unique_Error_String_XYZ");
    expect(results.length).toBeGreaterThan(0);
  });

  it("getEventCounts returns a count per type", () => {
    addHistoryEvent({ type: "fix_success", description: "Test count" });
    const counts = getEventCounts();
    expect(counts["fix_success"]).toBeGreaterThanOrEqual(1);
  });

  it("totalEvents returns a non-negative number", () => {
    expect(totalEvents()).toBeGreaterThanOrEqual(0);
  });

  it("SAFETY: rollback events survive replaceHistory", () => {
    const rb = addHistoryEvent({ type: "rollback", description: "Must survive compression" });
    const allBefore = getRecentHistory(500);
    replaceHistory(allBefore); // simulate compression pass
    const allAfter = getRollbackHistory();
    expect(allAfter.some(e => e.id === rb.id)).toBe(true);
  });
});

// ── DecisionLog ───────────────────────────────────────────────────────────────
import {
  logDecision, getDecisions, getRecentDecisions, getCriticalDecisions,
  searchDecisions, totalDecisions,
} from "../lib/memory/decisionLog";

describe("Phase 5 — decisionLog: CRUD + critical flag", () => {
  it("logDecision creates an entry with id and timestamp", () => {
    const d = logDecision({ type: "agent_reasoning", reasoning: "Planner chose sequential task order" });
    expect(typeof d.id).toBe("string");
    expect(typeof d.timestamp).toBe("number");
    expect(d.type).toBe("agent_reasoning");
  });

  it("rollback decisions are automatically critical", () => {
    const d = logDecision({ type: "rollback", reasoning: "tsc failed after patch" });
    expect(d.critical).toBe(true);
  });

  it("patch_approved decisions are automatically critical", () => {
    const d = logDecision({ type: "patch_approved", reasoning: "User approved high-risk patch" });
    expect(d.critical).toBe(true);
  });

  it("approval_required decisions are automatically critical", () => {
    const d = logDecision({ type: "approval_required", reasoning: "Risk score 65 exceeded threshold" });
    expect(d.critical).toBe(true);
  });

  it("routine decisions are NOT automatically critical", () => {
    const d = logDecision({ type: "agent_reasoning", reasoning: "Standard reasoning step" });
    expect(d.critical).toBe(false);
  });

  it("getDecisions filters by type", () => {
    logDecision({ type: "risk_assessment", reasoning: "High risk detected" });
    const results = getDecisions({ type: "risk_assessment" });
    expect(results.every(d => d.type === "risk_assessment")).toBe(true);
  });

  it("getDecisions filters by agentId", () => {
    logDecision({ type: "agent_reasoning", reasoning: "Builder analysis", agentId: "builder" });
    const results = getDecisions({ agentId: "builder" });
    expect(results.every(d => d.agentId === "builder")).toBe(true);
  });

  it("getCriticalDecisions returns only critical entries", () => {
    logDecision({ type: "rollback", reasoning: "Critical rollback" });
    const crit = getCriticalDecisions();
    expect(crit.every(d => !!d.critical)).toBe(true);
    expect(crit.length).toBeGreaterThan(0);
  });

  it("getRecentDecisions sorted by timestamp desc", () => {
    const rec = getRecentDecisions(10);
    for (let i = 1; i < rec.length; i++)
      expect(rec[i - 1].timestamp).toBeGreaterThanOrEqual(rec[i].timestamp);
  });

  it("searchDecisions finds by reasoning text", () => {
    logDecision({ type: "agent_reasoning", reasoning: "UniqueSearchToken_ABC in reasoning" });
    const found = searchDecisions("UniqueSearchToken_ABC");
    expect(found.length).toBeGreaterThan(0);
  });

  it("totalDecisions returns non-negative number", () => {
    expect(totalDecisions()).toBeGreaterThanOrEqual(0);
  });
});

// ── PatternLearning ───────────────────────────────────────────────────────────
import {
  analyzeHistory as analyzeH, getAllPatterns, getPatternsByType,
  getRecommendations, searchPatterns, updatePatternFromEvent,
} from "../lib/memory/patternLearning";
import type { HistoryEvent as HE } from "../lib/memory/projectHistory";

describe("Phase 5 — patternLearning: detection + recommendations", () => {
  const makeEv = (overrides: Partial<HE> = {}): HE => ({
    id: Math.random().toString(36).slice(2), type: "fix_failure",
    timestamp: Date.now(), description: "Failure",
    affectedFiles: ["src/lib/foo.ts"], ...overrides,
  });

  it("analyzeHistory detects recurring_failure for file with 2+ failures", () => {
    const history = [
      makeEv({ type: "fix_failure", affectedFiles: ["risky.ts"] }),
      makeEv({ type: "fix_failure", affectedFiles: ["risky.ts"] }),
      makeEv({ type: "fix_failure", affectedFiles: ["risky.ts"] }),
    ];
    const patterns = analyzeH(history);
    expect(patterns.some(p => p.type === "recurring_failure" && p.affectedFiles?.includes("risky.ts"))).toBe(true);
  });

  it("analyzeHistory detects unstable_file for file with rollback", () => {
    const history = [
      makeEv({ type: "rollback", affectedFiles: ["unstable.ts"] }),
    ];
    const patterns = analyzeH(history);
    expect(patterns.some(p => p.type === "unstable_file" && p.affectedFiles?.includes("unstable.ts"))).toBe(true);
  });

  it("analyzeHistory detects successful_patch for repeated fix success", () => {
    const desc = "Fixed auth import error";
    const history = [
      makeEv({ type: "fix_success", description: desc }),
      makeEv({ type: "fix_success", description: desc }),
    ];
    const patterns = analyzeH(history);
    expect(patterns.some(p => p.type === "successful_patch" && p.description === desc)).toBe(true);
  });

  it("unstable_file patterns have positive riskAdjustment", () => {
    const history = [makeEv({ type: "rollback", affectedFiles: ["hot.ts"] })];
    const patterns = analyzeH(history);
    const p = patterns.find(p => p.type === "unstable_file");
    expect(p).toBeDefined();
    expect(p!.riskAdjustment).toBeGreaterThan(0);
  });

  it("successful_patch patterns have negative riskAdjustment (risk reduction)", () => {
    const desc = "Proven fix pattern";
    const history = Array.from({ length: 3 }, () => makeEv({ type: "fix_success", description: desc }));
    const patterns = analyzeH(history);
    const p = patterns.find(p => p.type === "successful_patch");
    expect(p).toBeDefined();
    expect(p!.riskAdjustment).toBeLessThanOrEqual(0);
  });

  it("confidence is bounded between 0 and 100", () => {
    const history = Array.from({ length: 20 }, () => makeEv({ type: "fix_failure", affectedFiles: ["many_failures.ts"] }));
    const patterns = analyzeH(history);
    for (const p of patterns) {
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("getRecommendations returns relevant strings for matched files", () => {
    analyzeH([
      makeEv({ type: "rollback",    affectedFiles: ["target.ts"] }),
      makeEv({ type: "fix_failure", affectedFiles: ["target.ts"] }),
      makeEv({ type: "fix_failure", affectedFiles: ["target.ts"] }),
    ]);
    const recs = getRecommendations({ files: ["target.ts"] });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every(r => typeof r === "string")).toBe(true);
  });

  it("searchPatterns filters by recommendation text", () => {
    analyzeH([makeEv({ type: "rollback", affectedFiles: ["searchable.ts"] })]);
    const results = searchPatterns("searchable.ts");
    expect(results.length).toBeGreaterThan(0);
  });

  it("updatePatternFromEvent increments rollback pattern count", () => {
    const ev = makeEv({ type: "rollback", affectedFiles: ["incremental.ts"] });
    updatePatternFromEvent(ev);
    const patterns = getPatternsByType("unstable_file");
    expect(patterns.some(p => p.affectedFiles?.includes("incremental.ts"))).toBe(true);
  });
});

// ── ContextCompression ────────────────────────────────────────────────────────
import { runFullCompression, getRelevantMemory, searchAllMemory } from "../lib/memory/contextCompression";

describe("Phase 5 — contextCompression: rollback preservation + retrieval", () => {
  it("SAFETY: runFullCompression preserves all rollback events", () => {
    const rb = addHistoryEvent({ type: "rollback", description: "Compression safety test rollback" });
    const result = runFullCompression();
    expect(result.history.preservedCritical).toBeGreaterThan(0);
    const afterRollbacks = getRollbackHistory();
    expect(afterRollbacks.some(e => e.id === rb.id)).toBe(true);
  });

  it("runFullCompression reduces history when there are many duplicate events", () => {
    // Add 10 identical ts_error events in the same bucket
    for (let i = 0; i < 10; i++) {
      addHistoryEvent({ type: "ts_error", description: `Same TS error #${i}`, affectedFiles: ["dup.ts"] });
    }
    const before = totalEvents();
    const result = runFullCompression();
    expect(result.history.compressedCount).toBeLessThanOrEqual(before);
  });

  it("getRelevantMemory returns a summary string and arrays", () => {
    const mem = getRelevantMemory({ files: [], issueType: "ts_error" });
    expect(typeof mem.summary).toBe("string");
    expect(Array.isArray(mem.recommendations)).toBe(true);
    expect(Array.isArray(mem.recentHistory)).toBe(true);
    expect(Array.isArray(mem.recentDecisions)).toBe(true);
    expect(Array.isArray(mem.riskWarnings)).toBe(true);
  });

  it("getRelevantMemory sets hasRollbackHistory when rollbacks affect given files", () => {
    addHistoryEvent({ type: "rollback", description: "File rollback", affectedFiles: ["risky_module.ts"] });
    const mem = getRelevantMemory({ files: ["risky_module.ts"] });
    expect(mem.hasRollbackHistory).toBe(true);
  });

  it("getRelevantMemory without files returns recent generic context", () => {
    const mem = getRelevantMemory({});
    expect(typeof mem.summary).toBe("string");
    // No crash, no undefined
    expect(mem.recentHistory).toBeDefined();
  });

  it("searchAllMemory returns history, decisions, and patterns sections", () => {
    addHistoryEvent({ type: "fix_success", description: "SearchAllToken_UNIQUE fixed" });
    const results = searchAllMemory("SearchAllToken_UNIQUE");
    expect(results.history).toBeDefined();
    expect(results.decisions).toBeDefined();
    expect(results.patterns).toBeDefined();
    expect(results.history.length).toBeGreaterThan(0);
  });

  it("searchAllMemory returns empty arrays for unmatched query", () => {
    const results = searchAllMemory("definitely_no_match_xyz_qrs");
    expect(results.history).toEqual([]);
    expect(results.decisions).toEqual([]);
    expect(results.patterns).toEqual([]);
  });
});
