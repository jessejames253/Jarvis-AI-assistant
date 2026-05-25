# Jarvis — Project Roadmap

A living document that explains what Jarvis is, what's been built, what comes next, and the long-term goal of turning it into a real mobile app.

---

## What is Jarvis?

Jarvis is a futuristic AI assistant web app. Users type questions into a chat interface, and Jarvis answers directly — drawing on a knowledge base for general questions and the live web for current information.

The app has a dark, futuristic visual design and is fully mobile-responsive.

---

## Project Structure

The project is a **monorepo** — one repository containing multiple apps that share code.

```
/
├── artifacts/
│   ├── jarvas/          ← The web app (what users see in their browser)
│   └── api-server/      ← The backend server (hidden from users, handles logic & secrets)
├── ROADMAP.md           ← This file
└── package.json         ← Workspace config
```

### Frontend — `artifacts/jarvas/`

The web app is built with **React** and **Vite**. React builds the UI from components; Vite is the build tool that compiles everything and serves it during development.

```
artifacts/jarvas/
├── src/
│   ├── main.tsx         ← Entry point — mounts the React app into the HTML page
│   ├── App.tsx          ← Root component — sets up routing and global providers
│   ├── index.css        ← Global styles, theme colors, animations, fonts
│   ├── pages/
│   │   └── Chat.tsx     ← The main chat interface (the entire user-facing experience)
│   ├── components/ui/   ← Pre-built UI primitives (buttons, inputs, cards, etc.)
│   └── hooks/           ← Reusable React logic (e.g. mobile detection, toast notifications)
```

### Backend — `artifacts/api-server/`

The backend is a **Node.js** server built with **Express**. It runs separately from the frontend and handles anything that needs to stay private — like API keys — or requires server-side logic.

```
artifacts/api-server/
├── src/
│   ├── index.ts         ← Entry point — starts the server on the configured port
│   ├── app.ts           ← Express app setup — registers middleware and routes
│   ├── lib/
│   │   ├── logger.ts    ← Structured logging using Pino
│   │   └── responder.ts ← Core AI response engine (the "brain" of Jarvis)
│   └── routes/
│       ├── index.ts     ← Registers all routes with the Express router
│       ├── health.ts    ← Health check endpoint (used to verify the server is alive)
│       ├── chat.ts      ← POST /api/chat — handles general conversation
│       └── search.ts    ← POST /api/search — handles web search queries
```

---

## Features Already Built

### Chat Interface
- Dark futuristic UI with animated background grid and glow effects
- Chat bubbles for both user and assistant messages, with timestamps
- Auto-expanding textarea input — grows as you type, max 3 lines
- Send on Enter key or button click
- Animated typing indicator while waiting for a response
- Fully responsive — works on mobile, tablet, and desktop

### Intelligent Responses (Backend)
- Backend `/api/chat` endpoint receives user messages and conversation history
- Smart response engine (`responder.ts`) classifies messages into categories:
  greetings, identity, capabilities, how-to, definitions, code questions, math, comparisons, opinions, yes/no, general
- Gives direct, useful answers rather than filler text
- Knows definitions for common technical topics (AI, ML, APIs, Python, etc.)
- Can compute simple math expressions safely on the server
- Clean architecture: swapping in a real AI model (GPT, Claude) requires changing **one function** (`complete()` in `responder.ts`)

### Web Search
- Backend `/api/search` endpoint handles queries that need current information
- Automatically triggers for questions about news, today's events, prices, weather, live scores
- Integrates with the **Brave Search API** when a `SEARCH_API_KEY` secret is set
- Falls back to clearly-labeled demo results when no key is present
- Search results displayed as clickable source cards with title, description, and domain

### Architecture & Security
- API keys are never exposed to the browser — all secrets live on the backend server
- `SEARCH_API_KEY` secret placeholder is registered (add your Brave API key to enable live search)
- Frontend and backend are separate deployable services

---

## Next Features to Add

These are ranked roughly from easiest to most impactful.

### Level 1 — Quick Wins

**1. Connect a real AI model**
Replace the `complete()` function in `responder.ts` with a call to OpenAI (GPT-4o) or Anthropic (Claude). The route and frontend need no changes. Add an `AI_API_KEY` secret, install the SDK, and swap the function body.

**2. Add live Brave Search**
Go to [brave.com/search/api](https://brave.com/search/api), get a free API key, and add it as the `SEARCH_API_KEY` secret. That's it — the code already handles the rest.

**3. Conversation memory**
Currently, each message is processed independently. Pass the full conversation history to the AI model so it can refer to earlier messages in the same chat session.

**4. Suggested questions / prompt chips**
Show 3-4 example questions below the welcome message so new users know what to ask. Make them clickable to populate the input.

### Level 2 — Meaningful Upgrades

**5. Chat history with local storage**
Save the conversation to the browser's `localStorage` so it persists when the user refreshes. Add a "Clear chat" button.

**6. User accounts**
Add authentication (Replit Auth or Clerk) so each user has their own private conversation history stored in a database.

**7. Multiple chat sessions**
Allow users to create named conversations and switch between them — similar to ChatGPT's sidebar.

**8. Markdown rendering**
Render AI responses as formatted markdown — headings, bullet points, code blocks with syntax highlighting. Currently all text is plain.

**9. Copy / share responses**
Add a copy-to-clipboard button on each assistant message. Add a share button that generates a shareable link to a response.

**10. File uploads**
Allow users to upload a document or image and ask Jarvis questions about it.

### Level 3 — Major Features

**11. Image generation**
Add a `/api/image` endpoint that calls DALL·E or Stable Diffusion when the user asks Jarvis to generate an image.

**12. Voice input / output**
Use the browser's Web Speech API to let users speak their questions. Use a text-to-speech API to have Jarvis speak responses aloud.

**13. Admin dashboard**
A private page (password-protected or behind auth) showing usage stats — total messages, search queries, popular topics, error rates.

**14. Streaming responses**
Instead of waiting for the full response, stream tokens to the UI as they arrive. This makes the app feel much faster and more alive.

---

## Building Jarvis Step by Step

If you want to keep developing Jarvis, here's a recommended order:

```
Step 1  →  Add SEARCH_API_KEY (Brave) for live web search         [5 minutes]
Step 2  →  Add AI_API_KEY (OpenAI or Anthropic) for real answers  [10 minutes]
Step 3  →  Enable markdown rendering in chat bubbles              [1 hour]
Step 4  →  Add suggested prompt chips on welcome screen           [1 hour]
Step 5  →  Add localStorage conversation persistence              [2 hours]
Step 6  →  Add user auth + database for saved chats               [half day]
Step 7  →  Add streaming responses                                [half day]
Step 8  →  Build multiple chat sessions with sidebar              [1 day]
Step 9  →  Add voice input/output                                 [1 day]
Step 10 →  Convert to mobile app (see below)                      [1-2 weeks]
```

---

## Future Goal: Converting Jarvis to a Mobile App

The long-term goal is to ship Jarvis as a native mobile app on iOS and Android. Here's the plan:

### Technology Choice: Expo (React Native)

Since Jarvis is already built in React, the natural migration path is **Expo** — a framework that lets you write React components that compile to native iOS and Android code. Most of what you already know transfers directly.

### What Changes

| What | Web (current) | Mobile (future) |
|------|--------------|-----------------|
| Framework | React + Vite | Expo (React Native) |
| Styling | Tailwind CSS | StyleSheet / NativeWind |
| Routing | Wouter | Expo Router |
| Storage | localStorage | AsyncStorage |
| Notifications | Browser API | Expo Notifications |
| Camera/Mic | Web APIs | Expo Camera / Audio |

### What Stays the Same

- The **backend API server** is unchanged — mobile apps call the same `/api/chat` and `/api/search` endpoints
- All business logic in `responder.ts` and `search.ts` stays exactly as-is
- The conversation architecture and data flow stays the same
- The `SEARCH_API_KEY` and any AI API keys stay the same

### Migration Steps

1. Create a new `artifacts/jarvas-mobile` artifact using the Expo template
2. Port `Chat.tsx` to React Native components (`View`, `Text`, `TextInput`, `FlatList`)
3. Replace Tailwind classes with `NativeWind` (Tailwind-compatible for React Native)
4. Connect to the same backend API (update base URL for production)
5. Add mobile-specific features: push notifications, haptic feedback, offline mode
6. Submit to the App Store and Google Play via Expo's EAS Build service

### Estimated Timeline

| Phase | Time |
|-------|------|
| Set up Expo project & basic layout | 2-3 days |
| Port chat UI to React Native | 2-3 days |
| Test on iOS & Android simulators | 1-2 days |
| Add mobile-specific features | 3-5 days |
| App Store submission | 1-2 days |
| **Total** | **~2 weeks** |

---

## Key Decisions Made So Far

- **Backend for secrets**: API keys are stored as server-side environment secrets, never sent to the browser
- **One-function AI swap**: The `complete()` function in `responder.ts` is the only thing that needs to change to connect a real AI model — the rest of the codebase is AI-model-agnostic
- **Search is opt-in by key**: Web search works in demo mode out of the box; adding a Brave key upgrades it to live results with no code changes
- **Monorepo**: Frontend and backend share one repository for easy development, but can be deployed as separate services

---

*Last updated: May 2026*
