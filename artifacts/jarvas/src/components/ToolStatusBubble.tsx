/**
 * components/ToolStatusBubble.tsx
 *
 * Renders inline tool-call status chips inside the assistant message bubble.
 * Each chip shows: icon · label · optional duration.
 * Running chips pulse; done chips are solid; error chips are red.
 */

const TOOL_META: Record<string, { icon: string; color: string }> = {
  get_weather:    { icon: "🌡️", color: "hsl(194 100% 55%)" },
  search_web:     { icon: "🔍", color: "hsl(210 90% 65%)" },
  calculate:      { icon: "🧮", color: "hsl(55 100% 60%)"  },
  create_reminder:{ icon: "📌", color: "hsl(142 70% 55%)"  },
  list_reminders: { icon: "📋", color: "hsl(142 70% 55%)"  },
  lookup_memory:  { icon: "🧠", color: "hsl(264 80% 70%)"  },
  run_code:       { icon: "⚡", color: "hsl(38 100% 62%)"  },
};

export type ToolCallStatus = "running" | "done" | "error";

export interface ToolCallInfo {
  id: string;
  tool: string;
  label: string;
  status: ToolCallStatus;
  durationMs?: number;
  result?: unknown;
  error?: string;
}

interface Props {
  calls: ToolCallInfo[];
}

export default function ToolStatusBubble({ calls }: Props) {
  if (calls.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 mb-2">
      {calls.map((call) => {
        const meta = TOOL_META[call.tool] ?? { icon: "⚙️", color: "hsl(196 40% 55%)" };
        const isRunning = call.status === "running";
        const isError = call.status === "error";

        const borderColor = isError
          ? "hsl(355 80% 55% / 0.5)"
          : isRunning
          ? `${meta.color.replace(")", " / 0.4)")}`
          : `${meta.color.replace(")", " / 0.3)")}`;

        const bgColor = isError
          ? "hsl(355 80% 55% / 0.08)"
          : isRunning
          ? `${meta.color.replace(")", " / 0.1)")}`
          : `${meta.color.replace(")", " / 0.07)")}`;

        return (
          <div
            key={call.id}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border"
            style={{
              background: bgColor,
              borderColor: borderColor,
              animation: isRunning ? "toolPulse 1.4s ease-in-out infinite" : undefined,
            }}
          >
            <span style={{ fontSize: "13px", lineHeight: 1 }}>{meta.icon}</span>
            <span
              className="font-mono tracking-wide"
              style={{ color: isError ? "hsl(355 80% 65%)" : meta.color }}
            >
              {isError ? (call.error ?? "Tool failed") : call.label}
            </span>
            {call.durationMs !== undefined && !isRunning && (
              <span
                className="ml-auto font-mono"
                style={{ color: "hsl(196 40% 40%)", fontSize: "10px" }}
              >
                {call.durationMs < 1000
                  ? `${call.durationMs}ms`
                  : `${(call.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
            {isRunning && (
              <span
                className="ml-auto flex gap-0.5 items-center"
                aria-label="Running"
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1 h-1 rounded-full"
                    style={{
                      background: meta.color,
                      animation: `toolDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
