# TwinMind Live Suggestions

TwinMind Live Suggestions is a three-panel web app for live conversation support. It records microphone audio, appends transcript chunks on a rolling cadence, generates exactly three fresh live suggestions per refresh, expands clicked suggestions into longer answers, supports direct chat questions, and exports the full session with timestamps.

This repo is built around the April 2026 TwinMind assignment constraints:
- Groq only
- `whisper-large-v3` for transcription
- `openai/gpt-oss-120b` for live suggestions and chat
- client-side Groq API key entry
- single in-memory session with export support

## Stack

- React 19 + Vite for the client
- Express for the backend API
- Browser `MediaRecorder` for rolling audio capture
- shared prompt, settings, and session model utilities in `shared/`

This stack keeps the app small, easy to reason about, and fast to defend in an interview. The client handles the live session UX, while the server owns Groq request orchestration, validation, and response shaping.

## Project Structure

- `client/src/App.jsx`: top-level session shell and panel wiring
- `client/src/hooks/useLiveSession.js`: microphone, chunk queue, transcription, and suggestion refresh orchestration
- `client/src/components/`: transcript, suggestions, chat, header, and settings UI
- `client/src/utils/api.js`: client API requests, timeout handling, and production-safe API base URL support
- `server/src/routes/`: `transcribe`, `suggestions`, and `chat` API routes
- `server/src/services/`: Groq requests, prompt builders, validation, and parsing
- `shared/`: default prompts, settings, audio constants, and session models

## Local Setup

Install dependencies from the repo root:

```bash
npm install
```

Run the backend in one terminal:

```bash
npm run dev:server
```

Run the frontend in a second terminal:

```bash
npm run dev:client
```

Local development assumes:
- the server runs on `http://localhost:4000`
- the Vite dev server runs on `http://localhost:5173`
- the client uses the Vite `/api` proxy unless `VITE_API_BASE_URL` is set

## Environment And API Key Handling

The user pastes their Groq API key into the in-app Settings modal. The app does not hard-code or persist the key server-side, but this local scaffold does persist the full settings object in browser `localStorage` so the key, prompts, and tuning values survive refresh on the same machine. Session exports sanitize the settings payload and remove the Groq API key.

Environment variables used by this repo:

- `PORT`: backend port, defaults to `4000`
- `CORS_ORIGIN`: optional comma-separated frontend origins allowed by the server
- `VITE_API_BASE_URL`: optional client API base URL for deployed frontends

Examples:

- local development:
  - server uses `PORT=4000`
  - client can leave `VITE_API_BASE_URL` unset and rely on the Vite proxy
- deployed frontend:
  - set `VITE_API_BASE_URL=https://your-backend.example.com/api`
- deployed backend:
  - set `CORS_ORIGIN=https://your-frontend.example.com`

Production safety notes:
- if `VITE_API_BASE_URL` is set to `https://your-backend.example.com` without `/api`, the client now normalizes it to `https://your-backend.example.com/api`
- the server accepts `CORS_ORIGIN`, `CORS_ORIGINS`, `FRONTEND_URL`, or `FRONTEND_ORIGIN`
- the server exposes both `/api/...` routes and bare `...` aliases to tolerate older frontend builds

Use a single optional root-level `.env` file for local configuration. Do not create separate `client/.env` or `server/.env` files. See `.env.example` for the root-level template.

## Live Session Flow

1. The user adds a Groq API key in Settings.
2. The client starts `MediaRecorder` and rolls audio into timed chunks.
3. Each chunk is posted to `/api/transcribe`.
4. The server sends the chunk to Groq Whisper and returns a normalized transcript chunk.
5. The client appends the transcript, then triggers or queues suggestion refresh based on the live pacing rules.
6. The server generates exactly three suggestions and validates shape, type variety, and duplication.
7. Clicking a suggestion adds it to chat and requests a longer detailed answer.
8. Direct typed chat questions use the same session transcript and chat history.
9. Export downloads the transcript, suggestion history, and chat history with timestamps.

## Prompt Strategy

### Live suggestions

The live suggestion prompt is optimized for speed, timeliness, and variety:
- exactly three suggestions
- each suggestion must do a different conversational job
- server-side conversation intelligence detects meeting mode, live trigger events, language style, speaker signals, topic shifts, and a target card mix before the LLM writes cards
- supported suggestion jobs include direct answers, sharp questions, talking points, clarify cues, fact checks, hidden risks, and concrete next steps
- previews must be useful before click
- reasons are generated as trust labels such as deadline detected, recent question, or possible risk
- generic coaching language is rejected when guardrails are enabled
- recent suggestion history is fed back in to reduce repetition
- Hinglish or mixed Hindi-English transcript context is mirrored naturally in suggestion previews when useful

### Clicked suggestion expansion

The detailed-answer prompt is optimized for immediate usability:
- lead with the direct answer or talking point first
- use compact support instead of long essays
- stay grounded in the clicked suggestion plus recent transcript
- reuse the same conversation intelligence block so answers adapt to meeting mode and language style
- acknowledge uncertainty when transcript support is thin

### Typed chat

The chat prompt is the simplest path:
- answer the user directly
- stay concise enough for live use
- rely on recent transcript and recent chat history
- include conversation intelligence so answers react to the current meeting mode, trigger event, and language style
- avoid unsupported claims

## Context Strategy

The app intentionally uses different context windows for different jobs.

- Suggestions use a narrower recent transcript window because they need to react to what is happening right now.
- Detailed answers and typed chat use a broader window because they benefit from more surrounding context.
- Older transcript context is compressed into a lightweight digest for suggestion generation when useful.
- Recent suggestion batches are passed back in so the model can avoid recycling the same ideas.
- Auto-refresh generates the first batch quickly, then paces later live refreshes so suggestions are not regenerated after every tiny transcript update.
- A deterministic signal layer runs before prompt construction to detect meeting type, question/decision/deadline/risk/budget/action triggers, mixed-language usage, speaker-label dynamics, and topic shift.
- The detected signals are added to live suggestion, clicked-answer, and typed-chat prompts as a compact context block instead of relying on the LLM to infer everything from raw transcript text.

This split is a deliberate tradeoff:
- narrower context improves live suggestion timeliness and reduces latency
- broader answer context improves coherence when the user clicks a suggestion or asks a direct question

## Guardrails And Reliability

Day 6 added several reliability improvements:
- configurable `VITE_API_BASE_URL` for deployed frontends
- request timeout and network error normalization in the client
- stricter server-side request shape validation
- safer timestamp handling for exported and generated session entities
- clearer UI status messaging during recording, transcription, and suggestion refresh
- more resilient handling when a single transcription chunk fails while recording continues

Suggestion guardrails already in the service layer include:
- exact count enforcement
- duplicate detection within a batch
- duplicate avoidance against recent batches
- generic suggestion rejection
- minimum type-variety enforcement

## Export Format

The app supports:
- JSON export
- plain text export

Each export includes:
- transcript chunks with timestamps
- suggestion batches and suggestion metadata
- full chat history with timestamps
- sanitized settings without the Groq API key

## Deployment

The simplest deployment shape is:
- frontend on Vercel or Netlify
- backend on Render or Railway

Recommended production setup:

1. Deploy the Express server first.
2. Set server env vars:
   - `PORT`
   - `CORS_ORIGIN=https://your-frontend.example.com`
3. Deploy the client.
4. Set client env var:
   - `VITE_API_BASE_URL=https://your-backend.example.com/api`
5. Test from a fresh browser session by pasting a Groq API key in Settings.

Important production note:
- local development can rely on Vite's `/api` proxy
- production should use `VITE_API_BASE_URL` unless the frontend host rewrites `/api` to the backend for you

## Verification Checklist

Before submission, verify:
- start and stop mic works
- transcript chunks append on the rolling cadence
- manual refresh syncs transcript first
- every refresh returns exactly three suggestions
- newest suggestion batches appear first
- clicked suggestions create detailed chat answers
- direct typed chat works
- JSON and text export work
- a fresh browser session can run end to end after pasting a Groq API key

## Tradeoffs

- The app keeps everything in a single in-memory session to stay aligned with the assignment and avoid auth or persistence overhead.
- Transcript chunking defaults to a roughly 30-second cadence, and suggestion refresh follows that same live rhythm so both surfaces stay aligned.
- Suggestion generation uses aggressive validation because suggestion quality matters more than clever backend abstraction here.
- The UI intentionally stays compact and readable instead of adding extra product surface area that the assignment does not reward.
