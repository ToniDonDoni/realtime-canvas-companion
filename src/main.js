import { createDrawingCanvas } from './canvas.js';
import { createRealtimeTransport } from './realtime.js';

const els = {
  model: document.querySelector('#modelSelect'),
  interval: document.querySelector('#intervalSelect'),
  call: document.querySelector('#callButton'),
  mode: document.querySelector('#modeBadge'),
  status: document.querySelector('#statusBadge'),
  log: document.querySelector('#eventLog'),
  canvas: document.querySelector('#drawingCanvas'),
  audio: document.querySelector('#remoteAudio'),
};

let config;
let transport;
let canvasState;
let sendTimer;
let connected = false;

function log(message) {
  const li = document.createElement('li');
  li.textContent = message;
  els.log.appendChild(li);
}

async function loadConfig() {
  const res = await fetch('/api/config');
  config = await res.json();
  els.mode.textContent = `mode: ${config.mode}`;
  els.model.innerHTML = '';
  for (const model of config.realtimeModels) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    if (model === config.defaultRealtimeModel) option.selected = true;
    els.model.appendChild(option);
  }
  const matching = [...els.interval.options].find(o => Number(o.value) === config.defaultCanvasIntervalMs);
  if (matching) matching.selected = true;
}

function wireTransport(t) {
  t.addEventListener('connected', (event) => {
    connected = true;
    els.status.textContent = 'connected';
    els.call.textContent = 'Stop';
    log(`connected with model ${event.detail.model}`);
    scheduleCanvasSending();
  });
  t.addEventListener('assistant_message', (event) => log(`assistant: ${event.detail.text}`));
  t.addEventListener('client_event', (event) => log(`sent: ${event.detail.type}`));
  t.addEventListener('disconnected', () => {
    connected = false;
    els.status.textContent = 'disconnected';
    els.call.textContent = 'Call';
    window.clearInterval(sendTimer);
    log('disconnected');
  });
}

async function startCall() {
  transport = createRealtimeTransport({ mode: config.mode, model: els.model.value, audioElement: els.audio });
  wireTransport(transport);
  els.status.textContent = 'connecting';
  await transport.connect();
}

async function stopCall() {
  await transport?.disconnect();
}

async function describeCanvasFrame(imageDataUrl) {
  const res = await fetch('/api/vision/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).summary;
}

function scheduleCanvasSending() {
  window.clearInterval(sendTimer);
  const interval = Number(els.interval.value);
  sendTimer = window.setInterval(async () => {
    if (!connected || !canvasState.hasChanged()) return;
    const imageDataUrl = canvasState.capture();
    log('canvas frame sent');
    const summary = await describeCanvasFrame(imageDataUrl);
    canvasState.markSent();
    await transport.sendSceneSummary(summary);
  }, interval);
}

els.call.addEventListener('click', async () => {
  if (connected || els.status.textContent === 'connecting') await stopCall();
  else await startCall();
});
els.interval.addEventListener('change', () => { if (connected) scheduleCanvasSending(); });

canvasState = createDrawingCanvas(els.canvas, () => log('drawing changed'));
await loadConfig();
log('app ready');
