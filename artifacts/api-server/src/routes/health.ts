/**
 * routes/health.ts — Health check endpoint
 *
 * GET /api/healthz
 *
 * Returns a simple { status: "ok" } response. This endpoint is used by:
 *  - Deployment platforms to verify the server started successfully
 *  - Monitoring tools to check if the server is still alive
 *  - Developers to quickly confirm the backend is reachable
 *
 * It intentionally does no heavy work — a fast response proves the server
 * process is running and able to handle requests.
 */

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  // HealthCheckResponse is a Zod schema that validates the shape of our response.
  // .parse() throws if the data doesn't match — a safety net against typos.
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
