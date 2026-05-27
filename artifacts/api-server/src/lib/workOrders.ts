/**
 * lib/workOrders.ts — Agent Work Orders v1
 *
 * Converts a CollaborationPlan into a set of actionable WorkOrders —
 * one per agent, with inputs, expected outputs, dependencies, and status.
 *
 * Status rules on creation:
 *   - First work order (no dependencies) → "ready"
 *   - All others → "pending" (awaiting dependency completion)
 *
 * Stored as a flat array in .jarvas-data/agents/work-orders.json.
 * Duplicate plans (same collaborationPlanId) replace old orders.
 *
 * Read-only execution: work orders are never run from this module.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomUUID }                                         from "crypto";
import path                                                   from "path";
import { readLastCollaboration, type CollaborationPlan }      from "./agentCollaboration";
import { PROJECT_ROOT }                                       from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkOrderStatus = "pending" | "ready" | "blocked" | "completed";
export type RiskLevel       = "high"    | "medium" | "low";

export interface WorkOrder {
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
  dependencies:        string[];   // ids of upstream WorkOrders
  dependencyNames:     string[];   // readable names for UI
  riskLevel:           RiskLevel;
  status:              WorkOrderStatus;
  createdAt:           string;
  completedAt?:        string;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORE_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "agents");
const ORDERS_FILE = path.join(STORE_DIR, "work-orders.json");

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

export function loadWorkOrders(): WorkOrder[] {
  try {
    return JSON.parse(readFileSync(ORDERS_FILE, "utf-8")) as WorkOrder[];
  } catch { return []; }
}

function saveWorkOrders(orders: WorkOrder[]): void {
  ensureDir();
  writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2) + "\n", "utf-8");
}

// ─── Status helpers ───────────────────────────────────────────────────────────

export function computeStatus(order: WorkOrder, allOrders: WorkOrder[]): WorkOrderStatus {
  if (order.dependencies.length === 0) return "ready";
  const depsDone = order.dependencies.every(depId => {
    const dep = allOrders.find(o => o.id === depId);
    return dep?.status === "completed";
  });
  return depsDone ? "ready" : "pending";
}

// ─── Risk level computation ───────────────────────────────────────────────────

function planMaxRisk(plan: CollaborationPlan): RiskLevel {
  if (plan.risks.some(r => r.severity === "high"))   return "high";
  if (plan.risks.some(r => r.severity === "medium")) return "medium";
  return "low";
}

function agentRiskLevel(
  agentId:      string,
  position:     number,
  totalAgents:  number,
  planMaxSev:   RiskLevel,
): RiskLevel {
  // Lead agent and final agent carry full plan risk
  if (position === 1 || position === totalAgents) return planMaxSev;
  // Middle agents carry one step lower risk
  if (planMaxSev === "high")   return "medium";
  if (planMaxSev === "medium") return "low";
  return "low";
}

// ─── Conversion from collaboration plan ───────────────────────────────────────

export function createFromCollaboration(plan: CollaborationPlan): WorkOrder[] {
  const planId   = plan.plannedAt; // use timestamp as stable plan id
  const maxRisk  = planMaxRisk(plan);

  // Build ordered agent list: lead first, then supporting by handoffPosition
  const allAgents = [
    plan.leadAgent,
    ...plan.supportingAgents.sort((a, b) => a.handoffPosition - b.handoffPosition),
  ];

  // Pre-assign IDs so we can wire up dependencies
  const ids: string[] = allAgents.map(() => randomUUID());

  const orders: WorkOrder[] = allAgents.map((agent, idx) => {
    const position   = idx + 1;
    const isFirst    = idx === 0;
    const totalCount = allAgents.length;

    // inputs: the artifact from the handoff step that delivers to this agent
    const inboundStep = plan.handoffOrder.find(s => s.toAgent.agentId === agent.agentId);
    const inputs: string[] = inboundStep
      ? [inboundStep.artifact]
      : ["Project goal and requirements"];

    // dependencies: the work order id of the previous agent in order
    const dependencies:    string[] = isFirst ? [] : [ids[idx - 1]];
    const dependencyNames: string[] = isFirst ? [] : [allAgents[idx - 1].agentName];

    const riskLevel = agentRiskLevel(agent.agentId, position, totalCount, maxRisk);

    return {
      id:                  ids[idx],
      collaborationPlanId: planId,
      agentId:             agent.agentId,
      agentName:           agent.agentName,
      agentColor:          agent.color,
      agentEmoji:          agent.emoji,
      title:               `[${agent.agentName}] ${plan.goal.slice(0, 55)}${plan.goal.length > 55 ? "…" : ""}`,
      objective:           agent.responsibility,
      inputs,
      expectedOutput:      agent.expectedOutput,
      dependencies,
      dependencyNames,
      riskLevel,
      status:              isFirst ? "ready" : "pending",
      createdAt:           new Date().toISOString(),
    };
  });

  // Merge: replace any existing orders from this plan, keep orders from other plans
  const existing   = loadWorkOrders().filter(o => o.collaborationPlanId !== planId);
  const merged     = [...existing, ...orders];
  saveWorkOrders(merged);

  return orders;
}

// ─── Status update ────────────────────────────────────────────────────────────

export function updateWorkOrderStatus(
  id:     string,
  status: WorkOrderStatus,
): WorkOrder | null {
  const all   = loadWorkOrders();
  const index = all.findIndex(o => o.id === id);
  if (index === -1) return null;

  all[index] = {
    ...all[index],
    status,
    completedAt: status === "completed" ? new Date().toISOString() : all[index].completedAt,
  };

  // Cascade: if an order just completed, promote any direct dependents to "ready"
  if (status === "completed") {
    for (const order of all) {
      if (order.status === "pending" && order.dependencies.includes(id)) {
        const allDepsDone = order.dependencies.every(depId => {
          const dep = all.find(o => o.id === depId);
          return dep?.status === "completed";
        });
        if (allDepsDone) order.status = "ready";
      }
    }
  }

  saveWorkOrders(all);
  return all[index];
}

// ─── Standalone work order (from autonomy suggestions) ────────────────────────

export function createStandaloneWorkOrder(params: {
  agentId:        string;
  agentName:      string;
  agentColor:     string;
  agentEmoji:     string;
  title:          string;
  objective:      string;
  inputs:         string[];
  expectedOutput: string;
  riskLevel:      RiskLevel;
  sourceLabel?:   string;
}): WorkOrder {
  const order: WorkOrder = {
    id:                  randomUUID(),
    collaborationPlanId: params.sourceLabel ?? "standalone",
    agentId:             params.agentId,
    agentName:           params.agentName,
    agentColor:          params.agentColor,
    agentEmoji:          params.agentEmoji,
    title:               params.title,
    objective:           params.objective,
    inputs:              params.inputs,
    expectedOutput:      params.expectedOutput,
    dependencies:        [],
    dependencyNames:     [],
    riskLevel:           params.riskLevel,
    status:              "ready",  // standalone orders are immediately ready
    createdAt:           new Date().toISOString(),
  };
  const existing = loadWorkOrders();
  saveWorkOrders([...existing, order]);
  return order;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export function getPlanForId(planId: string): CollaborationPlan | null {
  if (planId === "last") return readLastCollaboration();
  // Try last plan and check if it matches
  const last = readLastCollaboration();
  if (last && last.plannedAt === planId) return last;
  return null;
}
