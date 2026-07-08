# Realtime Canvas Companion TODO

## What is broken

The assistant draws inaccurately because the realtime orchestration is too noisy and tool calls can be applied more than once.

## Findings

1. Duplicate tool execution
   - File: `src/realtime.js`
   - Tool calls are handled from both:
     - `response.function_call_arguments.done`
     - `response.output_item.done` with `item.type === 'function_call'`
   - Result: one model tool call can draw the same line twice.

2. Too many `response.create` calls
   - File: `src/realtime.js`
   - `response.create` is sent after scene images and after tool outputs.
   - With 1s canvas interval, new responses are requested while another response is still active.
   - Result: OpenAI errors: `Conversation already has an active response in progress`.

3. Scene frames interrupt drawing flow
   - File: `src/main.js` / `src/realtime.js`
   - Canvas/image frames are sent frequently and can trigger model responses during tool execution.
   - Result: the model keeps reacting instead of completing a clean drawing plan.

4. Drawing tools are too primitive
   - File: `src/canvas.js`
   - Current tools mostly move/draw by direction and distance.
   - No absolute geometry tools like `move_to`, `draw_to`, `draw_rect`.
   - Result: model estimates long relative movements and produces messy boxes.

## Target architecture: selectable Realtime transports

The application should support two interchangeable live Realtime engines behind
one browser-facing transport contract:

- `webrtc`: keep the current low-latency browser-to-OpenAI media path, with JSON
  control events carried by the WebRTC data channel.
- `websocket`: route ordered Realtime JSON events through the application server,
  which owns the authenticated upstream OpenAI WebSocket connection and never
  exposes `OPENAI_API_KEY` to the browser.

The browser must expose an engine selector before a call starts and construct only
the selected engine. Both engines must emit the same application events so the UI,
canvas capture loop, tools, and event log remain transport-independent.

The WebSocket engine's final goal is deterministic turn grouping. Every committed
user turn should have an application-owned `turn_id` and a context snapshot. Audio
chunks, user text, canvas summary/image context, commit, and response request for
that turn must be observable as one ordered event group instead of relying on the
relative timing of an independent media stream and control channel.

Before implementation, add tests that prove the transport contract and selector.
Use a local mock OpenAI WebSocket server to verify the full browser -> application
server -> mock upstream path, including ordered grouped events and a grouped mock
response. No live OpenAI key or paid request may be required by the test suite.

## Fix plan

1. Add tool-call deduplication by `call_id` / item id.
2. Execute function calls from only one event path.
3. Track `responseActive` and never send `response.create` while active.
4. Queue or drop scene frames while a response/tool execution is running.
5. Add absolute canvas tools:
   - `canvas_cursor_move_to(x, y)`
   - `canvas_draw_to(x, y, color, line_width_px)`
   - `canvas_draw_rect(x, y, width, height, color, line_width_px)`
   - `canvas_erase_rect(x, y, width, height)`
6. Add tests for:
   - duplicate tool-call suppression
   - no `response.create` during active response
   - scene image throttling/queuing
   - absolute drawing tools

## Main files to inspect

- `src/realtime.js` — response lifecycle, tool-call handling, scene image sending.
- `src/main.js` — canvas send interval and frame dispatch.
- `src/canvas.js` — actual drawing/tool implementation.
- `package.json` — bump app version with every behavior change.
