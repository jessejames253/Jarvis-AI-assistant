/**
 * lib/agents/permissions.ts — Phase 4 permission system.
 *
 * Defines a strict, server-side permission model for every agent.
 * Agents cannot escalate their own permissions.
 * Every permission check is logged to the in-memory audit trail.
 */

export const PERMISSIONS = {
  /** Read project files (source code, configs) — no writes */
  READ_FILES:        "READ_FILES",
  /** Read the shared context bus (health, tasks, patches, autofix) */
  READ_CONTEXT:      "READ_CONTEXT",
  /** Propose a patch (adds to pending-patch queue — human must approve) */
  PATCH_PROPOSAL:    "PATCH_PROPOSAL",
  /** Execute allowlisted test / typecheck commands */
  TEST_RUNNER:       "TEST_RUNNER",
  /** Trigger the AutoFix engine analysis */
  AUTOFIX_TRIGGER:   "AUTOFIX_TRIGGER",
  /** Create a snapshot checkpoint before a write */
  CHECKPOINT:        "CHECKPOINT",
  /** Restore a file from a snapshot (rollback) */
  ROLLBACK:          "ROLLBACK",
  /** Read git status, diff, log */
  GIT_STATUS:        "GIT_STATUS",
  /** Create a git commit */
  GIT_COMMIT:        "GIT_COMMIT",
  /** Create tasks in the task graph */
  TASK_CREATE:       "TASK_CREATE",
  /** Update task status / result in the task graph */
  TASK_UPDATE:       "TASK_UPDATE",
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// ─── Audit log ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  agentId:   string;
  action:    Permission;
  allowed:   boolean;
  timestamp: number;
  reason?:   string;
}

const auditLog: AuditEntry[] = [];

function record(entry: AuditEntry): void {
  auditLog.push(entry);
  if (auditLog.length > 2000) auditLog.splice(0, auditLog.length - 2000);
}

// ─── Permission helpers ───────────────────────────────────────────────────────

/** Returns true if the agent's permission set includes the required permission. */
export function hasPermission(
  agentPermissions: Permission[],
  required: Permission,
): boolean {
  return agentPermissions.includes(required);
}

/**
 * Assert that an agent has the required permission.
 * Throws `PermissionDeniedError` if not granted.
 * Always records to the audit log.
 */
export function assertPermission(
  agentPermissions: Permission[],
  required: Permission,
  agentId: string,
): void {
  const allowed = hasPermission(agentPermissions, required);
  record({
    agentId,
    action:    required,
    allowed,
    timestamp: Date.now(),
    reason:    allowed ? undefined : "Not in agent permission set",
  });
  if (!allowed) {
    throw new PermissionDeniedError(agentId, required, agentPermissions);
  }
}

/**
 * Check a permission and return a structured result (non-throwing).
 * Always records to the audit log.
 */
export function checkPermission(
  agentPermissions: Permission[],
  required: Permission,
  agentId: string,
): { allowed: boolean; agentId: string; action: Permission; reason?: string } {
  const allowed = hasPermission(agentPermissions, required);
  record({ agentId, action: required, allowed, timestamp: Date.now() });
  return {
    allowed,
    agentId,
    action: required,
    reason: allowed ? undefined : "Not in agent permission set",
  };
}

/** Returns the last N audit entries (most recent last). */
export function getPermissionAuditLog(limit = 50): AuditEntry[] {
  return auditLog.slice(-limit);
}

/** Returns only the denied entries from the audit log. */
export function getPermissionDenials(limit = 20): AuditEntry[] {
  return auditLog.filter(e => !e.allowed).slice(-limit);
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class PermissionDeniedError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly required: Permission,
    public readonly granted: Permission[],
  ) {
    super(
      `PermissionDenied: Agent '${agentId}' does not have '${required}'. ` +
      `Granted: [${granted.join(", ")}]`,
    );
    this.name = "PermissionDeniedError";
  }
}
