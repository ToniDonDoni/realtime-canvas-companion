# ARCHITECTURE

## Runtime modes

- `mock`: no OpenAI key; browser uses `MockRealtimeTransport`; `/api/vision/describe` returns deterministic summaries.
- `live`: backend uses `OPENAI_API_KEY`; the user selects WebRTC or WebSocket before starting a call.

## Browser components

- `src/main.js`: UI orchestration, canvas drawing, session lifecycle, interval scheduling.
- `src/realtime.js`: `MockRealtimeTransport`, `OpenAIWebRTCTransport`, and `OpenAIWebSocketTransport` sharing one application event interface.
- `src/audio.js`: browser audio-output boundary for mock voice, using Web Audio so E2E tests can instrument it.
- `src/canvas.js`: pointer drawing and frame capture.

## Backend components

- `server/index.js`: static file server plus API routes.
- `POST /api/realtime/session`: accepts browser SDP in live mode and returns OpenAI SDP answer; mock mode returns mock SDP.
- `GET /api/realtime/ws`: WebSocket upgrade endpoint that proxies authenticated Realtime JSON events to OpenAI. The browser sends application-owned `app.turn` envelopes; the proxy forwards only valid protocol events and keeps the API key on the server.
- `POST /api/vision/describe`: accepts canvas data URL and returns a summary for `summary` context mode; live mode calls OpenAI Responses API with image input; mock mode returns deterministic text. `image` context mode bypasses this endpoint and sends `input_image` directly over the Realtime data channel.
- `GET /api/config`: exposes safe runtime config only.

## Test boundaries

Primary test boundary is browser E2E with Playwright. Tests install browser-level microphone/WebRTC/audio instrumentation before app startup, then drive visible controls and pointer events.

The WebSocket proxy has an additional integration boundary: a local mock OpenAI WebSocket server records forwarded protocol events and returns deterministic Realtime events. This proves authentication, ordering, turn correlation, and bidirectional relay without a live key.

## Realtime transport selection and turn grouping

WebRTC remains the default browser voice path. WebSocket captures browser audio,
resamples it to 24 kHz PCM16, and sends ordered Realtime events through the
backend proxy. A client-generated `turn_id` and context snapshot group the first
context item, audio chunks, audio commit, and response request. The proxy maps the
group to unique OpenAI `event_id` values and emits `app.turn.forwarded` for
diagnostics. Assistant PCM16 deltas are scheduled through Web Audio in arrival
order.

## Canvas editing modes

The rendered app owns a visible Draw/Erase mode selector and Clear button. `src/canvas.js` exposes a canvas controller with `setMode(mode)`, `clear()`, `hasChanged()`, `markSent()`, and `capture()`. Browser E2E tests must drive the visible controls and inspect canvas pixels after pointer gestures.

## Timestamped event log

The event log is rendered as an unnumbered list. Each UI-visible entry is prepended with a local `HH:MM:SS` timestamp generated at insertion time. Entries are inserted at the beginning of the rendered list so newest events are visible at the top without scrolling.

## Canvas context modes

`summary` mode keeps a two-model pipeline: canvas PNG -> backend vision summary -> Realtime text context. `image` mode uses the existing Realtime WebRTC data channel: canvas PNG -> `conversation.item.create` with `input_text` plus `input_image` -> `response.create`. The same dirty flag and checksum deduplication gate both modes.
