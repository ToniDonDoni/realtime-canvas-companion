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
