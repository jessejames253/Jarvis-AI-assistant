/**
 * lib/agents/registry.ts — Phase 4 agent registry.
 *
 * Singleton map of all registered agents.
 * Agents self-register on import (see agents/ directory).
 */

import type { AgentDefinition } from "./baseAgent";

const registry = new Map<string, AgentDefinition>();

/** Register an agent definition. Throws if the ID is already taken. */
export function registerAgent(def: AgentDefinition): void {
  if (registry.has(def.id)) {
    throw new Error(`AgentRegistry: Agent '${def.id}' is already registered`);
  }
  registry.set(def.id, def);
}

/** Look up a registered agent by ID. Returns undefined if not found. */
export function getAgent(id: string): AgentDefinition | undefined {
  return registry.get(id);
}

/** List all registered agents (order: registration order). */
export function listAgents(): AgentDefinition[] {
  return Array.from(registry.values());
}

/** Returns true if an agent with the given ID is registered. */
export function isRegistered(id: string): boolean {
  return registry.has(id);
}

/** Unregister an agent (used in tests). */
export function _unregisterAgent(id: string): void {
  registry.delete(id);
}
