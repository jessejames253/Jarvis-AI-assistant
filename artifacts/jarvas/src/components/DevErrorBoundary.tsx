import React from "react";
import { RefreshCw } from "lucide-react";

interface State { hasError: boolean; error: string }

export class DevErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error("[DevErrorBoundary] caught:", err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div
            className="rounded-2xl p-6 max-w-md w-full flex flex-col gap-4"
            style={{ background: "hsl(355 80% 8%)", border: "1px solid hsl(355 80% 22%)" }}
          >
            <div className="text-xs font-bold tracking-widest" style={{ color: "hsl(355 80% 62%)" }}>
              DEV WORKSPACE ERROR
            </div>
            <div
              className="text-xs leading-relaxed font-mono p-3 rounded-xl"
              style={{ background: "hsl(355 80% 5%)", color: "hsl(355 80% 55%)", wordBreak: "break-all" }}
            >
              {this.state.error}
            </div>
            <div className="text-xs leading-relaxed" style={{ color: "hsl(196 25% 42%)" }}>
              This error is isolated to the DEV workspace. Your main Jarvis chat is unaffected.
            </div>
            <button
              onClick={() => this.setState({ hasError: false, error: "" })}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold tracking-widest transition-all active:scale-95"
              style={{
                background: "hsl(355 80% 55% / 0.12)",
                border: "1px solid hsl(355 80% 55% / 0.40)",
                color: "hsl(355 80% 68%)",
              }}
            >
              <RefreshCw className="w-3 h-3" />
              RETRY
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
