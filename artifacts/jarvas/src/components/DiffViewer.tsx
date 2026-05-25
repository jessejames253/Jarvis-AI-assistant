/**
 * components/DiffViewer.tsx — Side-by-side / unified diff viewer.
 *
 * Computes a simple line-level diff between oldContent and newContent.
 * Shows removed lines in red, added lines in green, context lines dimmed.
 */

import { useState } from "react";

interface DiffLine {
  type: "context" | "removed" | "added";
  oldLineNum?: number;
  newLineNum?: number;
  text: string;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  const LIMIT = 300; // prevent O(n²) on huge files

  if (m > LIMIT || n > LIMIT) {
    // Fallback: show all old as removed, all new as added
    const result: DiffLine[] = [];
    oldLines.forEach((t, i) => result.push({ type: "removed", oldLineNum: i + 1, text: t }));
    newLines.forEach((t, i) => result.push({ type: "added", newLineNum: i + 1, text: t }));
    return result;
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Trace back
  const diff: DiffLine[] = [];
  let i = 0, j = 0;
  let oldNum = 1, newNum = 1;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      diff.push({ type: "context", oldLineNum: oldNum++, newLineNum: newNum++, text: oldLines[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      diff.push({ type: "added", newLineNum: newNum++, text: newLines[j] });
      j++;
    } else {
      diff.push({ type: "removed", oldLineNum: oldNum++, text: oldLines[i] });
      i++;
    }
  }
  return diff;
}

function collapseContext(lines: DiffLine[], contextRadius = 3): DiffLine[] {
  const changed = new Set<number>();
  lines.forEach((l, i) => { if (l.type !== "context") changed.add(i); });

  const keep = new Set<number>();
  changed.forEach(idx => {
    for (let k = Math.max(0, idx - contextRadius); k <= Math.min(lines.length - 1, idx + contextRadius); k++) {
      keep.add(k);
    }
  });

  const result: DiffLine[] = [];
  let lastKept = -1;
  lines.forEach((l, i) => {
    if (keep.has(i)) {
      if (lastKept !== -1 && i > lastKept + 1) {
        result.push({ type: "context", text: `… ${i - lastKept - 1} unchanged lines …` });
      }
      result.push(l);
      lastKept = i;
    }
  });
  return result;
}

interface DiffViewerProps {
  file: string;
  description: string;
  oldContent: string;
  newContent: string;
  onApprove: () => void;
  onReject: () => void;
  applying?: boolean;
}

export default function DiffViewer({ file, description, oldContent, newContent, onApprove, onReject, applying }: DiffViewerProps) {
  const [expanded, setExpanded] = useState(false);

  const allLines = computeDiff(oldContent, newContent);
  const collapsed = collapseContext(allLines);
  const lines = expanded ? allLines : collapsed;

  const added   = allLines.filter(l => l.type === "added").length;
  const removed = allLines.filter(l => l.type === "removed").length;
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
          {added > 0 && <span style={{ color: "hsl(142 71% 55%)" }}>+{added}</span>}
          {removed > 0 && <span style={{ color: "hsl(355 80% 62%)" }}>-{removed}</span>}
        </div>
      </div>

      {/* Diff lines */}
      <div className="overflow-x-auto max-h-64 overflow-y-auto scrollbar-thin text-xs font-mono" style={{ background: "hsl(220 20% 4%)" }}>
        {lines.map((line, i) => {
          const isSkip = line.text.startsWith("… ");
          const bg = isSkip ? "transparent"
            : line.type === "added"   ? "hsl(142 60% 30% / 0.15)"
            : line.type === "removed" ? "hsl(355 80% 40% / 0.15)"
            : "transparent";
          const color = isSkip ? "hsl(210 15% 35%)"
            : line.type === "added"   ? "hsl(142 71% 60%)"
            : line.type === "removed" ? "hsl(355 80% 62%)"
            : "hsl(196 20% 45%)";
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
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full py-1 text-center text-xs transition-opacity hover:opacity-100 opacity-50"
            style={{ color: "hsl(194 100% 55%)" }}
          >
            Show full diff ({allLines.length} lines)
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: "hsl(210 15% 13%)" }}>
        <button
          type="button"
          onClick={onApprove}
          disabled={applying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50"
          style={{ background: "hsl(142 60% 35% / 0.25)", border: "1px solid hsl(142 60% 40% / 0.5)", color: "hsl(142 71% 65%)" }}
        >
          {applying ? "Applying…" : "✓ Apply patch"}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={applying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50"
          style={{ background: "hsl(355 80% 40% / 0.15)", border: "1px solid hsl(355 80% 45% / 0.4)", color: "hsl(355 80% 62%)" }}
        >
          ✕ Reject
        </button>
        <span className="text-xs ml-auto" style={{ color: "hsl(210 15% 35%)" }}>Review carefully before applying</span>
      </div>
    </div>
  );
}
