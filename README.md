# Realtime Canvas Companion

One-page browser demo for a realtime AI voice companion that can listen, speak, and comment on a drawable canvas.

## What is included

- Browser SPA with visible `Call` / `Stop` flow.
- Model selector and canvas-send interval selector.
- Mouse drawing canvas.
- Mock realtime transport for deterministic tests without an OpenAI key.
- Live OpenAI mode using WebRTC SDP through a backend endpoint.
- Canvas frame description bridge: browser sends canvas data URL to `/api/vision/describe`; backend returns a concise summary; the summary is sent into the realtime session.
- Playwright E2E tests that drive the same user journey: open app, see controls, call, hear/observe greeting, draw, wait for canvas send, observe assistant comment, stop.
- SDDTDD artifacts under `.sddtdd_skill/`.

## Run in mock mode

```bash
npm install
APP_MODE=mock PORT=5179 npm start
```

Open `http://localhost:5179`.

## Run tests

```bash
npm test
```

The tests use Playwright. In this sandbox I had to point Playwright at `/usr/bin/chromium` because downloading Playwright's bundled Chromium failed due DNS/CDN access. On a normal machine, `npx playwright install chromium` is enough.

## Run in live OpenAI mode

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Set:

```bash
APP_MODE=live
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_VISION_MODEL=gpt-5.1-mini
OPENAI_REALTIME_VOICE=marin
```

Then:

```bash
npm start
```

The browser never sees the standard OpenAI API key. It posts its SDP offer to `/api/realtime/session`; the backend forwards SDP and session config to OpenAI `/v1/realtime/calls` and returns the SDP answer.

## Data flow

```text
Browser microphone -> WebRTC audio track -> OpenAI realtime model -> remote audio track -> browser audio element
Browser canvas -> /api/vision/describe -> short summary -> realtime data channel -> assistant comment
Browser controls -> app state -> realtime transport
```

## Important live-mode caveat

The realtime session receives text scene summaries, not raw canvas pixels. Raw canvas pixels are handled by the backend vision endpoint first. This keeps the realtime voice connection focused on low-latency audio while still letting the companion comment on visual state.
