/**
 * routes/index.ts — Route registry
 *
 * Collects all route modules and mounts them on the shared Express router.
 * Every route here is automatically prefixed with /api (set in app.ts).
 *
 * Current routes:
 *   GET  /api/healthz                  — server health check
 *   POST /api/chat                     — conversation (with optional memory)
 *   POST /api/search                   — web search
 *   GET  /api/memory/:sessionId        — fetch session memory
 *   PUT  /api/memory/:sessionId/prefs  — update preferences
 *   DELETE /api/memory/:sessionId      — clear memory
 */

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import searchRouter from "./search";
import chatRouter from "./chat";
import memoryRouter from "./memory";
import tasksRouter from "./tasks";
import kbRouter from "./kb";
import planRouter from "./plan";

const router: IRouter = Router();

router.use(healthRouter);
router.use(searchRouter);
router.use(chatRouter);
router.use(memoryRouter);
router.use(tasksRouter);
router.use(kbRouter);
router.use(planRouter);

export default router;
