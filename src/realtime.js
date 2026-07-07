import { playMockVoice } from './audio.js';

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
    this.pc = new RTCPeerConnection();
    this.pc.ontrack = (event) => { this.audioElement.srcObject = event.streams[0]; };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.pc.addTrack(this.stream.getTracks()[0]);
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
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.type?.includes('transcript') && event.transcript) {
      this.dispatchEvent(new CustomEvent('assistant_message', { detail: { text: event.transcript } }));
    }
    this.dispatchEvent(new CustomEvent('server_event', { detail: event }));
  }

  async sendSceneSummary(summary) {
    if (!this.dc || this.dc.readyState !== 'open') return;
    this.dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `screen_summary: ${summary}` }],
      },
    }));
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
