/**
 * lib/autonomy/autonomyBudget.ts — Phase 6 autonomy budget tracking.
 *
 * Each improvement cycle runs under a strict budget. Exceeding any limit
 * is a HARD STOP — the cycle terminates immediately and a budget_exceeded
 * event is logged.
 *
 * Default conservative budget:
 *   3 tasks · 3 patch proposals · 2 applied patches · 2 retries total
 *   2 files changed · 80 changed lines · 10 minutes max · 2 autofix attempts
 *
 * The budget tracker is in-memory per cycle run (created fresh from the
 * persisted BudgetConfig each time a cycle starts).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetConfig {
  maxTasks:           number;  // default 3
  maxPatchProposals:  number;  // default 3
  maxAppliedPatches:  number;  // default 2
  maxRetries:         number;  // default 2
  maxFiles:           number;  // default 2
  maxLines:           number;  // default 80
  maxRuntimeMs:       number;  // default 600_000 (10 min)
  maxAutoFixAttempts: number;  // default 2
  maxModelCalls?:     number;  // optional tracking
}

export const DEFAULT_BUDGET: BudgetConfig = {
  maxTasks:           3,
  maxPatchProposals:  3,
  maxAppliedPatches:  2,
  maxRetries:         2,
  maxFiles:           2,
  maxLines:           80,
  maxRuntimeMs:       600_000,
  maxAutoFixAttempts: 2,
};

export interface BudgetUsage {
  tasks:            number;
  patchProposals:   number;
  appliedPatches:   number;
  retries:          number;
  filesChanged:     string[];
  linesChanged:     number;
  startedAt:        number;
  elapsedMs:        number;
  modelCalls:       number;
  autoFixAttempts:  number;
}

export interface BudgetCheck {
  allowed:   boolean;
  reason?:   string;
  remaining: Partial<Record<string, number>>;
}

export interface BudgetSummary {
  config:    BudgetConfig;
  usage:     BudgetUsage;
  remaining: Record<string, number>;
  exhausted: boolean;
}

// ─── Tracker class ────────────────────────────────────────────────────────────

export class BudgetTracker {
  private usage: BudgetUsage;

  constructor(readonly config: BudgetConfig) {
    this.usage = {
      tasks:           0,
      patchProposals:  0,
      appliedPatches:  0,
      retries:         0,
      filesChanged:    [],
      linesChanged:    0,
      startedAt:       Date.now(),
      elapsedMs:       0,
      modelCalls:      0,
      autoFixAttempts: 0,
    };
  }

  // ── Task budget ──────────────────────────────────────────────────────────

  checkTask(): BudgetCheck {
    const rtCheck = this.checkRuntime();
    if (!rtCheck.allowed) return rtCheck;
    if (this.usage.tasks >= this.config.maxTasks) {
      return { allowed: false, reason: `Task budget exhausted (max ${this.config.maxTasks})`, remaining: this.remaining() };
    }
    return { allowed: true, remaining: this.remaining() };
  }

  consumeTask(): void { this.usage.tasks++; this.touch(); }

  // ── Patch budget ─────────────────────────────────────────────────────────

  checkPatchProposal(): BudgetCheck {
    const rtCheck = this.checkRuntime();
    if (!rtCheck.allowed) return rtCheck;
    if (this.usage.patchProposals >= this.config.maxPatchProposals) {
      return { allowed: false, reason: `Patch proposal budget exhausted (max ${this.config.maxPatchProposals})`, remaining: this.remaining() };
    }
    return { allowed: true, remaining: this.remaining() };
  }

  consumePatchProposal(): void { this.usage.patchProposals++; this.touch(); }

  checkApplyPatch(newFiles: string[], newLines: number): BudgetCheck {
    const rtCheck = this.checkRuntime();
    if (!rtCheck.allowed) return rtCheck;
    if (this.usage.appliedPatches >= this.config.maxAppliedPatches) {
      return { allowed: false, reason: `Applied patch budget exhausted (max ${this.config.maxAppliedPatches})`, remaining: this.remaining() };
    }
    const totalFiles = new Set([...this.usage.filesChanged, ...newFiles]).size;
    if (totalFiles > this.config.maxFiles) {
      return { allowed: false, reason: `File change budget exceeded (max ${this.config.maxFiles} files)`, remaining: this.remaining() };
    }
    if (this.usage.linesChanged + newLines > this.config.maxLines) {
      return { allowed: false, reason: `Line change budget exceeded (max ${this.config.maxLines} lines)`, remaining: this.remaining() };
    }
    return { allowed: true, remaining: this.remaining() };
  }

  consumeApplyPatch(files: string[], lines: number): void {
    this.usage.appliedPatches++;
    for (const f of files) {
      if (!this.usage.filesChanged.includes(f)) this.usage.filesChanged.push(f);
    }
    this.usage.linesChanged += lines;
    this.touch();
  }

  // ── Retry budget ─────────────────────────────────────────────────────────

  checkRetry(): BudgetCheck {
    if (this.usage.retries >= this.config.maxRetries) {
      return { allowed: false, reason: `Retry budget exhausted (max ${this.config.maxRetries})`, remaining: this.remaining() };
    }
    return { allowed: true, remaining: this.remaining() };
  }

  consumeRetry(): void { this.usage.retries++; this.touch(); }

  // ── AutoFix budget ───────────────────────────────────────────────────────

  checkAutoFix(): BudgetCheck {
    if (this.usage.autoFixAttempts >= this.config.maxAutoFixAttempts) {
      return { allowed: false, reason: `AutoFix budget exhausted (max ${this.config.maxAutoFixAttempts})`, remaining: this.remaining() };
    }
    return { allowed: true, remaining: this.remaining() };
  }

  consumeAutoFix(): void { this.usage.autoFixAttempts++; this.touch(); }

  // ── Runtime budget ───────────────────────────────────────────────────────

  checkRuntime(): BudgetCheck {
    const elapsed = Date.now() - this.usage.startedAt;
    this.usage.elapsedMs = elapsed;
    if (elapsed >= this.config.maxRuntimeMs) {
      return {
        allowed: false,
        reason:  `Runtime budget exceeded (${Math.round(elapsed / 1000)}s / max ${Math.round(this.config.maxRuntimeMs / 1000)}s)`,
        remaining: this.remaining(),
      };
    }
    return { allowed: true, remaining: this.remaining() };
  }

  // ── Model call tracking ──────────────────────────────────────────────────

  consumeModelCall(): void { this.usage.modelCalls++; }

  checkModelCall(): BudgetCheck {
    if (this.config.maxModelCalls != null && this.usage.modelCalls >= this.config.maxModelCalls) {
      return { allowed: false, reason: `Model call budget exhausted (max ${this.config.maxModelCalls})`, remaining: this.remaining() };
    }
    return { allowed: true, remaining: this.remaining() };
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  getUsage(): BudgetUsage {
    this.usage.elapsedMs = Date.now() - this.usage.startedAt;
    return { ...this.usage, filesChanged: [...this.usage.filesChanged] };
  }

  isExhausted(): boolean {
    return (
      this.usage.tasks           >= this.config.maxTasks           ||
      this.usage.appliedPatches  >= this.config.maxAppliedPatches  ||
      !this.checkRuntime().allowed
    );
  }

  getSummary(): BudgetSummary {
    const usage = this.getUsage();
    return {
      config:    { ...this.config },
      usage,
      remaining: this.remaining(),
      exhausted: this.isExhausted(),
    };
  }

  private remaining(): Record<string, number> {
    const elapsed = Date.now() - this.usage.startedAt;
    return {
      tasks:           this.config.maxTasks           - this.usage.tasks,
      patchProposals:  this.config.maxPatchProposals  - this.usage.patchProposals,
      appliedPatches:  this.config.maxAppliedPatches  - this.usage.appliedPatches,
      retries:         this.config.maxRetries          - this.usage.retries,
      files:           this.config.maxFiles            - this.usage.filesChanged.length,
      lines:           this.config.maxLines            - this.usage.linesChanged,
      runtimeMs:       Math.max(0, this.config.maxRuntimeMs - elapsed),
      autoFixAttempts: this.config.maxAutoFixAttempts  - this.usage.autoFixAttempts,
    };
  }

  private touch(): void {
    this.usage.elapsedMs = Date.now() - this.usage.startedAt;
  }
}
