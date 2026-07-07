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
