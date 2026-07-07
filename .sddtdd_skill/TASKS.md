# TASKS

- [x] TASK-001 Capture spec draft and reviewed spec.
- [x] TASK-002 Add E2E tests for visible controls, call/stop, mock greeting audio, canvas drawing, periodic canvas send, and assistant comment.
- [x] TASK-003 Implement one-page browser app.
- [x] TASK-004 Implement mock and live backend routes.
- [x] TASK-005 Run E2E regression and package result.

- [x] TASK-006 Add newest-first log ordering and interval cadence E2E coverage.

- [x] TASK-007 RED: Add browser E2E coverage for visible Draw/Erase/Clear controls and their user-observable canvas effects.
- [x] TASK-008 GREEN: Implement Draw/Erase mode switching and Clear behavior.
- [x] TASK-009 Run regression and package updated project.

- [x] TASK-010 RED: Add browser E2E coverage for timestamped, unnumbered, newest-first event log entries.
- [x] TASK-011 GREEN: Implement timestamped unnumbered event log rendering.
- [x] TASK-012 Run regression and package updated project.

## ADDITION TASKS FR-009/FR-010

- Add RED E2E tests proving realtime model selection is sent to `/api/realtime/session` in live mode.
- Add RED E2E tests proving the selected vision model is sent to `/api/vision/describe` after a real canvas drawing journey.
- Implement visible Vision model selector populated from `/api/config`.
- Implement backend `visionModels`, `defaultVisionModel`, and selected vision model handling.
- Keep realtime model selection in the live session request and expose the low-cost realtime options.

## Task FR-011 Paste image into canvas

1. RED: Add an E2E test that opens the app, draws existing content, puts an image in the clipboard, presses the paste shortcut, and asserts the canvas is replaced with aspect-fit image content and white margins.
2. GREEN: Implement browser paste handling and canvas aspect-fit image rendering.
3. REGRESSION: Run the E2E suite.


## Task FR013 unchanged canvas vision deduplication

1. RED: Add an E2E test that draws once, observes one vision request, waits another interval without changing the canvas, and proves no second vision request is sent.
2. GREEN: Add canvas frame checksum tracking before vision describe calls and skip unchanged frames with a visible event-log message.
3. REGRESSION: Run the E2E suite.

## Task FR-015 AI cat-paw cursor and canvas tools

1. RED: Add an E2E test proving the pink cat-paw cursor is visible and centered on first load.
2. RED: Add an E2E test that simulates realtime tool calls for moving the paw, drawing a colored line, and erasing the line through the browser/data-channel boundary.
3. GREEN: Implement the rendered paw cursor overlay and canvas helper methods for move/draw/erase.
4. GREEN: Add realtime tool schemas and dispatch tool-call events into the canvas layer.
5. REGRESSION: Run the E2E suite.

## Task FR-016 Canvas context mode

1. RED: Add E2E coverage for a visible Canvas context mode selector with `summary` default and `image` option.
2. RED: Add E2E coverage proving image mode sends a changed canvas directly as a Realtime `input_image` event and does not call `/api/vision/describe`.
3. GREEN: Expose canvas context modes from `/api/config` and support `CANVAS_CONTEXT_MODE`.
4. GREEN: Implement `sendSceneImage(imageDataUrl)` on mock and live realtime transports.
5. REGRESSION: Run the E2E suite.

## Task FR-017 Adaptive WebRTC image payload sizing
1. RED: Extend the fake WebRTC E2E transport with an SCTP `maxMessageSize` and make its data channel throw on oversized sends.
2. RED: Assert image context mode sends a final Realtime payload no larger than 80% of the negotiated message size.
3. GREEN: Expose the transport image target from `pc.sctp.maxMessageSize` and compress/downscale canvas JPEG frames against that target.
4. GREEN: Bump the app version and visible version test expectations.
