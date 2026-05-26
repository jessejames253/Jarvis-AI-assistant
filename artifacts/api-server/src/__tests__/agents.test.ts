/**
 * __tests__/agents.test.ts — Phase 4 multi-agent system tests.
 *
 * Covers:
 *  - Permission enforcement (assertPermission, hasPermission, PermissionDeniedError)
 *  - Permission audit log (denials are recorded)
 *  - Task graph CRUD + dependency logic
 *  - Agent registry (register, lookup, list, duplicate guard)
 *  - Orchestrator utilities (getOrchestrationStatus)
 *  - Cross-cutting: permission denials on blocked-action attempts
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PERMISSIONS, hasPermission, assertPermission, checkPermission,
  getPermissionAuditLog, getPermissionDenials, PermissionDeniedError,
  type Permission,
} from "../lib/agents/permissions";
import {
  createTask, getTask, updateTask, deleteTask, listTasks,
  getTaskGraph, getReadyTasks, clearTasks,
  type Task,
} from "../lib/agents/taskGraph";
import {
  registerAgent, getAgent, listAgents, isRegistered, _unregisterAgent,
} from "../lib/agents/registry";
import { getOrchestrationStatus } from "../lib/agents/orchestrator";
import type { AgentDefinition } from "../lib/agents/baseAgent";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_PERMS = Object.values(PERMISSIONS) as Permission[];
const NO_PERMS: Permission[] = [];

function makeAgent(id: string, perms: Permission[]): AgentDefinition {
  return {
    id,
    name:          `Agent ${id}`,
    role:          "test",
    description:   "test agent",
    capabilities:  [],
    permissions:   perms,
    riskLimit:     "safe",
    executionMode: "read-only",
    systemPromptBuilder: () => `system prompt for ${id}`,
  };
}

// ─── Permission tests ─────────────────────────────────────────────────────────

describe("permissions — hasPermission", () => {
  it("returns true when the permission is in the set", () => {
    expect(hasPermission([PERMISSIONS.READ_FILES], PERMISSIONS.READ_FILES)).toBe(true);
  });

  it("returns false when the permission is absent", () => {
    expect(hasPermission([PERMISSIONS.READ_FILES], PERMISSIONS.PATCH_PROPOSAL)).toBe(false);
  });

  it("returns false for an empty permission set", () => {
    expect(hasPermission([], PERMISSIONS.CHECKPOINT)).toBe(false);
  });

  it("returns true when the full permission set is granted", () => {
    expect(hasPermission(ALL_PERMS, PERMISSIONS.GIT_COMMIT)).toBe(true);
  });
});

describe("permissions — assertPermission", () => {
  it("does not throw when permission is granted", () => {
    expect(() =>
      assertPermission([PERMISSIONS.READ_FILES], PERMISSIONS.READ_FILES, "agent-a"),
    ).not.toThrow();
  });

  it("throws PermissionDeniedError when permission is absent", () => {
    expect(() =>
      assertPermission(NO_PERMS, PERMISSIONS.PATCH_PROPOSAL, "agent-b"),
    ).toThrow(PermissionDeniedError);
  });

  it("error message includes the agent ID and required permission", () => {
    expect(() =>
      assertPermission(NO_PERMS, PERMISSIONS.ROLLBACK, "agent-c"),
    ).toThrow(/agent-c.*ROLLBACK|ROLLBACK.*agent-c/);
  });

  it("error message includes the granted permissions", () => {
    try {
      assertPermission([PERMISSIONS.READ_FILES], PERMISSIONS.CHECKPOINT, "agent-d");
    } catch (e) {
      expect(String(e)).toContain("READ_FILES");
    }
  });

  it("records a denial entry in the audit log", () => {
    const logBefore = getPermissionAuditLog(100).length;
    try { assertPermission(NO_PERMS, PERMISSIONS.GIT_COMMIT, "audit-test"); } catch { /**/ }
    const logAfter = getPermissionAuditLog(100).length;
    expect(logAfter).toBeGreaterThan(logBefore);
  });

  it("records a granted entry in the audit log", () => {
    const logBefore = getPermissionAuditLog(100).length;
    assertPermission([PERMISSIONS.READ_CONTEXT], PERMISSIONS.READ_CONTEXT, "audit-granted");
    const logAfter = getPermissionAuditLog(100).length;
    expect(logAfter).toBeGreaterThan(logBefore);
  });
});

describe("permissions — checkPermission (non-throwing)", () => {
  it("returns allowed: true when granted", () => {
    const r = checkPermission([PERMISSIONS.TASK_UPDATE], PERMISSIONS.TASK_UPDATE, "x");
    expect(r.allowed).toBe(true);
    expect(r.agentId).toBe("x");
  });

  it("returns allowed: false when denied", () => {
    const r = checkPermission([], PERMISSIONS.TASK_CREATE, "y");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

describe("permissions — getPermissionDenials", () => {
  it("only returns denied entries", () => {
    // Trigger a denial
    try { assertPermission([], PERMISSIONS.GIT_STATUS, "denial-audit"); } catch { /**/ }
    const denials = getPermissionDenials(50);
    expect(denials.every(e => !e.allowed)).toBe(true);
  });
});

// ─── Specific agent permission constraints ────────────────────────────────────

describe("agent permission constraints", () => {
  it("PlannerAgent cannot PATCH_PROPOSAL", () => {
    const plannerPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(hasPermission(plannerPerms, PERMISSIONS.PATCH_PROPOSAL)).toBe(false);
  });

  it("PlannerAgent cannot CHECKPOINT or ROLLBACK", () => {
    const plannerPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(hasPermission(plannerPerms, PERMISSIONS.CHECKPOINT)).toBe(false);
    expect(hasPermission(plannerPerms, PERMISSIONS.ROLLBACK)).toBe(false);
  });

  it("BuilderAgent cannot TEST_RUNNER", () => {
    const builderPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.PATCH_PROPOSAL,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(hasPermission(builderPerms, PERMISSIONS.TEST_RUNNER)).toBe(false);
  });

  it("TesterAgent cannot PATCH_PROPOSAL", () => {
    const testerPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.TEST_RUNNER,
      PERMISSIONS.AUTOFIX_TRIGGER,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(hasPermission(testerPerms, PERMISSIONS.PATCH_PROPOSAL)).toBe(false);
  });

  it("ResearchAgent has only READ + TASK_UPDATE", () => {
    const researchPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(hasPermission(researchPerms, PERMISSIONS.PATCH_PROPOSAL)).toBe(false);
    expect(hasPermission(researchPerms, PERMISSIONS.TEST_RUNNER)).toBe(false);
    expect(hasPermission(researchPerms, PERMISSIONS.CHECKPOINT)).toBe(false);
    expect(hasPermission(researchPerms, PERMISSIONS.GIT_COMMIT)).toBe(false);
  });

  it("GitAgent cannot PATCH_PROPOSAL or TEST_RUNNER", () => {
    const gitPerms: Permission[] = [
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.CHECKPOINT,
      PERMISSIONS.ROLLBACK,
      PERMISSIONS.GIT_STATUS,
      PERMISSIONS.GIT_COMMIT,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(hasPermission(gitPerms, PERMISSIONS.PATCH_PROPOSAL)).toBe(false);
    expect(hasPermission(gitPerms, PERMISSIONS.TEST_RUNNER)).toBe(false);
  });
});

// ─── Task graph tests ─────────────────────────────────────────────────────────

describe("taskGraph — CRUD", () => {
  beforeEach(() => clearTasks());

  it("creates a task with defaults", () => {
    const t = createTask({ title: "T1", description: "desc", agentId: "planner" });
    expect(t.id).toBeTruthy();
    expect(t.status).toBe("pending");
    expect(t.priority).toBe("medium");
    expect(t.riskScore).toBe(0);
    expect(t.dependencies).toEqual([]);
  });

  it("retrieves a task by ID", () => {
    const t = createTask({ title: "T2", description: "d", agentId: "builder" });
    const got = getTask(t.id);
    expect(got?.title).toBe("T2");
  });

  it("returns undefined for an unknown task ID", () => {
    expect(getTask("non-existent-id")).toBeUndefined();
  });

  it("updates task status", () => {
    const t = createTask({ title: "T3", description: "d", agentId: "tester" });
    const updated = updateTask(t.id, { status: "running" });
    expect(updated?.status).toBe("running");
    expect(getTask(t.id)?.status).toBe("running");
  });

  it("updateTask returns null for unknown ID", () => {
    expect(updateTask("missing", { status: "done" })).toBeNull();
  });

  it("deletes a task", () => {
    const t = createTask({ title: "T4", description: "d", agentId: "git" });
    expect(deleteTask(t.id)).toBe(true);
    expect(getTask(t.id)).toBeUndefined();
  });

  it("listTasks returns all tasks", () => {
    createTask({ title: "A", description: "d", agentId: "planner" });
    createTask({ title: "B", description: "d", agentId: "builder" });
    expect(listTasks().length).toBeGreaterThanOrEqual(2);
  });

  it("listTasks filters by orchestrationId", () => {
    createTask({ title: "X", description: "d", agentId: "planner", orchestrationId: "orch-1" });
    createTask({ title: "Y", description: "d", agentId: "builder", orchestrationId: "orch-2" });
    const filtered = listTasks("orch-1");
    expect(filtered.every(t => t.orchestrationId === "orch-1")).toBe(true);
  });

  it("clearTasks removes all tasks", () => {
    createTask({ title: "Z", description: "d", agentId: "researcher" });
    clearTasks();
    expect(getTaskGraph().length).toBe(0);
  });

  it("clearTasks with orchestrationId only removes that orchestration", () => {
    createTask({ title: "keep", description: "d", agentId: "planner", orchestrationId: "keep-orch" });
    createTask({ title: "del",  description: "d", agentId: "builder", orchestrationId: "del-orch" });
    clearTasks("del-orch");
    const remaining = getTaskGraph();
    expect(remaining.some(t => t.orchestrationId === "keep-orch")).toBe(true);
    expect(remaining.some(t => t.orchestrationId === "del-orch")).toBe(false);
  });
});

describe("taskGraph — dependency logic", () => {
  beforeEach(() => clearTasks());

  it("a task with no deps is immediately ready", () => {
    const t = createTask({ title: "NoDeps", description: "d", agentId: "researcher" });
    const ready = getReadyTasks();
    expect(ready.some(r => r.id === t.id)).toBe(true);
  });

  it("a task with an unfinished dep is NOT ready", () => {
    const dep = createTask({ title: "Dep", description: "d", agentId: "planner" });
    const child = createTask({
      title: "Child", description: "d", agentId: "builder", dependencies: [dep.id],
    });
    const ready = getReadyTasks();
    expect(ready.some(r => r.id === child.id)).toBe(false);
  });

  it("a task becomes ready when its dep is done", () => {
    const dep = createTask({ title: "Dep2", description: "d", agentId: "planner" });
    const child = createTask({
      title: "Child2", description: "d", agentId: "builder", dependencies: [dep.id],
    });
    updateTask(dep.id, { status: "done" });
    const ready = getReadyTasks();
    expect(ready.some(r => r.id === child.id)).toBe(true);
  });

  it("getReadyTasks excludes running/done/failed tasks", () => {
    const t1 = createTask({ title: "R1", description: "d", agentId: "tester" });
    updateTask(t1.id, { status: "running" });
    const t2 = createTask({ title: "R2", description: "d", agentId: "tester" });
    updateTask(t2.id, { status: "done" });
    const ready = getReadyTasks();
    expect(ready.some(r => r.id === t1.id)).toBe(false);
    expect(ready.some(r => r.id === t2.id)).toBe(false);
  });

  it("multi-dep task requires ALL deps done", () => {
    const d1 = createTask({ title: "D1", description: "d", agentId: "planner" });
    const d2 = createTask({ title: "D2", description: "d", agentId: "planner" });
    const child = createTask({
      title: "Child3", description: "d", agentId: "builder",
      dependencies: [d1.id, d2.id],
    });
    updateTask(d1.id, { status: "done" }); // only one dep done
    expect(getReadyTasks().some(r => r.id === child.id)).toBe(false);
    updateTask(d2.id, { status: "done" }); // now both done
    expect(getReadyTasks().some(r => r.id === child.id)).toBe(true);
  });
});

// ─── Agent registry tests ─────────────────────────────────────────────────────

describe("agentRegistry", () => {
  const TEST_ID = "test-agent-registry-unique";

  beforeEach(() => _unregisterAgent(TEST_ID));

  it("registers and retrieves an agent", () => {
    const def = makeAgent(TEST_ID, [PERMISSIONS.READ_FILES]);
    registerAgent(def);
    expect(getAgent(TEST_ID)?.id).toBe(TEST_ID);
  });

  it("isRegistered returns true after registration", () => {
    registerAgent(makeAgent(TEST_ID, []));
    expect(isRegistered(TEST_ID)).toBe(true);
  });

  it("isRegistered returns false before registration", () => {
    expect(isRegistered("never-registered-xyz")).toBe(false);
  });

  it("throws if the same ID is registered twice", () => {
    registerAgent(makeAgent(TEST_ID, []));
    expect(() => registerAgent(makeAgent(TEST_ID, []))).toThrow(/already registered/);
  });

  it("listAgents includes the registered agent", () => {
    registerAgent(makeAgent(TEST_ID, [PERMISSIONS.READ_CONTEXT]));
    const ids = listAgents().map(a => a.id);
    expect(ids).toContain(TEST_ID);
  });

  it("stores the full agent definition", () => {
    const def = makeAgent(TEST_ID, [PERMISSIONS.READ_FILES, PERMISSIONS.TASK_CREATE]);
    registerAgent(def);
    const got = getAgent(TEST_ID)!;
    expect(got.name).toBe(def.name);
    expect(got.permissions).toEqual(def.permissions);
    expect(got.executionMode).toBe("read-only");
  });
});

// ─── Orchestration status tests ───────────────────────────────────────────────

describe("getOrchestrationStatus", () => {
  beforeEach(() => clearTasks());

  it("returns empty status for unknown orchestrationId", () => {
    const s = getOrchestrationStatus("unknown-orch");
    expect(s.total).toBe(0);
    expect(s.complete).toBe(false);
  });

  it("reports correct counts", () => {
    const oid = "test-orch-status";
    const t1 = createTask({ title: "A", description: "d", agentId: "planner", orchestrationId: oid });
    const t2 = createTask({ title: "B", description: "d", agentId: "builder", orchestrationId: oid });
    updateTask(t1.id, { status: "done" });
    updateTask(t2.id, { status: "failed" });
    const s = getOrchestrationStatus(oid);
    expect(s.total).toBe(2);
    expect(s.done).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.pending).toBe(0);
    expect(s.running).toBe(0);
  });

  it("complete is true when all tasks are done and none pending/running", () => {
    const oid = "test-orch-complete";
    const t = createTask({ title: "T", description: "d", agentId: "tester", orchestrationId: oid });
    updateTask(t.id, { status: "done" });
    expect(getOrchestrationStatus(oid).complete).toBe(true);
  });

  it("complete is false while tasks are pending", () => {
    const oid = "test-orch-incomplete";
    createTask({ title: "T", description: "d", agentId: "tester", orchestrationId: oid });
    expect(getOrchestrationStatus(oid).complete).toBe(false);
  });

  it("tasks not matching the orchestrationId are excluded", () => {
    const oid = "isolated-orch";
    createTask({ title: "Mine", description: "d", agentId: "planner", orchestrationId: oid });
    createTask({ title: "Other", description: "d", agentId: "builder", orchestrationId: "other-orch" });
    expect(getOrchestrationStatus(oid).total).toBe(1);
  });
});

// ─── Blocked action attempt tests ─────────────────────────────────────────────

describe("blocked action attempts", () => {
  it("PlannerAgent attempting PATCH_PROPOSAL throws PermissionDeniedError", () => {
    const plannerPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.TASK_CREATE,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(() =>
      assertPermission(plannerPerms, PERMISSIONS.PATCH_PROPOSAL, "planner"),
    ).toThrow(PermissionDeniedError);
  });

  it("ResearchAgent attempting CHECKPOINT throws PermissionDeniedError", () => {
    const researchPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(() =>
      assertPermission(researchPerms, PERMISSIONS.CHECKPOINT, "researcher"),
    ).toThrow(PermissionDeniedError);
  });

  it("BuilderAgent attempting GIT_COMMIT throws PermissionDeniedError", () => {
    const builderPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.PATCH_PROPOSAL,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(() =>
      assertPermission(builderPerms, PERMISSIONS.GIT_COMMIT, "builder"),
    ).toThrow(PermissionDeniedError);
  });

  it("TesterAgent attempting ROLLBACK throws PermissionDeniedError", () => {
    const testerPerms: Permission[] = [
      PERMISSIONS.READ_FILES,
      PERMISSIONS.READ_CONTEXT,
      PERMISSIONS.TEST_RUNNER,
      PERMISSIONS.AUTOFIX_TRIGGER,
      PERMISSIONS.TASK_UPDATE,
    ];
    expect(() =>
      assertPermission(testerPerms, PERMISSIONS.ROLLBACK, "tester"),
    ).toThrow(PermissionDeniedError);
  });

  it("an agent cannot escalate its own permissions (granting itself new perms has no effect)", () => {
    const restrictedPerms: Permission[] = [PERMISSIONS.READ_FILES];
    // Simulating an agent trying to add PATCH_PROPOSAL to its own set externally
    const attemptedEscalation = [...restrictedPerms, PERMISSIONS.PATCH_PROPOSAL];
    // The original set is unchanged — immutability check
    expect(restrictedPerms).toEqual([PERMISSIONS.READ_FILES]);
    // Even with the escalated set, assertPermission on the ORIGINAL set still fails
    expect(() =>
      assertPermission(restrictedPerms, PERMISSIONS.PATCH_PROPOSAL, "rogue-agent"),
    ).toThrow(PermissionDeniedError);
    // The escalated set is a NEW array and doesn't affect server-side enforcement
    expect(hasPermission(restrictedPerms, PERMISSIONS.PATCH_PROPOSAL)).toBe(false);
    expect(hasPermission(attemptedEscalation, PERMISSIONS.PATCH_PROPOSAL)).toBe(true);
  });
});

// ─── Rollback integrity tests ─────────────────────────────────────────────────

describe("rollback integrity", () => {
  beforeEach(() => clearTasks());

  it("failed tasks are preserved in the graph (not deleted on failure)", () => {
    const t = createTask({ title: "Fail", description: "d", agentId: "builder" });
    updateTask(t.id, { status: "failed", error: "compilation error" });
    expect(getTask(t.id)?.status).toBe("failed");
    expect(getTask(t.id)?.error).toBe("compilation error");
  });

  it("retryCount is correctly incremented on failure", () => {
    const t = createTask({ title: "Retry", description: "d", agentId: "tester" });
    updateTask(t.id, { retryCount: 1, status: "failed" });
    updateTask(t.id, { retryCount: 2, status: "failed" });
    expect(getTask(t.id)?.retryCount).toBe(2);
  });

  it("cancelled task stays in graph with cancelled status", () => {
    const t = createTask({ title: "Cancel", description: "d", agentId: "git" });
    updateTask(t.id, { status: "cancelled" });
    expect(getTask(t.id)?.status).toBe("cancelled");
    expect(getReadyTasks().some(r => r.id === t.id)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4B — Coordinated Execution Engine Tests
// ═══════════════════════════════════════════════════════════════════════════

import {
  classifyFailure, canRetry, logRetry, getRetryLog, _clearRetryLog,
} from "../lib/agents/retryPolicy";
import {
  getOrCreateRun, getOrchestrationRun, setRunState, setActiveTask,
  addTimelineEvent, getTimeline, resetRun,
} from "../lib/agents/executionState";
import {
  sendMessage, getMessages, getMessagesForTask, _clearMessages,
  type AgentMessage,
} from "../lib/agents/agentMessages";
import { isTaskReady, isSuccess, isTerminal } from "../lib/agents/taskGraph";

// ─── Retry Policy ────────────────────────────────────────────────────────────

describe("Phase 4B — retryPolicy: classifyFailure", () => {
  it("classifies PermissionDenied as permission_denied", () => {
    expect(classifyFailure("PermissionDeniedError: READ_FILES denied")).toBe("permission_denied");
  });

  it("classifies network errors as recoverable", () => {
    expect(classifyFailure("ECONNREFUSED connection refused")).toBe("recoverable");
    expect(classifyFailure("Request timeout")).toBe("recoverable");
    expect(classifyFailure("fetch failed: network error")).toBe("recoverable");
  });

  it("classifies Claude API errors as recoverable", () => {
    expect(classifyFailure("anthropic API 503 overloaded")).toBe("recoverable");
    expect(classifyFailure("rate limit 429")).toBe("recoverable");
  });

  it("classifies risky failures as risky", () => {
    expect(classifyFailure("risky operation: cannot apply patch")).toBe("risky");
    expect(classifyFailure("high risk level exceeded")).toBe("risky");
    expect(classifyFailure("blocked.file: protected path")).toBe("risky");
  });

  it("classifies unknown errors as unrecoverable", () => {
    expect(classifyFailure("unexpected assertion failure in core module")).toBe("unrecoverable");
    expect(classifyFailure("null pointer exception in task runner")).toBe("unrecoverable");
  });

  it("classifies dependency errors as recoverable", () => {
    expect(classifyFailure("unmet dependency: task-abc not done")).toBe("recoverable");
  });
});

describe("Phase 4B — retryPolicy: canRetry", () => {
  beforeEach(() => { _clearRetryLog(); });

  const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: "t1", title: "T", description: "d", agentId: "tester",
    dependencies: [], status: "failed", priority: "medium",
    riskScore: 10, retryCount: 0, maxRetries: 2, createdAt: Date.now(),
    ...overrides,
  });

  it("allows retry when count < max and error is recoverable", () => {
    expect(canRetry(makeTask({ retryCount: 0 }), "ECONNREFUSED")).toBe(true);
  });

  it("denies retry when retryCount >= maxRetries", () => {
    expect(canRetry(makeTask({ retryCount: 2, maxRetries: 2 }), "ECONNREFUSED")).toBe(false);
  });

  it("denies retry on permission denial regardless of count", () => {
    expect(canRetry(makeTask({ retryCount: 0 }), "PermissionDenied: PATCH_PROPOSAL")).toBe(false);
  });

  it("denies retry on risky failure", () => {
    expect(canRetry(makeTask({ retryCount: 1 }), "risky operation blocked")).toBe(false);
  });

  it("denies retry on unrecoverable failure", () => {
    expect(canRetry(makeTask({ retryCount: 0 }), "assertion error in logic")).toBe(false);
  });
});

describe("Phase 4B — retryPolicy: logRetry", () => {
  beforeEach(() => { _clearRetryLog(); });

  it("logs retry entries with correct shape", () => {
    const entry = logRetry("task-1", 1, "timeout");
    expect(entry.taskId).toBe("task-1");
    expect(entry.attempt).toBe(1);
    expect(entry.error).toBe("timeout");
    expect(entry.failureClass).toBe("recoverable");
    expect(typeof entry.timestamp).toBe("number");
  });

  it("getRetryLog filters by taskId", () => {
    logRetry("task-a", 1, "timeout");
    logRetry("task-b", 1, "ECONNREFUSED");
    logRetry("task-a", 2, "timeout");
    expect(getRetryLog("task-a")).toHaveLength(2);
    expect(getRetryLog("task-b")).toHaveLength(1);
  });

  it("getRetryLog returns all when no taskId given", () => {
    logRetry("t1", 1, "timeout");
    logRetry("t2", 1, "timeout");
    expect(getRetryLog().length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Execution State ──────────────────────────────────────────────────────────

describe("Phase 4B — executionState: run lifecycle", () => {
  const oid = "test-orch-" + Math.random().toString(36).slice(2);

  beforeEach(() => { resetRun(oid); });

  it("getOrCreateRun creates an idle run for new orchestrationId", () => {
    const run = getOrCreateRun(oid);
    expect(run.orchestrationId).toBe(oid);
    expect(run.state).toBe("idle");
    expect(run.timeline).toEqual([]);
  });

  it("setRunState transitions to running and records startedAt", () => {
    const before = Date.now();
    setRunState(oid, "running");
    const run = getOrchestrationRun(oid)!;
    expect(run.state).toBe("running");
    expect(run.startedAt).toBeGreaterThanOrEqual(before);
  });

  it("setRunState does not overwrite startedAt on re-entry", () => {
    setRunState(oid, "running");
    const first = getOrchestrationRun(oid)!.startedAt!;
    setRunState(oid, "running");
    expect(getOrchestrationRun(oid)!.startedAt).toBe(first);
  });

  it("setRunState sets completedAt on completed/failed", () => {
    setRunState(oid, "running");
    setRunState(oid, "completed");
    expect(getOrchestrationRun(oid)!.completedAt).toBeDefined();
  });

  it("setActiveTask sets currentAgentId and activeTaskId", () => {
    setRunState(oid, "running");
    setActiveTask(oid, "task-xyz", "builder");
    const run = getOrchestrationRun(oid)!;
    expect(run.activeTaskId).toBe("task-xyz");
    expect(run.currentAgentId).toBe("builder");
  });

  it("setActiveTask can clear both fields with undefined", () => {
    setRunState(oid, "running");
    setActiveTask(oid, "task-xyz", "builder");
    setActiveTask(oid, undefined, undefined);
    const run = getOrchestrationRun(oid)!;
    expect(run.activeTaskId).toBeUndefined();
    expect(run.currentAgentId).toBeUndefined();
  });
});

describe("Phase 4B — executionState: timeline", () => {
  const oid = "timeline-test-" + Math.random().toString(36).slice(2);

  beforeEach(() => { resetRun(oid); });

  it("addTimelineEvent appends an event with correct shape", () => {
    const ev = addTimelineEvent(oid, "plan_started", { message: "Go" });
    expect(ev.orchestrationId).toBe(oid);
    expect(ev.type).toBe("plan_started");
    expect(ev.message).toBe("Go");
    expect(typeof ev.id).toBe("string");
    expect(typeof ev.timestamp).toBe("number");
  });

  it("getTimeline returns events sorted by timestamp", () => {
    addTimelineEvent(oid, "task_started", { message: "A" });
    addTimelineEvent(oid, "task_completed", { message: "B" });
    addTimelineEvent(oid, "handoff_sent", { message: "C" });
    const tl = getTimeline(oid);
    expect(tl.length).toBe(3);
    for (let i = 1; i < tl.length; i++)
      expect(tl[i].timestamp).toBeGreaterThanOrEqual(tl[i - 1].timestamp);
  });

  it("addTimelineEvent uses type as default message when message omitted", () => {
    const ev = addTimelineEvent(oid, "plan_paused");
    expect(ev.message).toBe("plan paused");
  });

  it("getTimeline for unknown orchestrationId returns empty array", () => {
    expect(getTimeline("no-such-id")).toEqual([]);
  });

  it("addTimelineEvent stores optional taskId and agentId", () => {
    const ev = addTimelineEvent(oid, "task_failed", {
      taskId: "t99", agentId: "builder", message: "Boom",
    });
    expect(ev.taskId).toBe("t99");
    expect(ev.agentId).toBe("builder");
  });
});

// ─── Agent Messages ───────────────────────────────────────────────────────────

describe("Phase 4B — agentMessages: sendMessage / getMessages", () => {
  const oid = "msg-test-" + Math.random().toString(36).slice(2);

  beforeEach(() => { _clearMessages(); });

  const makeMsg = (overrides: Partial<Omit<AgentMessage, "id" | "timestamp">> = {}) => ({
    fromAgent: "planner", toAgent: "builder",
    taskId: "t1", orchestrationId: oid,
    type: "plan_created" as const, content: "Plan ready",
    risk: "safe" as const,
    ...overrides,
  });

  it("sendMessage returns a message with id and timestamp", () => {
    const msg = sendMessage(makeMsg());
    expect(typeof msg.id).toBe("string");
    expect(typeof msg.timestamp).toBe("number");
    expect(msg.fromAgent).toBe("planner");
  });

  it("getMessages returns messages for the given orchestrationId", () => {
    sendMessage(makeMsg({ orchestrationId: oid }));
    sendMessage(makeMsg({ orchestrationId: "other-orch" }));
    const msgs = getMessages(oid);
    expect(msgs.every(m => m.orchestrationId === oid)).toBe(true);
  });

  it("getMessages returns all messages when no orchestrationId given", () => {
    sendMessage(makeMsg());
    sendMessage(makeMsg({ orchestrationId: "other" }));
    expect(getMessages().length).toBeGreaterThanOrEqual(2);
  });

  it("getMessages respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) sendMessage(makeMsg({ content: `msg ${i}` }));
    expect(getMessages(oid, 3)).toHaveLength(3);
  });

  it("getMessagesForTask filters by taskId", () => {
    sendMessage(makeMsg({ taskId: "t-alpha" }));
    sendMessage(makeMsg({ taskId: "t-beta" }));
    sendMessage(makeMsg({ taskId: "t-alpha" }));
    expect(getMessagesForTask("t-alpha")).toHaveLength(2);
    expect(getMessagesForTask("t-beta")).toHaveLength(1);
  });

  it("supports all message types in the type union", () => {
    const types = [
      "plan_created", "context_ready", "patch_proposed",
      "validation_requested", "validation_passed", "validation_failed",
      "autofix_suggested", "approval_required", "rollback_requested",
      "task_completed", "task_failed", "handoff_sent",
    ] as const;
    for (const type of types) {
      const msg = sendMessage(makeMsg({ type }));
      expect(msg.type).toBe(type);
    }
    expect(getMessages(oid).length).toBe(types.length);
  });

  it("supports relatedPatchId and validationResult fields", () => {
    const msg = sendMessage(makeMsg({
      type: "validation_failed",
      relatedPatchId: "patch-123",
      validationResult: { passed: false, errors: ["TS error"] },
    }));
    expect(msg.relatedPatchId).toBe("patch-123");
    expect(msg.validationResult?.passed).toBe(false);
    expect(msg.validationResult?.errors).toContain("TS error");
  });
});

// ─── TaskGraph Phase 4B states ────────────────────────────────────────────────

describe("Phase 4B — taskGraph: new status types", () => {
  beforeEach(() => { clearTasks(); });

  it("isSuccess returns true for done and passed", () => {
    expect(isSuccess("done")).toBe(true);
    expect(isSuccess("passed")).toBe(true);
    expect(isSuccess("failed")).toBe(false);
    expect(isSuccess("blocked")).toBe(false);
    expect(isSuccess("pending")).toBe(false);
  });

  it("isTerminal returns true for all terminal statuses", () => {
    for (const s of ["passed", "done", "failed", "skipped", "blocked", "rolled_back", "cancelled"] as const)
      expect(isTerminal(s)).toBe(true);
    for (const s of ["pending", "ready", "running", "waiting_approval", "validating"] as const)
      expect(isTerminal(s)).toBe(false);
  });

  it("isTaskReady returns false for non-pending statuses", () => {
    const t = createTask({ title: "T", description: "d", agentId: "planner" });
    for (const s of ["running", "done", "failed", "blocked", "waiting_approval"] as const) {
      updateTask(t.id, { status: s });
      expect(isTaskReady(getTask(t.id)!)).toBe(false);
    }
  });

  it("task can be set to waiting_approval status", () => {
    const t = createTask({ title: "T", description: "d", agentId: "builder" });
    updateTask(t.id, { status: "waiting_approval" });
    expect(getTask(t.id)?.status).toBe("waiting_approval");
    expect(getReadyTasks().some(r => r.id === t.id)).toBe(false);
  });

  it("task can be set to validating status", () => {
    const t = createTask({ title: "T", description: "d", agentId: "tester" });
    updateTask(t.id, { status: "validating" });
    expect(getTask(t.id)?.status).toBe("validating");
  });

  it("task can be set to rolled_back status", () => {
    const t = createTask({ title: "T", description: "d", agentId: "git" });
    updateTask(t.id, { status: "rolled_back" });
    expect(getTask(t.id)?.status).toBe("rolled_back");
    expect(isTerminal("rolled_back")).toBe(true);
  });

  it("task can be set to skipped status", () => {
    const t = createTask({ title: "T", description: "d", agentId: "researcher" });
    updateTask(t.id, { status: "skipped" });
    expect(getTask(t.id)?.status).toBe("skipped");
    expect(isTerminal("skipped")).toBe(true);
  });
});

describe("Phase 4B — taskGraph: dependency ordering", () => {
  beforeEach(() => { clearTasks(); });

  it("getReadyTasks only includes tasks with all deps done", () => {
    const dep1 = createTask({ title: "Dep1", description: "d", agentId: "planner" });
    const dep2 = createTask({ title: "Dep2", description: "d", agentId: "researcher" });
    const child = createTask({
      title: "Child", description: "d", agentId: "builder",
      dependencies: [dep1.id, dep2.id],
    });

    // Neither dep done → child not ready
    expect(getReadyTasks().map(t => t.id)).not.toContain(child.id);

    // Only one dep done → still not ready
    updateTask(dep1.id, { status: "done" });
    expect(getReadyTasks().map(t => t.id)).not.toContain(child.id);

    // Both deps done → child now ready
    updateTask(dep2.id, { status: "passed" });
    expect(getReadyTasks().map(t => t.id)).toContain(child.id);
  });

  it("isTaskReady accepts passed (Phase 4B success alias) in deps", () => {
    const dep = createTask({ title: "Dep", description: "d", agentId: "planner" });
    const child = createTask({
      title: "Child", description: "d", agentId: "builder",
      dependencies: [dep.id],
    });
    updateTask(dep.id, { status: "passed" });
    expect(isTaskReady(getTask(child.id)!)).toBe(true);
  });

  it("blocked dep prevents child from being ready", () => {
    const dep = createTask({ title: "Dep", description: "d", agentId: "planner" });
    const child = createTask({
      title: "Child", description: "d", agentId: "builder",
      dependencies: [dep.id],
    });
    updateTask(dep.id, { status: "blocked" });
    expect(isTaskReady(getTask(child.id)!)).toBe(false);
    expect(getReadyTasks().map(t => t.id)).not.toContain(child.id);
  });

  it("three-level chain: grandchild only ready when both parents done", () => {
    const gp = createTask({ title: "Grandparent", description: "d", agentId: "planner" });
    const p  = createTask({ title: "Parent", description: "d", agentId: "researcher", dependencies: [gp.id] });
    const gc = createTask({ title: "Grandchild", description: "d", agentId: "builder", dependencies: [p.id] });

    expect(getReadyTasks().map(t => t.id)).toContain(gp.id);
    expect(getReadyTasks().map(t => t.id)).not.toContain(p.id);
    expect(getReadyTasks().map(t => t.id)).not.toContain(gc.id);

    updateTask(gp.id, { status: "done" });
    expect(getReadyTasks().map(t => t.id)).toContain(p.id);
    expect(getReadyTasks().map(t => t.id)).not.toContain(gc.id);

    updateTask(p.id, { status: "passed" });
    expect(getReadyTasks().map(t => t.id)).toContain(gc.id);
  });
});

// ─── No permission escalation ─────────────────────────────────────────────────

describe("Phase 4B — no permission escalation", () => {
  it("researcher cannot use PATCH_PROPOSAL permission", () => {
    const researcher = {
      permissions: [PERMISSIONS.READ_FILES, PERMISSIONS.READ_CONTEXT, PERMISSIONS.TASK_UPDATE],
    };
    expect(hasPermission(researcher.permissions, PERMISSIONS.PATCH_PROPOSAL)).toBe(false);
  });

  it("planner cannot use CHECKPOINT permission", () => {
    const planner = {
      permissions: [PERMISSIONS.READ_FILES, PERMISSIONS.READ_CONTEXT, PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE],
    };
    expect(hasPermission(planner.permissions, PERMISSIONS.CHECKPOINT)).toBe(false);
  });

  it("builder cannot use ROLLBACK permission", () => {
    const builder = {
      permissions: [PERMISSIONS.READ_FILES, PERMISSIONS.READ_CONTEXT, PERMISSIONS.PATCH_PROPOSAL, PERMISSIONS.TASK_UPDATE],
    };
    expect(hasPermission(builder.permissions, PERMISSIONS.ROLLBACK)).toBe(false);
  });

  it("tester cannot use GIT_COMMIT permission", () => {
    const tester = {
      permissions: [PERMISSIONS.READ_FILES, PERMISSIONS.READ_CONTEXT, PERMISSIONS.TEST_RUNNER, PERMISSIONS.AUTOFIX_TRIGGER, PERMISSIONS.TASK_UPDATE],
    };
    expect(hasPermission(tester.permissions, PERMISSIONS.GIT_COMMIT)).toBe(false);
  });

  it("assertPermission throws PermissionDeniedError and records audit denial", () => {
    const permsBefore = getPermissionDenials().length;
    expect(() =>
      assertPermission([PERMISSIONS.READ_FILES], PERMISSIONS.GIT_COMMIT, "researcher"),
    ).toThrow(PermissionDeniedError);
    expect(getPermissionDenials().length).toBeGreaterThan(permsBefore);
  });
});

// ─── Pause / Resume state (unit) ──────────────────────────────────────────────

describe("Phase 4B — executionState: pause/resume transitions", () => {
  const oid = "pause-test-" + Math.random().toString(36).slice(2);

  beforeEach(() => { resetRun(oid); });

  it("setRunState can transition idle → running → paused → running", () => {
    setRunState(oid, "running");
    expect(getOrchestrationRun(oid)!.state).toBe("running");
    setRunState(oid, "paused");
    expect(getOrchestrationRun(oid)!.state).toBe("paused");
    setRunState(oid, "running");
    expect(getOrchestrationRun(oid)!.state).toBe("running");
  });

  it("timeline records pause and resume events", () => {
    setRunState(oid, "running");
    addTimelineEvent(oid, "plan_paused", { message: "User paused" });
    addTimelineEvent(oid, "plan_resumed", { message: "User resumed" });
    const tl = getTimeline(oid);
    expect(tl.some(e => e.type === "plan_paused")).toBe(true);
    expect(tl.some(e => e.type === "plan_resumed")).toBe(true);
  });
});
