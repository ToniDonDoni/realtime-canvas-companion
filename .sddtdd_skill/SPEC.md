# SPEC

## Product goal

A developer can run a one-page browser demo that connects to a realtime AI voice companion, lets the user draw on a canvas, periodically sends canvas observations to the companion, and receives spoken/visible comments.

## User journey

A person opens the app. They see a model selector, mode indicator, canvas send interval selector, a Call button, a drawable canvas, and an event log. They choose a model and interval, press Call, grant microphone access in live mode or use the mock transport in test mode, see the button change to Stop, hear/observe the assistant greeting, draw on the canvas, wait for the configured interval, and observe that a canvas frame/description was sent and the assistant commented on it. They press Stop and can tell the session ended.

## Functional requirements and acceptance criteria

### FR-001 Visible realtime controls

AC-FR001-1:
- Given: the app is opened in a browser.
- When: the first screen is displayed.
- Then: the user can visibly identify the model selector, canvas send interval selector, Call button, canvas, mode indicator, and event log.
- Boundary: browser end-to-end.
- Not enough: DOM component exists, config contains labels, or a unit test reads strings.

### FR-002 Start and stop voice session

AC-FR002-1:
- Given: the visible app is open and mock mode is enabled.
- When: the user selects a model and activates Call.
- Then: the button changes to Stop, status indicates connected, and the app shows the selected model in the session log.
- Boundary: browser end-to-end.
- Not enough: internal connection flag changes.

AC-FR002-2:
- Given: a session is connected.
- When: the assistant greets after connection.
- Then: the user can observe the greeting in the transcript and audio output is submitted to the browser audio path.
- Boundary: browser end-to-end with browser-level audio instrumentation.
- Not enough: a mock callback was invoked without rendered app flow.

AC-FR002-3:
- Given: a session is connected.
- When: the user activates Stop.
- Then: status indicates disconnected and the button changes back to Call.
- Boundary: browser end-to-end.
- Not enough: calling a stop method directly.

### FR-003 Canvas drawing

AC-FR003-1:
- Given: the app is open.
- When: the user presses the mouse on the canvas and moves.
- Then: the canvas visibly changes and the app records that drawing occurred.
- Boundary: browser end-to-end.
- Not enough: a drawing function exists or pixel changes are asserted without real pointer actions.

### FR-004 Periodic canvas sending and comments

AC-FR004-1:
- Given: the app is connected, the interval is set to 1 second, and the user has drawn on the canvas.
- When: at least one interval elapses.
- Then: the app sends a canvas frame to the vision endpoint/transport and logs that a canvas frame was sent.
- Boundary: browser end-to-end with mocked backend/transport.
- Not enough: timer exists or function was imported.

AC-FR004-2:
- Given: a canvas frame has been sent.
- When: the mocked companion receives the canvas summary.
- Then: the user observes an assistant comment about the drawing and audio output is submitted to the browser audio path.
- Boundary: browser end-to-end with audio instrumentation.
- Not enough: a mocked data object exists.

### FR-006 Newest-first event log and observable cadence changes

AC-FR006-1:
- Given: the app is open and events are being produced.
- When: a new event is logged.
- Then: the newest event appears at the top of the transcript/event list.
- Boundary: browser end-to-end.
- Not enough: a log array is sorted internally without proving the rendered list order.

AC-FR006-2:
- Given: the app is connected, the canvas has changed, and the interval is set to 10 seconds.
- When: less than the 10 second interval elapses.
- Then: no canvas frame is sent.
- Boundary: browser end-to-end with mocked vision endpoint.
- Not enough: asserting only that the select value changed.

AC-FR006-3:
- Given: the app is connected, the canvas has changed, and the interval is changed to 1 second.
- When: one selected interval elapses.
- Then: a canvas frame is sent, the visible log identifies the 1000ms interval, and the assistant comment becomes the newest visible event.
- Boundary: browser end-to-end with mocked vision endpoint.
- Not enough: a timer function exists or an internal variable changes.

### FR-005 Live/OpenAI mode

AC-FR005-1:
- Given: APP_MODE=live and OPENAI_API_KEY is configured on the backend.
- When: the browser posts an SDP offer to `/api/realtime/session`.
- Then: the backend forwards the SDP and session config to OpenAI `/v1/realtime/calls` and returns the SDP answer without exposing the standard API key to the browser.
- Boundary: backend integration with mocked fetch for automated tests; live manual verification with a real key.
- Not enough: endpoint file exists.

AC-FR005-2:
- Given: APP_MODE=live and a canvas frame is sent to `/api/vision/describe`.
- When: the backend receives the frame.
- Then: it uses the configured vision model to return a concise scene summary that the browser sends into the realtime data channel.
- Boundary: backend integration with mocked fetch for automated tests; live manual verification with a real key.
- Not enough: the browser sends a data URL only.

### FR-007 Draw, erase, and clear canvas controls

AC-FR007-1:
- Given: the app is opened in a browser.
- When: the first screen is displayed.
- Then: the user can visibly identify Draw mode, Erase mode, and Clear controls near the canvas.
- Boundary: browser end-to-end.
- Not enough: mode variables exist, canvas functions exist, or source text contains labels.

AC-FR007-2:
- Given: Draw mode is selected.
- When: the user presses and drags on the canvas.
- Then: visible/non-empty drawing content is produced on the canvas through real pointer actions.
- Boundary: browser end-to-end using real pointer events and canvas pixel inspection.
- Not enough: calling a drawing helper directly or asserting an internal changed flag only.

AC-FR007-3:
- Given: the canvas contains visible drawing content and Erase mode is selected.
- When: the user presses and drags over existing content.
- Then: the visible/non-empty drawing content is reduced on the canvas through real pointer actions.
- Boundary: browser end-to-end using real pointer events and canvas pixel inspection.
- Not enough: an erase function exists or an internal tool mode changes.

AC-FR007-4:
- Given: the canvas contains visible drawing content.
- When: the user activates the visible Clear control.
- Then: the canvas becomes empty/cleared and the event log records that the canvas was cleared.
- Boundary: browser end-to-end using visible control activation and canvas pixel inspection.
- Not enough: directly calling clearCanvas or only checking that a Clear button exists.

### FR-008 Timestamped newest-first event log without numbering

AC-FR008-1:
- Given: the app is opened in a browser.
- When: events are recorded in the transcript/event log.
- Then: each visible event includes a timestamp and event text, and no numeric list marker is shown.
- Boundary: browser end-to-end with rendered UI/CSS inspection.
- Not enough: a timestamp helper exists or event text is stored internally.

AC-FR008-2:
- Given: multiple events are recorded.
- When: a later event is added.
- Then: the later event appears as the first/top visible log entry.
- Boundary: browser end-to-end with visible log ordering assertions.
- Not enough: array order changes without proving visible rendered order.

## ADDITION FR-009 Realtime and vision model selectors

AC-FR009-1:
- Given: the app is opened in live mode and the visible realtime model selector contains available realtime models.
- When: the user selects a realtime model and starts a call through the visible Call button.
- Then: the app opens the realtime session using the selected model in the session request.
- Boundary: browser end-to-end with a fake WebRTC/browser boundary and intercepted session request.
- Not enough: a model option exists, a variable changes internally, or a unit test calls transport code directly.

AC-FR010-1:
- Given: the app is opened and the visible vision model selector contains low-cost vision models.
- When: the user selects a vision model, starts a call, draws on the canvas, and the canvas send cadence fires.
- Then: the `/api/vision/describe` request includes the selected vision model and the resulting summary appears in the event log.
- Boundary: browser end-to-end with intercepted vision request.
- Not enough: a select element exists, config contains model names, or a request helper is called directly.

## FR-011 Paste image into canvas

A user can paste an image from the system clipboard into the app with the normal paste shortcut. The current canvas content is replaced. The pasted image is aspect-fit scaled into the canvas while preserving proportions. Empty canvas bands remain white.

AC-FR011-1:
- Given: the browser app is open and the user has an image in the clipboard.
- When: the user presses the paste shortcut.
- Then: the canvas is replaced with the pasted image, scaled to fit while preserving aspect ratio, and white margins are visible where the image does not fill the canvas.
- Boundary: browser end-to-end.
- Not enough: a paste handler exists, an image helper exists, or a unit test calls a draw function directly.


## FR013 unchanged canvas vision deduplication

AC-FR013-1:
- Given: the app is connected, a canvas frame has been submitted for vision, and the visible canvas has not changed since that submission.
- When: the next canvas send interval fires.
- Then: the browser must not send another `/api/vision/describe` request for the unchanged image, and the event log must show that the unchanged frame was skipped.
- Boundary: browser end-to-end with network request counting.
- Not enough: a checksum helper exists, an internal flag changes, or a unit test calls the helper directly.

## ADDITION FR-015 AI-controlled pink cat-paw canvas cursor and drawing tools

The canvas has a second cursor controlled by the realtime companion. The cursor is visually represented as a pink cat paw, starts in the center of the canvas, and is independent from the user's mouse drawing. The companion can call tools to move the paw without drawing, draw a straight colored line while moving the paw, and erase along a straight line while moving the paw.

AC-FR015-1:
- Given: the app is opened in a browser.
- When: the first screen is displayed.
- Then: the user can visibly identify a pink cat-paw companion cursor centered over the canvas.
- Boundary: browser end-to-end with rendered UI geometry.
- Not enough: a variable exists for a cursor position or a source file contains paw markup.

AC-FR015-2:
- Given: the app is connected in live-mode with a fake WebRTC/data-channel boundary.
- When: the realtime model emits a `canvas_cursor_move` tool call.
- Then: the visible paw cursor moves in the requested direction and distance without changing canvas pixels.
- Boundary: browser end-to-end with a simulated realtime server tool-call event.
- Not enough: directly calling a canvas helper or asserting only a tool schema exists.

AC-FR015-3:
- Given: the app is connected and the paw cursor is visible.
- When: the realtime model emits a `canvas_draw_line` tool call with a color and distance.
- Then: the canvas visibly contains a line in that color and the paw cursor moves to the line end.
- Boundary: browser end-to-end with canvas pixel inspection.
- Not enough: only logging the tool call.

AC-FR015-4:
- Given: the canvas contains a companion-drawn line and the paw is at a line endpoint.
- When: the realtime model emits a `canvas_erase_line` tool call across that line.
- Then: visible/non-empty canvas content is reduced and the paw moves to the erase endpoint.
- Boundary: browser end-to-end with canvas pixel inspection.
- Not enough: an erase tool schema exists without a rendered canvas effect.

## FR-018 Selectable WebRTC and WebSocket realtime engines

AC-FR018-1:
- Given: the app is opened in a browser.
- When: the first screen is displayed.
- Then: the user can select either `webrtc` or `websocket`, with `webrtc` selected by default.
- Boundary: browser end-to-end.
- Not enough: a transport class exists without a visible selector.

AC-FR018-2:
- Given: live mode is configured and the user selects `websocket`.
- When: the user starts a call and a canvas summary is produced.
- Then: the browser opens `/api/realtime/ws`, sends one `app.turn` with a generated `turn_id`, includes the context snapshot, and orders the context item before `response.create`.
- Boundary: browser end-to-end with fake WebSocket and microphone boundaries.
- Not enough: checking a selector value or calling a transport method directly.

AC-FR018-3:
- Given: the application server is connected to a mock OpenAI WebSocket server.
- When: a contextual audio turn is sent through the application WebSocket endpoint.
- Then: the mock receives context, audio append, commit, and response request in order with correlated event IDs; the client receives the mock grouped response; and the OpenAI key is sent only on the server-to-upstream connection.
- Boundary: backend integration with real local WebSocket connections and mock upstream.
- Not enough: mocking the proxy forwarding method in process.
