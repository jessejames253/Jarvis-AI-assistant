/**
 * components/WorkOrdersPanel.tsx — Agent Work Orders v1
 *
 * Shows work orders grouped by agent, each with:
 *   - Status badge (pending | ready | blocked | completed)
 *   - Dependency indicators
 *   - Risk level label
 *   - Objective, inputs, expected output
 *
 * Also provides a one-click "Convert last collaboration plan → work orders" action.
 * Status can be updated inline (no agent code is executed).
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, ClipboardList, Loader2, XCircle,
  ChevronDown, ChevronRight, RefreshCw,
  ArrowRight, Lock, CheckCircle2,
  AlertTriangle, Clock, Zap, Package,
  Link2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkOrderStatus = "pending" | "ready" | "blocked" | "completed";
type RiskLevel       = "high"    | "medium" | "low";

interface WorkOrder {
  id:                  string;
  collaborationPlanId: string;
  agentId:             string;
  agentName:           string;
  agentColor:          string;
  agentEmoji:          string;
  title:               string;
  objective:           string;
  inputs:              string[];
  expectedOutput:      string;
  dependencies:        string[];
  dependencyNames:     string[];
  riskLevel:           RiskLevel;
  status:              WorkOrderStatus;
  createdAt:           string;
  completedAt?:        string;
}

interface WorkOrdersPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const GOLD  = "hsl(43 100% 55%)";
const MUTED = "hsl(210 15% 38%)";
const GREEN = "hsl(150 70% 55%)";
const AMBER = "hsl(38 100% 60%)";
const RED   = "hsl(355 80% 65%)";
const BLUE  = "hsl(196 80% 58%)";
const DARK  = "hsl(220 20% 5%)";

const STATUS_META: Record<WorkOrderStatus, { label: string; color: string; icon: React.ElementType }> = {
  ready:     { label: "READY",     color: GREEN, icon: Zap          },
  pending:   { label: "PENDING",   color: AMBER, icon: Clock        },
  blocked:   { label: "BLOCKED",   color: RED,   icon: Lock         },
  completed: { label: "DONE",      color: BLUE,  icon: CheckCircle2 },
};

const RISK_META: Record<RiskLevel, { color: string }> = {
  high:   { color: RED   },
  medium: { color: AMBER },
  low:    { color: GREEN },
};

// ─── Status selector ──────────────────────────────────────────────────────────

function StatusBadge({
  status, orderId, onUpdate, updating,
}: {
  status:   WorkOrderStatus;
  orderId:  string;
  onUpdate: (id: string, s: WorkOrderStatus) => void;
  updating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={updating}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-mono font-bold transition-all"
        style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}40`, color: meta.color }}
      >
        {updating
          ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
          : <Icon className="w-2.5 h-2.5" />}
        {meta.label}
        <ChevronDown className="w-2 h-2" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden z-10 shadow-xl"
          style={{ background: "hsl(222 28% 9%)", border: "1px solid hsl(210 15% 20%)", minWidth: 110 }}>
          {(["ready","pending","blocked","completed"] as WorkOrderStatus[]).map(s => {
            const m  = STATUS_META[s];
            const Si = m.icon;
            return (
              <button key={s} type="button"
                onClick={() => { setOpen(false); onUpdate(orderId, s); }}
                className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-[8px] font-mono hover:bg-white/5 transition-colors"
                style={{ color: m.color }}>
                <Si className="w-2.5 h-2.5 flex-shrink-0" />
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Work order card ──────────────────────────────────────────────────────────

function OrderCard({
  order, allOrders, onUpdateStatus, updatingId,
}: {
  order:          WorkOrder;
  allOrders:      WorkOrder[];
  onUpdateStatus: (id: string, s: WorkOrderStatus) => void;
  updatingId:     string | null;
}) {
  const [open, setOpen] = useState(false);
  const risk    = RISK_META[order.riskLevel];
  const blocked = order.status === "blocked";
  const isUpdating = updatingId === order.id;

  // Resolve dependency names live from allOrders (more accurate than stored names)
  const depNames = order.dependencies.map(depId => {
    const dep = allOrders.find(o => o.id === depId);
    return dep ? dep.agentName : order.dependencyNames[order.dependencies.indexOf(depId)] ?? depId.slice(0, 8);
  });

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{
        border:     `1px solid ${blocked ? RED + "40" : order.agentColor + "30"}`,
        background: `${order.agentColor}06`,
        opacity:    order.status === "completed" ? 0.65 : 1,
      }}>
      {/* Header */}
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left px-2.5 py-2">
        <span className="text-[11px] flex-shrink-0">{order.agentEmoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-semibold truncate" style={{ color: "hsl(196 25% 74%)" }}>
            {order.objective.length > 60 ? order.objective.slice(0, 60) + "…" : order.objective}
          </p>
          {depNames.length > 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              <Link2 className="w-2 h-2 flex-shrink-0" style={{ color: MUTED }} />
              <span className="text-[7px] font-mono truncate" style={{ color: MUTED }}>
                needs: {depNames.join(", ")}
              </span>
            </div>
          )}
        </div>
        {/* Risk badge */}
        <span className="text-[7px] font-mono px-1 rounded flex-shrink-0"
          style={{ background: `${risk.color}12`, border: `1px solid ${risk.color}30`, color: risk.color }}>
          {order.riskLevel}
        </span>
        {/* Status */}
        <StatusBadge
          status={order.status}
          orderId={order.id}
          onUpdate={onUpdateStatus}
          updating={isUpdating}
        />
        {open
          ? <ChevronDown  className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
          : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t px-2.5 py-2.5 space-y-2"
          style={{ borderColor: `${order.agentColor}20` }}>
          {/* Inputs */}
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
              <p className="text-[7px] font-mono font-bold tracking-widest" style={{ color: MUTED }}>
                INPUTS
              </p>
            </div>
            {order.inputs.map((inp, i) => (
              <p key={i} className="text-[8px] leading-relaxed pl-4" style={{ color: "hsl(196 20% 60%)" }}>
                • {inp}
              </p>
            ))}
          </div>
          {/* Expected output */}
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <Package className="w-2.5 h-2.5 flex-shrink-0" style={{ color: `${order.agentColor}90` }} />
              <p className="text-[7px] font-mono font-bold tracking-widest" style={{ color: MUTED }}>
                EXPECTED OUTPUT
              </p>
            </div>
            <p className="text-[8px] leading-relaxed pl-4" style={{ color: MUTED }}>
              {order.expectedOutput}
            </p>
          </div>
          {/* ID + timestamp */}
          <p className="text-[7px] font-mono" style={{ color: "hsl(210 15% 28%)" }}>
            {order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Agent group ──────────────────────────────────────────────────────────────

function AgentGroup({
  agentId, agentName, agentColor, agentEmoji, orders, allOrders, onUpdateStatus, updatingId,
}: {
  agentId:        string;
  agentName:      string;
  agentColor:     string;
  agentEmoji:     string;
  orders:         WorkOrder[];
  allOrders:      WorkOrder[];
  onUpdateStatus: (id: string, s: WorkOrderStatus) => void;
  updatingId:     string | null;
}) {
  const [open, setOpen] = useState(true);
  const doneCount = orders.filter(o => o.status === "completed").length;
  return (
    <div className="rounded-xl overflow-hidden mb-2.5"
      style={{ border: `1px solid ${agentColor}35`, background: DARK }}>
      {/* Group header */}
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left px-3 py-2.5">
        <span className="text-[13px]">{agentEmoji}</span>
        <span className="flex-1 text-[10px] font-bold" style={{ color: agentColor }}>
          {agentName}
        </span>
        <span className="text-[8px] font-mono" style={{ color: MUTED }}>
          {doneCount}/{orders.length}
        </span>
        <div className="flex gap-1 flex-shrink-0">
          {orders.map(o => {
            const m = STATUS_META[o.status];
            return (
              <div key={o.id} className="w-1.5 h-1.5 rounded-full"
                style={{ background: m.color }} />
            );
          })}
        </div>
        {open
          ? <ChevronDown  className="w-3 h-3" style={{ color: MUTED }} />
          : <ChevronRight className="w-3 h-3" style={{ color: MUTED }} />}
      </button>
      {open && (
        <div className="border-t px-2.5 py-2.5 space-y-2"
          style={{ borderColor: `${agentColor}20` }}>
          {orders.map(order => (
            <OrderCard key={order.id} order={order}
              allOrders={allOrders}
              onUpdateStatus={onUpdateStatus}
              updatingId={updatingId} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ orders }: { orders: WorkOrder[] }) {
  const counts: Record<WorkOrderStatus, number> = { ready: 0, pending: 0, blocked: 0, completed: 0 };
  orders.forEach(o => counts[o.status]++);
  return (
    <div className="flex gap-2 flex-wrap">
      {(["ready","pending","blocked","completed"] as WorkOrderStatus[]).map(s => {
        const m  = STATUS_META[s];
        const Si = m.icon;
        if (counts[s] === 0) return null;
        return (
          <div key={s} className="flex items-center gap-1 px-2 py-1 rounded-lg"
            style={{ background: `${m.color}10`, border: `1px solid ${m.color}25` }}>
            <Si className="w-2.5 h-2.5" style={{ color: m.color }} />
            <span className="text-[8px] font-mono font-bold" style={{ color: m.color }}>
              {counts[s]}
            </span>
            <span className="text-[7px] font-mono" style={{ color: MUTED }}>{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function WorkOrdersPanel({ isOpen, onClose, apiBase }: WorkOrdersPanelProps) {
  const [orders,     setOrders]     = useState<WorkOrder[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [converting, setConverting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/work-orders`);
      const data = await res.json() as { ok: boolean; orders?: WorkOrder[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Failed to load work orders");
      setOrders(data.orders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (isOpen) void fetchOrders();
  }, [isOpen, fetchOrders]);

  const convertLastPlan = useCallback(async () => {
    setConverting(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/work-orders/from-collaboration/last`, {
        method: "POST",
      });
      const data = await res.json() as { ok: boolean; orders?: WorkOrder[]; planGoal?: string; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Conversion failed");
      // Reload all orders (merge with existing from other plans)
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setConverting(false);
    }
  }, [apiBase, fetchOrders]);

  const updateStatus = useCallback(async (id: string, status: WorkOrderStatus) => {
    setUpdatingId(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/work-orders/${id}/status`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ status }),
      });
      const data = await res.json() as { ok: boolean; orders?: WorkOrder[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Status update failed");
      setOrders(data.orders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setUpdatingId(null);
    }
  }, [apiBase]);

  // Group orders by agent, preserving original order within each agent
  const grouped: Map<string, { agentId: string; agentName: string; agentColor: string; agentEmoji: string; orders: WorkOrder[] }> = new Map();
  for (const order of orders) {
    if (!grouped.has(order.agentId)) {
      grouped.set(order.agentId, {
        agentId:    order.agentId,
        agentName:  order.agentName,
        agentColor: order.agentColor,
        agentEmoji: order.agentEmoji,
        orders:     [],
      });
    }
    grouped.get(order.agentId)!.orders.push(order);
  }

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}

      <aside
        data-testid="work-orders-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Work orders panel"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4" style={{ color: GOLD }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: GOLD }}>ORDERS</h2>
            {orders.length > 0 && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}40`, color: GOLD }}>
                {orders.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchOrders} disabled={loading}
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}
              title="Refresh">
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`}
                style={{ color: "hsl(210 20% 55%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close work orders panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">

          {/* ── Convert action ────────────────────────────────────────────── */}
          <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(210 15% 12%)" }}>
            <button type="button" onClick={convertLastPlan} disabled={converting || loading}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-xl font-bold text-[10px] tracking-widest transition-all active:scale-95 disabled:opacity-40"
              style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}45`, color: GOLD }}>
              {converting
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> CONVERTING…</>
                : <><ClipboardList className="w-3.5 h-3.5" /> CONVERT LAST COLLAB PLAN → ORDERS</>}
            </button>
            <p className="text-[8px] mt-1.5 text-center" style={{ color: MUTED }}>
              Converts the most recent collaboration plan into assigned work orders.
            </p>
          </div>

          {/* ── Error ────────────────────────────────────────────────────── */}
          {error && (
            <div className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-lg"
              style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
              <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
            </div>
          )}

          {/* ── Loading ───────────────────────────────────────────────────── */}
          {loading && (
            <div className="flex items-center gap-2 py-10 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: GOLD }} />
              <span className="text-[10px]" style={{ color: MUTED }}>Loading work orders…</span>
            </div>
          )}

          {/* ── Empty state ───────────────────────────────────────────────── */}
          {!loading && orders.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-14 text-center px-6">
              <ClipboardList className="w-8 h-8 opacity-10" style={{ color: GOLD }} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                No work orders yet. First create a collaboration plan via <strong style={{ color: "hsl(320 70% 62%)" }}>COLLAB</strong>,
                then click <strong style={{ color: GOLD }}>CONVERT</strong> above to generate orders.
              </p>
            </div>
          )}

          {/* ── Stats + orders ────────────────────────────────────────────── */}
          {!loading && orders.length > 0 && (
            <div className="px-4 pt-3">
              <StatsBar orders={orders} />
            </div>
          )}

          {!loading && grouped.size > 0 && (
            <div className="px-3 pt-3 pb-8">
              {Array.from(grouped.values()).map(group => (
                <AgentGroup
                  key={group.agentId}
                  {...group}
                  allOrders={orders}
                  onUpdateStatus={updateStatus}
                  updatingId={updatingId}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
