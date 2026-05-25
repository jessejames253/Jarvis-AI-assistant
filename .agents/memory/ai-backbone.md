---
name: Jarvis AI backbone
description: How Jarvis generates responses — Claude via Replit-managed Anthropic integration
---

The system uses Claude claude-sonnet-4-6 via `@workspace/integrations-anthropic-ai` (Replit-managed, no user API key needed).

**Rule:** `aiTool` handles intents: definition, general, coding, planning. `researchTool` handles research (Brave Search + Claude synthesis). Math, memory updates, tasks, KB, casual, identity remain deterministic.

**Why:** The previous system was entirely template/rule-based and could not answer general questions directly. Claude replaced all template tools.

**How to apply:** Any new intent that needs real reasoning should route to `aiTool` or a Claude-powered variant. Do NOT add template response arrays for knowledge/coding/planning — Claude handles those.

Registry: `artifacts/api-server/src/lib/tools/registry.ts`
AI tool: `artifacts/api-server/src/lib/tools/ai.ts`
Research tool: `artifacts/api-server/src/lib/tools/research.ts`
