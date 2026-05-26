/**
 * lib/executionRecords.ts — Execution history store
 *
 * Persists execution records in:
 *   {PROJECT_ROOT}/.jarvas-data/executions/executions.json
 *
 * Records are NEVER deleted — append-only log.
 * Status lifecycle: queued → running → completed | failed
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { PROJECT_ROOT } from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecutionStatus   = "queued" | "running" | "completed" | "failed";
export type ExecutionOpType   =
  | "create_directory"
  | "create_file"
  | "append_log"
  | "update_task_status"
  | "generate_report"
  | "unsupported";

export interface ExecutionRecord {
  id:             string;
  actionId:       string;
  actionTitle:    string;
  operationType:  ExecutionOpType;
  status:         ExecutionStatus;
  dryRun:         boolean;
  startedAt:      string;
  completedAt?:   string;
  checkpointId?:  string;
  affectedFiles:  string[];
  report:         string;
  error?:         string;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const EX_DIR  = path.join(PROJECT_ROOT, ".jarvas-data", "executions");
const EX_FILE = path.join(EX_DIR, "executions.json");

function ensureDir(): void {
  if (!existsSync(EX_DIR)) mkdirSync(EX_DIR, { recursive: true });
}

function readRaw(): ExecutionRecord[] {
  ensureDir();
  if (!existsSync(EX_FILE)) return [];
  try {
    const raw = readFileSync(EX_FILE, "utf-8").trim();
    return raw ? (JSON.parse(raw) as ExecutionRecord[]) : [];
  } catch { return []; }
}

function writeRaw(records: ExecutionRecord[]): void {
  ensureDir();
  writeFileSync(EX_FILE, JSON.stringify(records, null, 2) + "\n", "utf-8");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** List all records, newest first. */
export function listExecutions(filter?: { actionId?: string; status?: ExecutionStatus }): ExecutionRecord[] {
  let all = readRaw();
  if (filter?.actionId) all = all.filter(r => r.actionId === filter.actionId);
  if (filter?.status)   all = all.filter(r => r.status   === filter.status);
  return all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

/** Get a single record by id. */
export function getExecution(id: string): ExecutionRecord | undefined {
  return readRaw().find(r => r.id === id);
}

/** Insert a new record (queued). */
export function createExecution(data: {
  actionId:      string;
  actionTitle:   string;
  operationType: ExecutionOpType;
  dryRun:        boolean;
}): ExecutionRecord {
  const rec: ExecutionRecord = {
    id:            randomUUID(),
    actionId:      data.actionId,
    actionTitle:   data.actionTitle,
    operationType: data.operationType,
    dryRun:        data.dryRun,
    status:        "queued",
    startedAt:     new Date().toISOString(),
    affectedFiles: [],
    report:        "",
  };
  writeRaw([...readRaw(), rec]);
  return rec;
}

/** Patch an existing record. */
export function updateExecution(id: string, patch: Partial<ExecutionRecord>): ExecutionRecord {
  const all = readRaw();
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) throw new Error(`Execution record "${id}" not found.`);
  const updated = { ...all[idx], ...patch } as ExecutionRecord;
  writeRaw(all.map((r, i) => (i === idx ? updated : r)));
  return updated;
}
