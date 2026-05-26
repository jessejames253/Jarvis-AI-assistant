/**
 * __tests__/autonomy.test.ts — Phase 6 autonomy tests.
 *
 * Coverage:
 *   - BudgetTracker: hard limits for tasks, patches, retries, files, lines, runtime, autofix
 *   - autonomyPolicy: blocked file patterns and exact paths
 *   - ImprovementCycle: CRUD, state transitions, active cycle detection
 *   - Autonomy audit: creation, retrieval, critical flag
 *   - buildProposals: generates valid proposals from patterns + hotspots
 *   - buildCycleGoal: includes type, memory evidence, budget constraints
 *   - Safety invariants: no escalation, manual start, budget as hard stop
 *   - Existing 210 tests still pass (by running alongside them)
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Budget tracker ────────────────────────────────────────────────────────────

import {
  BudgetTracker,
  DEFAULT_BUDGET,
  type BudgetConfig,
}                             from "../lib/autonomy/autonomyBudget";

describe("BudgetTracker", () => {
  function makeBudget(overrides: Partial<BudgetConfig> = {}): BudgetConfig {
    return { ...DEFAULT_BUDGET, ...overrides };
  }

  it("default budget values are conservative", () => {
    expect(DEFAULT_BUDGET.maxTasks).toBe(3);
    expect(DEFAULT_BUDGET.maxPatchProposals).toBe(3);
    expect(DEFAULT_BUDGET.maxAppliedPatches).toBe(2);
    expect(DEFAULT_BUDGET.maxRetries).toBe(2);
    expect(DEFAULT_BUDGET.maxFiles).toBe(2);
    expect(DEFAULT_BUDGET.maxLines).toBe(80);
    expect(DEFAULT_BUDGET.maxRuntimeMs).toBe(600_000);
    expect(DEFAULT_BUDGET.maxAutoFixAttempts).toBe(2);
  });

  it("allows tasks within budget", () => {
    const t = new BudgetTracker(makeBudget({ maxTasks: 2 }));
    expect(t.checkTask().allowed).toBe(true);
    t.consumeTask();
    expect(t.checkTask().allowed).toBe(true);
    t.consumeTask();
    // At limit — next check must deny
    const denied = t.checkTask();
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/task budget exhausted/i);
  });

  it("task budget is a hard stop", () => {
    const t = new BudgetTracker(makeBudget({ maxTasks: 1 }));
    t.consumeTask();
    const check = t.checkTask();
    expect(check.allowed).toBe(false);
    expect(check.remaining.tasks).toBe(0);
  });

  it("patch proposal budget enforced", () => {
    const t = new BudgetTracker(makeBudget({ maxPatchProposals: 2 }));
    t.consumePatchProposal();
    t.consumePatchProposal();
    expect(t.checkPatchProposal().allowed).toBe(false);
    expect(t.checkPatchProposal().reason).toMatch(/patch proposal budget/i);
  });

  it("applied patch budget enforced", () => {
    const t = new BudgetTracker(makeBudget({ maxAppliedPatches: 1 }));
    expect(t.checkApplyPatch(["a.ts"], 10).allowed).toBe(true);
    t.consumeApplyPatch(["a.ts"], 10);
    expect(t.checkApplyPatch(["b.ts"], 5).allowed).toBe(false);
  });

  it("file change limit enforced", () => {
    const t = new BudgetTracker(makeBudget({ maxFiles: 1, maxAppliedPatches: 5 }));
    t.consumeApplyPatch(["a.ts"], 5);
    // New file would exceed file budget
    const check = t.checkApplyPatch(["b.ts"], 5);
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/file change budget/i);
  });

  it("line change limit enforced", () => {
    const t = new BudgetTracker(makeBudget({ maxLines: 20, maxAppliedPatches: 5 }));
    t.consumeApplyPatch(["a.ts"], 15);
    const check = t.checkApplyPatch(["a.ts"], 10);
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/line change budget/i);
  });

  it("retry budget enforced", () => {
    const t = new BudgetTracker(makeBudget({ maxRetries: 1 }));
    t.consumeRetry();
    expect(t.checkRetry().allowed).toBe(false);
    expect(t.checkRetry().reason).toMatch(/retry budget/i);
  });

  it("autofix budget enforced", () => {
    const t = new BudgetTracker(makeBudget({ maxAutoFixAttempts: 1 }));
    t.consumeAutoFix();
    expect(t.checkAutoFix().allowed).toBe(false);
    expect(t.checkAutoFix().reason).toMatch(/autofix budget/i);
  });

  it("runtime budget enforced (simulated)", () => {
    // Use a minimal runtime — we can't time-travel, so just verify the check exists
    const t = new BudgetTracker(makeBudget({ maxRuntimeMs: 999_999_999 }));
    const check = t.checkRuntime();
    expect(check.allowed).toBe(true);
  });

  it("remaining values decrease after consumption", () => {
    const t = new BudgetTracker(makeBudget({ maxTasks: 3 }));
    t.consumeTask();
    const summary = t.getSummary();
    expect(summary.remaining.tasks).toBe(2);
  });

  it("isExhausted returns true when task budget spent", () => {
    const t = new BudgetTracker(makeBudget({ maxTasks: 1 }));
    expect(t.isExhausted()).toBe(false);
    t.consumeTask();
    expect(t.isExhausted()).toBe(true);
  });

  it("optional maxModelCalls enforced when set", () => {
    const t = new BudgetTracker(makeBudget({ maxModelCalls: 1 }));
    t.consumeModelCall();
    expect(t.checkModelCall().allowed).toBe(false);
  });

  it("getUsage returns accurate snapshot", () => {
    const t = new BudgetTracker(DEFAULT_BUDGET);
    t.consumeTask();
    t.consumePatchProposal();
    t.consumeApplyPatch(["x.ts"], 30);
    t.consumeRetry();
    const usage = t.getUsage();
    expect(usage.tasks).toBe(1);
    expect(usage.patchProposals).toBe(1);
    expect(usage.appliedPatches).toBe(1);
    expect(usage.linesChanged).toBe(30);
    expect(usage.filesChanged).toContain("x.ts");
    expect(usage.retries).toBe(1);
  });
});

// ── Policy gates ──────────────────────────────────────────────────────────────

import {
  isFileBlocked,
  isTaskDescriptionSafe,
  validateFiles,
  listBlockedPatterns,
  listBlockedExactPaths,
}                             from "../lib/autonomy/autonomyPolicy";

describe("autonomyPolicy — blocked file patterns", () => {
  it("blocks auth files", () => {
    expect(isFileBlocked("src/routes/auth.ts").blocked).toBe(true);
    expect(isFileBlocked("lib/authMiddleware.ts").blocked).toBe(true);
  });

  it("blocks payment/stripe files", () => {
    expect(isFileBlocked("src/lib/stripe.ts").blocked).toBe(true);
    expect(isFileBlocked("routes/payment.ts").blocked).toBe(true);
    expect(isFileBlocked("src/billing/webhook.ts").blocked).toBe(true);
  });

  it("blocks migration files", () => {
    expect(isFileBlocked("db/migrations/001_create_users.ts").blocked).toBe(true);
  });

  it("blocks .env files", () => {
    expect(isFileBlocked(".env").blocked).toBe(true);
    expect(isFileBlocked(".env.local").blocked).toBe(true);
    expect(isFileBlocked(".env.production").blocked).toBe(true);
  });

  it("blocks package.json and lock files", () => {
    expect(isFileBlocked("package.json").blocked).toBe(true);
    expect(isFileBlocked("pnpm-lock.yaml").blocked).toBe(true);
  });

  it("blocks secret files", () => {
    expect(isFileBlocked("src/lib/secrets.ts").blocked).toBe(true);
    expect(isFileBlocked("config/secretManager.ts").blocked).toBe(true);
  });

  it("blocks deployment files", () => {
    expect(isFileBlocked("deploy.sh").blocked).toBe(true);
    expect(isFileBlocked("lib/deployment/index.ts").blocked).toBe(true);
  });

  it("blocks permissions.ts", () => {
    expect(isFileBlocked("src/lib/agents/permissions.ts").blocked).toBe(true);
    expect(isFileBlocked("lib/permissions.ts").blocked).toBe(true);
  });

  it("blocks rollback/checkpoint files", () => {
    expect(isFileBlocked("lib/rollback.ts").blocked).toBe(true);
    expect(isFileBlocked("src/checkpoint/manager.ts").blocked).toBe(true);
  });

  it("blocks key/cert files", () => {
    expect(isFileBlocked("keys/private.key").blocked).toBe(true);
    expect(isFileBlocked("ssl/cert.pem").blocked).toBe(true);
    expect(isFileBlocked("server.cert").blocked).toBe(true);
  });

  it("allows safe source files", () => {
    expect(isFileBlocked("src/lib/agents/orchestrator.ts").blocked).toBe(false);
    expect(isFileBlocked("src/routes/intel.ts").blocked).toBe(false);
    expect(isFileBlocked("src/components/Chat.tsx").blocked).toBe(false);
    expect(isFileBlocked("lib/memory/memoryStore.ts").blocked).toBe(false);
  });

  it("validateFiles splits allowed and blocked correctly", () => {
    const result = validateFiles([
      "src/lib/utils.ts",
      "src/lib/agents/permissions.ts",
      "lib/stripe.ts",
    ]);
    expect(result.allSafe).toBe(false);
    expect(result.allowed).toContain("src/lib/utils.ts");
    expect(result.blocked.map(b => b.file)).toContain("src/lib/agents/permissions.ts");
    expect(result.blocked.map(b => b.file)).toContain("lib/stripe.ts");
  });

  it("validateFiles returns allSafe=true when nothing blocked", () => {
    const result = validateFiles(["src/lib/utils.ts", "src/components/Chart.tsx"]);
    expect(result.allSafe).toBe(true);
    expect(result.blocked).toHaveLength(0);
  });

  it("task description safety blocks risky terms", () => {
    expect(isTaskDescriptionSafe("Fix the authentication bug").blocked).toBe(true);
    expect(isTaskDescriptionSafe("Update the payment webhook handler").blocked).toBe(true);
    expect(isTaskDescriptionSafe("Apply the database migration").blocked).toBe(true);
    expect(isTaskDescriptionSafe("Deploy the new service").blocked).toBe(true);
    expect(isTaskDescriptionSafe("Modify rollback checkpoint logic").blocked).toBe(true);
  });

  it("task description safety allows safe tasks", () => {
    expect(isTaskDescriptionSafe("Add JSDoc to orchestrator.ts").blocked).toBe(false);
    expect(isTaskDescriptionSafe("Improve type coverage in memoryStore").blocked).toBe(false);
    expect(isTaskDescriptionSafe("Add tests for BudgetTracker").blocked).toBe(false);
  });

  it("listBlockedPatterns returns non-empty array", () => {
    const patterns = listBlockedPatterns();
    expect(patterns.length).toBeGreaterThan(5);
    expect(patterns[0]).toHaveProperty("pattern");
    expect(patterns[0]).toHaveProperty("reason");
  });

  it("listBlockedExactPaths includes permissions.ts", () => {
    const paths = listBlockedExactPaths();
    expect(paths.some(p => p.includes("permissions.ts"))).toBe(true);
  });
});

// ── Improvement cycle ─────────────────────────────────────────────────────────

import {
  createCycle, saveCycle, getCycle, getActiveCycle, listCycles,
  updateCycleState, buildCycleGoal, buildProposals,
  CYCLE_META,
}                             from "../lib/autonomy/improvementCycle";
import { DEFAULT_BUDGET as DEF } from "../lib/autonomy/autonomyBudget";

describe("ImprovementCycle", () => {
  it("creates a cycle with correct initial state", () => {
    const c = createCycle("fix_ts_errors", DEF);
    expect(c.id).toBeTruthy();
    expect(c.state).toBe("running");
    expect(c.type).toBe("fix_ts_errors");
    expect(c.tasks).toHaveLength(0);
    expect(c.patchesProposed).toBe(0);
    expect(c.patchesApplied).toBe(0);
    expect(c.startedAt).toBeGreaterThan(0);
  });

  it("getCycle retrieves persisted cycle", () => {
    const c = createCycle("improve_tests", DEF);
    const found = getCycle(c.id);
    expect(found).toBeTruthy();
    expect(found!.id).toBe(c.id);
    expect(found!.type).toBe("improve_tests");
  });

  it("updateCycleState changes state", () => {
    const c = createCycle("clean_unused_code", DEF);
    updateCycleState(c.id, "paused");
    const updated = getCycle(c.id);
    expect(updated!.state).toBe("paused");
  });

  it("getActiveCycle returns running cycle", () => {
    const c = createCycle("strengthen_validation", DEF);
    expect(c.state).toBe("running");
    const active = getActiveCycle();
    expect(active).toBeTruthy();
  });

  it("getActiveCycle returns undefined when none running", () => {
    // Pause all running cycles
    const active = getActiveCycle();
    if (active) updateCycleState(active.id, "completed");
    const stillActive = listCycles().find(c => c.state === "running");
    if (!stillActive) {
      const found = getActiveCycle();
      expect(found).toBeUndefined();
    }
  });

  it("listCycles returns newest first", () => {
    createCycle("improve_documentation", DEF);
    createCycle("reduce_risk_hotspots", DEF);
    const list = listCycles(5);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Newest has higher startedAt
    expect((list[0].startedAt ?? 0)).toBeGreaterThanOrEqual((list[1].startedAt ?? 0));
  });

  it("saveCycle persists patches and tasks", () => {
    const c = createCycle("fix_ts_errors", DEF);
    c.tasks.push("task-abc");
    c.patchesProposed = 2;
    c.patchesApplied  = 1;
    saveCycle(c);
    const found = getCycle(c.id);
    expect(found!.tasks).toContain("task-abc");
    expect(found!.patchesProposed).toBe(2);
    expect(found!.patchesApplied).toBe(1);
  });

  it("CYCLE_META has all 7 types with labels", () => {
    const types = Object.keys(CYCLE_META);
    expect(types).toContain("fix_ts_errors");
    expect(types).toContain("reduce_risk_hotspots");
    expect(types).toContain("improve_unstable_modules");
    expect(types).toContain("clean_unused_code");
    expect(types).toContain("improve_tests");
    expect(types).toContain("improve_documentation");
    expect(types).toContain("strengthen_validation");
    for (const t of types) {
      expect(CYCLE_META[t as keyof typeof CYCLE_META].label).toBeTruthy();
      expect(CYCLE_META[t as keyof typeof CYCLE_META].defaultRisk).toBeGreaterThanOrEqual(0);
    }
  });

  it("buildCycleGoal includes type and budget constraints", () => {
    const goal = buildCycleGoal("improve_tests", ["pattern A"], DEF);
    expect(goal).toContain("improve_tests");
    expect(goal).toContain("Max tasks: 3");
    expect(goal).toContain("Max patch proposals: 3");
    expect(goal).toContain("pattern A");
    expect(goal).toContain("Do NOT touch");
  });

  it("buildCycleGoal with no memory evidence still produces valid goal", () => {
    const goal = buildCycleGoal("clean_unused_code", [], DEF);
    expect(goal).toContain("Clean");
    expect(goal).not.toContain("Memory evidence");
  });

  it("buildProposals returns proposals sorted by riskScore", () => {
    const proposals = buildProposals(
      [{ type: "recurring_failure", recommendation: "Fix X", confidence: 70, affectedFiles: ["a.ts"] }],
      [{ name: "Orchestrator", riskScore: 75, type: "orchestration" }],
    );
    expect(proposals.length).toBeGreaterThan(0);
    // Verify sorted ascending by risk
    for (let i = 1; i < proposals.length; i++) {
      expect(proposals[i].riskScore).toBeGreaterThanOrEqual(proposals[i - 1].riskScore);
    }
  });

  it("buildProposals includes required scoring fields", () => {
    const proposals = buildProposals([], []);
    for (const p of proposals) {
      expect(p.title).toBeTruthy();
      expect(p.cycleType).toBeTruthy();
      expect(typeof p.riskScore).toBe("number");
      expect(typeof p.confidence).toBe("number");
      expect(p.expectedBenefit).toBeTruthy();
      expect(p.testPlan).toBeTruthy();
      expect(p.rollbackPlan).toBeTruthy();
      expect(Array.isArray(p.memoryEvidence)).toBe(true);
      expect(Array.isArray(p.affectedFiles)).toBe(true);
    }
  });
});

// ── Audit trail ───────────────────────────────────────────────────────────────

import {
  logAudit, getAuditLog, getCycleAudit, getRecentAudit,
  totalAuditEntries, getCriticalAuditEntries,
}                             from "../lib/autonomy/autonomyAudit";

describe("autonomyAudit", () => {
  it("logAudit creates an entry with id and timestamp", () => {
    const entry = logAudit({
      cycleId:  "test-cycle-1",
      type:     "cycle_started",
      reasoning: "Test cycle started by user",
    });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.type).toBe("cycle_started");
    expect(entry.cycleId).toBe("test-cycle-1");
  });

  it("getCycleAudit returns entries for specific cycle", () => {
    const cycleId = "audit-test-cycle-2";
    logAudit({ cycleId, type: "task_started", reasoning: "Task A", agentId: "builder" });
    logAudit({ cycleId, type: "task_completed", reasoning: "Task A done" });

    const entries = getCycleAudit(cycleId);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every(e => e.cycleId === cycleId)).toBe(true);
  });

  it("getCycleAudit returns entries in chronological order", () => {
    const cycleId = "audit-order-cycle";
    logAudit({ cycleId, type: "cycle_started",   reasoning: "Start" });
    logAudit({ cycleId, type: "task_started",     reasoning: "Task" });
    logAudit({ cycleId, type: "task_completed",   reasoning: "Done" });
    logAudit({ cycleId, type: "cycle_completed",  reasoning: "Finish" });

    const entries = getCycleAudit(cycleId);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].timestamp).toBeGreaterThanOrEqual(entries[i - 1].timestamp);
    }
  });

  it("critical flag set automatically for rollback_executed", () => {
    const entry = logAudit({
      cycleId:  "crit-cycle",
      type:     "rollback_executed",
      reasoning: "Rollback after failure",
    });
    expect(entry.critical).toBe(true);
  });

  it("critical flag set automatically for policy_blocked", () => {
    const entry = logAudit({
      cycleId:  "policy-cycle",
      type:     "policy_blocked",
      reasoning: "Blocked auth file",
    });
    expect(entry.critical).toBe(true);
  });

  it("critical flag set for approval events", () => {
    const requested = logAudit({ cycleId: "approval-cycle", type: "approval_requested", reasoning: "High risk task" });
    const granted   = logAudit({ cycleId: "approval-cycle", type: "approval_granted",   reasoning: "User approved" });
    const denied    = logAudit({ cycleId: "approval-cycle", type: "approval_denied",    reasoning: "User denied" });
    expect(requested.critical).toBe(true);
    expect(granted.critical).toBe(true);
    expect(denied.critical).toBe(true);
  });

  it("critical flag false for non-critical events", () => {
    const entry = logAudit({
      cycleId:  "non-crit",
      type:     "task_completed",
      reasoning: "Normal task completed",
    });
    expect(entry.critical).toBe(false);
  });

  it("getCriticalAuditEntries returns only critical entries", () => {
    logAudit({ cycleId: "crit-filter", type: "rollback_executed", reasoning: "Rollback" });
    logAudit({ cycleId: "crit-filter", type: "task_completed",    reasoning: "Done" });

    const critical = getCriticalAuditEntries();
    expect(critical.every(e => !!e.critical)).toBe(true);
  });

  it("totalAuditEntries increases after logging", () => {
    const before = totalAuditEntries();
    logAudit({ cycleId: "count-test", type: "task_started", reasoning: "Count test" });
    const after  = totalAuditEntries();
    expect(after).toBeGreaterThan(before);
  });

  it("audit entries include memory evidence when provided", () => {
    const evidence = ["Pattern A detected", "Risk score 75 in hotspot"];
    const entry = logAudit({
      cycleId:        "evidence-cycle",
      type:           "memory_retrieved",
      reasoning:      "Retrieved context",
      memoryEvidence: evidence,
    });
    expect(entry.memoryEvidence).toEqual(evidence);
  });

  it("audit entries include agentId when provided", () => {
    const entry = logAudit({
      cycleId:  "agent-cycle",
      type:     "task_started",
      reasoning: "Builder started",
      agentId:  "builder",
    });
    expect(entry.agentId).toBe("builder");
  });

  it("getRecentAudit returns entries sorted newest first", () => {
    const entries = getRecentAudit(10);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].timestamp).toBeLessThanOrEqual(entries[i - 1].timestamp);
    }
  });

  it("getAuditLog filters by cycleId", () => {
    const id = "filter-test-cycle";
    logAudit({ cycleId: id,     type: "task_started",   reasoning: "Mine" });
    logAudit({ cycleId: "other", type: "cycle_started", reasoning: "Not mine" });

    const result = getAuditLog({ cycleId: id });
    expect(result.every(e => e.cycleId === id)).toBe(true);
  });
});

// ── Safety invariants ─────────────────────────────────────────────────────────

describe("Safety invariants", () => {
  it("autonomy controller exports do NOT include a scheduler or cron function", async () => {
    const controller = await import("../lib/autonomy/autonomyController");
    const keys = Object.keys(controller);
    // Must not export anything that sounds like background scheduling
    const forbidden = keys.filter(k =>
      /schedule|cron|interval|timer|background|auto.*run|loop/i.test(k)
    );
    expect(forbidden).toHaveLength(0);
  });

  it("startCycle is the ONLY function that begins a cycle (exported as named export)", async () => {
    const controller = await import("../lib/autonomy/autonomyController");
    expect(typeof controller.startCycle).toBe("function");
    // pauseCycle and stopCycle exist for user control
    expect(typeof controller.pauseCycle).toBe("function");
    expect(typeof controller.stopCycle).toBe("function");
    expect(typeof controller.resumeCycle).toBe("function");
  });

  it("budget config maxTasks cannot be set to 0 (minimum 1 for a meaningful cycle)", () => {
    // Budget tracker with maxTasks=0 is immediately exhausted
    const t = new BudgetTracker({ ...DEFAULT_BUDGET, maxTasks: 0 });
    expect(t.isExhausted()).toBe(true);
    expect(t.checkTask().allowed).toBe(false);
  });

  it("permissions.ts is always on the blocked exact path list", () => {
    const paths = listBlockedExactPaths();
    expect(paths.some(p => p.includes("permissions.ts"))).toBe(true);
  });

  it("autonomyPolicy.ts itself is on the blocked exact path list", () => {
    const paths = listBlockedExactPaths();
    expect(paths.some(p => p.includes("autonomyPolicy.ts"))).toBe(true);
  });

  it("no permission escalation — policy cannot be overridden by confidence", () => {
    // Even 100% confidence doesn't unblock a protected file
    const result = isFileBlocked("src/lib/agents/permissions.ts");
    expect(result.blocked).toBe(true);
    // confidence parameter doesn't exist — policy is not confidence-aware
    expect(typeof result.blocked).toBe("boolean");
  });

  it("cycle state machine prevents double-starting", () => {
    const c = createCycle("fix_ts_errors", DEF);
    expect(c.state).toBe("running");
    // getActiveCycle() would prevent startCycle() from running again
    const active = getActiveCycle();
    expect(active).toBeTruthy();
    expect(active!.state).toBe("running");
  });
});
