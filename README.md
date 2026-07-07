# Realtime Canvas Companion


## Architecture and event model

Read `docs/EVENT_AND_AUDIO_MODEL.md` for the detailed explanation of how canvas
updates, vision summaries, Realtime data-channel events, transcripts, and audio
playback move through the app. The important part: scene summaries are sent
immediately and do not wait for previous assistant audio to finish playing.

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

The tests use Playwright. `playwright.config.js` selects a browser executable by platform:

- `PLAYWRIGHT_CHROMIUM_EXECUTABLE` wins when set explicitly;
- macOS defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`;
- Linux defaults to `/usr/bin/chromium`;
- other platforms fall back to Playwright's bundled browser.

If needed, install Playwright's browser with `npx playwright install chromium`, or override the executable path:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm test
```

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

## Event log behavior

The transcript/event log is newest-first: the newest event is inserted at the top.
Entries are unnumbered and use a local timestamp prefix:

```text
[14:03:27] assistant: Вижу рисунок: линии и штрихи.
[14:03:26] sent: scene_summary.sent
[14:03:25] canvas frame sent (interval: 5000ms)
```

`drawing changed` means the local canvas changed. `canvas frame sent` is the interval-driven send event; change the Canvas send interval control to verify cadence.

## Model selectors

The app has two independent model selectors:

- **Model** controls the realtime voice session model. When the user presses **Call**, the selected value is sent to `/api/realtime/session?model=...`.
- **Vision model** controls the model used by `/api/vision/describe` for canvas image summaries. The selected value is included in the canvas describe request body as `model`.

Default low-cost live configuration:

```bash
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_VISION_MODEL=gpt-5.4-nano
```

Switch Vision model to `gpt-5.4-mini` if `gpt-5.4-nano` is too weak for the drawing quality you need. Keep the canvas interval at 5–10 seconds unless you intentionally want frequent paid vision requests.

## Paste image into canvas

Copy an image to the clipboard and press paste (`Cmd+V` on macOS, `Ctrl+V` elsewhere) while the app is open. The canvas is replaced with the pasted image. The image is scaled with aspect-fit behavior: its proportions are preserved, and unused canvas space remains white.


## App version visibility

The server reads the version from `package.json` and exposes it through `/api/config`.
The browser displays it as `version: ...`, logs it to the browser console, and writes `app version: ...` into the Transcript / events list. This makes it easy to verify which extracted archive/build is actually running.
