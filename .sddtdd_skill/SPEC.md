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
