/**
 * index.ts — Server entry point
 *
 * This is the first file that runs when the backend server starts.
 * Its only job is to read the PORT from the environment and call app.listen(),
 * which opens a socket and starts accepting HTTP requests.
 *
 * The PORT is set automatically by the Replit environment — each service
 * (frontend, backend) gets its own port so they don't conflict.
 *
 * The actual server configuration (middleware, routes) lives in app.ts.
 * This file just kicks it off.
 */

import app from "./app";
import { logger } from "./lib/logger";

// The PORT environment variable is required — the Replit environment sets it.
// If it's missing, we crash immediately with a clear error rather than silently failing.
const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Start listening for HTTP requests on the given port.
// The callback fires once the server is ready to accept connections.
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
