/**
 * lib/dev/context.ts — System-wide Dev context aggregator (Phase 3A).
 *
 * Collects health, patches, improvements, tasks, git status, rollback history,
 * and recent errors into a single snapshot. Used to:
 *   1. Serve GET /api/dev/context for the frontend ContextPill
 *   2. Inject a human-readable summary into every Dev Agent system prompt
 *
 * Read-only — never writes or executes anything.
 */

import { getHealth } from "./health";
import { pendingPatches } from "./tools";
import { getImprovements } from "./improvements";
import { getAllTasks } from "./taskStore";
import { getGitStatus } from "./gitHelper";
import { getAutofixHistory } from "./autofix";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextHealth {
  score: number;
  label: string;
  feErrors: number;
  beErrors: number;
}

export interface ContextPatches {
  count: number;
  /** First 10 file names (basenames) */
  files: string[];
}

export interface ContextImprovements {
  total: number;
  autoFixable: number;
  categories: string[];
}

export interface ContextTaskSummary {
  id: string;
  title: string;
  status: string;
}

export interface ContextTasks {
  open: number;
  recent: ContextTaskSummary[];
}

export interface ContextGit {
  branch: string;
  dirty: boolean;
  changes: number;
}

export interface ContextRollback {
  title: string;
  reason: string;
  at: number;
}

export interface ContextError {
  taskTitle: string;
  error: string;
  at: number;
}

export interface DevContext {
  health: ContextHealth;
  patches: ContextPatches;
  improvements: ContextImprovements;
  tasks: ContextTasks;
  git: ContextGit;
  rollbacks: ContextRollback[];
  errors: ContextError[];
  /** Unix ms when this context snapshot was taken */
  snapshotAt: number;
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

export async function getDevContext(forceHealthRefresh = false): Promise<DevContext> {
  // Fetch everything concurrently; individual failures are handled gracefully
  const [health, git] = await Promise.all([
    getHealth(forceHealthRefresh).catch(() => null),
    getGitStatus().catch(() => ({ available: false as const, branch: "main", clean: true, changes: [] })),
  ]);

  // Synchronous store reads — no I/O
  const patches       = Array.from(pendingPatches.values());
  const allImprovements = getImprovements();
  const allTasks      = getAllTasks();
  const autofixHist   = getAutofixHistory();

  const activeImps = allImprovements.filter(
    i => !["applied", "rejected"].includes(i.status),
  );
  const autoFixable = activeImps.filter(i => i.autoFixable).length;
  const categories  = [...new Set(activeImps.map(i => i.category))];

  const openTasks = allTasks.filter(
    t => !["cancelled", "applied", "completed"].includes(t.status),
  );

  const recentRollbacks: ContextRollback[] = autofixHist
    .filter(h => h.rolledBack)
    .slice(-5)
    .reverse()
    .map(h => ({
      title:  h.improvementTitle,
      reason: h.rollbackReason ?? "validation failed",
      at:     h.appliedAt,
    }));

  const recentErrors: ContextError[] = allTasks
    .filter(t => t.lastError)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)
    .map(t => ({ taskTitle: t.title, error: t.lastError!, at: t.updatedAt }));

  return {
    health: {
      score:    health?.score    ?? 100,
      label:    health?.label    ?? "healthy",
      feErrors: health?.typescript?.frontend?.errorCount ?? 0,
      beErrors: health?.typescript?.backend?.errorCount  ?? 0,
    },
    patches: {
      count: patches.length,
      files: patches.map(p => p.file.split("/").pop() ?? p.file).slice(0, 10),
    },
    improvements: {
      total: activeImps.length,
      autoFixable,
      categories: categories.slice(0, 8),
    },
    tasks: {
      open: openTasks.length,
      recent: openTasks.slice(0, 5).map(t => ({
        id:     t.id,
        title:  t.title,
        status: t.status,
      })),
    },
    git: {
      branch:  git.branch  ?? "main",
      dirty:   !(git.clean ?? true),
      changes: (git.changes ?? []).length,
    },
    rollbacks: recentRollbacks,
    errors:    recentErrors,
    snapshotAt: Date.now(),
  };
}

// ─── Prompt formatter ─────────────────────────────────────────────────────────

/**
 * Produces a concise Markdown block that is appended to the Dev Agent system
 * prompt on every invocation. Keeps the model aware of the project's live
 * state without large context windows.
 */
export function formatContextForPrompt(ctx: DevContext): string {
  const lines: string[] = ["## Live system context (read-only snapshot)"];

  // Health
  const feErr = ctx.health.feErrors > 0 ? ` — ${ctx.health.feErrors} frontend TS error${ctx.health.feErrors !== 1 ? "s" : ""}` : "";
  const beErr = ctx.health.beErrors > 0 ? `, ${ctx.health.beErrors} backend TS error${ctx.health.beErrors !== 1 ? "s" : ""}` : "";
  lines.push(`- **Health**: ${ctx.health.score}/100 (${ctx.health.label})${feErr}${beErr}`);

  // Patches
  if (ctx.patches.count > 0) {
    lines.push(`- **Pending patches**: ${ctx.patches.count} file${ctx.patches.count !== 1 ? "s" : ""} awaiting review — ${ctx.patches.files.join(", ")}`);
  } else {
    lines.push(`- **Pending patches**: none`);
  }

  // Improvements
  if (ctx.improvements.total > 0) {
    lines.push(
      `- **Proposed improvements**: ${ctx.improvements.total}` +
      (ctx.improvements.autoFixable > 0 ? ` (${ctx.improvements.autoFixable} auto-fixable)` : "") +
      (ctx.improvements.categories.length > 0 ? ` — categories: ${ctx.improvements.categories.join(", ")}` : ""),
    );
  } else {
    lines.push(`- **Proposed improvements**: none`);
  }

  // Tasks
  if (ctx.tasks.open > 0) {
    lines.push(`- **Open tasks**: ${ctx.tasks.open}`);
    for (const t of ctx.tasks.recent.slice(0, 3)) {
      lines.push(`  • [${t.status}] ${t.title}`);
    }
  } else {
    lines.push(`- **Open tasks**: none`);
  }

  // Git
  const gitLine = ctx.git.dirty
    ? `branch \`${ctx.git.branch}\`, ${ctx.git.changes} uncommitted change${ctx.git.changes !== 1 ? "s" : ""}`
    : `branch \`${ctx.git.branch}\`, working tree clean`;
  lines.push(`- **Git**: ${gitLine}`);

  // Rollbacks
  if (ctx.rollbacks.length > 0) {
    lines.push(`- **Recent rollbacks**: ${ctx.rollbacks.length}`);
    for (const r of ctx.rollbacks.slice(0, 2)) {
      lines.push(`  • "${r.title}" — ${r.reason}`);
    }
  }

  // Errors
  if (ctx.errors.length > 0) {
    lines.push(`- **Recent task errors**: ${ctx.errors.length}`);
    for (const e of ctx.errors.slice(0, 2)) {
      lines.push(`  • [${e.taskTitle}] ${e.error.slice(0, 100)}`);
    }
  }

  lines.push(`\n_Context snapshot taken at ${new Date(ctx.snapshotAt).toISOString()}_`);
  lines.push(`\nIMPORTANT: This context is informational only. Do NOT auto-apply patches or improvements based on this. All changes require explicit human approval.`);

  return lines.join("\n");
}

// ─── Suggested tasks ──────────────────────────────────────────────────────────

export interface TaskSuggestion {
  label: string;
  prompt: string;
  priority: "high" | "medium" | "low";
}

/**
 * Generates up to 5 human-readable task suggestions based on the current
 * context. These are surfaced as clickable prompts in the chat UI — the user
 * clicks to pre-fill their input. Nothing executes autonomously.
 */
export function suggestTasksFromContext(ctx: DevContext): TaskSuggestion[] {
  const suggestions: TaskSuggestion[] = [];

  // TypeScript errors → suggest fixing them
  const totalTsErrors = ctx.health.feErrors + ctx.health.beErrors;
  if (totalTsErrors > 0) {
    suggestions.push({
      label: `Fix ${totalTsErrors} TypeScript error${totalTsErrors !== 1 ? "s" : ""}`,
      prompt: `There ${totalTsErrors === 1 ? "is" : "are"} ${totalTsErrors} TypeScript error${totalTsErrors !== 1 ? "s" : ""} in the codebase (${ctx.health.feErrors} frontend, ${ctx.health.beErrors} backend). Please find and fix the most impactful one.`,
      priority: "high",
    });
  }

  // Pending patches → suggest reviewing them
  if (ctx.patches.count > 0) {
    suggestions.push({
      label: `Review ${ctx.patches.count} pending patch${ctx.patches.count !== 1 ? "es" : ""}`,
      prompt: `There ${ctx.patches.count === 1 ? "is" : "are"} ${ctx.patches.count} pending patch${ctx.patches.count !== 1 ? "es" : ""} waiting for review (files: ${ctx.patches.files.join(", ")}). Please explain what each one does so I can decide whether to apply it.`,
      priority: "medium",
    });
  }

  // Auto-fixable improvements
  if (ctx.improvements.autoFixable > 0) {
    suggestions.push({
      label: `Apply ${ctx.improvements.autoFixable} low-risk fix${ctx.improvements.autoFixable !== 1 ? "es" : ""}`,
      prompt: `There ${ctx.improvements.autoFixable === 1 ? "is" : "are"} ${ctx.improvements.autoFixable} auto-fixable low-risk improvement${ctx.improvements.autoFixable !== 1 ? "s" : ""} ready. Please describe each one so I can decide which to apply first.`,
      priority: "low",
    });
  }

  // Open tasks not in a stable state
  if (ctx.tasks.open > 0) {
    const waiting = ctx.tasks.recent.find(t => t.status === "waiting_approval");
    if (waiting) {
      suggestions.push({
        label: `Resume: "${waiting.title.slice(0, 32)}…"`,
        prompt: `Resume the open task: "${waiting.title}". Please summarize what was proposed and what I need to do next.`,
        priority: "medium",
      });
    }
  }

  // Git dirty → suggest reviewing changes
  if (ctx.git.dirty && ctx.git.changes > 0) {
    suggestions.push({
      label: `Review ${ctx.git.changes} uncommitted change${ctx.git.changes !== 1 ? "s" : ""}`,
      prompt: `There ${ctx.git.changes === 1 ? "is" : "are"} ${ctx.git.changes} uncommitted file${ctx.git.changes !== 1 ? "s" : ""} on branch \`${ctx.git.branch}\`. Please list what changed and whether it's safe to commit.`,
      priority: "low",
    });
  }

  return suggestions.slice(0, 5);
}
