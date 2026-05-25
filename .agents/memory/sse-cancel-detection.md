---
name: SSE cancellation detection in Express
description: req.on("close") fires prematurely for SSE — always use res.on("close") instead
---

## Rule

For SSE endpoints in Express, always listen on `res.on("close", ...)` to detect client disconnection — never `req.on("close", ...)`.

**Why:** Express's `express.json()` body-parser consumes the entire POST request body before the route handler runs. This causes Node.js to emit `close` on the *request* stream (req) immediately after body parsing completes — which is before any async work starts. Listening on `req.on("close")` therefore sets `cancelled = true` before the first SSE step ever executes, making the planner appear to cancel instantly every time.

The *response* stream (`res.on("close")`) only fires when the actual underlying TCP connection is torn down by the client, which is the correct signal for "user navigated away / connection dropped."

**How to apply:** Anywhere an SSE or streaming endpoint needs to detect disconnection:

```typescript
// WRONG — fires immediately after body parsing
req.on("close", () => { cancelled = true; });

// CORRECT — fires only when client actually disconnects
res.on("close", () => { cancelled = true; });
```

This applies to all Express SSE routes: chat/stream, plan/stream, or any future streaming endpoint.
