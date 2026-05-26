---
name: Repo Reasoning v1
description: AI reasoning module that analyses a goal against the workspace map and returns structured guidance (files, systems, plan, risks, validation)
---

## Architecture

- `lib/repoReasoner.ts` — reads WorkspaceMap from disk, builds a concise workspace context string, sends goal+changeType+riskTolerance to Claude, parses JSON response, saves to cache
- `routes/repoReasoner.ts` — `POST /api/workspace/reason` (auto-checkpoint + run reasoning), `GET /api/workspace/reason/last` (return cached result)
- `ReasonPanel.tsx` — violet `hsl(264 80% 68%)` / `Brain` icon; form at top, collapsible section cards below; `Brain` was already imported in Chat.tsx so no new lucide import needed

## ReasoningResult shape

```typescript
{
  goal, changeType, riskTolerance, reasonedAt,
  confidence: number,           // 0-100
  summary: string,
  recommendedFiles: { path, role: "create"|"modify"|"review", reason, priority: "high"|"medium"|"low" }[],
  affectedSystems:  { name, impact: "high"|"medium"|"low", reason }[],
  implementationPlan: { order, title, description, files: string[] }[],
  risks:            { description, severity: "high"|"medium"|"low", mitigation }[],
  validationPlan:   { type: "typecheck"|"test"|"e2e"|"manual"|"lint", description, command? }[],
}
```

## Claude integration

- Model: `claude-sonnet-4-6`
- max_tokens: 4096 (structured JSON response)
- System prompt tells Claude to only output JSON (no prose outside)
- JSON extracted with `extractJson()`: strips markdown fences, then finds `{...}` by depth counting
- Workspace context passed as a concise text summary of packages, routes, components, modules, data stores — NOT the full 44KB workspace-map.json

## Storage

`.jarvas-data/workspace/last-reasoning.json` — ~11 KB; single result, overwritten on each call

## Panel design

- Violet `hsl(264 80% 68%)` / `Brain` icon (pre-existing lucide import — no new import needed)
- Loads last reasoning on panel open (GET /workspace/reason/last)
- Form: goal textarea + changeType select + riskTolerance select + ANALYSE button
- `⌘↵` submits the form
- Output: ConfidenceRing SVG + summary, then 5 collapsible sections
- All sections default-open; each section has a count badge
- FileRow: expandable with reason on click; role + priority color badges
- Read-only: no file execution from this panel ever

## Validation

- `goal`: required, min 3 chars
- `changeType`: enum of 8 values
- `riskTolerance`: enum of 3 values
- All validated server-side before calling Claude

## Known pitfall: Brain duplicate import

`Brain` is already imported in `Chat.tsx` at line 18 (first lucide-react block). Do NOT add it again — it causes TS2300 duplicate identifier error.

**Why read-only + checkpoint:**
The result file is written to `.jarvas-data/workspace/last-reasoning.json`. Even though it's not source code, we checkpoint before saving to maintain a consistent audit trail consistent with other routes.
