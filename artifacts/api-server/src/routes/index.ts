/**
 * routes/index.ts — Route registry
 *
 * This file collects all the individual route modules and attaches them
 * to a single Express router. That router is then mounted at "/api" in app.ts,
 * so every route defined here is automatically prefixed with /api.
 *
 * To add a new route group:
 *   1. Create a new file in src/routes/ (e.g. image.ts)
 *   2. Import it here
 *   3. Add: router.use(imageRouter)
 */

import { Router, type IRouter } from "express";
import healthRouter from "./health";   // GET  /api/healthz   — server status check
import searchRouter from "./search";   // POST /api/search    — web search queries
import chatRouter from "./chat";       // POST /api/chat      — conversation responses

const router: IRouter = Router();

router.use(healthRouter);
router.use(searchRouter);
router.use(chatRouter);

export default router;
