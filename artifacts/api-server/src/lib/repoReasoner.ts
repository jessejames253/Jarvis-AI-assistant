/**
 * lib/repoReasoner.ts — Repo Reasoning v1
 *
 * Uses the existing WorkspaceMap + Claude to reason about:
 *   - Where a new feature / change belongs in the codebase
 *   - Which files, routes, and components are affected
 *   - Implementation order and steps
 *   - Risks and mitigations
 *   - What tests / validations should run
 *
 * Purely read-only: never modifies source files.
 * Result is cached at .jarvas-data/workspace/last-reasoning.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path                                                    from "path";
import { anthropic }                                           from "@workspace/integrations-anthropic-ai";
import { readWorkspaceMap }                                    from "./workspace";
import { PROJECT_ROOT }                                        from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeType =
  | "feature" | "bugfix" | "refactor" | "api"
  | "frontend" | "data" | "test" | "docs";

export type RiskTolerance = "low" | "medium" | "high";

export interface ReasoningRequest {
  goal:          string;
  changeType:    ChangeType;
  riskTolerance: RiskTolerance;
}

export interface RecommendedFile {
  path:     string;
  role:     "create" | "modify" | "review";
  reason:   string;
  priority: "high" | "medium" | "low";
}

export interface AffectedSystem {
  name:   string;
  impact: "high" | "medium" | "low";
  reason: string;
}

export interface PlanStep {
  order:       number;
  title:       string;
  description: string;
  files:       string[];
}

export interface Risk {
  description: string;
  severity:    "high" | "medium" | "low";
  mitigation:  string;
}

export interface ValidationItem {
  type:        "typecheck" | "test" | "e2e" | "manual" | "lint";
  description: string;
  command?:    string;
}

export interface ReasoningResult {
  goal:               string;
  changeType:         ChangeType;
  riskTolerance:      RiskTolerance;
  reasonedAt:         string;
  confidence:         number; // 0-100
  summary:            string;
  recommendedFiles:   RecommendedFile[];
  affectedSystems:    AffectedSystem[];
  implementationPlan: PlanStep[];
  risks:              Risk[];
  validationPlan:     ValidationItem[];
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORE_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "workspace");
const CACHE_FILE = path.join(STORE_DIR, "last-reasoning.json");

export function readLastReasoning(): ReasoningResult | null {
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as ReasoningResult;
  } catch { return null; }
}

function saveReasoning(result: ReasoningResult): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2) + "\n", "utf-8");
}

// ─── Workspace context builder ────────────────────────────────────────────────

function buildWorkspaceContext(): string {
  const map = readWorkspaceMap();
  if (!map) return "No workspace map available — workspace has not been scanned yet.";

  const lines: string[] = [
    `## Workspace: ${map.rootPath}`,
    `Scanned: ${new Date(map.scannedAt).toLocaleString()}`,
    "",
    "### Packages",
    ...map.packages.map(p => `  - ${p.name} (${p.kind}) at ${p.relativePath}`),
    "",
    "### API Routes (grouped by module)",
  ];

  for (const g of map.apiRoutes) {
    lines.push(`  ${g.moduleName}.ts:`);
    for (const r of g.routes) {
      lines.push(`    ${r.method.padEnd(6)} /api${r.path}`);
    }
  }

  lines.push("", "### Frontend Panels");
  const panels = map.frontendComponents.filter(c => c.kind === "panel");
  panels.forEach(p => lines.push(`  - ${p.name} (${p.relativePath})`));

  lines.push("", "### Frontend Pages");
  const pages = map.frontendComponents.filter(c => c.kind === "page");
  pages.forEach(p => lines.push(`  - ${p.name} (${p.relativePath})`));

  lines.push("", "### Frontend Components");
  const comps = map.frontendComponents.filter(c => c.kind === "component");
  comps.forEach(c => lines.push(`  - ${c.name}`));

  lines.push("", "### Frontend Hooks");
  const hooks = map.frontendComponents.filter(c => c.kind === "hook");
  hooks.forEach(h => lines.push(`  - ${h.name}`));

  lines.push("", "### Backend Lib Modules (top-level)");
  const topModules = map.backendModules.filter(m => {
    const depth = m.relativePath.split("/").length;
    return depth <= 6; // api-server/src/lib/X or api-server/src/lib/dir/X
  });
  topModules.forEach(m => lines.push(`  - ${m.name}${m.isDir ? "/" : ""}`));

  lines.push("", "### Data Stores (.jarvas-data/)");
  map.dataStores.forEach(s => lines.push(`  - ${s.name}/  (${s.fileCount} files, ${Math.round(s.totalBytes / 1024)} KB)`));

  lines.push("", "### Important Files");
  map.importantFiles.forEach(f => lines.push(`  - ${f}`));

  return lines.join("\n");
}

// ─── JSON extractor ───────────────────────────────────────────────────────────

function extractJson(text: string): string {
  // Strip markdown fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) return fenced[1].trim();
  // Find first { ... } block
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in response");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start);
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior software architect analyzing a monorepo codebase called "Jarvis".
Your job is to reason about planned changes and provide concrete, actionable guidance.

Rules:
- Be specific about file paths and route names — reference actual names from the workspace context.
- Keep each risk / plan step concise but actionable.
- Only recommend files that plausibly exist or need to be created.
- Confidence should reflect how well the goal maps to visible codebase structure (0–100).
- Respond with ONLY valid JSON matching the schema exactly — no prose outside the JSON.`;

function buildPrompt(req: ReasoningRequest, workspaceCtx: string): string {
  return `${workspaceCtx}

---

## Reasoning Request

**Goal:** ${req.goal}
**Change Type:** ${req.changeType}
**Risk Tolerance:** ${req.riskTolerance}

Please analyze this goal in the context of the workspace above and respond with a JSON object with EXACTLY this shape:

{
  "summary": "<2-3 sentence executive summary of the recommended approach>",
  "confidence": <integer 0-100>,
  "recommendedFiles": [
    {
      "path": "<relative file path>",
      "role": "create" | "modify" | "review",
      "reason": "<why this file is involved>",
      "priority": "high" | "medium" | "low"
    }
  ],
  "affectedSystems": [
    {
      "name": "<system/subsystem name>",
      "impact": "high" | "medium" | "low",
      "reason": "<why it's affected>"
    }
  ],
  "implementationPlan": [
    {
      "order": <number starting at 1>,
      "title": "<step title>",
      "description": "<what to do in this step>",
      "files": ["<file path>"]
    }
  ],
  "risks": [
    {
      "description": "<risk description>",
      "severity": "high" | "medium" | "low",
      "mitigation": "<how to mitigate>"
    }
  ],
  "validationPlan": [
    {
      "type": "typecheck" | "test" | "e2e" | "manual" | "lint",
      "description": "<what to validate>",
      "command": "<optional shell command>"
    }
  ]
}

Provide 3-8 recommendedFiles, 2-5 affectedSystems, 3-7 implementationPlan steps, 2-5 risks, and 3-6 validationPlan items.
The change type is "${req.changeType}" and the risk tolerance is "${req.riskTolerance}" — adjust depth and caution accordingly.`;
}

// ─── Public: run reasoning ────────────────────────────────────────────────────

export async function runReasoning(req: ReasoningRequest): Promise<ReasoningResult> {
  const workspaceCtx = buildWorkspaceContext();
  const prompt       = buildPrompt(req, workspaceCtx);

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 4096,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: prompt }],
  });

  const rawText = response.content
    .filter(b => b.type === "text")
    .map(b => (b as { type: "text"; text: string }).text)
    .join("");

  const parsed = JSON.parse(extractJson(rawText)) as {
    summary:            string;
    confidence:         number;
    recommendedFiles:   RecommendedFile[];
    affectedSystems:    AffectedSystem[];
    implementationPlan: PlanStep[];
    risks:              Risk[];
    validationPlan:     ValidationItem[];
  };

  const result: ReasoningResult = {
    goal:               req.goal,
    changeType:         req.changeType,
    riskTolerance:      req.riskTolerance,
    reasonedAt:         new Date().toISOString(),
    confidence:         Math.min(100, Math.max(0, Math.round(parsed.confidence))),
    summary:            parsed.summary             ?? "",
    recommendedFiles:   parsed.recommendedFiles    ?? [],
    affectedSystems:    parsed.affectedSystems     ?? [],
    implementationPlan: parsed.implementationPlan  ?? [],
    risks:              parsed.risks               ?? [],
    validationPlan:     parsed.validationPlan      ?? [],
  };

  saveReasoning(result);
  return result;
}
