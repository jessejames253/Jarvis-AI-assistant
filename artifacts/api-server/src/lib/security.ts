/**
 * lib/security.ts — Production security middleware
 *
 * Provides two hardening primitives that are wired into app.ts:
 *
 *   1. buildCorsOptions()
 *      Reads ALLOWED_ORIGINS (comma-separated list of origins) and returns a
 *      cors options object. In development (ALLOWED_ORIGINS unset + NODE_ENV ≠
 *      production) the behaviour is unchanged — all origins are allowed.
 *      In production, only listed origins are accepted; any other origin gets
 *      a CORS error. Requests with no origin (curl, Postman, server-to-server)
 *      are always allowed so healthchecks and API tooling continue to work.
 *
 *   2. apiKeyAuth
 *      Express middleware that enforces `Authorization: Bearer <key>` on every
 *      route EXCEPT GET /api/healthz (needed by Docker, uptime monitors, and
 *      load balancers that must reach the healthcheck without credentials).
 *
 *      Auth is opt-in: if API_KEY is not set, the middleware is a no-op so
 *      the development workflow is unchanged. Once API_KEY is set, every
 *      non-exempt request must present the correct token or receives 401.
 *
 * Environment variables
 * ─────────────────────
 *   ALLOWED_ORIGINS   Comma-separated list of allowed CORS origins.
 *                     Example: https://jarvis.example.com,https://app.example.com
 *                     Leave unset in development. Required in production.
 *
 *   API_KEY           Secret bearer token required on all non-exempt API
 *                     requests. Leave unset in development. Required in
 *                     production. Generate with: openssl rand -hex 32
 */

import type { RequestHandler } from "express";
import type { CorsOptions }    from "cors";
import { logger }              from "./logger";

// ─── CORS ─────────────────────────────────────────────────────────────────────

/**
 * Build cors() options from the ALLOWED_ORIGINS environment variable.
 *
 * Behaviour matrix:
 *
 *   ALLOWED_ORIGINS set   → allowlist mode (production)
 *   not set + dev         → allow all (existing dev behaviour, unchanged)
 *   not set + production  → block all origins (safe default, logs a warning)
 */
export function buildCorsOptions(): CorsOptions {
  const raw        = process.env["ALLOWED_ORIGINS"]?.trim() ?? "";
  const isProduction = process.env["NODE_ENV"] === "production";

  if (!raw) {
    if (isProduction) {
      logger.warn(
        "ALLOWED_ORIGINS is not set in production. " +
        "All cross-origin browser requests will be blocked. " +
        "Set ALLOWED_ORIGINS to a comma-separated list of allowed origins " +
        "(e.g. https://jarvis.example.com)."
      );
      // Block all cross-origin requests — requests with no origin (curl,
      // server-to-server) still pass because `origin` will be undefined.
      return { origin: false, credentials: true };
    }

    // Development: preserve existing open-CORS behaviour.
    return { origin: true, credentials: true };
  }

  // Build allowlist from comma-separated value.
  const allowed = new Set(
    raw.split(",").map(o => o.trim()).filter(Boolean)
  );

  logger.info({ origins: [...allowed] }, "CORS allowlist configured");

  return {
    origin(origin, callback) {
      // Requests with no Origin header (curl, Postman, server-to-server, same-origin)
      // are always permitted — they cannot be forged by a browser.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowed.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' is not in the allowlist.`));
      }
    },
    credentials: true,
  };
}

// ─── API key auth ──────────────────────────────────────────────────────────────

/**
 * Paths that are always public — no API key required.
 *
 * /api/healthz must remain unauthenticated so Docker HEALTHCHECK, load
 * balancers, and uptime monitors can reach it without credentials.
 */
const PUBLIC_PATHS = new Set<string>(["/api/healthz"]);

/**
 * Bearer-token authentication middleware.
 *
 * - If API_KEY env var is NOT set → middleware is a no-op (dev mode).
 * - If API_KEY IS set → every request must include:
 *     Authorization: Bearer <API_KEY>
 *   Requests to PUBLIC_PATHS are always exempt.
 *
 * On failure: HTTP 401 with WWW-Authenticate: Bearer header.
 */
export const apiKeyAuth: RequestHandler = (req, res, next) => {
  const configuredKey = process.env["API_KEY"]?.trim();

  // Auth disabled — no API_KEY set (development mode).
  if (!configuredKey) {
    next();
    return;
  }

  // Always allow public paths (healthz, etc.).
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  // Extract token from Authorization header.
  const authHeader = (req.headers["authorization"] as string | undefined) ?? "";
  const token      = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token || token !== configuredKey) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="Jarvis API"');
    res.status(401).json({
      ok:    false,
      error: "Unauthorized. Include a valid API key: Authorization: Bearer <key>",
    });
    return;
  }

  next();
};
