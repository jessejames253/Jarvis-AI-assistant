---
name: Jarvas architecture
description: Key decisions, data storage paths, and AI-swap points for the Jarvas agent app.
---

# Jarvas architecture

## Data storage
- Chat sessions: `/home/runner/workspace/.jarvas-data/sessions/{sessionId}.json`
- Task/project/goal store: `/home/runner/workspace/.jarvas-data/tasks/{sessionId}.json`
- Both use same pattern: one JSON file per session, same read/write helper shape.

## Adding a new tool (8 intents already registered)
1. `lib/tasks/types.ts` — add new type (if needed)
2. `lib/types.ts` — add IntentType literal
3. `lib/intent.ts` DESCRIPTORS array — add strong/weak patterns
4. `lib/tools/yourTool.ts` — export `Tool` object
5. `lib/tools/registry.ts` — import + add to `ALL_TOOLS` array

## SessionId propagation to tools
- Chat route passes `sessionId` into `memoryContext.sessionId` (as `Record<string,unknown>` cast)
- Tools access it via `input.memoryContext?.sessionId ?? "default"`
- **Why:** ToolInput type doesn't natively carry sessionId; memoryContext is the safe pass-through without breaking the interface.

## Task intent vs planning intent ordering
- `tasksTool` registered BEFORE `planningTool` in ALL_TOOLS
- **Why:** "add task" and "what should I work on" patterns overlap with planning; task intent needs priority.

## Frontend routing
- Uses `wouter` with `base={import.meta.env.BASE_URL.replace(/\/$/, "")}`
- Routes: `/` → Chat, `/dashboard` → Dashboard
- API base URL: `import.meta.env.BASE_URL` (already has trailing slash from Vite)

## AI-ready swap points
- `lib/responder.ts` — public entry point; swap rule-based tools for real AI calls here
- `lib/memory.ts` `buildSummary()` — replace with abstractive AI summarization
- `lib/tools/tasks.ts` — all sub-handlers can call an LLM for natural language generation
- Task creation (`createTask`) already accepts optional AI-inferred fields: category, priority, dueDate
