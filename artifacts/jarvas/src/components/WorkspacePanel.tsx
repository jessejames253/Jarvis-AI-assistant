/**
 * components/WorkspacePanel.tsx — Workspace Intelligence v1
 *
 * Displays a live map of the Jarvis monorepo:
 *   Overview stats → Packages & Services → API Routes → Frontend → Modules → Data Stores
 *
 * Loads the cached map on open, offers a manual Rescan button that triggers
 * POST /api/workspace/scan and refreshes all sections.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, Map, RefreshCw, Loader2, XCircle,
  ChevronDown, ChevronRight, Package2,
  Route, Layers2, Database, HardDrive,
  FileCode2, Box, Code2, BookOpen,
  LayoutGrid, Webhook, FolderOpen,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiRoute      { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string }
interface ApiRouteGroup { file: string; moduleName: string; routes: ApiRoute[] }
interface ComponentFile { name: string; relativePath: string; kind: "panel"|"page"|"hook"|"component" }
interface ModuleFile    { name: string; relativePath: string; isDir: boolean }
interface DataStore     { name: string; relativePath: string; fileCount: number; totalBytes: number; files: string[] }
interface PackageInfo   { name: string; version: string; relativePath: string; kind: "web"|"api"|"design"|"lib"|"other"; scripts: string[]; depCount: number }
interface FolderNode    { name: string; relativePath: string; children?: FolderNode[] }

interface WorkspaceMap {
  scannedAt:          string;
  rootPath:           string;
  workspaceGlobs:     string[];
  packages:           PackageInfo[];
  apiRoutes:          ApiRouteGroup[];
  frontendComponents: ComponentFile[];
  backendModules:     ModuleFile[];
  dataStores:         DataStore[];
  importantFiles:     string[];
  folderTree:         FolderNode[];
  stats: {
    totalPackages:    number;
    totalApiRoutes:   number;
    totalComponents:  number;
    totalModules:     number;
    totalDataStores:  number;
    totalDataKB:      number;
  };
}

interface WorkspacePanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const AMBER  = "hsl(28 100% 62%)";
const MUTED  = "hsl(210 15% 38%)";
const TEAL   = "hsl(175 70% 58%)";
const GREEN  = "hsl(150 70% 55%)";
const BLUE   = "hsl(196 80% 58%)";
const PURPLE = "hsl(264 80% 68%)";
const RED    = "hsl(355 80% 65%)";

const METHOD_COLOR: Record<string, string> = {
  GET:    GREEN,
  POST:   BLUE,
  PUT:    AMBER,
  PATCH:  PURPLE,
  DELETE: RED,
};

const KIND_COLOR: Record<string, string> = {
  web:    TEAL,
  api:    BLUE,
  design: PURPLE,
  lib:    GREEN,
  other:  MUTED,
};

const KIND_ICON: Record<string, React.ElementType> = {
  web:    Layers2,
  api:    Webhook,
  design: LayoutGrid,
  lib:    Package2,
  other:  Box,
};

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({
  title, icon: Icon, color, count, children, defaultOpen = true,
}: {
  title: string;
  icon:  React.ElementType;
  color: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl overflow-hidden mb-2"
      style={{ border: "1px solid hsl(210 15% 13%)", background: "hsl(220 20% 5.5%)" }}>
      <button type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left px-3 py-2.5">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        <span className="flex-1 text-[10px] font-mono font-bold tracking-widest" style={{ color }}>
          {title}
        </span>
        {count !== undefined && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
            style={{ background: `${color}18`, border: `1px solid ${color}30`, color }}>
            {count}
          </span>
        )}
        {open
          ? <ChevronDown  className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />
          : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />}
      </button>
      {open && (
        <div className="border-t px-3 py-2" style={{ borderColor: "hsl(210 15% 10%)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Method badge ─────────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: string }) {
  const c = METHOD_COLOR[method] ?? MUTED;
  return (
    <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded flex-shrink-0 w-10 text-center"
      style={{ background: `${c}18`, border: `1px solid ${c}35`, color: c }}>
      {method}
    </span>
  );
}

// ─── Formatted file size ──────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ─── API route group ──────────────────────────────────────────────────────────

function RouteGroup({ group }: { group: ApiRouteGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 w-full text-left py-1">
        {open
          ? <ChevronDown  className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
          : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />}
        <FileCode2 className="w-3 h-3 flex-shrink-0" style={{ color: BLUE }} />
        <span className="text-[10px] font-mono flex-1" style={{ color: "hsl(196 25% 72%)" }}>
          {group.moduleName}
        </span>
        <span className="text-[9px] font-mono" style={{ color: MUTED }}>{group.routes.length}</span>
      </button>
      {open && (
        <div className="ml-4 space-y-0.5">
          {group.routes.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5">
              <MethodBadge method={r.method} />
              <span className="text-[9px] font-mono truncate" style={{ color: MUTED }}>{r.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component/module row ─────────────────────────────────────────────────────

function CompRow({ item, color }: { item: ComponentFile | ModuleFile; color?: string }) {
  const isModule = "isDir" in item;
  const c = color ?? (isModule && (item as ModuleFile).isDir ? PURPLE : BLUE);
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {isModule && (item as ModuleFile).isDir
        ? <FolderOpen className="w-2.5 h-2.5 flex-shrink-0" style={{ color: PURPLE }} />
        : <FileCode2  className="w-2.5 h-2.5 flex-shrink-0" style={{ color: c }} />}
      <span className="text-[9px] font-mono truncate" style={{ color: "hsl(196 20% 68%)" }}>
        {item.name}
      </span>
      {"kind" in item && (item as ComponentFile).kind && (
        <span className="text-[8px] font-mono ml-auto flex-shrink-0" style={{ color: MUTED }}>
          {(item as ComponentFile).kind}
        </span>
      )}
    </div>
  );
}

// ─── Data store row ───────────────────────────────────────────────────────────

function DataStoreRow({ store }: { store: DataStore }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 w-full text-left py-1">
        {open
          ? <ChevronDown  className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
          : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />}
        <Database className="w-2.5 h-2.5 flex-shrink-0" style={{ color: TEAL }} />
        <span className="text-[10px] font-mono flex-1 text-left" style={{ color: "hsl(196 25% 72%)" }}>
          {store.name}
        </span>
        <span className="text-[9px] font-mono flex-shrink-0" style={{ color: MUTED }}>
          {store.fileCount}f · {fmtBytes(store.totalBytes)}
        </span>
      </button>
      {open && store.files.length > 0 && (
        <div className="ml-4 space-y-0.5">
          {store.files.map(f => (
            <div key={f} className="flex items-center gap-1 py-0.5">
              <FileCode2 className="w-2 h-2 flex-shrink-0" style={{ color: MUTED }} />
              <span className="text-[8px] font-mono truncate" style={{ color: MUTED }}>{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Package card ─────────────────────────────────────────────────────────────

function PackageCard({ pkg }: { pkg: PackageInfo }) {
  const [open, setOpen] = useState(false);
  const color = KIND_COLOR[pkg.kind] ?? MUTED;
  const Icon  = KIND_ICON[pkg.kind]  ?? Box;
  return (
    <div className="rounded-lg mb-1.5 overflow-hidden"
      style={{ border: `1px solid ${color}25`, background: `${color}06` }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left px-2.5 py-2">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold truncate" style={{ color: "hsl(196 30% 78%)" }}>{pkg.name}</p>
          <p className="text-[8px] font-mono" style={{ color: MUTED }}>{pkg.relativePath} · v{pkg.version}</p>
        </div>
        <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0"
          style={{ background: `${color}18`, border: `1px solid ${color}30`, color }}>
          {pkg.kind}
        </span>
        {open
          ? <ChevronDown  className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />
          : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: MUTED }} />}
      </button>
      {open && (
        <div className="border-t px-2.5 py-2 space-y-1" style={{ borderColor: `${color}20` }}>
          <p className="text-[9px] font-mono" style={{ color: MUTED }}>
            {pkg.depCount} deps · scripts: {pkg.scripts.join(", ") || "none"}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function WorkspacePanel({ isOpen, onClose, apiBase }: WorkspacePanelProps) {
  const [map,      setMap]      = useState<WorkspaceMap | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"overview"|"routes"|"frontend"|"modules"|"data">("overview");

  const loadMap = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${apiBase}api/workspace/map`);
      const data = await res.json() as { ok: boolean; map?: WorkspaceMap; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load workspace map");
      setMap(data.map ?? null);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "Network error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { if (isOpen) loadMap(); }, [isOpen, loadMap]);

  const rescan = useCallback(async () => {
    setScanning(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/workspace/scan`, { method: "POST" });
      const data = await res.json() as { ok: boolean; map?: WorkspaceMap; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Scan failed");
      setMap(data.map ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setScanning(false);
    }
  }, [apiBase]);

  // Tab definitions
  const TABS: Array<{ id: typeof activeTab; label: string; icon: React.ElementType; color: string }> = [
    { id: "overview",  label: "Overview",  icon: BookOpen,  color: AMBER  },
    { id: "routes",    label: "Routes",    icon: Route,     color: BLUE   },
    { id: "frontend",  label: "Frontend",  icon: Code2,     color: TEAL   },
    { id: "modules",   label: "Modules",   icon: FileCode2, color: GREEN  },
    { id: "data",      label: "Data",      icon: HardDrive, color: PURPLE },
  ];

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="workspace-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Workspace panel"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <Map className="w-4 h-4" style={{ color: AMBER }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: AMBER }}>WORKSPACE</h2>
            {map && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${AMBER}18`, border: `1px solid ${AMBER}40`, color: AMBER }}>
                {map.stats.totalPackages} pkgs
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={rescan} disabled={scanning || loading}
              title="Rescan workspace"
              className="flex items-center gap-1 px-2 h-7 rounded-lg border text-[9px] font-bold tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${AMBER}12`, borderColor: `${AMBER}35`, color: AMBER }}>
              {scanning
                ? <><Loader2 className="w-3 h-3 animate-spin" /> SCANNING…</>
                : <><RefreshCw className="w-3 h-3" /> RESCAN</>}
            </button>
            <button type="button" onClick={onClose} aria-label="Close workspace panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {error && (
          <div className="mx-3 mt-2 flex items-start gap-2 p-2.5 rounded-lg flex-shrink-0"
            style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
            <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
          </div>
        )}

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        {map && (
          <div className="flex gap-0.5 px-3 pt-2 flex-shrink-0 overflow-x-auto pb-1">
            {TABS.map(tab => (
              <button key={tab.id} type="button"
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-mono font-bold tracking-widest flex-shrink-0 transition-all"
                style={{
                  background:  activeTab === tab.id ? `${tab.color}18` : "transparent",
                  border:      `1px solid ${activeTab === tab.id ? `${tab.color}45` : "transparent"}`,
                  color:       activeTab === tab.id ? tab.color : MUTED,
                }}>
                <tab.icon className="w-2.5 h-2.5" />
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-2" style={{ color: MUTED }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[11px]">Scanning workspace…</span>
            </div>
          ) : !map ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Map className="w-8 h-8 opacity-15" style={{ color: AMBER }} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                No workspace map yet. Click <strong style={{ color: AMBER }}>RESCAN</strong> to discover the repo structure.
              </p>
            </div>
          ) : (
            <>
              {/* ── Overview tab ───────────────────────────────────────── */}
              {activeTab === "overview" && (
                <div className="space-y-3 py-1">
                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: "PACKAGES",    value: map.stats.totalPackages,   color: AMBER  },
                      { label: "API ROUTES",  value: map.stats.totalApiRoutes,  color: BLUE   },
                      { label: "COMPONENTS",  value: map.stats.totalComponents, color: TEAL   },
                      { label: "MODULES",     value: map.stats.totalModules,    color: GREEN  },
                      { label: "DATA STORES", value: map.stats.totalDataStores, color: PURPLE },
                      { label: "DATA KB",     value: map.stats.totalDataKB,     color: MUTED  },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl p-2 text-center"
                        style={{ background: `${s.color}10`, border: `1px solid ${s.color}22` }}>
                        <p className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-[7px] font-mono tracking-widest mt-0.5" style={{ color: `${s.color}80` }}>
                          {s.label}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Last scan */}
                  <p className="text-[9px] font-mono text-center" style={{ color: MUTED }}>
                    scanned {new Date(map.scannedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {" · "}{map.rootPath}
                  </p>

                  {/* Workspace globs */}
                  {map.workspaceGlobs.length > 0 && (
                    <Section title="WORKSPACE GLOBS" icon={Package2} color={AMBER} count={map.workspaceGlobs.length} defaultOpen>
                      <div className="space-y-0.5">
                        {map.workspaceGlobs.map(g => (
                          <div key={g} className="flex items-center gap-1.5">
                            <span className="text-[8px] font-mono" style={{ color: AMBER }}>→</span>
                            <span className="text-[9px] font-mono" style={{ color: "hsl(196 25% 70%)" }}>{g}</span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Packages */}
                  <Section title="PACKAGES & SERVICES" icon={Box} color={AMBER} count={map.packages.length} defaultOpen>
                    {map.packages.map(pkg => <PackageCard key={pkg.relativePath} pkg={pkg} />)}
                  </Section>

                  {/* Important files */}
                  {map.importantFiles.length > 0 && (
                    <Section title="KEY FILES" icon={FileCode2} color={MUTED} count={map.importantFiles.length} defaultOpen={false}>
                      <div className="space-y-0.5">
                        {map.importantFiles.map(f => (
                          <div key={f} className="flex items-center gap-1.5 py-0.5">
                            <FileCode2 className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
                            <span className="text-[9px] font-mono truncate" style={{ color: "hsl(196 20% 65%)" }}>{f}</span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {/* Folder tree */}
                  {map.folderTree.length > 0 && (
                    <Section title="FOLDER TREE" icon={FolderOpen} color={MUTED} defaultOpen={false}>
                      {map.folderTree.map(node => (
                        <div key={node.name} className="mb-1">
                          <p className="text-[9px] font-mono font-bold" style={{ color: "hsl(196 25% 65%)" }}>
                            {node.name}/
                          </p>
                          {node.children?.map(child => (
                            <p key={child.name} className="text-[8px] font-mono ml-3" style={{ color: MUTED }}>
                              └ {child.name}/
                            </p>
                          ))}
                        </div>
                      ))}
                    </Section>
                  )}
                </div>
              )}

              {/* ── Routes tab ─────────────────────────────────────────── */}
              {activeTab === "routes" && (
                <div className="py-1">
                  <p className="text-[9px] font-mono mb-2" style={{ color: MUTED }}>
                    {map.stats.totalApiRoutes} routes across {map.apiRoutes.length} route files
                  </p>
                  {map.apiRoutes.map(g => <RouteGroup key={g.file} group={g} />)}
                </div>
              )}

              {/* ── Frontend tab ────────────────────────────────────────── */}
              {activeTab === "frontend" && (
                <div className="py-1 space-y-3">
                  {(["panel", "page", "hook", "component"] as const).map(kind => {
                    const items = map.frontendComponents.filter(c => c.kind === kind);
                    if (items.length === 0) return null;
                    const colors: Record<string, string> = { panel: TEAL, page: BLUE, hook: GREEN, component: PURPLE };
                    const icons: Record<string, React.ElementType> = { panel: Layers2, page: LayoutGrid, hook: Code2, component: Box };
                    return (
                      <Section key={kind}
                        title={`${kind.toUpperCase()}S`}
                        icon={icons[kind]}
                        color={colors[kind]}
                        count={items.length}
                        defaultOpen={kind === "panel"}>
                        <div className="space-y-0">
                          {items.map(item => <CompRow key={item.relativePath} item={item} color={colors[kind]} />)}
                        </div>
                      </Section>
                    );
                  })}
                </div>
              )}

              {/* ── Modules tab ─────────────────────────────────────────── */}
              {activeTab === "modules" && (
                <div className="py-1">
                  <p className="text-[9px] font-mono mb-2" style={{ color: MUTED }}>
                    {map.stats.totalModules} files/dirs in api-server/src/lib/
                  </p>
                  <div className="space-y-0">
                    {map.backendModules.map(m => <CompRow key={m.relativePath} item={m} />)}
                  </div>
                </div>
              )}

              {/* ── Data tab ────────────────────────────────────────────── */}
              {activeTab === "data" && (
                <div className="py-1">
                  <p className="text-[9px] font-mono mb-2" style={{ color: MUTED }}>
                    {map.stats.totalDataStores} stores · {map.stats.totalDataKB} KB total in .jarvas-data/
                  </p>
                  {map.dataStores.map(s => <DataStoreRow key={s.name} store={s} />)}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
