/**
 * lib/planner/executor.ts — Runs plan steps sequentially via a mini-agent loop.
 *
 * Each step gets its own focused Claude call (up to MAX_STEP_ITERS iterations)
 * with the overall goal and previous step results as context. Tool events are
 * forwarded to the SSE sender as-is (same format as the main agent runner).
 *
 * Recovery: on first failure, waits 500ms and retries once with a retry hint.
 * If the retry also fails, the step is marked failed and execution continues
 * (subsequent steps receive "Step N failed: [error]" as context so they can adapt).
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { TOOL_DEFINITIONS, TOOL_LABELS, executeToolCall } from "../agent/registry";
import type { ToolContext } from "../agent/registry";
import type { Plan, PlanStep } from "./types";

const MAX_STEP_ITERS = 3;
const MAX_RETRIES    = 1;
const RETRY_DELAY_MS = 500;

// ─── Jarvis personality (mirrors runner.ts) ───────────────────────────────────

const BASE_SYSTEM = `You are Jarvis — a calm, intelligent, and direct AI assistant. Confident and precise. Answer directly without preamble. Format responses with markdown where appropriate.`;

// ─── Types ────────────────────────────────────────────────────────────────────

type TextBlock    = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
type ContentBlock = TextBlock | ToolUseBlock;

type MessageParam =
  | { role: "user";      content: string | Array<{ type: "tool_result"; tool_use_id: string; content: string }> }
  | { role: "assistant"; content: ContentBlock[] };

// ─── Step system prompt ───────────────────────────────────────────────────────

function buildStepPrompt(plan: Plan, step: PlanStep, stepIndex: number, prevResults: string[], isRetry: boolean): string {
  const parts = [BASE_SYSTEM, ""];
  parts.push(`You are executing step ${stepIndex + 1} of ${plan.steps.length} in a multi-step plan.`);
  parts.push(`Overall goal: ${plan.goal}`);
  parts.push(`Current step (${stepIndex + 1}/${plan.steps.length}): ${step.title}`);

  if (step.hint) {
    parts.push(`Guidance: ${step.hint}`);
  }

  if (isRetry) {
    parts.push(`\nNote: This step failed on the first attempt (error: ${step.error}). Adjust your approach.`);
  }

  if (prevResults.length > 0) {
    parts.push("\nContext from previous steps:");
    prevResults.forEach((r, i) => {
      parts.push(`Step ${i + 1}: ${r.slice(0, 600)}`);
    });
  }

  parts.push("\nExecute this step directly and concisely. Use tools when needed. Your response becomes the step result shown to the user.");

  return parts.join("\n");
}

// ─── Single step executor ─────────────────────────────────────────────────────

async function executeStep(
  plan: Plan,
  step: PlanStep,
  stepIndex: number,
  prevResults: string[],
  ctx: ToolContext,
  send: (data: object) => void,
  isRetry: boolean,
): Promise<string> {
  const systemPrompt = buildStepPrompt(plan, step, stepIndex, prevResults, isRetry);
  const messages: MessageParam[] = [
    { role: "user", content: step.hint ? `${step.title}\n\n${step.hint}` : step.title },
  ];

  let fullResponse = "";

  for (let iter = 0; iter < MAX_STEP_ITERS; iter++) {
    const blocks = new Map<number, ContentBlock & { input_json?: string }>();
    let stopReason = "end_turn";

    const stream = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages as Parameters<typeof anthropic.messages.create>[0]["messages"],
      tools: TOOL_DEFINITIONS as Parameters<typeof anthropic.messages.create>[0]["tools"],
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const cb = event.content_block;
        if (cb.type === "text") {
          blocks.set(event.index, { type: "text", text: "" });
        } else if (cb.type === "tool_use") {
          blocks.set(event.index, { type: "tool_use", id: cb.id, name: cb.name, input: {}, input_json: "" });
          const label = TOOL_LABELS[cb.name]?.running ?? `Using ${cb.name}...`;
          send({ type: "tool_start", toolCallId: cb.id, tool: cb.name, label });
        }
      } else if (event.type === "content_block_delta") {
        const block = blocks.get(event.index);
        if (!block) continue;
        if (event.delta.type === "text_delta" && block.type === "text") {
          block.text += event.delta.text;
          fullResponse += event.delta.text;
          send({ type: "token", text: event.delta.text });
        } else if (event.delta.type === "input_json_delta" && block.type === "tool_use") {
          (block as { input_json: string }).input_json =
            ((block as { input_json: string }).input_json ?? "") + event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        const block = blocks.get(event.index);
        if (block?.type === "tool_use") {
          try {
            block.input = JSON.parse((block as { input_json: string }).input_json ?? "{}");
          } catch {
            block.input = {};
          }
        }
      } else if (event.type === "message_delta") {
        stopReason = event.delta.stop_reason ?? "end_turn";
      }
    }

    const assistantContent: ContentBlock[] = Array.from(blocks.values()).map(b =>
      b.type === "text"
        ? { type: "text", text: b.text }
        : { type: "tool_use", id: (b as ToolUseBlock).id, name: (b as ToolUseBlock).name, input: (b as ToolUseBlock).input },
    );
    messages.push({ role: "assistant", content: assistantContent });

    if (stopReason !== "tool_use") break;

    // Execute tool calls
    const toolUseBlocks = assistantContent.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const toolResults: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];

    for (const tb of toolUseBlocks) {
      const start = Date.now();
      let result: unknown;
      let errorMsg: string | undefined;
      try {
        result = await executeToolCall(tb.name, tb.input as Record<string, unknown>, ctx);
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        result = { error: errorMsg };
      }

      const durationMs = Date.now() - start;
      if (errorMsg) {
        send({ type: "tool_error", toolCallId: tb.id, tool: tb.name, durationMs, error: errorMsg });
      } else {
        send({ type: "tool_done", toolCallId: tb.id, tool: tb.name, durationMs, result });
      }

      const contentStr = errorMsg
        ? `Error: ${errorMsg}`
        : typeof result === "string" ? result : JSON.stringify(result, null, 2);
      toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: contentStr });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return fullResponse;
}

// ─── Summary generator ────────────────────────────────────────────────────────

async function generateSummary(plan: Plan, stepResults: string[]): Promise<string> {
  try {
    const context = plan.steps.map((s, i) => {
      const result = stepResults[i] ? stepResults[i].slice(0, 400) : (s.status === "failed" ? `Failed: ${s.error}` : "No output");
      return `Step ${i + 1} (${s.title}): ${result}`;
    }).join("\n\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [{
        role: "user",
        content: `Goal: ${plan.goal}\n\nStep results:\n${context}\n\nWrite a 1–2 sentence summary of what was accomplished. Be specific about results.`,
      }],
    });

    const raw = response.content[0];
    return raw.type === "text" ? raw.text : "Plan complete.";
  } catch {
    return "Plan complete.";
  }
}

// ─── Plan executor ────────────────────────────────────────────────────────────

export interface ExecutePlanResult {
  durationMs: number;
  summary: string;
  stepsCompleted: number;
  stepsFailed: number;
}

export async function executePlan(
  plan: Plan,
  ctx: ToolContext,
  send: (data: object) => void,
  isCancelled: () => boolean,
): Promise<ExecutePlanResult> {
  const startTime = Date.now();
  const stepResults: string[] = [];

  for (let i = 0; i < plan.steps.length; i++) {
    if (isCancelled()) {
      send({ type: "plan_cancelled", planId: plan.id });
      break;
    }

    const step = plan.steps[i];

    send({ type: "plan_step_start", planId: plan.id, stepId: step.id, stepIndex: i, title: step.title });

    const stepStart = Date.now();
    let succeeded = false;
    let lastError = "";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Retry: notify then wait
        send({ type: "plan_step_retry", planId: plan.id, stepId: step.id, stepIndex: i, attempt });
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        if (isCancelled()) break;
      }

      try {
        const result = await executeStep(plan, step, i, stepResults, ctx, send, attempt > 0);
        stepResults.push(result || "(step complete)");
        step.status = "complete";
        step.result = result;
        step.durationMs = Date.now() - stepStart;
        send({
          type: "plan_step_complete",
          planId: plan.id,
          stepId: step.id,
          stepIndex: i,
          durationMs: step.durationMs,
          summary: result.slice(0, 200),
        });
        succeeded = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        step.error = lastError;
        step.retryCount = attempt;

        if (attempt < MAX_RETRIES) {
          send({ type: "plan_step_failed", planId: plan.id, stepId: step.id, stepIndex: i, error: lastError, willRetry: true });
        }
      }
    }

    if (!succeeded) {
      step.status = "failed";
      step.durationMs = Date.now() - stepStart;
      stepResults.push(`Step failed: ${lastError}`);
      send({
        type: "plan_step_failed",
        planId: plan.id,
        stepId: step.id,
        stepIndex: i,
        error: lastError,
        willRetry: false,
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const stepsCompleted = plan.steps.filter(s => s.status === "complete").length;
  const stepsFailed    = plan.steps.filter(s => s.status === "failed").length;
  const summary = await generateSummary(plan, stepResults);

  return { durationMs, summary, stepsCompleted, stepsFailed };
}
