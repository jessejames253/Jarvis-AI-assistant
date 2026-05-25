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
 *   2. cors       → allows the frontend (running on a different port) to call this API
 *   3. json       → parses JSON request bodies so routes can read req.body
 *   4. urlencoded → parses form-encoded request bodies (less common, but good to have)
 *   5. /api       → hands off to the route handlers in src/routes/
 *
 * This file only configures the server — it does NOT start it.
 * Starting (calling app.listen) happens in src/index.ts.
 */

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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

// Allow cross-origin requests — without this, the browser blocks frontend → backend calls
// because they run on different ports during development.
app.use(cors());

// Parse incoming JSON bodies (e.g. { "message": "hello" }) into req.body
app.use(express.json());

// Parse form-encoded bodies (e.g. from HTML <form> submissions)
app.use(express.urlencoded({ extended: true }));

// Mount all API routes under the /api prefix.
// Example: the chat route becomes POST /api/chat
app.use("/api", router);

export default app;
