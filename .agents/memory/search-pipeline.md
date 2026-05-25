---
name: Search pipeline
description: How Jarvis handles web search — Brave Search + Claude synthesis
---

**Flow:** User query with research intent → `performSearch()` (Brave API, key: SEARCH_API_KEY) → top results fed to Claude → synthesized answer returned with source cards.

**Fallback:** If no SEARCH_API_KEY, Claude answers from training knowledge directly (no fake/demo results).

**Why:** Previous system returned fake demo results when no API key was set. New system always gives a real answer.

**How to apply:** Never add fake/demo search responses. The `researchTool` gracefully handles missing API keys via Claude fallback.
