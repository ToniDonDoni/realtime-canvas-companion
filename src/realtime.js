import { playMockVoice } from './audio.js';

// The mock transport preserves the public behavior of the live transport:
// connect, receive assistant messages, send scene summaries, and disconnect.
// E2E tests use it to prove the user journey without spending OpenAI tokens.
export class MockRealtimeTransport extends EventTarget {
  constructor({ model }) {
    super();
    this.model = model;
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    this.dispatchEvent(new CustomEvent('connected', { detail: { model: this.model } }));
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

  async disconnect() {
    this.connected = false;
    this.dispatchEvent(new CustomEvent('disconnected'));
  }
}

// The live transport treats OpenAI as a WebRTC peer. Audio and JSON events are
// intentionally separate: microphone/speaker audio travels on media tracks, while
// text events, transcripts, errors, and scene summaries travel on the data
// channel.
export class OpenAIWebRTCTransport extends EventTarget {
  constructor({ model, audioElement }) {
    super();
    this.model = model;
    this.audioElement = audioElement;
    this.pc = undefined;
    this.dc = undefined;
    this.stream = undefined;
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
    this.dispatchEvent(new CustomEvent('connected', { detail: { model: this.model } }));
  }

  handleEvent(raw) {
    // OpenAI emits many event types. The demo surfaces only user-useful messages
    // and errors, while still forwarding the raw server event for future state
    // machine work.
    let event;
    try { event = JSON.parse(raw); } catch { return; }
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
    // Current policy: every accepted visual summary immediately asks the model for
    // a response. This does not wait for previous audio to finish. A production
    // companion may instead queue, coalesce, or cancel responses.
    if (!this.dc || this.dc.readyState !== 'open') return;
    this.dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `screen_summary: ${summary}` }],
      },
    }));
    // `conversation.item.create` only adds context. `response.create` is the
    // explicit trigger that asks the realtime model to answer.
    this.dc.send(JSON.stringify({ type: 'response.create' }));
    this.dispatchEvent(new CustomEvent('client_event', { detail: { type: 'scene_summary.sent', summary } }));
  }

  async disconnect() {
    this.dc?.close();
    this.pc?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.dispatchEvent(new CustomEvent('disconnected'));
  }
}

export function createRealtimeTransport({ mode, model, audioElement }) {
  if (mode === 'live') return new OpenAIWebRTCTransport({ model, audioElement });
  return new MockRealtimeTransport({ model });
}
