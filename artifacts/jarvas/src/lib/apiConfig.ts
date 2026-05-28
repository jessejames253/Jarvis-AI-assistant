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
    const base = explicit.endsWith("/") ? explicit : explicit + "/";
    console.log("[Jarvis] API base → VITE_API_BASE_URL:", base);
    return base;
  }
  const viteBase: string = import.meta.env.BASE_URL ?? "/";
  const base = viteBase.endsWith("/") ? viteBase : viteBase + "/";
  console.warn(
    "[Jarvis] VITE_API_BASE_URL not set — falling back to same-origin:",
    base,
    "\nChat will hang if the nginx /api proxy cannot reach the backend.",
  );
  return base;
}
