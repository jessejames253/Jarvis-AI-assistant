/**
 * lib/autonomy/improvementCycle.ts — Phase 6 improvement cycle types and state.
 *
 * Defines the seven supported cycle types, their goal prompts, and the
 * persistent cycle records. Also provides the CycleReport structure generated
 * at the end of each run.
 *
 * Cycle records are persisted to /tmp so the UI can poll state across
 * HTTP requests and the user can pause/stop mid-cycle.
 */

import { randomUUID }      from "crypto";
import { PersistentStore } from "../memory/memoryStore";
import type { BudgetConfig, BudgetSummary } from "./autonomyBudget";

// ─── Cycle types ──────────────────────────────────────────────────────────────

export type CycleType =
  | "fix_ts_errors"
  | "reduce_risk_hotspots"
  | "improve_unstable_modules"
  | "clean_unused_code"
  | "improve_tests"
  | "improve_documentation"
  | "strengthen_validation";

export const CYCLE_META: Record<CycleType, { label: string; description: string; defaultRisk: number }> = {
  fix_ts_errors: {
    label:       "Fix TypeScript Errors",
    description: "Resolve recurring TypeScript compile errors detected in project history",
    defaultRisk: 20,
  },
  reduce_risk_hotspots: {
    label:       "Reduce Risk Hotspots",
    description: "Refactor high-risk, high-coupling modules identified by the architecture graph",
    defaultRisk: 50,
  },
  improve_unstable_modules: {
    label:       "Improve Unstable Modules",
    description: "Stabilise modules that have required multiple rollbacks or repeated failures",
    defaultRisk: 45,
  },
  clean_unused_code: {
    label:       "Clean Unused Code",
    description: "Remove dead code, unused imports, and unreferenced exports",
    defaultRisk: 25,
  },
  improve_tests: {
    label:       "Improve Test Coverage",
    description: "Add or strengthen tests for poorly-covered or high-failure-rate modules",
    defaultRisk: 15,
  },
  improve_documentation: {
    label:       "Improve Documentation",
    description: "Add or update JSDoc comments and module-level documentation",
    defaultRisk: 10,
  },
  strengthen_validation: {
    label:       "Strengthen Validation",
    description: "Improve type-check gates, health checks, and validation pipeline coverage",
    defaultRisk: 30,
  },
};

// ─── Cycle state ──────────────────────────────────────────────────────────────

export type CycleState = "idle" | "running" | "paused" | "completed" | "stopped" | "failed";

export interface ProposedImprovement {
  title:           string;
  description:     string;
  cycleType:       CycleType;
  expectedBenefit: string;
  riskScore:       number;
  confidence:      number;
  affectedFiles:   string[];
  testPlan:        string;
  rollbackPlan:    string;
  memoryEvidence:  string[];
}

export interface CycleReport {
  cycleId:             string;
  type:                CycleType;
  state:               CycleState;
  tasksCompleted:      number;
  tasksFailed:         number;
  patchesProposed:     number;
  patchesApplied:      number;
  patchesRolledBack:   number;
  budgetSummary:       BudgetSummary;
  memoryEvidenceUsed:  string[];
  durationMs:          number;
  summary:             string;
  auditEntries:        number;
  stoppedReason?:      string;
}

export interface ImprovementCycle {
  id:                  string;
  type:                CycleType;
  state:               CycleState;
  budget:              BudgetConfig;
  orchestrationId?:    string;
  plannerTaskId?:      string;
  startedAt?:          number;
  completedAt?:        number;
  tasks:               string[];
  patchesProposed:     number;
  patchesApplied:      number;
  patchesRolledBack:   number;
  memoryEvidence:      string[];
  report?:             CycleReport;
  currentTaskTitle?:   string;
  currentAgentId?:     string;
  approvalsPending:    number;
  stoppedReason?:      string;
  budgetSnapshot?:     BudgetSummary;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const store = new PersistentStore<ImprovementCycle>("/tmp/jarvis_cycles.json", 50);

// ─── Cycle CRUD ───────────────────────────────────────────────────────────────

export function createCycle(type: CycleType, budget: BudgetConfig): ImprovementCycle {
  const cycle: ImprovementCycle = {
    id:               randomUUID(),
    type,
    state:            "running",
    budget,
    tasks:            [],
    patchesProposed:  0,
    patchesApplied:   0,
    patchesRolledBack: 0,
    memoryEvidence:   [],
    approvalsPending: 0,
    startedAt:        Date.now(),
  };
  store.set(cycle);
  return cycle;
}

export function saveCycle(cycle: ImprovementCycle): ImprovementCycle {
  return store.set(cycle);
}

export function getCycle(id: string): ImprovementCycle | undefined {
  return store.get(id);
}

export function getActiveCycle(): ImprovementCycle | undefined {
  return store.filter(c => c.state === "running" || c.state === "paused")[0];
}

export function listCycles(limit = 20): ImprovementCycle[] {
  return store.all()
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, limit);
}

export function updateCycleState(id: string, state: CycleState): ImprovementCycle | null {
  return store.patch(id, { state });
}

// ─── Goal builder ─────────────────────────────────────────────────────────────

export function buildCycleGoal(
  type: CycleType,
  memoryEvidence: string[],
  budget: BudgetConfig,
): string {
  const meta = CYCLE_META[type];
  const evidenceBlock = memoryEvidence.length > 0
    ? `\n\nMemory evidence:\n${memoryEvidence.map(e => `• ${e}`).join("\n")}`
    : "";

  return [
    `AUTONOMY CYCLE: ${type} (${meta.label})`,
    `Goal: ${meta.description}`,
    ``,
    `HARD CONSTRAINTS (must not exceed):`,
    `- Max tasks: ${budget.maxTasks}`,
    `- Max patch proposals: ${budget.maxPatchProposals}`,
    `- Max applied patches: ${budget.maxAppliedPatches}`,
    `- Max files changed: ${budget.maxFiles}`,
    `- Max lines changed: ${budget.maxLines}`,
    `- Do NOT touch: auth, payment, migrations, .env, permissions.ts, rollback/checkpoint files`,
    evidenceBlock,
    ``,
    `Create a minimal, safe, bounded improvement plan respecting all constraints.`,
    `Focus only on safe, low-risk improvements with clear rollback paths.`,
  ].join("\n");
}

// ─── Proposal builder ─────────────────────────────────────────────────────────

export function buildProposals(
  patterns: Array<{ type: string; recommendation: string; confidence: number; affectedFiles?: string[] }>,
  hotspots: Array<{ name: string; riskScore: number; type: string }>,
): ProposedImprovement[] {
  const proposals: ProposedImprovement[] = [];

  // TS error patterns → fix_ts_errors
  const tsErrors = patterns.filter(p => p.type === "recurring_failure");
  for (const p of tsErrors.slice(0, 2)) {
    proposals.push({
      title:           `Fix recurring failures: ${p.affectedFiles?.[0]?.split("/").pop() ?? "module"}`,
      description:     p.recommendation,
      cycleType:       "fix_ts_errors",
      expectedBenefit: "Eliminate recurring validation failures, improve stability",
      riskScore:       25,
      confidence:      p.confidence,
      affectedFiles:   p.affectedFiles ?? [],
      testPlan:        "Run full tsc --noEmit and test suite after applying fix",
      rollbackPlan:    "Git checkpoint created before any patch; rollback via GitAgent",
      memoryEvidence:  [p.recommendation],
    });
  }

  // Unstable files → improve_unstable_modules
  const unstable = patterns.filter(p => p.type === "unstable_file");
  for (const p of unstable.slice(0, 2)) {
    proposals.push({
      title:           `Stabilise: ${p.affectedFiles?.[0]?.split("/").pop() ?? "module"}`,
      description:     p.recommendation,
      cycleType:       "improve_unstable_modules",
      expectedBenefit: "Reduce rollback frequency, improve long-term stability",
      riskScore:       40,
      confidence:      p.confidence,
      affectedFiles:   p.affectedFiles ?? [],
      testPlan:        "Run targeted tests + validation pipeline after change",
      rollbackPlan:    "Git checkpoint before patch; AutoFix rollback if validation fails",
      memoryEvidence:  [p.recommendation],
    });
  }

  // High-risk hotspots → reduce_risk_hotspots
  for (const h of hotspots.slice(0, 2)) {
    proposals.push({
      title:           `Reduce risk: ${h.name} (${h.type})`,
      description:     `Reduce coupling strength and risk score of ${h.name}`,
      cycleType:       "reduce_risk_hotspots",
      expectedBenefit: "Lower system-wide coupling, reduce failure blast radius",
      riskScore:       h.riskScore,
      confidence:      60,
      affectedFiles:   [],
      testPlan:        "Run full validation suite after refactoring",
      rollbackPlan:    "Git checkpoint before any structural change",
      memoryEvidence:  [`${h.name} has risk score ${h.riskScore} in architecture graph`],
    });
  }

  // Always suggest doc / test improvement as low-risk options
  proposals.push({
    title:           "Improve documentation coverage",
    description:     "Add JSDoc comments to exported functions lacking documentation",
    cycleType:       "improve_documentation",
    expectedBenefit: "Improve code readability and future maintainability",
    riskScore:       8,
    confidence:      80,
    affectedFiles:   [],
    testPlan:        "Check TypeScript compiles without errors",
    rollbackPlan:    "Git checkpoint before changes; revert if test fails",
    memoryEvidence:  [],
  });

  proposals.push({
    title:           "Strengthen test coverage",
    description:     "Add tests for modules with low coverage or recent failures",
    cycleType:       "improve_tests",
    expectedBenefit: "Catch regressions earlier, improve confidence in patches",
    riskScore:       12,
    confidence:      75,
    affectedFiles:   [],
    testPlan:        "Run full test suite to confirm new tests pass",
    rollbackPlan:    "Tests are additive; removing them does not break the build",
    memoryEvidence:  [],
  });

  return proposals
    .sort((a, b) => a.riskScore - b.riskScore) // safest first
    .slice(0, 6);
}
