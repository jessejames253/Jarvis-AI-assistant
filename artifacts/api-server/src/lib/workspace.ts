/**
 * lib/workspace.ts — Workspace Intelligence v1
 *
 * Scans the monorepo structure READ-ONLY and produces a WorkspaceMap
 * stored at .jarvas-data/workspace/workspace-map.json.
 *
 * Discovers:
 *   - pnpm workspace packages (artifacts/*, lib/*)
 *   - API routes (parsed from route source files via regex)
 *   - Frontend panels, pages, hooks, components (artifacts/jarvas/src/)
 *   - Backend library modules (artifacts/api-server/src/lib/)
 *   - Data stores (.jarvas-data/ subdirectories)
 *   - Top-level folder tree (depth ≤ 2)
 *   - Known important config files
 *
 * NO files are modified during scanning — only workspace-map.json is written.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync,
         statSync, writeFileSync }                       from "fs";
import path                                              from "path";
import { PROJECT_ROOT }                                  from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path:   string;
}

export interface ApiRouteGroup {
  file:       string;
  moduleName: string;
  routes:     ApiRoute[];
}

export interface ComponentFile {
  name:         string;
  relativePath: string;
  kind:         "panel" | "page" | "hook" | "component";
}

export interface ModuleFile {
  name:         string;
  relativePath: string;
  isDir:        boolean;
}

export interface DataStore {
  name:         string;
  relativePath: string;
  fileCount:    number;
  totalBytes:   number;
  files:        string[];
}

export interface PackageInfo {
  name:         string;
  version:      string;
  relativePath: string;
  kind:         "web" | "api" | "design" | "lib" | "other";
  scripts:      string[];
  depCount:     number;
}

export interface FolderNode {
  name:         string;
  relativePath: string;
  children?:    FolderNode[];
}

export interface WorkspaceMap {
  scannedAt:         string;
  rootPath:          string;
  workspaceGlobs:    string[];
  packages:          PackageInfo[];
  apiRoutes:         ApiRouteGroup[];
  frontendComponents: ComponentFile[];
  backendModules:    ModuleFile[];
  dataStores:        DataStore[];
  importantFiles:    string[];
  folderTree:        FolderNode[];
  stats: {
    totalPackages:    number;
    totalApiRoutes:   number;
    totalComponents:  number;
    totalModules:     number;
    totalDataStores:  number;
    totalDataKB:      number;
  };
}

// ─── Storage paths ────────────────────────────────────────────────────────────

const WORKSPACE_DATA_DIR = path.join(PROJECT_ROOT, ".jarvas-data", "workspace");
const MAP_FILE           = path.join(WORKSPACE_DATA_DIR, "workspace-map.json");

// ─── Constants ────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", ".cache", "__pycache__",
  ".next", "build", "coverage", ".turbo", ".svelte-kit",
]);

// ─── Safe FS helpers ──────────────────────────────────────────────────────────

function safeRead(filePath: string): string | null {
  try { return readFileSync(filePath, "utf-8"); } catch { return null; }
}

function safeDir(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

function safeStat(p: string) {
  try { return statSync(p); } catch { return null; }
}

// ─── Public: read cached map ─────────────────────────────────────────────────

export function readWorkspaceMap(): WorkspaceMap | null {
  const raw = safeRead(MAP_FILE);
  if (!raw) return null;
  try { return JSON.parse(raw) as WorkspaceMap; } catch { return null; }
}

// ─── Workspace glob parser ────────────────────────────────────────────────────

function parseWorkspaceGlobs(): string[] {
  const yaml = safeRead(path.join(PROJECT_ROOT, "pnpm-workspace.yaml")) ?? "";
  const globs: string[] = [];
  let inPkgs = false;
  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "packages:") { inPkgs = true; continue; }
    if (inPkgs) {
      const m = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?/);
      if (m) globs.push(m[1]);
      else if (trimmed && !line.startsWith(" ") && !line.startsWith("\t")) break;
    }
  }
  return globs;
}

// ─── Package scanner ──────────────────────────────────────────────────────────

function detectPackageKind(dirName: string): PackageInfo["kind"] {
  if (dirName.includes("api"))               return "api";
  if (dirName.includes("sandbox") ||
      dirName.includes("mockup"))            return "design";
  if (dirName.includes("integrations") ||
      dirName.includes("lib"))               return "lib";
  return "web";
}

function scanSinglePackage(dirPath: string, relBase: string, name: string): PackageInfo | null {
  const raw = safeRead(path.join(dirPath, "package.json"));
  if (!raw) return null;
  try {
    const pkg = JSON.parse(raw) as {
      name?: string; version?: string;
      scripts?: Record<string, string>;
      dependencies?: object; devDependencies?: object;
    };
    return {
      name:         pkg.name ?? name,
      version:      pkg.version ?? "0.0.0",
      relativePath: relBase,
      kind:         detectPackageKind(name),
      scripts:      Object.keys(pkg.scripts ?? {}),
      depCount:     Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).length,
    };
  } catch { return null; }
}

function scanPackages(): PackageInfo[] {
  const results: PackageInfo[] = [];

  for (const base of ["artifacts", "lib"]) {
    const baseDir = path.join(PROJECT_ROOT, base);
    if (!existsSync(baseDir)) continue;
    for (const name of safeDir(baseDir).sort()) {
      const fullDir = path.join(baseDir, name);
      if (!safeStat(fullDir)?.isDirectory()) continue;
      const info = scanSinglePackage(fullDir, `${base}/${name}`, name);
      if (info) results.push(info);

      // integrations sub-packages (lib/integrations/*)
      if (base === "lib" && name === "integrations") {
        for (const sub of safeDir(fullDir).sort()) {
          const subDir = path.join(fullDir, sub);
          if (!safeStat(subDir)?.isDirectory()) continue;
          const subInfo = scanSinglePackage(subDir, `lib/integrations/${sub}`, sub);
          if (subInfo) results.push({ ...subInfo, kind: "lib" });
        }
      }
    }
  }
  return results;
}

// ─── API route scanner ────────────────────────────────────────────────────────

function extractRoutes(source: string): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const re = /router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    routes.push({
      method: m[1].toUpperCase() as ApiRoute["method"],
      path:   m[2],
    });
  }
  return routes;
}

function scanApiRoutes(): ApiRouteGroup[] {
  const routesDir = path.join(
    PROJECT_ROOT, "artifacts", "api-server", "src", "routes",
  );
  if (!existsSync(routesDir)) return [];

  const groups: ApiRouteGroup[] = [];

  for (const fileName of safeDir(routesDir).sort()) {
    if (!fileName.endsWith(".ts"))      continue;
    if (fileName.includes(".devbak"))   continue;
    if (fileName === "index.ts")        continue; // registry, not routes

    const source = safeRead(path.join(routesDir, fileName));
    if (!source) continue;

    const routes = extractRoutes(source);
    if (routes.length === 0) continue;

    groups.push({
      file:       fileName,
      moduleName: fileName.replace(/\.ts$/, ""),
      routes,
    });
  }
  return groups;
}

// ─── Frontend component scanner ───────────────────────────────────────────────

function classifyComponent(name: string): ComponentFile["kind"] {
  if (/Panel$/.test(name))                         return "panel";
  if (/^use[A-Z]/.test(name))                      return "hook";
  return "component";
}

function scanFrontendComponents(): ComponentFile[] {
  const items: ComponentFile[] = [];
  const jarvasBase = path.join(PROJECT_ROOT, "artifacts", "jarvas", "src");

  const scanDir = (subDir: string, suffix: string, overrideKind?: ComponentFile["kind"]) => {
    const dir = path.join(jarvasBase, subDir);
    if (!existsSync(dir)) return;
    for (const f of safeDir(dir).sort()) {
      if (!f.endsWith(".tsx") && !f.endsWith(".ts")) continue;
      if (f.includes(".devbak")) continue;
      const name = f.replace(/\.(tsx|ts)$/, "");
      items.push({
        name,
        relativePath: `artifacts/jarvas/src/${subDir}/${f}`,
        kind: overrideKind ?? classifyComponent(name),
      });
    }
  };

  scanDir("components", "components");
  scanDir("pages",      "pages",      "page");
  scanDir("hooks",      "hooks",      "hook");

  return items;
}

// ─── Backend module scanner ───────────────────────────────────────────────────

function scanBackendModules(): ModuleFile[] {
  const modules: ModuleFile[] = [];
  const libDir = path.join(PROJECT_ROOT, "artifacts", "api-server", "src", "lib");
  if (!existsSync(libDir)) return [];

  const scan = (dir: string, relBase: string) => {
    for (const name of safeDir(dir).sort()) {
      if (name.includes(".devbak")) continue;
      const fullPath = path.join(dir, name);
      const st = safeStat(fullPath);
      if (!st) continue;

      if (st.isDirectory() && !IGNORE_DIRS.has(name)) {
        modules.push({ name, relativePath: `${relBase}/${name}`, isDir: true });
        scan(fullPath, `${relBase}/${name}`);
      } else if (st.isFile() && name.endsWith(".ts") && !name.endsWith(".d.ts")) {
        modules.push({
          name:         name.replace(/\.ts$/, ""),
          relativePath: `${relBase}/${name}`,
          isDir:        false,
        });
      }
    }
  };

  scan(libDir, "artifacts/api-server/src/lib");
  return modules;
}

// ─── Data store scanner ───────────────────────────────────────────────────────

function scanDataStores(): DataStore[] {
  const stores: DataStore[] = [];
  const dataDir = path.join(PROJECT_ROOT, ".jarvas-data");
  if (!existsSync(dataDir)) return [];

  for (const name of safeDir(dataDir).sort()) {
    const dirPath = path.join(dataDir, name);
    if (!safeStat(dirPath)?.isDirectory()) continue;

    let fileCount  = 0;
    let totalBytes = 0;
    const files: string[] = [];

    for (const f of safeDir(dirPath)) {
      const fp  = path.join(dirPath, f);
      const fst = safeStat(fp);
      if (!fst?.isFile()) continue;
      fileCount++;
      totalBytes += fst.size;
      files.push(f);
    }

    stores.push({
      name,
      relativePath: `.jarvas-data/${name}`,
      fileCount,
      totalBytes,
      files,
    });
  }
  return stores;
}

// ─── Important files ──────────────────────────────────────────────────────────

const IMPORTANT_CANDIDATES = [
  "pnpm-workspace.yaml",
  "package.json",
  ".replit",
  "artifact.toml",
  "artifacts/api-server/package.json",
  "artifacts/api-server/tsconfig.json",
  "artifacts/api-server/src/app.ts",
  "artifacts/api-server/src/routes/index.ts",
  "artifacts/jarvas/package.json",
  "artifacts/jarvas/tsconfig.json",
  "artifacts/jarvas/vite.config.ts",
  "artifacts/jarvas/index.html",
];

function findImportantFiles(): string[] {
  return IMPORTANT_CANDIDATES.filter(p => existsSync(path.join(PROJECT_ROOT, p)));
}

// ─── Folder tree ─────────────────────────────────────────────────────────────

function buildFolderTree(dir: string, depth: number, maxDepth: number): FolderNode[] {
  if (depth >= maxDepth || !existsSync(dir)) return [];
  const nodes: FolderNode[] = [];

  for (const name of safeDir(dir).sort()) {
    if (IGNORE_DIRS.has(name) || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (!safeStat(full)?.isDirectory()) continue;
    nodes.push({
      name,
      relativePath: path.relative(PROJECT_ROOT, full),
      children:     depth + 1 < maxDepth
        ? buildFolderTree(full, depth + 1, maxDepth)
        : undefined,
    });
  }
  return nodes;
}

// ─── Public: full scan ────────────────────────────────────────────────────────

export function scanWorkspace(): WorkspaceMap {
  const workspaceGlobs     = parseWorkspaceGlobs();
  const packages           = scanPackages();
  const apiRoutes          = scanApiRoutes();
  const frontendComponents = scanFrontendComponents();
  const backendModules     = scanBackendModules();
  const dataStores         = scanDataStores();
  const importantFiles     = findImportantFiles();
  const folderTree         = buildFolderTree(PROJECT_ROOT, 0, 2);

  const totalApiRoutes  = apiRoutes.reduce((s, g) => s + g.routes.length, 0);
  const totalDataBytes  = dataStores.reduce((s, d) => s + d.totalBytes, 0);

  const map: WorkspaceMap = {
    scannedAt:         new Date().toISOString(),
    rootPath:          PROJECT_ROOT,
    workspaceGlobs,
    packages,
    apiRoutes,
    frontendComponents,
    backendModules,
    dataStores,
    importantFiles,
    folderTree,
    stats: {
      totalPackages:   packages.length,
      totalApiRoutes,
      totalComponents: frontendComponents.length,
      totalModules:    backendModules.length,
      totalDataStores: dataStores.length,
      totalDataKB:     Math.round(totalDataBytes / 1024),
    },
  };

  if (!existsSync(WORKSPACE_DATA_DIR)) mkdirSync(WORKSPACE_DATA_DIR, { recursive: true });
  writeFileSync(MAP_FILE, JSON.stringify(map, null, 2) + "\n", "utf-8");
  return map;
}
