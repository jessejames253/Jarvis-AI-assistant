/**
 * lib/agentActionExecutor.ts — Dry-run executor for agent actions
 *
 * SAFE BY DESIGN:
 *   - No file writes, reads of arbitrary paths, destructive shell commands,
 *     or network calls are performed here.
 *   - Analysis is done purely from the action's metadata (title, description,
 *     riskLevel) using deterministic keyword matching.
 *   - Real execution is NOT implemented and must not be added without an
 *     explicit, separately reviewed "executionMode: manual" feature gate.
 *
 * Returns a structured DryRunResult describing what the action WOULD do,
 * the safety checks that WOULD apply, estimated impact, and a verdict.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DryRunVerdict = "safe" | "caution" | "blocked";

export interface DryRunStep {
  step:        string;
  description: string;
  safe:        boolean;
}

export interface DryRunSafetyCheck {
  check:   string;
  passed:  boolean;
  note?:   string;
}

export interface DryRunResult {
  verdict:          DryRunVerdict;
  summary:          string;
  steps:            DryRunStep[];
  estimatedImpact:  string[];
  safetyChecks:     DryRunSafetyCheck[];
  risks:            string[];
  ranAt:            string;
}

// ─── Category detection ───────────────────────────────────────────────────────

type Category =
  | "destructive_file"
  | "cache_clear"
  | "deploy"
  | "config_change"
  | "network"
  | "database"
  | "code_change"
  | "process_control"
  | "build"
  | "general";

interface CategoryRule {
  category: Category;
  patterns: RegExp[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "destructive_file",
    patterns: [/\b(wipe|delete|remove|erase|purge|drop|destroy|truncat)\b/i],
  },
  {
    category: "cache_clear",
    patterns: [/\b(cache|cach|temp|tmp|artifact|dist|build output)\b/i],
  },
  {
    category: "deploy",
    patterns: [/\b(deploy|publish|release|ship|rollout|go.?live|push.*(prod|staging))\b/i],
  },
  {
    category: "config_change",
    patterns: [/\b(config|setting|env(ironment)?|variable|flag|feature.flag|toggle)\b/i],
  },
  {
    category: "network",
    patterns: [/\b(api|http|webhook|fetch|request|endpoint|socket|cors|proxy)\b/i],
  },
  {
    category: "database",
    patterns: [/\b(database|db|sql|query|migration|schema|table|column|index|record)\b/i],
  },
  {
    category: "code_change",
    patterns: [/\b(refactor|rewrite|modify|patch|fix|update.*code|lint|format)\b/i],
  },
  {
    category: "process_control",
    patterns: [/\b(restart|start|stop|kill|spawn|process|service|daemon|worker|pod)\b/i],
  },
  {
    category: "build",
    patterns: [/\b(build|compile|bundle|install|package|pnpm|npm|yarn|pip)\b/i],
  },
];

function detectCategories(text: string): Category[] {
  const matched: Category[] = [];
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some(p => p.test(text))) {
      if (!matched.includes(rule.category)) matched.push(rule.category);
    }
  }
  return matched.length > 0 ? matched : ["general"];
}

// ─── Per-category step templates ─────────────────────────────────────────────

type CategoryPlan = {
  steps:           DryRunStep[];
  estimatedImpact: string[];
  risks:           string[];
};

function planForCategory(category: Category): CategoryPlan {
  switch (category) {
    case "destructive_file":
      return {
        steps: [
          { step: "Scan target paths",   description: "Identify all files and directories matching the action scope.", safe: true },
          { step: "Verify permissions",  description: "Check that the process has write access to the targets.", safe: true },
          { step: "Snapshot manifest",   description: "Record a manifest of items that would be removed.", safe: true },
          { step: "Dry-delete (skip)",   description: "In a real run, the identified items would be permanently removed.", safe: false },
        ],
        estimatedImpact: [
          "One or more files or directories would be permanently removed.",
          "This operation cannot be undone without a backup.",
        ],
        risks: [
          "Data loss if the wrong paths are matched.",
          "Downstream services depending on the deleted files may break.",
        ],
      };

    case "cache_clear":
      return {
        steps: [
          { step: "Locate cache directory", description: "Find the configured cache or artifact output path.", safe: true },
          { step: "Calculate size",          description: "Measure total size of cached data to be cleared.", safe: true },
          { step: "Dry-clear (skip)",        description: "In a real run, all cache entries would be deleted.", safe: false },
        ],
        estimatedImpact: [
          "Cached or temporary build artifacts would be removed.",
          "Next build or operation will need to regenerate from scratch (slower).",
        ],
        risks: [
          "Increased build time until cache is rebuilt.",
          "Potential downtime if running services depend on cached state.",
        ],
      };

    case "deploy":
      return {
        steps: [
          { step: "Pre-flight checks",    description: "Verify build artifacts are current and passing tests.", safe: true },
          { step: "Snapshot current rev", description: "Record the currently deployed revision for rollback.", safe: true },
          { step: "Dry-push (skip)",      description: "In a real run, the new version would be pushed to the target environment.", safe: false },
          { step: "Health check (skip)",  description: "In a real run, post-deploy health checks would run.", safe: true },
        ],
        estimatedImpact: [
          "Running production or staging environment would be updated.",
          "Users may experience brief downtime during the deploy window.",
        ],
        risks: [
          "Untested code reaching production.",
          "Rollback required if health checks fail after deploy.",
        ],
      };

    case "config_change":
      return {
        steps: [
          { step: "Validate schema",        description: "Check the proposed config values against their expected types.", safe: true },
          { step: "Diff current vs proposed", description: "Identify what values would change.", safe: true },
          { step: "Dry-apply (skip)",        description: "In a real run, configuration would be written to disk or environment.", safe: false },
          { step: "Reload check (skip)",     description: "Services that read this config may need a restart.", safe: true },
        ],
        estimatedImpact: [
          "Application configuration or environment variables would change.",
          "Services reading these values may behave differently after reload.",
        ],
        risks: [
          "Incorrect values could cause service failures.",
          "Sensitive config changes should be reviewed for secret exposure.",
        ],
      };

    case "network":
      return {
        steps: [
          { step: "Resolve endpoint",    description: "Determine the target URL or socket address.", safe: true },
          { step: "Auth check",          description: "Verify that required credentials or API keys are available.", safe: true },
          { step: "Dry-request (skip)",  description: "In a real run, an HTTP request or socket call would be made.", safe: false },
        ],
        estimatedImpact: [
          "An external or internal API endpoint would be called.",
          "Rate limits or quotas on the target API may be consumed.",
        ],
        risks: [
          "Unexpected API responses could trigger downstream side-effects.",
          "Credentials must be valid and scoped correctly.",
        ],
      };

    case "database":
      return {
        steps: [
          { step: "Parse query/migration",  description: "Validate SQL or migration syntax without executing.", safe: true },
          { step: "Estimate row count",      description: "Estimate how many rows would be affected.", safe: true },
          { step: "Dry-execute (skip)",      description: "In a real run, the query or migration would be applied to the database.", safe: false },
          { step: "Rollback plan (skip)",    description: "A rollback script would need to be prepared before real execution.", safe: true },
        ],
        estimatedImpact: [
          "Database schema or data would be modified.",
          "Depending on query scope, many rows could be affected.",
        ],
        risks: [
          "Irreversible data changes without a prior backup.",
          "Schema changes may break running application queries.",
          "Long-running queries can lock tables and degrade performance.",
        ],
      };

    case "code_change":
      return {
        steps: [
          { step: "Identify target files", description: "Determine which source files the change would affect.", safe: true },
          { step: "Type-check (dry)",      description: "Simulate a TypeScript or lint pass on the proposed changes.", safe: true },
          { step: "Dry-apply (skip)",      description: "In a real run, files would be modified on disk.", safe: false },
          { step: "Test run (skip)",       description: "In a real run, the test suite would be executed to verify correctness.", safe: true },
        ],
        estimatedImpact: [
          "Source code files would be modified.",
          "All downstream tests touching modified files should be re-run.",
        ],
        risks: [
          "Breaking changes to exported interfaces.",
          "Untested code paths may introduce regressions.",
        ],
      };

    case "process_control":
      return {
        steps: [
          { step: "Identify process",     description: "Locate the target process or service by name or PID.", safe: true },
          { step: "Dependency check",     description: "Check if other services depend on this process.", safe: true },
          { step: "Dry-signal (skip)",    description: "In a real run, a start/stop/restart signal would be sent.", safe: false },
        ],
        estimatedImpact: [
          "A running process or service would be started, stopped, or restarted.",
          "Brief downtime for dependent services during the transition.",
        ],
        risks: [
          "Stopping a critical service could cause cascading failures.",
          "In-flight requests may be dropped during restart.",
        ],
      };

    case "build":
      return {
        steps: [
          { step: "Check lockfile",      description: "Verify pnpm-lock.yaml is up to date and consistent.", safe: true },
          { step: "Validate manifests",  description: "Check package.json files for missing scripts or bad versions.", safe: true },
          { step: "Dry-install (skip)",  description: "In a real run, packages would be installed or the project compiled.", safe: false },
        ],
        estimatedImpact: [
          "Project dependencies may be installed or upgraded.",
          "Build output artifacts would be (re)generated.",
        ],
        risks: [
          "New package versions may introduce breaking changes.",
          "Build failures halt downstream CI/CD pipelines.",
        ],
      };

    default:
      return {
        steps: [
          { step: "Analyse action scope",  description: "Inspect the action title and description for implied operations.", safe: true },
          { step: "Dry-simulate (skip)",   description: "In a real run, the described operation would be carried out.", safe: false },
        ],
        estimatedImpact: [
          "The exact impact depends on the action's underlying implementation.",
        ],
        risks: [
          "Unclassified action — manual review recommended before real execution.",
        ],
      };
  }
}

// ─── Safety checks ────────────────────────────────────────────────────────────

function buildSafetyChecks(
  categories:  Category[],
  riskLevel:   string,
  text:        string,
): DryRunSafetyCheck[] {
  const checks: DryRunSafetyCheck[] = [
    {
      check:  "Action is approved",
      passed: true,
      note:   "Only approved actions may be dry-run.",
    },
    {
      check:  "Execution mode is dry-run",
      passed: true,
      note:   "No real operations will be performed.",
    },
    {
      check:  "Risk level acknowledged",
      passed: riskLevel !== "high",
      note:   riskLevel === "high"
        ? "High-risk action — extra caution required before real execution."
        : `Risk level is ${riskLevel}.`,
    },
  ];

  if (categories.includes("destructive_file") || categories.includes("database")) {
    checks.push({
      check:  "Backup / snapshot exists",
      passed: false,
      note:   "A backup or snapshot should be verified before real execution of destructive operations.",
    });
  }

  if (categories.includes("deploy")) {
    checks.push({
      check:  "Tests pass",
      passed: false,
      note:   "Test suite result is not known at dry-run time — must be verified before real deploy.",
    });
  }

  const hasSensitiveKeyword = /\b(secret|password|token|credential|key|auth)\b/i.test(text);
  if (hasSensitiveKeyword) {
    checks.push({
      check:  "No secret exposure",
      passed: false,
      note:   "Action mentions credentials or secrets — ensure values are not logged during real execution.",
    });
  }

  return checks;
}

// ─── Verdict logic ────────────────────────────────────────────────────────────

function computeVerdict(
  categories:    Category[],
  riskLevel:     string,
  safetyChecks:  DryRunSafetyCheck[],
): DryRunVerdict {
  const failedCritical = safetyChecks.filter(c =>
    !c.passed && (c.check === "Backup / snapshot exists" || c.check === "No secret exposure"),
  );

  if (riskLevel === "high" && categories.some(c =>
    c === "destructive_file" || c === "database" || c === "deploy",
  )) {
    return failedCritical.length > 0 ? "blocked" : "caution";
  }

  if (riskLevel === "high" || failedCritical.length > 0) return "caution";

  return "safe";
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function runDryRun(action: {
  title:       string;
  description: string;
  riskLevel:   string;
}): DryRunResult {
  const text       = `${action.title} ${action.description}`;
  const categories = detectCategories(text);

  // Merge plans from all matched categories
  const plans      = categories.map(planForCategory);
  const steps:            DryRunStep[]       = dedup(plans.flatMap(p => p.steps),           s => s.step);
  const estimatedImpact:  string[]           = dedup(plans.flatMap(p => p.estimatedImpact), x => x);
  const risks:            string[]           = dedup(plans.flatMap(p => p.risks),            x => x);

  const safetyChecks = buildSafetyChecks(categories, action.riskLevel, text);
  const verdict      = computeVerdict(categories, action.riskLevel, safetyChecks);

  const verdictSummary: Record<DryRunVerdict, string> = {
    safe:    "This action appears low-risk and could be executed with standard precautions.",
    caution: "This action carries elevated risk. Review all steps and ensure preconditions are met before real execution.",
    blocked: "This action has one or more unresolved safety checks. Do not execute without manual review and remediation.",
  };

  return {
    verdict,
    summary:  verdictSummary[verdict],
    steps,
    estimatedImpact,
    safetyChecks,
    risks,
    ranAt:    new Date().toISOString(),
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function dedup<T>(arr: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter(item => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
