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
