/**
 * lib/agents/agentMessages.ts — Phase 4B agent-to-agent message bus.
 *
 * Agents communicate through structured messages.
 * All messages are append-only (no mutation after send).
 * The bus is in-memory; capped at 2 000 messages.
 */

import { randomUUID } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentMessageType =
  | "plan_created"         | "context_ready"
  | "patch_proposed"       | "validation_requested"
  | "validation_passed"    | "validation_failed"
  | "autofix_suggested"    | "approval_required"
  | "rollback_requested"   | "task_completed"
  | "task_failed"          | "handoff_sent";

export interface AgentMessage {
  id:              string;
  fromAgent:       string;
  toAgent:         string;
  taskId:          string;
  orchestrationId: string;
  type:            AgentMessageType;
  content:         string;
  risk:            "safe" | "review" | "risky";
  timestamp:       number;
  relatedPatchId?: string;
  validationResult?: {
    passed: boolean;
    errors: string[];
  };
}

// ─── Bus ─────────────────────────────────────────────────────────────────────

const MAX_BUS_SIZE = 2000;
const bus: AgentMessage[] = [];

// ─── Sending ─────────────────────────────────────────────────────────────────

/** Send a structured message between agents. Returns the saved message. */
export function sendMessage(
  params: Omit<AgentMessage, "id" | "timestamp">,
): AgentMessage {
  const msg: AgentMessage = {
    ...params,
    id:        randomUUID(),
    timestamp: Date.now(),
  };
  bus.push(msg);
  if (bus.length > MAX_BUS_SIZE)
    bus.splice(0, bus.length - MAX_BUS_SIZE);
  return msg;
}

// ─── Querying ────────────────────────────────────────────────────────────────

/** Get all messages, optionally filtered by orchestrationId. Most recent last. */
export function getMessages(
  orchestrationId?: string,
  limit = 50,
): AgentMessage[] {
  const filtered = orchestrationId
    ? bus.filter(m => m.orchestrationId === orchestrationId)
    : bus;
  return filtered.slice(-limit);
}

/** Get all messages for a specific task. */
export function getMessagesForTask(taskId: string): AgentMessage[] {
  return bus.filter(m => m.taskId === taskId);
}

/** Get messages of a specific type. */
export function getMessagesByType(
  type: AgentMessageType,
  orchestrationId?: string,
): AgentMessage[] {
  return bus.filter(
    m => m.type === type &&
         (!orchestrationId || m.orchestrationId === orchestrationId),
  );
}

/** Count of messages sent between two specific agents for an orchestration. */
export function getHandoffCount(
  orchestrationId: string,
  fromAgent: string,
  toAgent: string,
): number {
  return bus.filter(
    m => m.orchestrationId === orchestrationId &&
         m.fromAgent === fromAgent &&
         m.toAgent   === toAgent,
  ).length;
}

/** Clear the bus (used in tests). */
export function _clearMessages(): void {
  bus.splice(0, bus.length);
}
