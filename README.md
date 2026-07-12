# Voice Call Demo

Local Docker-based voice assistant tech demo with a Vue frontend and a Node.js agent middleware backend.

The browser captures spoken utterances or debug text. The middleware transcribes voice input with OpenAI Speech-to-Text, runs a local OpenAI agent with a configurable system prompt, discovers CRM tools from MCP servers (or uses a local demo catalog), can speak intermediate responses before and during tool calls, segments streamed assistant text into speakable phrases, synthesizes each phrase with OpenAI Text-to-Speech, and streams audio segments back to the browser for sequential playback.

**Live mode** adds an OpenAI Realtime WebRTC agent — useful as a hold-queue assistant while callers wait for human support (see [`backend/src/liveAgentPrompt.ts`](backend/src/liveAgentPrompt.ts)).

## License

This repository is licensed under the [Teewurst Live Agent Demo License (TLAD-1.0)](LICENSE):

- You may clone, use, and modify it for private evaluation and internal demos.
- You may **not** sell it or redistribute it (no republishing, mirroring, or bundling into another product).

## Quick start

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Set your OpenAI API key in `.env`:

```env
OPENAI_API_KEY=sk-your-key-here
```

3. Set the agent model in `.env` if needed. Edit agent identity and prompt in [`backend/src/agentPrompt.ts`](backend/src/agentPrompt.ts):

```env
OPENAI_AGENT_MODEL=gpt-4.1-mini
AGENT_MAX_TOOL_CALLS=3
```

Voice settings (see [TTS notes](#text-to-speech) below):

```env
OPENAI_TTS_MODEL=gpt-4o-mini-tts-2025-03-20
OPENAI_TTS_VOICE=shimmer
```

5. Start the demo:

```bash
docker compose up -d --build
```

After code changes, rebuild **and** recreate containers (`up -d --build`). `docker compose build` alone does not update running containers.

6. Open the app:

```text
http://localhost:3000
```

Backend health check:

```text
http://localhost:3001/health
```

## Architecture

```text
Browser utterance or debug text
  -> middleware STT (voice only)
  -> OpenAI agent tool loop (emit_output + MCP-discovered CRM tools)
  -> phrase segmentation
  -> OpenAI TTS per phrase
  -> SSE audio segments
  -> frontend playback queue
```

### Agent orchestration

The middleware runs a tool loop until the agent marks a turn complete:

1. user text enters the turn
2. backend discovers CRM tools from MCP (`tools/list`) or uses the local demo catalog
3. OpenAI chooses tools: always `emit_output` plus discovered backend tools (e.g. `validate_customer`, `research_customer`)
4. `emit_output` is spoken immediately via TTS — this is the only way Helen talks to the caller
5. `validate_customer` checks credentials; validation state is stored in the MCP session (MCP mode) and mirrored in the voice session for UI/gating
6. `research_customer` looks up data after validation; in MCP mode the validated customer is resolved from the MCP session, not from LLM arguments

Tool discovery lives in [`backend/src/mcpToolRegistry.ts`](backend/src/mcpToolRegistry.ts). Execution and session gating live in [`backend/src/toolExecutor.ts`](backend/src/toolExecutor.ts). The stateful CRM MCP mock is in [`mcp-mock/src/crm-server.ts`](mcp-mock/src/crm-server.ts).

**Tool backend toggle:** The frontend sends `X-Tool-Backend: local | mcp` on utterance/debug requests. `local` uses in-process demo data; `mcp` uses discovered tools from `MCP_SERVER_URLS`.

**Knowledge model:** The agent may only cite (1) the static knowledge base in [`backend/src/agentPrompt.ts`](backend/src/agentPrompt.ts) — products, support hours, process FAQ — or (2) tool results. General FAQ does not need `research_customer`; account-specific data does.

Demo credentials: `DEMO_CUSTOMER_PASSWORDS` as JSON, e.g. `{"12345":"9876","67890":"horizon42"}` — each customer has their own phone password. The frontend debug panel lists the same values.

### Phrase-level TTS streaming

The middleware does not wait for the full final answer before speaking. It also does not send every tiny streamed text delta directly to TTS.

Instead:

1. text chunks arrive immediately
2. chunks append to a text buffer
3. the buffer flushes on sentence boundaries or max length
4. each flushed phrase is sent to OpenAI TTS
5. each resulting audio segment is streamed to the browser immediately
6. the frontend plays segments in order

### Text-to-speech

Defaults are tuned for a natural support-agent voice:

- **Model:** `gpt-4o-mini-tts-2025-03-20` — the March 2025 snapshot is widely reported to sound more natural than the newer December 2025 snapshot.
- **Voice:** `shimmer` — warm female voice, well suited for support/IVR. Alternatives to try: `marin` (bright), `cedar` (calm/professional).
- **Instructions:** set in [`backend/src/ttsConfig.ts`](backend/src/ttsConfig.ts) to control pace and tone (the `speed` parameter does not apply to `gpt-4o-mini-tts`).

On call start, `POST /api/sessions` opens the call line as an SSE stream. The first event assigns a session id, then Helen greets the caller before the microphone opens. Company name, agent name, and greeting text are configured in [`backend/src/agentPrompt.ts`](backend/src/agentPrompt.ts).

## UI behavior

- Phone UI on the left: call experience only
- Background panel on the right: session timeline with user messages, agent notes, tool calls, tool results, and assistant answers
- Green button: start session and listening mode
- Red button: interrupt assistant playback and active backend work
- Reset: start a fresh session
- Gray `debug` chips in the upper-right corner send preset text messages without using the microphone or STT

## Debug mode

Use the gray `debug` buttons to test agent and tool behavior without recording voice input. The frontend sends a text message to:

```text
POST /api/sessions/:sessionId/debug-message
```

The backend skips OpenAI Speech-to-Text for this route and runs the same agent orchestration pipeline as a normal utterance.

Useful presets:

- `I need my invoice number.`
- `My customer number is 12345 and phone password is 9876. Please look up my latest invoice.`
- `Look up my invoice without validating first.` (demonstrates research gating)

## MCP integration

The Docker stack includes a stateful CRM MCP mock (`crm-mcp` on port 3010). The backend connects once per voice session, discovers tools via `tools/list`, and routes `tools/call` through persistent MCP sessions.

Configure one or more MCP endpoints (comma-separated):

```env
MCP_SERVER_URLS=http://crm-mcp:3010/mcp
```

When you add tools to the real CRM MCP server, they appear automatically on the next discovery refresh (session start or backend mode switch to `mcp`).

## Barge-in

If the user starts speaking while assistant audio is playing:

1. frontend playback stops immediately
2. playback queue is cleared
3. active utterance SSE request is aborted
4. backend `/interrupt` is called
5. a new utterance is recorded

## Environment variables

See [`.env.example`](.env.example).

Important values:

- `OPENAI_API_KEY`: backend only, never exposed to frontend
- `OPENAI_AGENT_MODEL`: text model for agent decisions and final answers
- `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`: speech synthesis model and voice
- `MCP_SERVER_URLS`: comma-separated MCP endpoints for tool discovery
- `FRONTEND_ORIGIN`: CORS origin, default `http://localhost:3000`
- `PHRASE_MAX_CHARS`, `PHRASE_MIN_CHARS`, `PHRASE_FLUSH_ON_NEWLINE`: phrase segmentation tuning

## Known limitations

- not a full WebRTC realtime voice agent
- speech-to-text is utterance-based, not continuous streaming recognition
- text-to-speech is phrase-based, not token-delta-based
- visible agent notes are controlled status messages, not private chain-of-thought
- interruption is implemented at application level
- speech quality depends on phrase segmentation settings
- sessions are in-memory only

## Local development without Docker

Backend:

```bash
cd backend
npm install
cp ../.env.example ../.env
npm run dev
```

Agent orchestration E2E test (uses local fake OpenAI server):

```bash
cd backend
npm run test:e2e
```

Frontend:

```bash
cd frontend
npm install
VITE_API_BASE=http://localhost:3001 npm run dev
```

## Project structure

```text
backend/     Node.js agent middleware (MCP host)
mcp-mock/    Stateful CRM MCP mock server
frontend/    Vue 3 call UI
docker-compose.yml
.env.example
README.md
```
