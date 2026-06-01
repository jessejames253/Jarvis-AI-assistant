import { Component, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Chat from "@/pages/Chat";
import Dashboard from "@/pages/Dashboard";
import KnowledgeBase from "@/pages/KnowledgeBase";
import DebugApi from "@/pages/DebugApi";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

// ── Error boundary ────────────────────────────────────────────────────────────
// Catches any uncaught render error in the entire tree.
// Without this, a single thrown exception produces a completely blank page
// with no indication of what failed.

interface EBState { error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[Jarvis] Uncaught render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100vh",
        background: "#0a0a0f", color: "#e0e0e0", fontFamily: "monospace",
        padding: "2rem", gap: "1rem",
      }}>
        <div style={{ color: "#ff4d6d", fontSize: "1.25rem", fontWeight: 700 }}>
          Jarvis encountered a startup error
        </div>
        <div style={{
          background: "#111", border: "1px solid #333", borderRadius: "8px",
          padding: "1rem", maxWidth: "640px", width: "100%",
          color: "#ff6b6b", fontSize: "0.85rem", whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {error.message}
          {"\n\n"}
          {error.stack}
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            background: "#1a1a2e", border: "1px solid #00c8ff", color: "#00c8ff",
            borderRadius: "6px", padding: "0.5rem 1.5rem", cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

function Router() {
  return (
    <Switch>
      <Route path="/" component={Chat} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/kb" component={KnowledgeBase} />
      <Route path="/debug-api" component={DebugApi} />
      <Route component={NotFound} />
    </Switch>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
