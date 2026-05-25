---
name: Agent tool system
description: How Jarvis's agentic loop, tool registry, SSE streaming, and frontend tool chips work together
---

## Architecture

- **`runner.ts`** — Claude agentic loop, MAX_ITERATIONS=6, streams `tool_start` on `content_block_start` for tool_use blocks, collects `input_json_delta`, executes after `stop_reason="tool_use"`, loops. Uses `claude-sonnet-4-6` with tool_definitions.
- **`registry.ts`** — Tool registry mapping tool names to handlers; exports `TOOL_DEFINITIONS` array for Claude API and `executeTool()`.
- **`routes/chat.ts`** — `AGENT_INTENTS = ["coding","planning","definition","general","research"]` all route through `runAgent()`. Other intents (casual, identity, math, memory_update, research-fallback) use direct handlers.

## SSE protocol
Events emitted during agentic turns:
- `{ type: "tool_start", toolCallId, tool, label }` — immediately when Claude begins a tool call
- `{ type: "tool_done", toolCallId, tool, durationMs, result }` — after execution
- `{ type: "tool_error", toolCallId, tool, durationMs, error }` — on failure

## Frontend integration
- `ToolStatusBubble.tsx` — renders live chips per tool call (running spinner → done/error state)
- `Chat.tsx` — `callChatStream` accepts `onToolEvent` callback; `tool_start` creates the message early via `ensureMessageCreated()`; subsequent events update tool chips
- `DebugPanel.tsx` — expanded section "TOOLS EXECUTED" shows each `AgentToolCall` with icon, status badge, duration, result snippet

## AgentToolCall type (defined inline in DebugPanel.tsx for frontend)
```ts
{ tool: string; label: string; durationMs: number; status: "done"|"error"; result?: unknown; error?: string; }
```
Backend canonical type is in `lib/types.ts` (includes `id` field).

**Why:** The frontend DebugPanel cannot import from the backend package directly; type is duplicated. Keep in sync if fields change.

## Tool roster
| Tool | Notes |
|---|---|
| `get_weather` | wttr.in JSON API, real data |
| `search_web` | Brave Search if SEARCH_API_KEY set, else Claude knowledge |
| `calculate` | mathjs safe eval |
| `create_reminder` | saves to `.jarvas-data/reminders/<sessionId>.json` |
| `list_reminders` | reads same file |
| `lookup_memory` | reads LTM store `.jarvas-data/ltm/<sessionId>.json` |
| `run_code` | Node.js vm sandbox, 5s timeout |

**Note:** `create_reminder` / `list_reminders` are also handled by direct routes for `memory_update` intent — both paths work.
