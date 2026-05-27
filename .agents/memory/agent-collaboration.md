---
name: Agent Collaboration v1
description: Claude-powered multi-agent collaboration planner — given a goal, picks lead/supporting agents, handoff sequence, responsibilities, outputs, and risks
---

## Architecture

- `lib/agentCollaboration.ts` — reads agent profiles, builds Claude prompt, parses JSON response, enriches refs with color/emoji, saves plan
- `routes/agentCollaboration.ts` — `POST /api/agents/collaborate` (auto-checkpoint + Claude plan), `GET /api/agents/collaborate/last`
- `CollabPanel.tsx` — magenta `hsl(320 70% 62%)` / `Network` icon; goal textarea, PLAN button, then: summary banner, lead agent card, supporting agents section, handoff timeline, risks, roster summary

## CollaborationPlan shape

```typescript
{
  goal, plannedAt, summary,
  leadAgent: SupportingAgent,      // extends AgentRef with responsibility, expectedOutput, handoffPosition
  supportingAgents: SupportingAgent[],
  handoffOrder: HandoffStep[],     // fromAgent: null = project start
  risks: CollaborationRisk[],      // severity: high|medium|low + mitigation
}
```

## Claude integration

- Model `claude-sonnet-4-6`, max_tokens 4096
- System prompt: coordinator role, respond ONLY with JSON
- All 6 agent profiles passed as context (id, name, role, description, specialties, preferredChangeTypes)
- JSON schema enforced in prompt with explicit rules: 2-5 agents, handoffOrder starts with `fromAgent: null`, 2-4 risks
- `enrichRef()` post-processes Claude's output to add `color` + `emoji` from loaded profiles

## Storage

`.jarvas-data/agents/last-collaboration.json` — ~7.4 KB; single plan, overwritten per POST

## Panel design — HandoffTimeline

- Vertical spine with numbered circles coloured by `toAgent.color`
- Each step: `From → To` agent names + artifact chip + expandable description (click to expand)
- Step nodes connected by a 1px vertical line
- `fromAgent: null` renders as "▶ Start"

## Smoke test result (notification system goal)

- Lead: 🏛️ Architect (pos 1)
- Supporting: ⚡ Coder (pos 2), 🧪 Tester (pos 3), 🚀 Deployment (pos 4)
- 4 handoff steps: Start→Architect→Coder→Tester→Deployment
- Artifacts: requirements doc → architecture doc → implemented API → validated codebase → deployed system
- 4 risks including WebSocket scalability (high) and secret management (high)

**Why Claude not heuristics:**
Collaboration requires reasoning about which agents genuinely add value for a specific goal, appropriate sequencing, and realistic artifact passing — heuristics can't capture this. The assignment engine (agentProfiles.ts) handles simple single-agent matching; collaboration is a higher-order planning task suited to Claude.
