# Realtime Canvas Companion

One-page browser demo for a realtime AI voice companion that can listen, speak, and comment on a drawable canvas.

## What is included

- Browser SPA with visible `Call` / `Stop` flow.
- Model selector and canvas-send interval selector.
- Mouse drawing canvas.
- Mock realtime transport for deterministic tests without an OpenAI key.
- Live OpenAI mode using WebRTC SDP through a backend endpoint.
- Canvas frame description bridge: browser sends canvas data URL to `/api/vision/describe`; backend returns a concise summary; the summary is sent into the realtime session.
- Playwright E2E tests that drive the same user journey: open app, see controls, call, hear/observe greeting, draw, wait for canvas send, observe assistant comment, verify newest-first event ordering, verify interval cadence changes, stop.
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


## Event log and interval behavior

New transcript/event entries are prepended, so the latest event is shown at the top of the list. Canvas-send events include the active interval, for example `canvas frame sent (interval: 1000ms)`, and interval changes are logged as `canvas send interval changed to 1000ms`.

The E2E suite verifies that a 10-second interval does not send a frame within 1.5 seconds, then changing the selector to 1 second causes a canvas frame to be sent and commented on.

## Canvas editing controls

The canvas now has three visible editing controls:

- **Draw**: default mode; hold the mouse button and move to draw black strokes.
- **Erase**: hold the mouse button and move over existing strokes to erase them.
- **Clear**: clears the whole canvas immediately.

The app logs mode changes and clear actions at the top of the transcript/event list. These controls are covered by browser E2E tests that drive the visible UI and inspect the canvas pixels after real pointer gestures.
