import { playMockVoice } from './audio.js';

// The mock transport preserves the public behavior of the live transport:
// connect, receive assistant messages, send scene summaries, and disconnect.
// E2E tests use it to prove the user journey without spending OpenAI tokens.
export class MockRealtimeTransport extends EventTarget {
  constructor({ model, engine = 'webrtc' }) {
    super();
    this.model = model;
    this.engine = engine;
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    this.dispatchEvent(new CustomEvent('connected', { detail: { model: this.model, engine: this.engine } }));
    window.setTimeout(async () => {
      if (!this.connected) return;
      await playMockVoice();
      this.dispatchEvent(new CustomEvent('assistant_message', { detail: { text: 'Привет. Я на связи и смотрю на канву.' } }));
    }, 150);
  }

  async sendSceneSummary(summary) {
    // Current policy: every accepted visual summary immediately asks the model for
    // a response. This does not wait for previous audio to finish. A production
    // companion may instead queue, coalesce, or cancel responses.
    if (!this.connected) return;
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'scene_summary.sent', summary } }));
    window.setTimeout(async () => {
      if (!this.connected) return;
      await playMockVoice();
      this.dispatchEvent(new CustomEvent('assistant_message', { detail: { text: `Вижу рисунок: ${summary}` } }));
    }, 80);
  }

  getSceneImageTargetBytes() {
    return 180000;
  }

  async sendSceneImage(imageDataUrl) {
    if (!this.connected) return;
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'scene_image.sent' } }));
    window.setTimeout(async () => {
      if (!this.connected) return;
      await playMockVoice();
      this.dispatchEvent(new CustomEvent('assistant_message', { detail: { text: 'Вижу картинку канвы напрямую.' } }));
    }, 80);
  }

  async disconnect() {
    this.connected = false;
    this.dispatchEvent(new CustomEvent('disconnected'));
  }
}

// The live transport treats OpenAI as a WebRTC peer. Audio and JSON events are
// intentionally separate: microphone/speaker audio travels on media tracks, while
// text events, transcripts, errors, and scene summaries travel on the data
// channel.
const DEFAULT_DATA_CHANNEL_MAX_MESSAGE_BYTES = 256 * 1024;
const SCENE_IMAGE_MESSAGE_FRACTION = 0.8;
const SCENE_IMAGE_JSON_OVERHEAD_BYTES = 8192;
const MIN_SCENE_IMAGE_TARGET_BYTES = 16 * 1024;

export class OpenAIWebRTCTransport extends EventTarget {
  constructor({ model, audioElement }) {
    super();
    this.model = model;
    this.engine = 'webrtc';
    this.audioElement = audioElement;
    this.pc = undefined;
    this.dc = undefined;
    this.stream = undefined;
  }

  getDataChannelMaxMessageBytes() {
    const negotiatedMaxMessageSize = this.pc?.sctp?.maxMessageSize;
    if (Number.isFinite(negotiatedMaxMessageSize) && negotiatedMaxMessageSize > 0) {
      return negotiatedMaxMessageSize;
    }
    return DEFAULT_DATA_CHANNEL_MAX_MESSAGE_BYTES;
  }

  getSceneImageTargetBytes() {
    const maxMessageBytes = this.getDataChannelMaxMessageBytes();
    const safeEnvelopeBytes = Math.floor(maxMessageBytes * SCENE_IMAGE_MESSAGE_FRACTION);
    return Math.max(MIN_SCENE_IMAGE_TARGET_BYTES, safeEnvelopeBytes - SCENE_IMAGE_JSON_OVERHEAD_BYTES);
  }

  buildSessionUpdateEvent() {
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: `You are a continuous realtime canvas companion.
Do not greet the user repeatedly.
Do not say hello after the first assistant message in this session.
Treat screen_summary messages and direct canvas images as ongoing visual context, not as a new conversation start.
When a screen_summary or canvas image arrives, use it to ground the current conversation.
If the user is speaking or has just spoken, answer the user's spoken question using the visual context.
You have tools. Use the canvas tools to control a visible pink cat-paw cursor on the shared canvas. The user can draw with the mouse; you can draw with the paw. Use canvas_cursor_move to move without drawing, canvas_draw_line to draw a colored line while moving, and canvas_erase_line to erase while moving. Prefer short, deliberate strokes. When the user asks you to draw or edit the canvas, call the relevant canvas tool instead of only describing what you would do. When the user gives a direct game command, call the matching game tool instead of saying you cannot control the game. Use game_move for movement, game_attack for attacks, and game_defend for shield, dodge, or defensive commands. When the user says search, google, find online, or asks for fresh external facts, call web_search. Describe tool results briefly after they complete.
Be concise.`,
        tool_choice: 'auto',
        tools: [
          {
            type: 'function',
            name: 'web_search',
            description: 'Demo web search tool. Use it when the user asks for current or external information.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                query: { type: 'string', description: 'The search query.' },
              },
              required: ['query'],
            },
          },
          {
            type: 'function',
            name: 'canvas_cursor_move',
            description: 'Move the visible pink cat-paw cursor on the canvas without drawing.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                direction: {
                  type: 'string',
                  enum: ['up', 'down', 'left', 'right'],
                  description: 'Direction to move the paw cursor.',
                },
                distance_px: {
                  type: 'integer',
                  description: 'Movement distance in canvas pixels. Defaults to 50.',
                },
              },
              required: ['direction'],
            },
          },
          {
            type: 'function',
            name: 'canvas_draw_line',
            description: 'Draw a straight line from the pink cat-paw cursor in a direction, using any CSS color, and move the cursor to the line end.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                direction: {
                  type: 'string',
                  enum: ['up', 'down', 'left', 'right'],
                  description: 'Direction to draw and move.',
                },
                distance_px: {
                  type: 'integer',
                  description: 'Line length in canvas pixels. Defaults to 50.',
                },
                color: {
                  type: 'string',
                  description: 'CSS color for the line, for example #ff66aa, red, or rgb(0 120 255).',
                },
                line_width_px: {
                  type: 'integer',
                  description: 'Stroke width in canvas pixels. Defaults to 7.',
                },
              },
              required: ['direction'],
            },
          },
          {
            type: 'function',
            name: 'canvas_erase_line',
            description: 'Erase along a straight line from the pink cat-paw cursor in a direction and move the cursor to the erased line end.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                direction: {
                  type: 'string',
                  enum: ['up', 'down', 'left', 'right'],
                  description: 'Direction to erase and move.',
                },
                distance_px: {
                  type: 'integer',
                  description: 'Erase distance in canvas pixels. Defaults to 50.',
                },
                line_width_px: {
                  type: 'integer',
                  description: 'Eraser width in canvas pixels. Defaults to 28.',
                },
              },
              required: ['direction'],
            },
          },
          {
            type: 'function',
            name: 'game_move',
            description: 'Demo game-control tool. Move the knight/player character in a direction.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                direction: {
                  type: 'string',
                  enum: ['forward', 'backward', 'left', 'right'],
                  description: 'Direction to move the character.',
                },
                duration_ms: {
                  type: 'integer',
                  description: 'Approximate movement duration in milliseconds.',
                },
              },
              required: ['direction'],
            },
          },
          {
            type: 'function',
            name: 'game_attack',
            description: 'Demo game-control tool. Attack with the knight/player character.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attack_type: {
                  type: 'string',
                  enum: ['light', 'heavy'],
                  description: 'Attack type to perform.',
                },
                target: {
                  type: 'string',
                  description: 'Optional target description, such as enemy, boss, or nearest target.',
                },
              },
              required: ['attack_type'],
            },
          },
          {
            type: 'function',
            name: 'game_defend',
            description: 'Demo game-control tool. Raise shield, dodge, or hold defensive posture.',
            parameters: {
              type: 'object',
              additionalProperties: false,
              properties: {
                defense_type: {
                  type: 'string',
                  enum: ['shield', 'dodge', 'hold'],
                  description: 'Defensive action to perform.',
                },
                duration_ms: {
                  type: 'integer',
                  description: 'Approximate defensive action duration in milliseconds.',
                },
              },
              required: ['defense_type'],
            },
          },
        ],
      },
    };
  }

  parseToolArguments(rawArguments) {
    if (!rawArguments) return {};
    if (typeof rawArguments === 'object') return rawArguments;
    try { return JSON.parse(rawArguments); } catch { return { raw: String(rawArguments) }; }
  }

  executeDemoTool(name, args) {
    // These tools intentionally do not control the OS or a real game yet. They
    // prove that the realtime model can request actions; the next step is to map
    // validated tool calls to actual keyboard/gamepad commands or backend search.
    if (name === 'web_search') {
      return { ok: true, tool: name, query: args.query, note: 'Demo only: real web search is not wired yet.' };
    }
    if (name === 'canvas_cursor_move') {
      return { ok: true, tool: name, action: `move paw ${args.direction}`, distance_px: args.distance_px ?? 50 };
    }
    if (name === 'canvas_draw_line') {
      return { ok: true, tool: name, action: `draw ${args.direction}`, distance_px: args.distance_px ?? 50, color: args.color ?? '#ff66aa' };
    }
    if (name === 'canvas_erase_line') {
      return { ok: true, tool: name, action: `erase ${args.direction}`, distance_px: args.distance_px ?? 50 };
    }
    if (name === 'game_move') {
      return { ok: true, tool: name, action: `move ${args.direction}`, duration_ms: args.duration_ms ?? 300 };
    }
    if (name === 'game_attack') {
      return { ok: true, tool: name, action: `${args.attack_type} attack`, target: args.target ?? 'nearest target' };
    }
    if (name === 'game_defend') {
      return { ok: true, tool: name, action: args.defense_type, duration_ms: args.duration_ms ?? 500 };
    }
    return { ok: false, tool: name, error: 'Unknown demo tool.' };
  }

  handleToolCall({ name, callId, rawArguments }) {
    const args = this.parseToolArguments(rawArguments);
    const detail = { name, callId, args, result: this.executeDemoTool(name, args) };
    this.dispatchEvent(new CustomEvent('tool_call', { detail }));
    if (!this.dc || this.dc.readyState !== 'open' || !callId) return;
    this.dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(detail.result),
      },
    }));
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'tool_output.sent', name, callId } }));
    this.dc.send(JSON.stringify({ type: 'response.create' }));
  }

  async connect() {
    // A single peer connection owns both streams: the microphone audio we send to
    // OpenAI and the assistant audio track OpenAI sends back.
    this.pc = new RTCPeerConnection();
    this.pc.ontrack = (event) => { this.audioElement.srcObject = event.streams[0]; };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.pc.addTrack(this.stream.getTracks()[0]);
    // The data channel is the control/event lane. It is faster than audible
    // playback, so transcript events can appear in the UI before speech finishes.
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onmessage = (event) => this.handleEvent(event.data);
    this.dc.onopen = () => {
      // The realtime model otherwise tends to treat every screen summary as a
      // fresh user turn and may greet repeatedly. These session instructions make
      // visual updates behave like continuing context for the same conversation.
      this.dc.send(JSON.stringify(this.buildSessionUpdateEvent()));
      this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'session.instructions.sent' } }));
    };
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    const answerResponse = await fetch(`/api/realtime/session?model=${encodeURIComponent(this.model)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    if (!answerResponse.ok) throw new Error(await answerResponse.text());
    const answer = { type: 'answer', sdp: await answerResponse.text() };
    await this.pc.setRemoteDescription(answer);
    this.dispatchEvent(new CustomEvent('connected', { detail: { model: this.model, engine: this.engine } }));
  }

  handleEvent(raw) {
    // OpenAI emits many event types. The demo surfaces only user-useful messages
    // and errors, while still forwarding the raw server event for future state
    // machine work.
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.type === 'response.function_call_arguments.done') {
      this.handleToolCall({ name: event.name, callId: event.call_id, rawArguments: event.arguments });
    }
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      this.handleToolCall({
        name: event.item.name,
        callId: event.item.call_id,
        rawArguments: event.item.arguments,
      });
    }
    if (event.type === 'error' || event.error) {
      const message = event.error?.message || event.message || raw;
      this.dispatchEvent(new CustomEvent('assistant_message', { detail: { text: `OpenAI event error: ${message}` } }));
    }
    if (event.type?.includes('transcript') && event.transcript) {
      this.dispatchEvent(new CustomEvent('assistant_message', { detail: { text: event.transcript } }));
    }
    this.dispatchEvent(new CustomEvent('server_event', { detail: event }));
  }

  async sendSceneSummary(summary) {
    // Current policy: every accepted visual update immediately asks the model for
    // a response. This does not wait for previous audio to finish. A production
    // companion may instead queue, coalesce, or cancel responses.
    if (!this.dc || this.dc.readyState !== 'open') return;
    this.dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Ongoing visual context update.

screen_summary:
${summary}

Do not greet. Do not treat this as a new conversation.
Use this only as visual grounding for the current or immediately preceding user turn. If drawing on the shared canvas would help, call canvas_cursor_move, canvas_draw_line, or canvas_erase_line.`,
        }],
      },
    }));
    // `conversation.item.create` only adds context. `response.create` is the
    // explicit trigger that asks the realtime model to answer.
    this.dc.send(JSON.stringify({ type: 'response.create' }));
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'scene_summary.sent', summary } }));
  }



  async sendSceneImage(imageDataUrl) {
    // Image context mode skips the separate vision-summary endpoint and sends the
    // captured canvas snapshot straight into the Realtime conversation over the
    // WebRTC data channel. main.js/canvas.js downscale this first using an 80%
    // envelope of pc.sctp.maxMessageSize so RTCDataChannel.send() does not throw
    // on large pasted game frames.
    if (!this.dc || this.dc.readyState !== 'open') return;
    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Ongoing visual context update.

canvas_image:
The attached image is the latest shared canvas frame.

Do not greet. Do not treat this as a new conversation.
Use this only as visual grounding for the current or immediately preceding user turn. If drawing on the shared canvas would help, call canvas_cursor_move, canvas_draw_line, or canvas_erase_line.`,
          },
          {
            type: 'input_image',
            image_url: imageDataUrl,
          },
        ],
      },
    };
    const payload = JSON.stringify(event);
    const safeEnvelopeBytes = Math.floor(this.getDataChannelMaxMessageBytes() * SCENE_IMAGE_MESSAGE_FRACTION);
    if (payload.length > safeEnvelopeBytes) {
      throw new Error(`Canvas image payload is ${payload.length} bytes, above safe RTCDataChannel envelope ${safeEnvelopeBytes} bytes`);
    }
    this.dc.send(payload);
    this.dc.send(JSON.stringify({ type: 'response.create' }));
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'scene_image.sent', bytes: payload.length, safeEnvelopeBytes } }));
  }

  async disconnect() {
    this.dc?.close();
    this.pc?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.dispatchEvent(new CustomEvent('disconnected'));
  }
}

const WEBSOCKET_AUDIO_SAMPLE_RATE = 24000;
const SPEECH_THRESHOLD = 0.02;
const SPEECH_COMMIT_SILENCE_MS = 700;

// Unlike WebRTC, a Realtime WebSocket does not provide browser media tracks.
// This transport therefore owns PCM conversion and playback so audio can share
// the same ordered, observable event stream as text and canvas context.
function floatToPcm16Base64(samples, sourceSampleRate) {
  const ratio = sourceSampleRate / WEBSOCKET_AUDIO_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const bytes = new Uint8Array(outputLength * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = Math.min(samples.length - 1, Math.floor(i * ratio));
    const value = Math.max(-1, Math.min(1, samples[sourceIndex]));
    view.setInt16(i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function pcm16Base64ToFloat32(base64) {
  const binary = atob(base64);
  const view = new DataView(new ArrayBuffer(binary.length));
  const bytes = new Uint8Array(view.buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const output = new Float32Array(Math.floor(binary.length / 2));
  for (let i = 0; i < output.length; i += 1) output[i] = view.getInt16(i * 2, true) / 0x8000;
  return output;
}

export class OpenAIWebSocketTransport extends OpenAIWebRTCTransport {
  constructor({ model, audioElement, voice }) {
    super({ model, audioElement });
    this.engine = 'websocket';
    this.voice = voice;
    this.socket = undefined;
    this.audioContext = undefined;
    this.inputNode = undefined;
    this.processorNode = undefined;
    this.silentGain = undefined;
    this.activeAudioTurn = undefined;
    this.audioTurnContextSent = false;
    this.lastSpeechAt = 0;
    this.latestContext = {};
    this.turnSequence = 0;
    this.nextPlaybackTime = 0;
    this.disconnectedEmitted = false;
    this.mediaStopped = false;
  }

  nextTurnId() {
    this.turnSequence += 1;
    return `turn-${Date.now()}-${this.turnSequence}`;
  }

  sendSocketEvent(event) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(event));
    return true;
  }

  sendGroupedTurn(turnId, context, events) {
    // `app.turn` is an application-only envelope. It lets the proxy and tests
    // prove which context belonged to an utterance; the proxy strips it before
    // OpenAI sees the enclosed protocol events.
    return this.sendSocketEvent({ type: 'app.turn', turn_id: turnId, context, events });
  }

  async connect() {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${scheme}//${window.location.host}/api/realtime/ws?model=${encodeURIComponent(this.model)}`;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => this.handleWebSocketEvent(event.data));
    this.socket.addEventListener('close', () => {
      this.stopMedia();
      this.emitDisconnected();
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
    });
    this.dc = {
      readyState: 'open',
      send: (raw) => this.socket.send(raw),
      close() {},
    };

    const sessionUpdate = this.buildSessionUpdateEvent();
    sessionUpdate.session.audio = {
      input: {
        format: { type: 'audio/pcm', rate: WEBSOCKET_AUDIO_SAMPLE_RATE },
        // Client-side silence detection gives the application one explicit commit
        // point for each turn. Server VAD would commit independently and weaken
        // the guarantee that the selected canvas context belongs to that audio.
        turn_detection: null,
      },
      output: {
        format: { type: 'audio/pcm', rate: WEBSOCKET_AUDIO_SAMPLE_RATE },
        voice: this.voice,
      },
    };
    this.sendSocketEvent(sessionUpdate);
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'session.instructions.sent' } }));
    await this.startMicrophone();
    this.dispatchEvent(new CustomEvent('connected', { detail: { model: this.model, engine: this.engine } }));
  }

  async startMicrophone() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    this.audioContext = new AudioCtor();
    if (!this.audioContext.createMediaStreamSource || !this.audioContext.createScriptProcessor) return;
    if (this.audioContext.resume) await this.audioContext.resume();
    this.inputNode = this.audioContext.createMediaStreamSource(this.stream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.processorNode.onaudioprocess = (event) => this.processMicrophoneBuffer(event.inputBuffer.getChannelData(0));
    this.inputNode.connect(this.processorNode);
    this.processorNode.connect(this.silentGain);
    // Browsers may suspend an unconnected processing graph. A zero-gain output
    // keeps microphone processing alive without feeding the microphone to speakers.
    this.silentGain.connect(this.audioContext.destination);
  }

  processMicrophoneBuffer(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
    const now = performance.now();
    if (peak >= SPEECH_THRESHOLD) this.lastSpeechAt = now;
    // Do not create turns from room noise. Once speech starts, preserve trailing
    // silence long enough to establish a deliberate end-of-turn boundary.
    if (!this.activeAudioTurn && peak < SPEECH_THRESHOLD) return;
    this.sendAudioChunk(floatToPcm16Base64(samples, this.audioContext.sampleRate));
    if (this.activeAudioTurn && this.lastSpeechAt > 0 && now - this.lastSpeechAt >= SPEECH_COMMIT_SILENCE_MS) {
      this.commitAudioTurn();
    }
  }

  sendAudioChunk(audio) {
    if (!this.activeAudioTurn) {
      this.activeAudioTurn = this.nextTurnId();
      this.audioTurnContextSent = false;
    }
    const events = [];
    if (!this.audioTurnContextSent) {
      // Context must precede the first audio chunk. Sending it later would leave
      // association to network timing, which is the ambiguity this engine exists
      // to remove.
      const summary = this.latestContext.screen_summary || 'No canvas summary is available.';
      events.push({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `turn_id=${this.activeAudioTurn}\nscreen_summary: ${summary}\nUse this as context for the following audio in the same turn.` }],
        },
      });
      this.audioTurnContextSent = true;
    }
    events.push({ type: 'input_audio_buffer.append', audio });
    this.sendGroupedTurn(this.activeAudioTurn, { ...this.latestContext }, events);
  }

  commitAudioTurn() {
    if (!this.activeAudioTurn) return;
    const turnId = this.activeAudioTurn;
    this.sendGroupedTurn(turnId, { ...this.latestContext }, [
      { type: 'input_audio_buffer.commit' },
      { type: 'response.create' },
    ]);
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'audio_turn.committed', turn_id: turnId } }));
    this.activeAudioTurn = undefined;
    this.audioTurnContextSent = false;
    this.lastSpeechAt = 0;
  }

  async sendSceneSummary(summary) {
    this.latestContext = { screen_summary: summary };
    const turnId = this.activeAudioTurn || this.nextTurnId();
    const events = [{
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `turn_id=${turnId}\nscreen_summary: ${summary}\nUse this visual context for this turn. Do not greet.` }],
      },
    }];
    // During speech, update the current turn without requesting a competing
    // response. Outside speech, a canvas change remains a standalone user turn.
    if (!this.activeAudioTurn) events.push({ type: 'response.create' });
    this.sendGroupedTurn(turnId, { ...this.latestContext }, events);
    if (this.activeAudioTurn) this.audioTurnContextSent = true;
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'scene_summary.sent', summary, turn_id: turnId } }));
  }

  async sendSceneImage(imageDataUrl) {
    this.latestContext = { canvas_image: true };
    const turnId = this.activeAudioTurn || this.nextTurnId();
    const events = [{
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: `turn_id=${turnId}\nThe attached canvas image is visual context for this turn. Do not greet.` },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      },
    }];
    if (!this.activeAudioTurn) events.push({ type: 'response.create' });
    this.sendGroupedTurn(turnId, { ...this.latestContext }, events);
    if (this.activeAudioTurn) this.audioTurnContextSent = true;
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'scene_image.sent', turn_id: turnId } }));
  }

  handleWebSocketEvent(raw) {
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.type === 'response.output_audio.delta' && event.delta) this.playAudioDelta(event.delta);
    this.handleEvent(raw);
  }

  playAudioDelta(base64) {
    if (!this.audioContext?.createBuffer || !this.audioContext?.createBufferSource) return;
    const samples = pcm16Base64ToFloat32(base64);
    const buffer = this.audioContext.createBuffer(1, samples.length, WEBSOCKET_AUDIO_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    // Each delta is a separate buffer. Schedule after the previous delta so
    // variable network timing cannot create gaps or overlapping speech.
    const startAt = Math.max(this.audioContext.currentTime, this.nextPlaybackTime);
    source.start(startAt);
    this.nextPlaybackTime = startAt + buffer.duration;
  }

  emitDisconnected() {
    if (this.disconnectedEmitted) return;
    this.disconnectedEmitted = true;
    this.dispatchEvent(new CustomEvent('disconnected'));
  }

  stopMedia() {
    if (this.mediaStopped) return;
    this.mediaStopped = true;
    if (this.processorNode) this.processorNode.onaudioprocess = null;
    // Upstream errors close the socket asynchronously. Stop capture here as well
    // as on the Stop button, otherwise the dead session keeps producing turns.
    this.processorNode?.disconnect?.();
    this.inputNode?.disconnect?.();
    this.silentGain?.disconnect?.();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audioContext?.close?.();
    this.activeAudioTurn = undefined;
    this.audioTurnContextSent = false;
  }

  async disconnect() {
    this.stopMedia();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
    else this.emitDisconnected();
  }
}

export function createRealtimeTransport({ mode, model, audioElement, engine = 'webrtc', voice }) {
  // Keep engine selection at one boundary so the UI and canvas loop depend on a
  // transport contract, not on WebRTC or WebSocket implementation details.
  if (mode === 'live' && engine === 'websocket') {
    return new OpenAIWebSocketTransport({ model, audioElement, voice });
  }
  if (mode === 'live') return new OpenAIWebRTCTransport({ model, audioElement });
  return new MockRealtimeTransport({ model, engine });
}
