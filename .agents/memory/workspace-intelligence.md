---
name: Workspace Intelligence v1
description: Read-only monorepo scanner that produces a live WorkspaceMap covering packages, API routes, components, modules, and data stores
---

## Architecture

- `lib/workspace.ts` — pure read-only scanner; `scanWorkspace()` + `readWorkspaceMap()`
- `routes/workspace.ts` — `GET /api/workspace/map` (auto-scans on first access), `POST /api/workspace/scan` (forced rescan + auto-checkpoint)
- `WorkspacePanel.tsx` — amber `hsl(28 100% 62%)` / `Map` icon; tabbed UI: Overview | Routes | Frontend | Modules | Data

## WorkspaceMap shape

```typescript
{
  scannedAt, rootPath, workspaceGlobs,
  packages:           PackageInfo[],      // artifacts/* + lib/* + lib/integrations/*
  apiRoutes:          ApiRouteGroup[],    // per route file, routes extracted via regex
  frontendComponents: ComponentFile[],    // kind: panel | page | hook | component
  backendModules:     ModuleFile[],       // api-server/src/lib/** (recursive)
  dataStores:         DataStore[],        // .jarvas-data/* subdirs with file/size counts
  importantFiles:     string[],           // known config/entry files checked for existence
  folderTree:         FolderNode[],       // depth ≤ 2 from PROJECT_ROOT
  stats: { totalPackages, totalApiRoutes, totalComponents, totalModules, totalDataStores, totalDataKB }
}
```

## What the scanner detects

| Category | Source | Method |
|----------|--------|--------|
| Packages | `artifacts/*/package.json`, `lib/*/package.json` | JSON parse, kind inferred from dir name |
| API routes | `artifacts/api-server/src/routes/*.ts` | Regex: `router.(get\|post\|put\|patch\|delete)\s*\("path"` |
| Frontend | `artifacts/jarvas/src/components/`, `pages/`, `hooks/` | File listing; kind from name pattern |
| Modules | `artifacts/api-server/src/lib/**` | Recursive FS walk |
| Data stores | `.jarvas-data/*/` | Dir listing with per-file size sum |
| Globs | `pnpm-workspace.yaml` | Line-by-line YAML parse (no yaml lib) |

## API route extraction

Regex applied per-file (new RegExp each time, never reuse with `/gi` state):
```
/router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi
```
- Skips `index.ts` (registry file, not routes)
- Skips `.devbak` files

## Storage

`.jarvas-data/workspace/workspace-map.json` — ~44 KB; auto-overwritten on each scan

## Panel design

- Amber `hsl(28 100% 62%)` color; `Map` icon from lucide-react; WORKSPACE header button
- 5 tabs: Overview, Routes, Frontend, Modules, Data
- Loads map on panel open (no polling — workspace rarely changes); manual RESCAN button
- First-access: `GET /api/workspace/map` auto-triggers a scan if no map file exists

## Live stats (as of first scan)

8 packages · 151 routes across 20 route files · 43 frontend files (18 panels) · 94 backend module files · 13 data stores · 142 KB data

**Why read-only + auto-checkpoint on POST scan:**
The scan writes one file (workspace-map.json). The GET route doesn't checkpoint since it's effectively idempotent read-on-demand. The POST scan checkpoints because it's a user-triggered explicit update operation.
