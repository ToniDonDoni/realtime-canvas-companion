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
- `POST /api/vision/describe`: accepts canvas data URL and returns a summary; live mode calls OpenAI Responses API with image input; mock mode returns deterministic text.
- `GET /api/config`: exposes safe runtime config only.

## Test boundaries

Primary test boundary is browser E2E with Playwright. Tests install browser-level microphone/WebRTC/audio instrumentation before app startup, then drive visible controls and pointer events.
