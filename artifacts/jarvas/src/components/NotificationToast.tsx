/**
 * components/NotificationToast.tsx — In-app runtime notification toasts.
 *
 * Positioned above the input bar. Shows up to 3 toasts, oldest first.
 * Each auto-dismisses via a timer in JarvisRuntime.
 * Manual dismiss by tapping the ×.
 */

import { useRuntime } from "@/hooks/useRuntime";
import type { Notification, NotificationLevel } from "@/lib/runtime/types";

const LEVEL_STYLES: Record<NotificationLevel, { border: string; bg: string; icon: string; color: string }> = {
  info:    { border: "hsl(194 100% 50% / 0.35)", bg: "hsl(194 100% 50% / 0.08)", icon: "ℹ",  color: "hsl(194 100% 65%)" },
  success: { border: "hsl(142 60% 40% / 0.45)",  bg: "hsl(142 60% 40% / 0.10)", icon: "✓",  color: "hsl(142 71% 60%)" },
  warn:    { border: "hsl(38 100% 50% / 0.45)",   bg: "hsl(38 100% 50% / 0.08)",  icon: "⚠", color: "hsl(38 100% 65%)" },
  error:   { border: "hsl(355 80% 55% / 0.45)",   bg: "hsl(355 80% 55% / 0.08)",  icon: "✕", color: "hsl(355 80% 65%)" },
};

function Toast({ n, onDismiss }: { n: Notification; onDismiss: (id: string) => void }) {
  const s = LEVEL_STYLES[n.level] ?? LEVEL_STYLES.info;
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-xl border backdrop-blur-sm shadow-lg max-w-xs w-full animate-in slide-in-from-bottom-2 duration-200"
      style={{ background: s.bg, borderColor: s.border }}
      role="alert"
    >
      <span className="flex-shrink-0 text-xs font-bold" style={{ color: s.color }}>
        {s.icon}
      </span>
      <span className="text-xs flex-1 leading-snug" style={{ color: "hsl(196 50% 70%)" }}>
        {n.message}
      </span>
      <button
        onClick={() => onDismiss(n.id)}
        className="flex-shrink-0 text-xs opacity-50 hover:opacity-100 transition-opacity"
        style={{ color: s.color }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export default function NotificationToast() {
  const { notifications, dismiss } = useRuntime();

  if (notifications.length === 0) return null;

  // Show newest 3
  const visible = notifications.slice(-3);

  return (
    <div
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none"
      style={{ fontFamily: "'Courier New', Courier, monospace" }}
    >
      {visible.map(n => (
        <div key={n.id} className="pointer-events-auto">
          <Toast n={n} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}
