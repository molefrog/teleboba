# teleprompter

## What this is

A live voice-driven illustration surface. The user speaks; an OpenAI Realtime
agent (`gpt-realtime-1.5`) listens continuously and calls tools in near-real
time to project visual context on screen — keyphrases, images, GIFs, video
clips — synchronized with what's being said.

The agent never speaks back. Its only output is tool calls. Turn detection is
tuned aggressively (short VAD silence, preempt in-flight responses) so tools
fire on each clause rather than waiting for sentence ends. Think of it as a
teleprompter in reverse: instead of the speaker reading text, the screen
reacts to the speaker.

## Architecture (short)

- **Browser (Vite + React)** — WebRTC to OpenAI Realtime; data channel carries
  tool-call events. Renders the centered phrase, live transcript, and
  illustration layer.
- **Hono server (bun)** — the only thing holding secrets. Mints ephemeral
  OpenAI tokens and proxies media-search APIs (YouTube, Unsplash, Tenor/GIPHY,
  Wikimedia) behind one `/api/illustrate` surface with caching.
- **No voice output** — `output_modalities: ["text"]`, `tool_choice: "required"`.

See `docs/openai-realtime-research.md` for the full Realtime API reference.

## Package manager

Use **bun** for all package management and script execution in this project.

- Install deps: `bun install`
- Add a dep: `bun add <pkg>`
- Run a script: `bun run <script>` (or `bun <script>`)
- Execute a binary: `bunx <cmd>`

Do not use `npm`, `pnpm`, or `yarn` commands here.
