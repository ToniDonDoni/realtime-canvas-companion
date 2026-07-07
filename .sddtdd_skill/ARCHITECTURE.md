# ARCHITECTURE

## Runtime modes

- `mock`: no OpenAI key; browser uses `MockRealtimeTransport`; `/api/vision/describe` returns deterministic summaries.
- `live`: backend uses `OPENAI_API_KEY`; browser creates a WebRTC peer connection and POSTs SDP to `/api/realtime/session`; backend forwards SDP/session config to OpenAI `/v1/realtime/calls`.

## Browser components

- `src/main.js`: UI orchestration, canvas drawing, session lifecycle, interval scheduling.
- `src/realtime.js`: `MockRealtimeTransport` and `OpenAIWebRTCTransport` sharing a small event interface.
- `src/audio.js`: browser audio-output boundary for mock voice, using Web Audio so E2E tests can instrument it.
- `src/canvas.js`: pointer drawing and frame capture.

## Backend components

- `server/index.js`: static file server plus API routes.
- `POST /api/realtime/session`: accepts browser SDP in live mode and returns OpenAI SDP answer; mock mode returns mock SDP.
- `POST /api/vision/describe`: accepts canvas data URL and returns a summary for `summary` context mode; live mode calls OpenAI Responses API with image input; mock mode returns deterministic text. `image` context mode bypasses this endpoint and sends `input_image` directly over the Realtime data channel.
- `GET /api/config`: exposes safe runtime config only.

## Test boundaries

Primary test boundary is browser E2E with Playwright. Tests install browser-level microphone/WebRTC/audio instrumentation before app startup, then drive visible controls and pointer events.

## Canvas editing modes

The rendered app owns a visible Draw/Erase mode selector and Clear button. `src/canvas.js` exposes a canvas controller with `setMode(mode)`, `clear()`, `hasChanged()`, `markSent()`, and `capture()`. Browser E2E tests must drive the visible controls and inspect canvas pixels after pointer gestures.

## Timestamped event log

The event log is rendered as an unnumbered list. Each UI-visible entry is prepended with a local `HH:MM:SS` timestamp generated at insertion time. Entries are inserted at the beginning of the rendered list so newest events are visible at the top without scrolling.

## Canvas context modes

`summary` mode keeps a two-model pipeline: canvas PNG -> backend vision summary -> Realtime text context. `image` mode uses the existing Realtime WebRTC data channel: canvas PNG -> `conversation.item.create` with `input_text` plus `input_image` -> `response.create`. The same dirty flag and checksum deduplication gate both modes.
