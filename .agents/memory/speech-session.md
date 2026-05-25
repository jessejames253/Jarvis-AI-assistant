---
name: Speech session layer
description: Global SpeechManager singleton, state machine, queue, iOS fixes, React integration
---

## Architecture

- **`lib/speechManager.ts`** — Singleton (`SpeechManager.getInstance()`). Owns all `window.speechSynthesis` access. Lives outside React — survives re-renders, route changes, unmounts.
- **`hooks/useSpeechSession.ts`** — React adapter. Subscribes to manager via `manager.subscribe(setSnap)`, unsubscribes on unmount. Returns controls: `speak`, `queue`, `stop`, `toggle`, `setAutoSpeak`, `unlock`, `isSpeakingMsg(msgId)`.
- **`hooks/useSpeechOutput.ts`** — Thin backward-compat shim delegating to `useSpeechSession`.
- **`components/SpeechDebugOverlay.tsx`** — Floating HUD (bottom-right), shown when `debugMode === true`. Shows state, queue depth, speaking duration, watchdog, heartbeat, utterance count, last error.

## State machine (7 states)
`idle → preparing → speaking → idle`
- `speaking → paused` (visibilitychange to hidden)
- `paused → speaking` (visibilitychange to visible + resume)  
- `speaking → interrupted` (new item enqueued with interrupt=true)
- `interrupted → preparing` (after 150ms cancel gap)
- `speaking → recovering` (watchdog fired)
- `recovering → idle` (after 500ms reset)
- `any → error → idle` (real speech error, 2s cooldown)

## Queue API
- `enqueue(msgId, text, {interrupt=true, priority=0})` — interrupt=true cancels current, gap timer acts as debounce (rapid taps replace each other within 150ms gap); interrupt=false adds to priority-sorted queue
- `cancelAll()` — hard reset, clears all timers, flushes queue
- `SpeechSnapshot.queueDepth` — depth excludes current item

## iOS resilience
- 150ms cancel→speak gap (CANCEL_GAP_MS in manager)
- 5s heartbeat `resume()` (HEARTBEAT_MS) — prevents iOS synth stall
- `visibilitychange` → `resume()` if paused
- Watchdog: max(12s, wordCount/140*60s) + 8s buffer (WATCHDOG_BUFFER_MS); triggers recovery if `onend` never fires
- `"interrupted"` / `"canceled"` errors from `onerror` are filtered (iOS fires on intentional cancel)
- Utterance held in `_utterance` property to prevent GC before `onend`
- `unlock()` — silent utterance on first gesture to prime iOS audio context

## Chat.tsx integration points
- `responseContentRef` accumulates full response text across onToken callbacks
- `onDone`: if `speech.autoSpeak`, calls `speech.queue(msgId, responseContentRef.current)` (interrupt=false)
- `sendMessage` and `toggleMic` both call `speech.unlock()` to prime audio
- MessageBubble: `isSpeaking={speech.isSpeakingMsg(msg.id)}`, `onSpeak={() => speech.toggle(msg.id, msg.content)}`
- Auto-speak toggle button in header (VolumeX / Volume2 icon, persisted to `jarvas_autospeak` localStorage key)

**Why singleton:** React hooks re-mount on route change; a module-level singleton ensures heartbeat, visibilitychange listener, and utterance ref all survive navigation. The subscriber pattern keeps React state in sync without coupling the manager to React lifecycle.
