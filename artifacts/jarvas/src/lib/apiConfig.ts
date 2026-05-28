/**
 * lib/apiConfig.ts — Central API base-URL resolver.
 *
 * Priority:
 *   1. VITE_API_BASE_URL (build-time env var) — use when the backend is on a
 *      different origin, e.g. a Coolify public URL.  Must end with "/".
 *      Example:  https://outstanding-okapi.syd1.coolify.app/
 *
 *   2. import.meta.env.BASE_URL (Vite base path) — relative to the same host,
 *      works when nginx proxies /api/* to the backend container.
 *      Example:  /   →  all fetches go to /api/...
 *
 * Usage:
 *   import { getApiBase } from "@/lib/apiConfig";
 *   fetch(`${getApiBase()}api/chat/stream`, ...)
 */
export function getApiBase(): string {
  const explicit: string | undefined = import.meta.env.VITE_API_BASE_URL;
  if (explicit) {
    return explicit.endsWith("/") ? explicit : explicit + "/";
  }
  const viteBase: string = import.meta.env.BASE_URL ?? "/";
  return viteBase.endsWith("/") ? viteBase : viteBase + "/";
}
