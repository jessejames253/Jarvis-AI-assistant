/**
 * routes/index.ts — Route registry
 *
 * Collects all route modules and mounts them on the shared Express router.
 * Every route here is automatically prefixed with /api (set in app.ts).
 *
 * Current routes:
 *   GET  /api/healthz                      — server health check
 *   POST /api/chat                         — conversation (with optional memory)
 *   POST /api/search                       — web search
 *   GET  /api/memory/:sessionId            — fetch session memory
 *   PUT  /api/memory/:sessionId/prefs      — update preferences
 *   DELETE /api/memory/:sessionId          — clear memory
 *   GET  /api/agents                       — list registered agents
 *   GET  /api/agents/tasks                 — full task graph
 *   GET  /api/agents/tasks/ready           — tasks ready to run
 *   GET  /api/agents/context               — shared context bus snapshot
 *   POST /api/agents/orchestrate           — create orchestration from a goal
 *   POST /api/agents/tasks/:id/run         — run a single task (user-triggered)
 *   PATCH /api/agents/tasks/:id            — update task metadata
 *   DELETE /api/agents/tasks               — clear task graph
 *   GET  /api/agents/permissions/audit     — permission audit log
 */

import { Router, type IRouter } from "express";
import healthRouter       from "./health";
import searchRouter       from "./search";
import chatRouter         from "./chat";
import memoryRouter       from "./memory";
import tasksRouter        from "./tasks";
import kbRouter           from "./kb";
import planRouter         from "./plan";
import devRouter          from "./dev";
import devExtendedRouter  from "./devExtended";
import agentsRouter       from "./agents";
import intelRouter        from "./intel";

// Register agents (self-register on import)
import "../agents/plannerAgent";
import "../agents/builderAgent";
import "../agents/testerAgent";
import "../agents/researchAgent";
import "../agents/gitAgent";

const router: IRouter = Router();

router.use(healthRouter);
router.use(searchRouter);
router.use(chatRouter);
router.use(memoryRouter);
router.use(tasksRouter);
router.use(kbRouter);
router.use(planRouter);
router.use(devRouter);
router.use(devExtendedRouter);
router.use(agentsRouter);
router.use(intelRouter);

export default router;
