/**
 * pages/DebugApi.tsx — Temporary production debug page
 *
 * Visit /debug-api to see on-screen:
 *   1. window.location.origin
 *   2. import.meta.env.VITE_API_BASE_URL (baked at build time)
 *   3. Final healthz URL (as computed by getApiBase)
 *   4. Result of GET /api/healthz — status, ok, body, error
 *   5. Result of POST /api/chat/stream — status, ok, first chunk / error
 */

import { useState, useEffect } from "react";
import { getApiBase } from "@/lib/apiConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FetchResult {
  url:     string;
  status:  number | null;
  ok:      boolean | null;
  body:    string | null;
  error:   string | null;
  headers: Record<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = getApiBase();

async function probeHealthz(): Promise<FetchResult> {
  const url = `${BASE}api/healthz`;
  try {
    const res = await fetch(url);
    const headers: Record<string, string> = {};
    for (const key of ["access-control-allow-origin", "content-type", "x-powered-by"]) {
      const v = res.headers.get(key);
      if (v) headers[key] = v;
    }
    let body: string | null = null;
    try { body = await res.text(); } catch { body = "(could not read body)"; }
    return { url, status: res.status, ok: res.ok, body, error: null, headers };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return { url, status: null, ok: false, body: null, headers: {},
      error: `${e.name}: ${e.message}` };
  }
}

async function probeChat(): Promise<FetchResult> {
  const url = `${BASE}api/chat/stream`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "__debug_ping__", sessionId: "debug", history: [] }),
    });
    const headers: Record<string, string> = {};
    for (const key of ["access-control-allow-origin", "content-type"]) {
      const v = res.headers.get(key);
      if (v) headers[key] = v;
    }
    // Read up to the first 500 chars of the stream body
    let body: string | null = null;
    try {
      const text = await res.text();
      body = text.slice(0, 500) + (text.length > 500 ? "\n… (truncated)" : "");
    } catch { body = "(could not read body)"; }
    return { url, status: res.status, ok: res.ok, body, error: null, headers };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    return { url, status: null, ok: false, body: null, headers: {},
      error: `${e.name}: ${e.message}` };
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Row({ label, value, mono = true, bad }: {
  label: string; value: string; mono?: boolean; bad?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: "1rem", padding: "0.45rem 0",
      borderBottom: "1px solid #1e2030" }}>
      <span style={{ width: 220, flexShrink: 0, color: "#7a8aaa",
        fontSize: "0.78rem", paddingTop: 2 }}>{label}</span>
      <span style={{
        fontFamily: mono ? "monospace" : "inherit",
        fontSize: "0.82rem",
        color: bad ? "#ff6b6b" : "#e0e8ff",
        wordBreak: "break-all",
        whiteSpace: "pre-wrap",
      }}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "2rem" }}>
      <div style={{ fontSize: "0.7rem", letterSpacing: "0.15em", color: "#00c8ff",
        textTransform: "uppercase", marginBottom: "0.5rem", fontFamily: "monospace" }}>
        {title}
      </div>
      <div style={{ background: "#0e111a", border: "1px solid #1e2a3a",
        borderRadius: 8, padding: "0.25rem 1rem" }}>
        {children}
      </div>
    </div>
  );
}

function ProbePanel({ label, probe }: {
  label: string;
  probe: () => Promise<FetchResult>;
}) {
  const [result, setResult] = useState<FetchResult | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const r = await probe();
    setResult(r);
    setRunning(false);
  };

  useEffect(() => { void run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Section title={label}>
      <Row label="URL" value={result?.url ?? "—"} />
      <Row label="status"
        value={result ? (result.status !== null ? String(result.status) : "—") : running ? "running…" : "—"}
        bad={result ? !result.ok : false}
      />
      <Row label="ok"
        value={result ? String(result.ok) : "—"}
        bad={result ? !result.ok : false}
      />
      {result && Object.entries(result.headers).map(([k, v]) => (
        <Row key={k} label={`header: ${k}`} value={v} />
      ))}
      {result?.error && (
        <Row label="ERROR" value={result.error} bad />
      )}
      <Row label="body / first 500 chars"
        value={result?.body ?? (running ? "running…" : "—")}
        bad={result ? !result.ok : false}
      />
      <div style={{ padding: "0.5rem 0" }}>
        <button
          onClick={run}
          disabled={running}
          style={{
            background: "#1a2240", border: "1px solid #00c8ff", color: "#00c8ff",
            borderRadius: 6, padding: "0.3rem 1rem", cursor: "pointer",
            fontSize: "0.78rem", fontFamily: "monospace", opacity: running ? 0.5 : 1,
          }}
        >
          {running ? "running…" : "re-run"}
        </button>
      </div>
    </Section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DebugApi() {
  return (
    <div style={{
      minHeight: "100vh", background: "#080b12", color: "#c8d8ff",
      fontFamily: "system-ui, sans-serif", padding: "2rem",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "1.1rem", fontFamily: "monospace", color: "#00c8ff",
            margin: 0, letterSpacing: "0.1em" }}>
            /debug-api — Jarvis API connectivity probe
          </h1>
          <p style={{ fontSize: "0.75rem", color: "#556", margin: "0.4rem 0 0" }}>
            All values rendered from the running browser — no console required.
          </p>
        </div>

        {/* ── Environment ── */}
        <Section title="1. Environment (baked at build time)">
          <Row label="window.location.origin"    value={window.location.origin} />
          <Row label="VITE_API_BASE_URL (raw)"   value={import.meta.env.VITE_API_BASE_URL ?? "(not set)"} bad={!import.meta.env.VITE_API_BASE_URL} />
          <Row label="import.meta.env.BASE_URL"  value={import.meta.env.BASE_URL ?? "/"} />
          <Row label="getApiBase() result"        value={BASE} />
          <Row label="MODE"                       value={import.meta.env.MODE} />
          <Row label="DEV"                        value={String(import.meta.env.DEV)} />
        </Section>

        {/* ── Healthz probe ── */}
        <ProbePanel label="2. GET /api/healthz" probe={probeHealthz} />

        {/* ── Chat stream probe ── */}
        <ProbePanel label="3. POST /api/chat/stream" probe={probeChat} />

      </div>
    </div>
  );
}
