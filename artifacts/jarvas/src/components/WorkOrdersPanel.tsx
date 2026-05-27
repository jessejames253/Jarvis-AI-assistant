/**
 * components/WorkOrdersPanel.tsx
 * Work Orders v1 + Execution Planning v1 + Execution Engine v1
 *
 * Per work order card (expanded):
 *   - Inputs / expected output
 *   - PLAN EXECUTION → dry-run AI plan inline (steps, files, safety, risks, validation)
 *   - EXECUTE → only shown when status=ready + plan exists + recommendation=proceed
 *   - Execution result inline (actions, logs, files created)
 */

import { useState, useEffect, useCallback } from "react";
import {
  X, ClipboardList, Loader2, XCircle,
  ChevronDown, ChevronRight, RefreshCw,
  ArrowRight, Lock, CheckCircle2,
  AlertTriangle, Clock, Zap, Package,
  Link2, PlayCircle, FileCode, ShieldCheck,
  CheckSquare, ListChecks, RotateCcw, Ban, Pencil,
  Rocket, FileText, ScrollText, CircleCheck, CircleX,
  SkipForward,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkOrderStatus = "pending" | "ready" | "blocked" | "completed";
type RiskLevel       = "high"    | "medium" | "low";
type Difficulty      = "low"     | "medium" | "high" | "critical";
type Recommendation  = "proceed" | "revise" | "block";
type SafetyResult    = "pass"    | "warn"   | "fail";
type FileChange      = "create"  | "modify" | "delete" | "read";
type ValidationType  = "test"    | "lint"   | "typecheck" | "manual" | "automated";
type ActionType      = "create_file" | "append_log" | "generate_report" | "update_status";
type ActionStatus    = "completed" | "skipped" | "failed";
type ExecStatus      = "success" | "partial" | "failed";

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

interface ProposedStep    { stepNumber: number; action: string; detail: string; reversible: boolean }
interface FileImpact      { path: string; change: FileChange; reason: string }
interface SafetyCheck     { check: string; result: SafetyResult; detail: string }
interface ExecutionRisk   { description: string; severity: "high"|"medium"|"low"; mitigation: string }
interface ValidationStep  { description: string; type: ValidationType }

interface ExecutionPlan {
  workOrderId:         string;
  objective:           string;
  requiredInputs:      string[];
  proposedSteps:       ProposedStep[];
  filesLikelyAffected: FileImpact[];
  safetyChecks:        SafetyCheck[];
  risks:               ExecutionRisk[];
  validationPlan:      ValidationStep[];
  estimatedDifficulty: Difficulty;
  recommendation:      Recommendation;
  plannedAt:           string;
}

interface ExecutionAction {
  type:     ActionType;
  path?:    string;
  content?: string;
  status:   ActionStatus;
  error?:   string;
}

interface ExecutionResult {
  id:                     string;
  workOrderId:            string;
  agentId:                string;
  agentName:              string;
  agentEmoji:             string;
  agentColor:             string;
  executedAt:             string;
  checkpointId:           string;
  status:                 ExecStatus;
  actionsPlanned:         number;
  actionsExecuted:        number;
  actions:                ExecutionAction[];
  logs:                   string[];
  errors:                 string[];
  workOrderStatusUpdated: boolean;
  outputDir:              string;
}

interface WorkOrdersPanelProps {
  isOpen:  boolean;
  onClose: () => void;
  apiBase: string;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const GOLD   = "hsl(43 100% 55%)";
const MUTED  = "hsl(210 15% 38%)";
const GREEN  = "hsl(150 70% 55%)";
const AMBER  = "hsl(38 100% 60%)";
const RED    = "hsl(355 80% 65%)";
const BLUE   = "hsl(196 80% 58%)";
const VIOLET = "hsl(262 75% 65%)";
const CYAN   = "hsl(185 75% 58%)";
const DARK   = "hsl(220 20% 5%)";

const STATUS_META: Record<WorkOrderStatus, { label: string; color: string; icon: React.ElementType }> = {
  ready:     { label: "READY",   color: GREEN, icon: Zap          },
  pending:   { label: "PENDING", color: AMBER, icon: Clock        },
  blocked:   { label: "BLOCKED", color: RED,   icon: Lock         },
  completed: { label: "DONE",    color: BLUE,  icon: CheckCircle2 },
};
const RISK_META: Record<RiskLevel, { color: string }> = {
  high: { color: RED }, medium: { color: AMBER }, low: { color: GREEN },
};
const DIFF_META: Record<Difficulty, { color: string; label: string }> = {
  low: { color: GREEN, label: "LOW" }, medium: { color: BLUE, label: "MEDIUM" },
  high: { color: AMBER, label: "HIGH" }, critical: { color: RED, label: "CRITICAL" },
};
const REC_META: Record<Recommendation, { color: string; label: string; icon: React.ElementType }> = {
  proceed: { color: GREEN, label: "PROCEED", icon: CheckCircle2 },
  revise:  { color: AMBER, label: "REVISE",  icon: Pencil       },
  block:   { color: RED,   label: "BLOCK",   icon: Ban          },
};
const SAFETY_META: Record<SafetyResult, { color: string; icon: React.ElementType }> = {
  pass: { color: GREEN, icon: CheckCircle2  },
  warn: { color: AMBER, icon: AlertTriangle },
  fail: { color: RED,   icon: Ban          },
};
const FILE_CHANGE_COLOR: Record<FileChange, string> = {
  create: GREEN, modify: BLUE, delete: RED, read: MUTED,
};
const VAL_COLOR: Record<ValidationType, string> = {
  test: GREEN, lint: BLUE, typecheck: VIOLET, manual: AMBER, automated: GREEN,
};
const EXEC_STATUS_META: Record<ExecStatus, { color: string; label: string }> = {
  success: { color: GREEN, label: "SUCCESS" },
  partial: { color: AMBER, label: "PARTIAL" },
  failed:  { color: RED,   label: "FAILED"  },
};
const ACTION_ICON: Record<ActionType, React.ElementType> = {
  create_file:     FileText,
  append_log:      ScrollText,
  generate_report: FileCode,
  update_status:   CheckSquare,
};
const ACTION_STATUS_ICON: Record<ActionStatus, React.ElementType> = {
  completed: CircleCheck,
  skipped:   SkipForward,
  failed:    CircleX,
};
const ACTION_STATUS_COLOR: Record<ActionStatus, string> = {
  completed: GREEN, skipped: MUTED, failed: RED,
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, orderId, onUpdate, updating }: {
  status: WorkOrderStatus; orderId: string;
  onUpdate: (id: string, s: WorkOrderStatus) => void; updating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(v => !v)} disabled={updating}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-mono font-bold transition-all"
        style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}40`, color: meta.color }}>
        {updating ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Icon className="w-2.5 h-2.5" />}
        {meta.label}<ChevronDown className="w-2 h-2" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden z-10 shadow-xl"
          style={{ background: "hsl(222 28% 9%)", border: "1px solid hsl(210 15% 20%)", minWidth: 110 }}>
          {(["ready","pending","blocked","completed"] as WorkOrderStatus[]).map(s => {
            const m = STATUS_META[s]; const Si = m.icon;
            return (
              <button key={s} type="button" onClick={() => { setOpen(false); onUpdate(orderId, s); }}
                className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-[8px] font-mono hover:bg-white/5 transition-colors"
                style={{ color: m.color }}>
                <Si className="w-2.5 h-2.5 flex-shrink-0" />{m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Execution plan view ──────────────────────────────────────────────────────

function ExecutionPlanView({ plan }: { plan: ExecutionPlan }) {
  const rec = REC_META[plan.recommendation];
  const diff = DIFF_META[plan.estimatedDifficulty];
  const RecIcon = rec.icon;
  const [stepsOpen,  setStepsOpen]  = useState(true);
  const [filesOpen,  setFilesOpen]  = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [risksOpen,  setRisksOpen]  = useState(false);
  const [valOpen,    setValOpen]    = useState(false);
  const failCount = plan.safetyChecks.filter(s => s.result === "fail").length;
  const warnCount = plan.safetyChecks.filter(s => s.result === "warn").length;

  return (
    <div className="mt-1.5 rounded-xl overflow-hidden"
      style={{ border: `1px solid ${rec.color}35`, background: `${rec.color}05` }}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b flex-wrap"
        style={{ borderColor: `${rec.color}20` }}>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <RecIcon className="w-2.5 h-2.5 flex-shrink-0" style={{ color: rec.color }} />
          <span className="text-[7px] font-mono font-bold tracking-widest" style={{ color: rec.color }}>{rec.label}</span>
          <span className="text-[6px]" style={{ color: MUTED }}>·</span>
          <span className="text-[6px] font-mono px-1 rounded"
            style={{ background: `${diff.color}15`, border: `1px solid ${diff.color}30`, color: diff.color }}>{diff.label}</span>
        </div>
        {(failCount > 0 || warnCount > 0) && (
          <span className="text-[6px] font-mono" style={{ color: failCount > 0 ? RED : AMBER }}>
            {[failCount > 0 && `${failCount}✗`, warnCount > 0 && `${warnCount}⚠`].filter(Boolean).join(" ")}
          </span>
        )}
      </div>
      <div className="px-2.5 py-1.5 space-y-1">
        {/* Steps */}
        <div>
          <button type="button" onClick={() => setStepsOpen(v => !v)}
            className="flex items-center gap-1.5 w-full text-left">
            <ListChecks className="w-2 h-2 flex-shrink-0" style={{ color: BLUE }} />
            <span className="flex-1 text-[6.5px] font-mono font-bold tracking-widest" style={{ color: BLUE }}>STEPS</span>
            <span className="text-[6px] font-mono" style={{ color: MUTED }}>{plan.proposedSteps.length}</span>
            {stepsOpen ? <ChevronDown className="w-1.5 h-1.5" style={{ color: MUTED }} /> : <ChevronRight className="w-1.5 h-1.5" style={{ color: MUTED }} />}
          </button>
          {stepsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {plan.proposedSteps.map(s => (
                <div key={s.stepNumber} className="flex items-start gap-1.5 pl-0.5">
                  <div className="w-3.5 h-3.5 rounded flex items-center justify-center text-[6px] font-bold flex-shrink-0 mt-0.5"
                    style={{ background: `${BLUE}15`, color: BLUE }}>{s.stepNumber}</div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[7px] font-semibold" style={{ color: "hsl(196 25% 70%)" }}>{s.action}</span>
                    {!s.reversible && <span className="ml-1 text-[5.5px] font-mono px-0.5 rounded" style={{ background: `${AMBER}12`, color: AMBER }}>irrev.</span>}
                    <p className="text-[6px] leading-snug" style={{ color: MUTED }}>{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Files */}
        <div>
          <button type="button" onClick={() => setFilesOpen(v => !v)}
            className="flex items-center gap-1.5 w-full text-left">
            <FileCode className="w-2 h-2 flex-shrink-0" style={{ color: VIOLET }} />
            <span className="flex-1 text-[6.5px] font-mono font-bold tracking-widest" style={{ color: VIOLET }}>FILES</span>
            <span className="text-[6px] font-mono" style={{ color: MUTED }}>{plan.filesLikelyAffected.length}</span>
            {filesOpen ? <ChevronDown className="w-1.5 h-1.5" style={{ color: MUTED }} /> : <ChevronRight className="w-1.5 h-1.5" style={{ color: MUTED }} />}
          </button>
          {filesOpen && (
            <div className="mt-0.5 space-y-0.5">
              {plan.filesLikelyAffected.map((f, i) => (
                <div key={i} className="flex items-center gap-1 pl-0.5">
                  <span className="text-[5.5px] font-mono px-0.5 rounded flex-shrink-0"
                    style={{ background: `${FILE_CHANGE_COLOR[f.change]}12`, color: FILE_CHANGE_COLOR[f.change] }}>{f.change}</span>
                  <p className="text-[6.5px] font-mono truncate" style={{ color: "hsl(196 25% 62%)" }}>{f.path}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Safety */}
        <div>
          <button type="button" onClick={() => setSafetyOpen(v => !v)}
            className="flex items-center gap-1.5 w-full text-left">
            <ShieldCheck className="w-2 h-2 flex-shrink-0" style={{ color: failCount > 0 ? RED : warnCount > 0 ? AMBER : GREEN }} />
            <span className="flex-1 text-[6.5px] font-mono font-bold tracking-widest" style={{ color: failCount > 0 ? RED : warnCount > 0 ? AMBER : GREEN }}>SAFETY</span>
            <span className="text-[6px] font-mono" style={{ color: MUTED }}>{plan.safetyChecks.length}</span>
            {safetyOpen ? <ChevronDown className="w-1.5 h-1.5" style={{ color: MUTED }} /> : <ChevronRight className="w-1.5 h-1.5" style={{ color: MUTED }} />}
          </button>
          {safetyOpen && (
            <div className="mt-0.5 space-y-0.5">
              {plan.safetyChecks.map((sc, i) => {
                const sm = SAFETY_META[sc.result]; const SIcon = sm.icon;
                return (
                  <div key={i} className="flex items-start gap-1 pl-0.5">
                    <SIcon className="w-2 h-2 flex-shrink-0 mt-0.5" style={{ color: sm.color }} />
                    <div>
                      <p className="text-[6.5px] font-semibold" style={{ color: "hsl(196 25% 62%)" }}>{sc.check}</p>
                      <p className="text-[6px]" style={{ color: MUTED }}>{sc.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* Risks */}
        {plan.risks.length > 0 && (
          <div>
            <button type="button" onClick={() => setRisksOpen(v => !v)}
              className="flex items-center gap-1.5 w-full text-left">
              <AlertTriangle className="w-2 h-2 flex-shrink-0" style={{ color: RED }} />
              <span className="flex-1 text-[6.5px] font-mono font-bold tracking-widest" style={{ color: RED }}>RISKS</span>
              <span className="text-[6px] font-mono" style={{ color: MUTED }}>{plan.risks.length}</span>
              {risksOpen ? <ChevronDown className="w-1.5 h-1.5" style={{ color: MUTED }} /> : <ChevronRight className="w-1.5 h-1.5" style={{ color: MUTED }} />}
            </button>
            {risksOpen && (
              <div className="mt-0.5 space-y-0.5">
                {plan.risks.map((r, i) => {
                  const c = RISK_META[r.severity].color;
                  return (
                    <div key={i} className="rounded px-1.5 py-1"
                      style={{ background: `${c}08`, border: `1px solid ${c}20` }}>
                      <div className="flex items-start gap-1">
                        <span className="text-[5.5px] font-mono px-0.5 rounded flex-shrink-0" style={{ background: `${c}15`, color: c }}>{r.severity}</span>
                        <p className="text-[6.5px]" style={{ color: "hsl(196 25% 62%)" }}>{r.description}</p>
                      </div>
                      <p className="text-[6px] mt-0.5 pl-4" style={{ color: MUTED }}>{r.mitigation}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* Validation */}
        {plan.validationPlan.length > 0 && (
          <div>
            <button type="button" onClick={() => setValOpen(v => !v)}
              className="flex items-center gap-1.5 w-full text-left">
              <CheckSquare className="w-2 h-2 flex-shrink-0" style={{ color: GREEN }} />
              <span className="flex-1 text-[6.5px] font-mono font-bold tracking-widest" style={{ color: GREEN }}>VALIDATION</span>
              <span className="text-[6px] font-mono" style={{ color: MUTED }}>{plan.validationPlan.length}</span>
              {valOpen ? <ChevronDown className="w-1.5 h-1.5" style={{ color: MUTED }} /> : <ChevronRight className="w-1.5 h-1.5" style={{ color: MUTED }} />}
            </button>
            {valOpen && (
              <div className="mt-0.5 space-y-0.5">
                {plan.validationPlan.map((v, i) => (
                  <div key={i} className="flex items-center gap-1 pl-0.5">
                    <span className="text-[5.5px] font-mono px-0.5 rounded flex-shrink-0"
                      style={{ background: `${VAL_COLOR[v.type]}12`, color: VAL_COLOR[v.type] }}>{v.type}</span>
                    <p className="text-[6.5px]" style={{ color: MUTED }}>{v.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Execution result view ────────────────────────────────────────────────────

function ExecutionResultView({ result }: { result: ExecutionResult }) {
  const sm = EXEC_STATUS_META[result.status];
  const [actionsOpen, setActionsOpen] = useState(true);
  const [logsOpen,    setLogsOpen]    = useState(false);

  const completedCount = result.actions.filter(a => a.status === "completed").length;
  const fileActions    = result.actions.filter(a => a.type !== "update_status" && a.status === "completed");

  return (
    <div className="mt-2 rounded-xl overflow-hidden"
      style={{ border: `1px solid ${sm.color}40`, background: `${sm.color}06` }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2 border-b flex-wrap"
        style={{ borderColor: `${sm.color}20` }}>
        <Rocket className="w-3 h-3 flex-shrink-0" style={{ color: sm.color }} />
        <span className="text-[8px] font-mono font-bold tracking-widest flex-1" style={{ color: sm.color }}>
          EXECUTED · {sm.label}
        </span>
        <span className="text-[7px] font-mono" style={{ color: sm.color }}>
          {completedCount}/{result.actionsPlanned} actions
        </span>
        {result.workOrderStatusUpdated && (
          <span className="text-[6px] font-mono px-1 rounded"
            style={{ background: `${BLUE}15`, border: `1px solid ${BLUE}30`, color: BLUE }}>
            status → done
          </span>
        )}
        <span className="text-[6.5px] font-mono" style={{ color: MUTED }}>
          {new Date(result.executedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="px-2.5 py-2 space-y-1.5">
        {/* Output files */}
        {fileActions.length > 0 && (
          <div>
            <button type="button" onClick={() => setActionsOpen(v => !v)}
              className="flex items-center gap-1.5 w-full text-left">
              <FileText className="w-2.5 h-2.5 flex-shrink-0" style={{ color: CYAN }} />
              <span className="flex-1 text-[7px] font-mono font-bold tracking-widest" style={{ color: CYAN }}>
                OUTPUT FILES
              </span>
              <span className="text-[6.5px] font-mono" style={{ color: MUTED }}>{fileActions.length}</span>
              {actionsOpen ? <ChevronDown className="w-2 h-2" style={{ color: MUTED }} /> : <ChevronRight className="w-2 h-2" style={{ color: MUTED }} />}
            </button>
            {actionsOpen && (
              <div className="mt-1 space-y-1">
                {result.actions.map((action, i) => {
                  const AIcon   = ACTION_ICON[action.type];
                  const StIcon  = ACTION_STATUS_ICON[action.status];
                  const stColor = ACTION_STATUS_COLOR[action.status];
                  const relPath = action.path
                    ? action.path.split(/[\\/]/).slice(-3).join("/")
                    : action.type;
                  return (
                    <div key={i} className="flex items-start gap-1.5">
                      <StIcon className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" style={{ color: stColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <AIcon className="w-2 h-2 flex-shrink-0" style={{ color: MUTED }} />
                          <span className="text-[7px] font-mono truncate" style={{ color: "hsl(196 25% 65%)" }}>
                            {relPath}
                          </span>
                          {action.status !== "completed" && (
                            <span className="text-[6px] font-mono px-0.5 rounded"
                              style={{ background: `${stColor}15`, color: stColor }}>{action.status}</span>
                          )}
                        </div>
                        {action.error && (
                          <p className="text-[6px] mt-0.5" style={{ color: RED }}>{action.error}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Output dir */}
        {result.outputDir && (
          <p className="text-[6.5px] font-mono" style={{ color: MUTED }}>
            📁 {result.outputDir}
          </p>
        )}

        {/* Logs */}
        <div>
          <button type="button" onClick={() => setLogsOpen(v => !v)}
            className="flex items-center gap-1.5 w-full text-left">
            <ScrollText className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
            <span className="flex-1 text-[7px] font-mono font-bold tracking-widest" style={{ color: MUTED }}>LOGS</span>
            <span className="text-[6.5px] font-mono" style={{ color: MUTED }}>{result.logs.length}</span>
            {logsOpen ? <ChevronDown className="w-2 h-2" style={{ color: MUTED }} /> : <ChevronRight className="w-2 h-2" style={{ color: MUTED }} />}
          </button>
          {logsOpen && (
            <div className="mt-1 rounded px-1.5 py-1.5 space-y-0.5 overflow-x-auto"
              style={{ background: "hsl(220 20% 4%)", border: "1px solid hsl(210 15% 14%)" }}>
              {result.logs.map((log, i) => (
                <p key={i} className="text-[6.5px] font-mono whitespace-nowrap"
                  style={{ color: log.includes("[ERR]") ? RED : log.includes("[SKIP]") ? AMBER : "hsl(196 25% 52%)" }}>
                  {log}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Errors */}
        {result.errors.length > 0 && (
          <div className="rounded px-2 py-1.5"
            style={{ background: `${RED}08`, border: `1px solid ${RED}25` }}>
            {result.errors.map((e, i) => (
              <p key={i} className="text-[7px]" style={{ color: "hsl(355 80% 72%)" }}>⚠ {e}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Work order card ──────────────────────────────────────────────────────────

function OrderCard({
  order, allOrders, onUpdateStatus, updatingId,
  executionPlan, onPlanExecution, planningId,
  executionResult, onExecute, executingId,
}: {
  order:           WorkOrder;
  allOrders:       WorkOrder[];
  onUpdateStatus:  (id: string, s: WorkOrderStatus) => void;
  updatingId:      string | null;
  executionPlan:   ExecutionPlan | null;
  onPlanExecution: (id: string) => void;
  planningId:      string | null;
  executionResult: ExecutionResult | null;
  onExecute:       (id: string) => void;
  executingId:     string | null;
}) {
  const [open, setOpen] = useState(false);
  const isUpdating  = updatingId  === order.id;
  const isPlanning  = planningId  === order.id;
  const isExecuting = executingId === order.id;
  const blocked     = order.status === "blocked";
  const risk        = RISK_META[order.riskLevel];

  // Execute button visibility: ready + plan exists + plan recommends proceed
  const canExecute =
    order.status === "ready" &&
    executionPlan !== null &&
    executionPlan.recommendation === "proceed";

  const depNames = order.dependencies.map(depId => {
    const dep = allOrders.find(o => o.id === depId);
    return dep ? dep.agentName : order.dependencyNames[order.dependencies.indexOf(depId)] ?? depId.slice(0, 8);
  });

  return (
    <div className="rounded-xl overflow-hidden transition-all"
      style={{
        border:     `1px solid ${blocked ? RED + "40" : order.agentColor + "30"}`,
        background: `${order.agentColor}06`,
        opacity:    order.status === "completed" ? 0.7 : 1,
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
        {/* Indicator dots */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {executionPlan && (
            <div className="w-1.5 h-1.5 rounded-full"
              style={{ background: REC_META[executionPlan.recommendation].color }}
              title={`Plan: ${executionPlan.recommendation}`} />
          )}
          {executionResult && (
            <div className="w-1.5 h-1.5 rounded-full"
              style={{ background: EXEC_STATUS_META[executionResult.status].color }}
              title={`Exec: ${executionResult.status}`} />
          )}
        </div>
        <span className="text-[7px] font-mono px-1 rounded flex-shrink-0"
          style={{ background: `${risk.color}12`, border: `1px solid ${risk.color}30`, color: risk.color }}>
          {order.riskLevel}
        </span>
        <StatusBadge status={order.status} orderId={order.id}
          onUpdate={onUpdateStatus} updating={isUpdating} />
        {open
          ? <ChevronDown  className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
          : <ChevronRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />}
      </button>

      {/* Expanded */}
      {open && (
        <div className="border-t px-2.5 py-2.5 space-y-2"
          style={{ borderColor: `${order.agentColor}20` }}>
          {/* Inputs */}
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" style={{ color: MUTED }} />
              <p className="text-[7px] font-mono font-bold tracking-widest" style={{ color: MUTED }}>INPUTS</p>
            </div>
            {order.inputs.map((inp, i) => (
              <p key={i} className="text-[8px] leading-relaxed pl-4" style={{ color: "hsl(196 20% 60%)" }}>• {inp}</p>
            ))}
          </div>
          {/* Expected output */}
          <div>
            <div className="flex items-center gap-1 mb-0.5">
              <Package className="w-2.5 h-2.5 flex-shrink-0" style={{ color: `${order.agentColor}90` }} />
              <p className="text-[7px] font-mono font-bold tracking-widest" style={{ color: MUTED }}>EXPECTED OUTPUT</p>
            </div>
            <p className="text-[8px] leading-relaxed pl-4" style={{ color: MUTED }}>{order.expectedOutput}</p>
          </div>

          {/* Plan Execution button */}
          <button type="button" onClick={() => onPlanExecution(order.id)} disabled={isPlanning || isExecuting}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg font-bold text-[8px] tracking-widest transition-all active:scale-95 disabled:opacity-50"
            style={{ background: `${VIOLET}12`, border: `1px solid ${VIOLET}40`, color: VIOLET }}>
            {isPlanning
              ? <><Loader2 className="w-3 h-3 animate-spin" /> PLANNING…</>
              : executionPlan
                ? <><RotateCcw className="w-3 h-3" /> RE-PLAN EXECUTION</>
                : <><PlayCircle className="w-3 h-3" /> PLAN EXECUTION</>}
          </button>

          {/* Execute button — only when ready + plan + proceed */}
          {canExecute && (
            <button type="button" onClick={() => onExecute(order.id)} disabled={isExecuting || isPlanning}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg font-bold text-[9px] tracking-widest transition-all active:scale-95 disabled:opacity-50"
              style={{ background: `${GREEN}15`, border: `1px solid ${GREEN}50`, color: GREEN }}>
              {isExecuting
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> EXECUTING…</>
                : <><Rocket className="w-3.5 h-3.5" /> EXECUTE WORK ORDER</>}
            </button>
          )}

          {/* Inline plan */}
          {executionPlan && !isPlanning && (
            <ExecutionPlanView plan={executionPlan} />
          )}

          {/* Inline execution result */}
          {executionResult && !isExecuting && (
            <ExecutionResultView result={executionResult} />
          )}

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
  agentId, agentName, agentColor, agentEmoji,
  orders, allOrders, onUpdateStatus, updatingId,
  executionPlans, onPlanExecution, planningId,
  executionResults, onExecute, executingId,
}: {
  agentId: string; agentName: string; agentColor: string; agentEmoji: string;
  orders: WorkOrder[]; allOrders: WorkOrder[];
  onUpdateStatus: (id: string, s: WorkOrderStatus) => void; updatingId: string | null;
  executionPlans: Record<string, ExecutionPlan>;
  onPlanExecution: (id: string) => void; planningId: string | null;
  executionResults: Record<string, ExecutionResult>;
  onExecute: (id: string) => void; executingId: string | null;
}) {
  const [open, setOpen] = useState(true);
  const doneCount = orders.filter(o => o.status === "completed").length;
  return (
    <div className="rounded-xl overflow-hidden mb-2.5"
      style={{ border: `1px solid ${agentColor}35`, background: DARK }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left px-3 py-2.5">
        <span className="text-[13px]">{agentEmoji}</span>
        <span className="flex-1 text-[10px] font-bold" style={{ color: agentColor }}>{agentName}</span>
        <span className="text-[8px] font-mono" style={{ color: MUTED }}>{doneCount}/{orders.length}</span>
        <div className="flex gap-1 flex-shrink-0">
          {orders.map(o => {
            const m = STATUS_META[o.status];
            return <div key={o.id} className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />;
          })}
        </div>
        {open ? <ChevronDown className="w-3 h-3" style={{ color: MUTED }} /> : <ChevronRight className="w-3 h-3" style={{ color: MUTED }} />}
      </button>
      {open && (
        <div className="border-t px-2.5 py-2.5 space-y-2"
          style={{ borderColor: `${agentColor}20` }}>
          {orders.map(order => (
            <OrderCard key={order.id} order={order}
              allOrders={allOrders}
              onUpdateStatus={onUpdateStatus} updatingId={updatingId}
              executionPlan={executionPlans[order.id] ?? null}
              onPlanExecution={onPlanExecution} planningId={planningId}
              executionResult={executionResults[order.id] ?? null}
              onExecute={onExecute} executingId={executingId}
            />
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
        const m = STATUS_META[s]; const Si = m.icon;
        if (counts[s] === 0) return null;
        return (
          <div key={s} className="flex items-center gap-1 px-2 py-1 rounded-lg"
            style={{ background: `${m.color}10`, border: `1px solid ${m.color}25` }}>
            <Si className="w-2.5 h-2.5" style={{ color: m.color }} />
            <span className="text-[8px] font-mono font-bold" style={{ color: m.color }}>{counts[s]}</span>
            <span className="text-[7px] font-mono" style={{ color: MUTED }}>{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function WorkOrdersPanel({ isOpen, onClose, apiBase }: WorkOrdersPanelProps) {
  const [orders,          setOrders]          = useState<WorkOrder[]>([]);
  const [executionPlans,  setExecutionPlans]  = useState<Record<string, ExecutionPlan>>({});
  const [executionResults,setExecutionResults]= useState<Record<string, ExecutionResult>>({});
  const [loading,         setLoading]         = useState(false);
  const [converting,      setConverting]      = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [updatingId,      setUpdatingId]      = useState<string | null>(null);
  const [planningId,      setPlanningId]      = useState<string | null>(null);
  const [executingId,     setExecutingId]     = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ordersRes, plansRes, execsRes] = await Promise.all([
        fetch(`${apiBase}api/agents/work-orders`),
        fetch(`${apiBase}api/agents/work-orders/execution-plans`),
        fetch(`${apiBase}api/agents/work-orders/executions`),
      ]);
      const ordersData = await ordersRes.json() as { ok: boolean; orders?: WorkOrder[]; error?: string };
      const plansData  = await plansRes.json()  as { ok: boolean; plans?: Record<string, ExecutionPlan> };
      const execsData  = await execsRes.json()  as { ok: boolean; executions?: ExecutionResult[] };

      if (!ordersData.ok) throw new Error(ordersData.error ?? "Failed to load work orders");
      setOrders(ordersData.orders ?? []);
      if (plansData.ok) setExecutionPlans(plansData.plans ?? {});
      if (execsData.ok) {
        // Build a map of workOrderId → most recent result
        const map: Record<string, ExecutionResult> = {};
        for (const ex of (execsData.executions ?? []).reverse()) map[ex.workOrderId] = ex;
        setExecutionResults(map);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { if (isOpen) void fetchOrders(); }, [isOpen, fetchOrders]);

  const convertLastPlan = useCallback(async () => {
    setConverting(true); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/work-orders/from-collaboration/last`, { method: "POST" });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Conversion failed");
      await fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setConverting(false); }
  }, [apiBase, fetchOrders]);

  const updateStatus = useCallback(async (id: string, status: WorkOrderStatus) => {
    setUpdatingId(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/work-orders/${id}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ status }),
      });
      const data = await res.json() as { ok: boolean; orders?: WorkOrder[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Status update failed");
      setOrders(data.orders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setUpdatingId(null); }
  }, [apiBase]);

  const triggerPlanExecution = useCallback(async (id: string) => {
    setPlanningId(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/work-orders/${id}/plan-execution`, { method: "POST" });
      const data = await res.json() as { ok: boolean; plan?: ExecutionPlan; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Execution planning failed");
      if (data.plan) setExecutionPlans(prev => ({ ...prev, [id]: data.plan! }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setPlanningId(null); }
  }, [apiBase]);

  const triggerExecution = useCallback(async (id: string) => {
    setExecutingId(id); setError(null);
    try {
      const res  = await fetch(`${apiBase}api/agents/work-orders/${id}/execute`, { method: "POST" });
      const data = await res.json() as { ok: boolean; result?: ExecutionResult; errors?: string[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? (data.errors?.[0] ?? "Execution failed"));
      if (data.result) {
        setExecutionResults(prev => ({ ...prev, [id]: data.result! }));
        // Refresh orders to pick up status cascade
        const ordersRes  = await fetch(`${apiBase}api/agents/work-orders`);
        const ordersData = await ordersRes.json() as { ok: boolean; orders?: WorkOrder[] };
        if (ordersData.ok) setOrders(ordersData.orders ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally { setExecutingId(null); }
  }, [apiBase]);

  // Group orders by agent
  const grouped: Map<string, { agentId: string; agentName: string; agentColor: string; agentEmoji: string; orders: WorkOrder[] }> = new Map();
  for (const order of orders) {
    if (!grouped.has(order.agentId)) {
      grouped.set(order.agentId, { agentId: order.agentId, agentName: order.agentName, agentColor: order.agentColor, agentEmoji: order.agentEmoji, orders: [] });
    }
    grouped.get(order.agentId)!.orders.push(order);
  }

  const plannedCount  = Object.keys(executionPlans).length;
  const executedCount = Object.keys(executionResults).length;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 sm:hidden"
          style={{ background: "hsl(220 30% 4% / 0.6)" }}
          onClick={onClose} aria-hidden="true" />
      )}
      <aside data-testid="work-orders-panel"
        className="fixed top-0 right-0 h-full z-40 flex flex-col transition-transform duration-300 ease-in-out"
        style={{
          width:      "min(100vw, 480px)",
          transform:  isOpen ? "translateX(0)" : "translateX(100%)",
          background: "hsl(222 28% 7%)",
          borderLeft: "1px solid hsl(210 15% 15%)",
          boxShadow:  isOpen ? "-4px 0 32px hsl(0 0% 0% / 0.5)" : "none",
        }}
        aria-label="Work orders panel">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 flex-shrink-0 border-b"
          style={{ borderColor: "hsl(210 15% 14%)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <ClipboardList className="w-4 h-4 flex-shrink-0" style={{ color: GOLD }} />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: GOLD }}>ORDERS</h2>
            {orders.length > 0 && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${GOLD}18`, border: `1px solid ${GOLD}40`, color: GOLD }}>
                {orders.length}
              </span>
            )}
            {plannedCount > 0 && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${VIOLET}18`, border: `1px solid ${VIOLET}40`, color: VIOLET }}>
                {plannedCount} planned
              </span>
            )}
            {executedCount > 0 && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ background: `${GREEN}18`, border: `1px solid ${GREEN}40`, color: GREEN }}>
                {executedCount} exec'd
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" onClick={fetchOrders} disabled={loading}
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }} title="Refresh">
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} style={{ color: "hsl(210 20% 55%)" }} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close work orders panel"
              className="w-7 h-7 flex items-center justify-center rounded-lg border transition-all active:scale-95"
              style={{ background: "transparent", borderColor: "hsl(210 15% 28%)" }}>
              <X className="w-3.5 h-3.5" style={{ color: "hsl(210 20% 55%)" }} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Convert action */}
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

          {/* Error */}
          {error && (
            <div className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-lg"
              style={{ background: "hsl(355 80% 50% / 0.1)", border: "1px solid hsl(355 80% 50% / 0.3)" }}>
              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: RED }} />
              <p className="text-[10px]" style={{ color: "hsl(355 80% 72%)" }}>{error}</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 py-10 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: GOLD }} />
              <span className="text-[10px]" style={{ color: MUTED }}>Loading…</span>
            </div>
          )}

          {!loading && orders.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-14 text-center px-6">
              <ClipboardList className="w-8 h-8 opacity-10" style={{ color: GOLD }} />
              <p className="text-[11px]" style={{ color: MUTED }}>
                No work orders yet. Create a collaboration plan via <strong style={{ color: "hsl(320 70% 62%)" }}>COLLAB</strong>,
                then click <strong style={{ color: GOLD }}>CONVERT</strong> above.
              </p>
            </div>
          )}

          {!loading && orders.length > 0 && (
            <div className="px-4 pt-3"><StatsBar orders={orders} /></div>
          )}

          {!loading && grouped.size > 0 && (
            <div className="px-3 pt-3 pb-8">
              {Array.from(grouped.values()).map(group => (
                <AgentGroup key={group.agentId} {...group}
                  allOrders={orders}
                  onUpdateStatus={updateStatus} updatingId={updatingId}
                  executionPlans={executionPlans}
                  onPlanExecution={triggerPlanExecution} planningId={planningId}
                  executionResults={executionResults}
                  onExecute={triggerExecution} executingId={executingId}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
