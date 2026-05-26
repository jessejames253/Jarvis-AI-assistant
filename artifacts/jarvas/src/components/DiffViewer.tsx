/**
 * components/DiffViewer.tsx — Diff viewer with metadata panel.
 *
 * Shows: RISK LEVEL · UI IMPACT · LOGIC IMPACT · SAFE TO TEST · APPROVAL REQUIRED
 * Then the labeled diff: removed lines red, added lines green, context dimmed.
 */

import { useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion, Eye, Cpu, FlaskConical, BadgeCheck } from "lucide-react";

interface DiffLine {
  type: "context" | "removed" | "added";
  oldLineNum?: number;
  newLineNum?: number;
  text: string;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length;
  const n = newLines.length;
  const LIMIT = 400;

  if (m > LIMIT || n > LIMIT) {
    const result: DiffLine[] = [];
    oldLines.forEach((t, i) => result.push({ type: "removed", oldLineNum: i + 1, text: t }));
    newLines.forEach((t, i) => result.push({ type: "added", newLineNum: i + 1, text: t }));
    return result;
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const diff: DiffLine[] = [];
  let i = 0, j = 0, oldNum = 1, newNum = 1;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      diff.push({ type: "context", oldLineNum: oldNum++, newLineNum: newNum++, text: oldLines[i++] });
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      diff.push({ type: "added", newLineNum: newNum++, text: newLines[j++] });
    } else {
      diff.push({ type: "removed", oldLineNum: oldNum++, text: oldLines[i++] });
    }
  }
  return diff;
}

function collapseContext(lines: DiffLine[], radius = 3): DiffLine[] {
  const changed = new Set<number>();
  lines.forEach((l, i) => { if (l.type !== "context") changed.add(i); });
  const keep = new Set<number>();
  changed.forEach(idx => {
    for (let k = Math.max(0, idx - radius); k <= Math.min(lines.length - 1, idx + radius); k++) keep.add(k);
  });
  const result: DiffLine[] = [];
  let lastKept = -1;
  lines.forEach((l, i) => {
    if (keep.has(i)) {
      if (lastKept !== -1 && i > lastKept + 1) result.push({ type: "context", text: `… ${i - lastKept - 1} unchanged lines …` });
      result.push(l);
      lastKept = i;
    }
  });
  return result;
}

// ─── Risk badge ───────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level?: "low" | "medium" | "high" }) {
  const cfg = {
    low:    { color: "hsl(142 71% 55%)", bg: "hsl(142 60% 30% / 0.15)", label: "LOW RISK",    Icon: ShieldCheck },
    medium: { color: "hsl(38 100% 62%)", bg: "hsl(38 100% 50% / 0.12)",  label: "MEDIUM RISK", Icon: ShieldQuestion },
    high:   { color: "hsl(355 80% 62%)", bg: "hsl(355 80% 40% / 0.15)",  label: "HIGH RISK",   Icon: ShieldAlert },
  }[level ?? "medium"] ?? { color: "hsl(38 100% 62%)", bg: "hsl(38 100% 50% / 0.12)", label: "RISK?", Icon: ShieldQuestion };

  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider" style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}>
      <cfg.Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Metadata row ─────────────────────────────────────────────────────────────

interface PatchMetadata {
  riskLevel?: "low" | "medium" | "high";
  uiImpact?: string;
  logicImpact?: string;
  safeToTest?: boolean;
}

function MetadataRow({ meta }: { meta: PatchMetadata }) {
  const safeColor  = meta.safeToTest ? "hsl(142 71% 55%)" : "hsl(38 100% 62%)";
  const safeLabel  = meta.safeToTest ? "Safe to test" : "Test carefully";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 border-b text-xs" style={{ borderColor: "hsl(210 15% 13%)", background: "hsl(220 20% 5%)" }}>
      <RiskBadge level={meta.riskLevel} />

      {meta.uiImpact && meta.uiImpact !== "none" && (
        <span className="flex items-center gap-1" style={{ color: "hsl(264 80% 72%)" }}>
          <Eye className="w-3 h-3 flex-shrink-0" />
          <span className="opacity-60 mr-0.5">UI:</span>
          {meta.uiImpact}
        </span>
      )}

      {meta.logicImpact && meta.logicImpact !== "none" && (
        <span className="flex items-center gap-1" style={{ color: "hsl(194 100% 62%)" }}>
          <Cpu className="w-3 h-3 flex-shrink-0" />
          <span className="opacity-60 mr-0.5">Logic:</span>
          {meta.logicImpact}
        </span>
      )}

      <span className="flex items-center gap-1 ml-auto" style={{ color: safeColor }}>
        <FlaskConical className="w-3 h-3 flex-shrink-0" />
        {safeLabel}
      </span>

      <span className="flex items-center gap-1" style={{ color: "hsl(38 100% 62%)" }}>
        <BadgeCheck className="w-3 h-3 flex-shrink-0" />
        Approval required
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface DiffViewerProps {
  file: string;
  description: string;
  oldContent: string;
  newContent: string;
  onApprove: () => void;
  onReject: () => void;
  applying?: boolean;
  metadata?: PatchMetadata;
}

export default function DiffViewer({ file, description, oldContent, newContent, onApprove, onReject, applying, metadata }: DiffViewerProps) {
  const [expanded, setExpanded] = useState(false);

  const allLines  = computeDiff(oldContent, newContent);
  const collapsed = collapseContext(allLines);
  const lines     = expanded ? allLines : collapsed;

  const added    = allLines.filter(l => l.type === "added").length;
  const removed  = allLines.filter(l => l.type === "removed").length;
  const isNewFile = !oldContent;

  return (
    <div className="rounded-xl border overflow-hidden my-2" style={{ background: "hsl(220 20% 5%)", borderColor: "hsl(210 15% 18%)" }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-3 py-2 border-b" style={{ borderColor: "hsl(210 15% 13%)" }}>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono" style={{ color: "hsl(196 40% 40%)" }}>PROPOSED PATCH</span>
            {isNewFile && <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(142 60% 35% / 0.2)", color: "hsl(142 71% 60%)" }}>NEW FILE</span>}
          </div>
          <span className="text-xs font-mono truncate" style={{ color: "hsl(194 100% 65%)" }}>{file}</span>
          <p className="text-xs mt-0.5 leading-snug" style={{ color: "hsl(196 25% 48%)" }}>{description}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 text-xs font-mono">
          {added   > 0 && <span style={{ color: "hsl(142 71% 55%)" }}>+{added}</span>}
          {removed > 0 && <span style={{ color: "hsl(355 80% 62%)" }}>-{removed}</span>}
        </div>
      </div>

      {/* Metadata */}
      {metadata && (metadata.riskLevel || metadata.uiImpact || metadata.logicImpact) && (
        <MetadataRow meta={metadata} />
      )}

      {/* Diff */}
      <div className="overflow-x-auto max-h-64 overflow-y-auto scrollbar-thin text-xs font-mono" style={{ background: "hsl(220 20% 4%)" }}>
        {lines.map((line, i) => {
          const isSkip = line.text.startsWith("… ");
          const bg    = isSkip ? "transparent" : line.type === "added" ? "hsl(142 60% 30% / 0.15)" : line.type === "removed" ? "hsl(355 80% 40% / 0.15)" : "transparent";
          const color = isSkip ? "hsl(210 15% 35%)"  : line.type === "added" ? "hsl(142 71% 60%)"    : line.type === "removed" ? "hsl(355 80% 62%)" : "hsl(196 20% 45%)";
          const prefix = isSkip ? "  " : line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          return (
            <div key={i} className="flex items-start" style={{ background: bg }}>
              <span className="w-8 text-right flex-shrink-0 px-1.5 py-0.5 select-none" style={{ color: "hsl(210 15% 28%)", fontSize: "0.65rem" }}>
                {isSkip ? "" : (line.type === "removed" ? line.oldLineNum : line.newLineNum) ?? ""}
              </span>
              <span className="w-4 flex-shrink-0 py-0.5 text-center select-none" style={{ color }}>{prefix}</span>
              <span className="flex-1 py-0.5 pr-3 whitespace-pre" style={{ color }}>{line.text}</span>
            </div>
          );
        })}
        {!expanded && collapsed.length < allLines.length && (
          <button type="button" onClick={() => setExpanded(true)} className="w-full py-1 text-center text-xs opacity-50 hover:opacity-100 transition-opacity" style={{ color: "hsl(194 100% 55%)" }}>
            Show full diff ({allLines.length} lines)
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: "hsl(210 15% 13%)" }}>
        <button type="button" onClick={onApprove} disabled={applying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50"
          style={{ background: "hsl(142 60% 35% / 0.25)", border: "1px solid hsl(142 60% 40% / 0.5)", color: "hsl(142 71% 65%)" }}>
          {applying ? "Applying…" : "✓ Apply patch"}
        </button>
        <button type="button" onClick={onReject} disabled={applying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50"
          style={{ background: "hsl(355 80% 40% / 0.15)", border: "1px solid hsl(355 80% 45% / 0.4)", color: "hsl(355 80% 62%)" }}>
          ✕ Reject
        </button>
        <span className="text-xs ml-auto" style={{ color: "hsl(210 15% 35%)" }}>Review carefully</span>
      </div>
    </div>
  );
}
