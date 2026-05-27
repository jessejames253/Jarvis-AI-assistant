/**
 * app.ts — Express application setup
 *
 * This file creates and configures the Express web server.
 * Express is a Node.js framework for building HTTP servers (APIs).
 *
 * Think of middleware as a pipeline: every incoming request passes through
 * each middleware in order before reaching a route handler.
 *
 * Pipeline for each request:
 *   1. pinoHttp   → logs the request (method, URL, status code)
 *   2. cors       → enforces ALLOWED_ORIGINS allowlist (open in dev, locked in prod)
 *   3. apiKeyAuth → requires Authorization: Bearer <API_KEY> when API_KEY is set
 *   4. json       → parses JSON request bodies so routes can read req.body
 *   5. urlencoded → parses form-encoded request bodies (less common, but good to have)
 *   6. /api       → hands off to the route handlers in src/routes/
 *
 * Security behaviour:
 *   Development (API_KEY unset, ALLOWED_ORIGINS unset) → open, same as before.
 *   Production  (API_KEY set,   ALLOWED_ORIGINS set)   → locked down.
 *
 * See src/lib/security.ts for full documentation of both middleware.
 *
 * This file only configures the server — it does NOT start it.
 * Starting (calling app.listen) happens in src/index.ts.
 */

import express, { type Express } from "express";
import cors                       from "cors";
import pinoHttp                   from "pino-http";
import router                     from "./routes";
import { logger }                 from "./lib/logger";
import { buildCorsOptions, apiKeyAuth } from "./lib/security";

const app: Express = express();

// Log every request. Pino is a fast, structured JSON logger.
// The serializers trim the logged data to just the fields we care about.
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0], // strip query strings from logs for brevity
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS — reads ALLOWED_ORIGINS env var.
// In development (ALLOWED_ORIGINS unset): allows all origins (existing behaviour).
// In production (ALLOWED_ORIGINS set):    only listed origins are accepted.
// cors() handles OPTIONS preflight internally and returns before auth middleware runs,
// so browsers can negotiate CORS without needing credentials.
app.use(cors(buildCorsOptions()));

// API key auth — reads API_KEY env var.
// When API_KEY is not set: no-op (development mode, existing behaviour).
// When API_KEY is set:     all requests must include Authorization: Bearer <key>.
// GET /api/healthz is always exempt (Docker healthchecks, uptime monitors).
app.use(apiKeyAuth);

// Parse incoming JSON bodies (e.g. { "message": "hello" }) into req.body
app.use(express.json());

// Parse form-encoded bodies (e.g. from HTML <form> submissions)
app.use(express.urlencoded({ extended: true }));

// Mount all API routes under the /api prefix.
// Example: the chat route becomes POST /api/chat
app.use("/api", router);

export default app;
