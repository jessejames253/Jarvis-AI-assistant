---
name: Patch apply/status reliability
description: Root causes and fixes for "build failed" false positives, "Patch not found" re-apply errors, and stale BUILD tab after apply.
---

## Issue 1 — Validator false-positive "typecheck failed"

**Root cause**: `validator.ts` `runScript` piped output through `| head -80`. In bash, a pipeline exits with the *last* command's exit code (`head` = 0). So `execAsync` never threw even when tsc exited 1 with errors. Failure detection then fell back to string matching including `output.toLowerCase().includes("error:")` — too broad; pnpm's own warning/error prefixes triggered false failures.

**Fix**: Removed `| head -80`, truncate in JS instead. Removed the broad `"error:"` check. Only `output.includes("error TS")` is used in the success path; non-zero exit is caught by the `catch` block.

**Why:** The pipeline exit-code masking is a common bash footgun; always check whether `| something` is eating your exit codes.

---

## Issue 2 — "Patch not found" on re-apply after tab navigation

**Root cause**: `applyPatch` deletes the patch from `pendingPatches` on success. `PatchCard` stores apply result in local React state. Switching tabs unmounts the card; on remount, local state resets to `"idle"`, showing the APPROVE button again. Second click → "Patch not found" (400).

**Fix**: Added `_recentlyApplied: Map<string, number>` in `tools.ts`. After a successful apply the patchId is stored there for 10 minutes. A subsequent `applyPatch` call for the same id returns `{ ok: true, alreadyApplied: true }` instead of an error. The route returns 200 with `alreadyApplied: true`; the frontend PatchCard shows "Patch was already applied" in the success style.

**Why:** Local React component state does not survive unmount/remount. Any "was this already done?" check must live in a scope that outlives the component.

---

## Issue 3 — BUILD tab shows stale health data after apply

**Root cause**: `health.ts` caches tsc results for 30 s. After `POST /dev/apply`, the BUILD tab still served the pre-apply cached result, making it look inconsistent with the patch-card validation result.

**Fix**: Added `invalidateHealthCache()` export to `health.ts` (sets `_cache = null`). Called after every successful apply in `routes/dev.ts`, so the next BUILD tab poll triggers a fresh tsc run.

---

## Validator summary improvement

The error summary previously said `"✗ typecheck failed"` with no detail. It now extracts the first 3 lines containing `"error TS"` or starting with `"error"` and appends them to the summary string.
