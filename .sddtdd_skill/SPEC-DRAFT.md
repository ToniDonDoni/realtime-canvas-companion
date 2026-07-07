# SPEC-DRAFT

## Raw user input 2026-07-07

Build a browser one-page app with:
- a Call button that starts a realtime voice conversation and becomes Stop;
- a browser model selector;
- assistant says hello after connection;
- a canvas where the user can draw by holding the mouse and moving;
- a control for how often to send the canvas image/summary to the model, e.g. 1, 5, or 10 seconds;
- the assistant comments on what happens on the canvas;
- voice and streaming behavior;
- mock mode for tests/no key and live mode for OpenAI with a key;
- produce spec first, then E2E user-journey tests, then implementation.

## Raw user input 2026-07-07 ADDITION

Change transcript/event log ordering so newest entries appear at the top. Make canvas-send cadence visible and testable, and verify changing the interval from the UI changes when canvas frames are sent.

## Raw user input 2026-07-07 ADDITION

Add two canvas interaction modes: Draw and Erase, with a visible switch between them. Add a visible Clear button that clears the whole canvas. Write tests first, then implementation.

## Raw user input 2026-07-07 ADDITION

Change the transcript/event log so it does not show numeric ordering. Each event should show a timestamp and event text. Newest events must appear at the top of the visible log.

ADDITION: User requires realtime model switching to be verified and a visible vision model selector added. The vision selector must offer the low-cost vision choices previously discussed, and tests must be written before implementation. The selected realtime model must be used when opening a live session. The selected vision model must be used when sending canvas frames for description.

ADDITION: The user wants to paste an image from the clipboard into the canvas using the normal paste hotkey. When pasted, the canvas should be replaced by the image, resized to fit the canvas while preserving proportions. If the image is narrower than the canvas, white side margins should remain. If it is shorter, white top/bottom margins should remain. This must be covered by an end-to-end user journey test before implementation.


ADDITION: The app must avoid sending unchanged canvas images to the vision model by comparing a checksum/signature with the previous submitted frame. This must be covered by an end-to-end user journey test before implementation.

## Raw user input 2026-07-07 ADDITION

ADDITION: Add a second AI-controlled cursor on the canvas, visually represented as a pink cat paw. The paw starts in the center of the canvas. The realtime companion must get tools to move the paw up/down/left/right by a requested distance, draw straight lines in any requested color while moving the paw, and erase while moving the paw. The human user still draws with the mouse; the companion draws through realtime tool calls. Canvas images continue to be sent to the companion so the conversation and tool-driven drawing can be interactive. Tests must be written first.
