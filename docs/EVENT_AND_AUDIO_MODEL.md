# Event and audio model

This document explains how the demo moves canvas changes, vision summaries,
Realtime events, text transcripts, and spoken audio through the application.

## Important answer first

A new canvas summary is currently sent to the Realtime model **without waiting for
previous assistant audio to finish playing**.

There are two independent streams:

1. **The event/control stream** over the WebRTC data channel. This carries JSON
   events such as `conversation.item.create`, `response.create`, transcripts,
   errors, and tool-like lifecycle events.
2. **The audio stream** over the WebRTC media track. This carries synthesized
   assistant speech to the browser audio element.

Because text/control events can arrive faster than the audible speech finishes,
the UI event log may show a newer assistant transcript while the browser is still
playing the previous spoken response. The new spoken response then plays after the
old audio has finished or after the browser/OpenAI audio pipeline has advanced to
it.

In other words: the log means "an event has arrived"; it does not mean "this text
is the audio that is currently coming out of the speakers."

## Current scene update pipeline

The image itself does **not** go into the Realtime WebRTC session. The browser
first sends the canvas image to the backend vision endpoint. The backend asks a
vision model to describe the image, and only the resulting short text summary is
sent into the Realtime conversation.

```text
user draws / pastes / erases / clears canvas
  -> canvas dirty flag becomes true
  -> interval timer wakes up
  -> canvas is captured as a PNG data URL
  -> checksum is computed
  -> unchanged checksum is skipped
  -> changed image is POSTed to /api/vision/describe
  -> backend sends image to the selected vision model
  -> backend returns a short text summary
  -> frontend sends `screen_summary: ...` as a text message into the Realtime data channel
  -> frontend immediately sends `response.create`
  -> Realtime model answers using the current conversation context
  -> the answer may include text/data events and spoken audio
```

## How voice input and screen summaries are mixed

There is one Realtime conversation session with two input paths:

```text
microphone audio track
  -> OpenAI Realtime session
  -> model receives the user's spoken turn

screen_summary text over the data channel
  -> OpenAI Realtime session
  -> model receives an extra text message in the same conversation
```

The screen summary is not a separate assistant. It is an additional conversation
item delivered to the same Realtime session that is also listening to the user's
voice.

When the frontend sends:

```text
conversation.item.create: user message "screen_summary: ..."
response.create
```

it is effectively saying:

```text
Here is the latest visual context. Please produce a response now, using this
context together with the rest of the conversation, including anything the user
has said through the microphone.
```

So the model can answer because of:

- the user's spoken audio turn;
- the latest `screen_summary` text item;
- both, if they are already present in the same Realtime conversation context.

The current demo does not wait for a spoken user turn before sending a
`screen_summary` response request. A changed canvas can trigger its own
`response.create`, even if the user has not just spoken.

Because the microphone/audio path and the data-channel/text path are independent,
timing can overlap:

```text
assistant is still speaking an old response
new screen_summary arrives over the data channel
frontend sends response.create immediately
new transcript/log events may arrive
old audio may still be playing
new audio plays after the old audio pipeline advances
```

This means the event log shows when text/control events arrive. It is not a
reliable indicator of which audio segment is currently audible.

## Current queue policy

The current implementation is intentionally simple:

- There is no local assistant-speaking state machine.
- There is no local queue of pending scene summaries.
- There is no local cancellation of the current assistant response when a new
  canvas summary arrives.
- Every accepted changed canvas summary sends a new `response.create` immediately.
- OpenAI and the browser audio pipeline decide how generated audio is buffered
  and played.

This is why a user can observe:

```text
old assistant audio is still playing
new canvas summary is sent
new transcript appears in the event log
old audio finishes
new audio starts
```

## Why the app is built this way for now

The demo is currently optimized for clarity and debuggability rather than perfect
conversation turn-taking. Sending each changed scene immediately makes it easy to
see whether the vision request, data channel, and response creation are wired
correctly.

For a production companion, a better policy is usually needed.

## Recommended production policy

A production version should choose one of these policies explicitly.

### Policy A: Queue while speaking

Use when the companion should not interrupt itself.

```text
if assistant is speaking:
  store only the newest pending scene summary
else:
  send scene summary and create a response

when assistant finishes speaking:
  if a pending scene summary exists:
    send the newest pending summary and create one response
```

This prevents delayed commentary spam and avoids sending every intermediate frame
to the model.

### Policy B: Interrupt on new scene

Use when the latest visual state is more important than finishing a sentence.

```text
new scene summary arrives
  -> cancel current response
  -> send latest scene summary
  -> create a new response
```

This makes the companion more reactive but may cut off speech.

### Policy C: Pure immediate mode

This is the current demo policy.

```text
every changed scene summary
  -> send immediately
  -> create response immediately
```

This is simplest, but it can let the event log get ahead of the audible output.

## Files to inspect

- `src/main.js`
  - owns the user-visible application state;
  - starts/stops the call;
  - schedules canvas capture;
  - computes the frame checksum;
  - calls `/api/vision/describe`;
  - sends the returned summary to the realtime transport;
  - writes the user-visible event log.

- `src/realtime.js`
  - contains the mock Realtime transport and the live OpenAI WebRTC transport;
  - opens `RTCPeerConnection`;
  - attaches the microphone audio track;
  - receives the assistant audio track;
  - creates the `oai-events` data channel;
  - sends `conversation.item.create` and `response.create`;
  - maps OpenAI data-channel events into UI events.

- `src/canvas.js`
  - owns drawing, erasing, clearing, paste-image aspect-fit rendering, dirty
    tracking, and PNG capture.

- `server/index.js`
  - serves the SPA;
  - exposes `/api/config`;
  - creates the OpenAI Realtime WebRTC call from the browser SDP offer;
  - accepts canvas PNG data URLs and calls the selected vision model.

## Model configuration

The model choices are not hard-coded into the UI only. They flow from the server
configuration endpoint.

- Realtime voice models are listed in `server/index.js` as `realtimeModels`.
- Vision models are listed in `server/index.js` as `visionModels`.
- Defaults come from `.env`:
  - `OPENAI_REALTIME_MODEL`
  - `OPENAI_VISION_MODEL`
  - `OPENAI_REALTIME_VOICE`

The current cheap defaults in `.env.example` are:

```env
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
OPENAI_VISION_MODEL=gpt-5.4-nano
```

## Cost controls already present

- Canvas frames are not sent until the canvas is dirty.
- A checksum prevents sending the same captured image repeatedly.
- The UI lets the user choose a slower canvas send interval.
- The UI lets the user choose the cheaper vision model.

## Known limitation

The checksum is computed over the captured PNG data URL. This is a practical demo
choice because it is simple and catches identical canvas captures. It is not a
semantic image comparison. Tiny visual or encoding changes produce a new checksum.
