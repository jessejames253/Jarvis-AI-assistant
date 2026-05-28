/**
 * lib/uuid.ts — Safe UUID / unique-ID generator for browser environments.
 *
 * `crypto.randomUUID()` is available in:
 *   - Chrome 92+, Firefox 95+, Safari 15.4+ (secure context only)
 *   - NOT available in older Safari, non-HTTPS contexts, or some in-app browsers
 *
 * The fallback produces a sufficiently unique string for UI IDs and session
 * keys. It is NOT cryptographically secure — use only for non-security
 * purposes (message IDs, notification IDs, session tokens for local storage).
 */
export function generateId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}
