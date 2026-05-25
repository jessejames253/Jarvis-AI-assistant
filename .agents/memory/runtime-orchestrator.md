---
name: Runtime orchestrator
description: JarvisRuntime singleton — coordinates speech, stream, memory, tools, network via typed EventBus; no React dependency
---

## Architecture

```
lib/runtime/
  types.ts       — RuntimeEvent union (speech/stream/tool/memory/network/device/runtime:*)
                   SubsystemHealth, Notification, RuntimeSnapshot
  eventBus.ts    — typed pub/sub; all handlers try/catch; wildcard onAny() support
  logger.ts      — 200-entry ring buffer; subscriber pattern for inspector
  index.ts       — JarvisRuntime singleton

hooks/
  useRuntime.ts  — useRuntime() → snapshot + controls; useRuntimeLog(n) → event array; useRuntimeEvent(type, handler)

components/
  RuntimeInspector.tsx  — floating debug panel; collapsed=health dots; expanded=health grid + event timeline
  NotificationToast.tsx — up to 3 toasts, auto-dismiss, always mounted
```

## JarvisRuntime bridges

- **SpeechManager bridge**: subscribes to SpeechManager singleton, emits `speech:state` only on state change (prevents heartbeat noise); also emits `speech:started/ended/error`
- **Network bridge**: `window.online/offline` → `network:online/offline` + auto-notify "Network offline — messages may not send"
- **Visibility bridge**: `document.visibilitychange` → `device:visible/hidden`

## Health tracking

Subsystems: `speech | stream | memory | tools | network`
Statuses: `healthy | degraded | error | offline | unknown`

- All bus events → logger (via `bus.onAny`)
- Specific event types → update `_health` map + notify React subscribers
- `errorCount` increments on error, resets to 0 on `healthy`

## Notification system

- `runtime.notify(message, level, autoDismissMs?)` — adds to `_notifications`, schedules auto-dismiss timer
- `runtime.dismiss(id)` — cancels timer, removes from list
- Max 3 toasts shown (newest); all stored internally
- Built-in notifications: network offline/online, speech errors

## Chat.tsx integration

- Module-level `const _rt = JarvisRuntime.getInstance()` — no hook needed for emission
- Emits: `stream:start` (sendMessage), `stream:done` (onDone with durationMs + tokens), `stream:error` (handleError), `tool:start/done/error` (tool event handler), `memory:loaded/error` (loadSession effect)
- `streamStartTime = Date.now()` captured just before `callChatStream`; used in `stream:done` for accurate duration
- RuntimeInspector replaces SpeechDebugOverlay in JSX; shown when `debugMode === true`
- NotificationToast always mounted, renders nothing when `notifications.length === 0`

## RuntimeInspector UX

- Fixed position: bottom-right, above input bar (bottom-24)
- Collapsed: "RUNTIME" label + 5 subsystem health dots (colored by status)
- Expanded: 2-column health grid + scrollable event timeline (newest first, 25 events)
- Event colors by namespace: speech=green, stream=cyan, tool=amber, memory=purple, network=orange
- Toggle via click on header; "CLEAR" button wipes logger

**Why singleton outside React:** The runtime must outlive all component lifecycles. A module-level singleton ensures the event log, health state, notification timers, and subsystem bridges survive navigation, remounts, and strict-mode double-effects. React hooks subscribe to it — they never own it.
