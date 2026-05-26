/**
 * agentRegistry.js
 * Single source of truth for all agent states, handoffs, and activity.
 * No auth / env / policy / checkpoint systems touched.
 */

const AGENT_IDS    = ['planner', 'builder', 'validator', 'security', 'memory'];
const VALID_STATES = ['idle', 'running', 'waiting_approval', 'stalled', 'error'];
const HANDOFF_CHAIN = ['planner', 'builder', 'validator'];   // enforced sequence
const HEARTBEAT_TTL = 8000; // ms before a running agent is marked stalled

// ── Internal state ─────────────────────────────────────────────────────────
const _agents    = {};
const _log       = [];
const _listeners = new Set();

AGENT_IDS.forEach(id => {
  _agents[id] = { id, state: 'idle', task: null, lastHeartbeat: Date.now(), retries: 0 };
});

// ── Helpers ────────────────────────────────────────────────────────────────
function notify() {
  _listeners.forEach(fn => fn({ ..._agents }));
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Transition an agent to a new state. Throws on unknown agent or invalid state. */
export function setAgentState(id, state, task = null) {
  if (!_agents[id])               throw new Error(`Unknown agent: ${id}`);
  if (!VALID_STATES.includes(state)) throw new Error(`Invalid state: ${state}`);
  _agents[id] = { ..._agents[id], state, task, lastHeartbeat: Date.now() };
  _log.push({ ts: Date.now(), agent: id, state, task });
  notify();
}

/** Refresh heartbeat timestamp for a running agent. */
export function heartbeat(id) {
  if (_agents[id]) _agents[id].lastHeartbeat = Date.now();
}

/** Mark running agents stalled if their heartbeat has expired. Call on an interval. */
export function checkStalled() {
  const now = Date.now();
  AGENT_IDS.forEach(id => {
    const a = _agents[id];
    if (a.state === 'running' && now - a.lastHeartbeat > HEARTBEAT_TTL) {
      setAgentState(id, 'stalled', a.task);
    }
  });
}

/**
 * Hand a task from one agent to the next in the enforced chain.
 * Chain: planner → builder → validator
 */
export function handoff(fromId, toId, task) {
  const fi = HANDOFF_CHAIN.indexOf(fromId);
  const ti = HANDOFF_CHAIN.indexOf(toId);
  if (fi === -1 || ti === -1 || ti !== fi + 1)
    throw new Error(`Invalid handoff: ${fromId}→${toId}`);
  setAgentState(fromId, 'idle',    null);
  setAgentState(toId,   'running', task);
}

/** Subscribe to agent state changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Return a snapshot of all agent states. */
export function getAgents() { return { ..._agents }; }

/** Return a copy of the full activity log. */
export function getLog() { return [..._log]; }

export const agentRegistry = {
  setAgentState, heartbeat, checkStalled,
  handoff, subscribe, getAgents, getLog,
};