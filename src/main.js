import { createDrawingCanvas } from './canvas.js';
import { createRealtimeTransport } from './realtime.js';

const els = {
  model: document.querySelector('#modelSelect'),
  interval: document.querySelector('#intervalSelect'),
  visionModel: document.querySelector('#visionModelSelect'),
  contextMode: document.querySelector('#canvasContextModeSelect'),
  call: document.querySelector('#callButton'),
  clearCanvas: document.querySelector('#clearCanvasButton'),
  canvasTools: document.querySelectorAll('input[name="canvasTool"]'),
  mode: document.querySelector('#modeBadge'),
  version: document.querySelector('#versionBadge'),
  status: document.querySelector('#statusBadge'),
  log: document.querySelector('#eventLog'),
  canvas: document.querySelector('#drawingCanvas'),
  companionPaw: document.querySelector('#companionPaw'),
  audio: document.querySelector('#remoteAudio'),
};

let config;
let transport;
let canvasState;
let sendTimer;
let connected = false;
let lastSubmittedCanvasChecksum = null;

// The log is an event timeline, not an audio playback timeline.
// Realtime transcripts can arrive before the corresponding synthesized audio
// has finished playing, so the newest log line may describe a response that the
// user has not heard yet.

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function log(message) {
  const li = document.createElement('li');
  li.textContent = `[${timestamp()}] ${message}`;
  els.log.prepend(li);
}


function formatServerEventForLog(event) {
  const fields = [];
  for (const key of ['event_id', 'item_id', 'response_id', 'type']) {
    if (event[key] && key !== 'type') fields.push(`${key}=${event[key]}`);
  }
  const transcript = event.transcript || event.delta || event.text;
  if (typeof transcript === 'string' && transcript.trim()) {
    fields.push(`text=${transcript.trim().slice(0, 80)}`);
  }
  const suffix = fields.length ? ` (${fields.join(' ')})` : '';
  return `server: ${event.type || 'unknown'}${suffix}`;
}

function selectedIntervalMs() {
  return Number(els.interval.value);
}

function selectedCanvasContextMode() {
  return els.contextMode?.value || 'summary';
}

function updateCompanionPaw(point) {
  const xPercent = (point.x / els.canvas.width) * 100;
  const yPercent = (point.y / els.canvas.height) * 100;
  els.companionPaw.style.left = `${xPercent}%`;
  els.companionPaw.style.top = `${yPercent}%`;
}

function applyCompanionCanvasTool(name, args = {}) {
  if (!canvasState || !name?.startsWith('canvas_')) return undefined;
  if (name === 'canvas_cursor_move') {
    const cursor = canvasState.moveCompanionCursor(args);
    log(`tool: canvas_cursor_move ${args.direction} ${args.distance_px ?? 50}px`);
    return { ok: true, cursor };
  }
  if (name === 'canvas_draw_line') {
    const stroke = canvasState.drawCompanionLine(args);
    log(`tool: canvas_draw_line ${args.direction} ${args.distance_px ?? 50}px ${args.color || '#ff66aa'}`);
    return { ok: true, stroke };
  }
  if (name === 'canvas_erase_line') {
    const stroke = canvasState.eraseCompanionLine(args);
    log(`tool: canvas_erase_line ${args.direction} ${args.distance_px ?? 50}px`);
    return { ok: true, stroke };
  }
  log(`tool error: unsupported canvas tool ${name}`);
  return { ok: false, error: `Unsupported canvas tool ${name}` };
}

// We checksum the captured canvas data URL to avoid paying for vision requests
// when the visible canvas did not change between timer ticks. This is a byte-level
// duplicate guard, not a semantic image comparison.
function checksumString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function loadConfig() {
  const res = await fetch('/api/config');
  config = await res.json();
  els.mode.textContent = `mode: ${config.mode}`;
  els.version.textContent = `version: ${config.version}`;
  console.info(`[app] version=${config.version}`);
  log(`app version: ${config.version}`);
  els.model.innerHTML = '';
  for (const model of config.realtimeModels) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    if (model === config.defaultRealtimeModel) option.selected = true;
    els.model.appendChild(option);
  }
  els.visionModel.innerHTML = '';
  for (const model of config.visionModels) {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    if (model === config.defaultVisionModel) option.selected = true;
    els.visionModel.appendChild(option);
  }
  els.contextMode.innerHTML = '';
  const contextModes = config.canvasContextModes || ['summary', 'image'];
  const defaultContextMode = config.defaultCanvasContextMode || 'summary';
  for (const mode of contextModes) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    if (mode === defaultContextMode) option.selected = true;
    els.contextMode.appendChild(option);
  }
  if (config.keyStatus) log(`server key status: ${config.keyStatus}`);
  const matching = [...els.interval.options].find(o => Number(o.value) === config.defaultCanvasIntervalMs);
  if (matching) matching.selected = true;
}

// Transport events are normalized into UI events here so the rest of the app
// does not need to care whether it is talking to the mock transport or the live
// OpenAI WebRTC transport.
function wireTransport(t) {
  t.addEventListener('connected', (event) => {
    connected = true;
    els.status.textContent = 'connected';
    els.call.textContent = 'Stop';
    log(`connected with model ${event.detail.model}`);
    scheduleCanvasSending();
  });
  t.addEventListener('assistant_message', (event) => log(`assistant: ${event.detail.text}`));
  t.addEventListener('tool_call', (event) => {
    const applied = applyCompanionCanvasTool(event.detail.name, event.detail.args);
    if (applied) event.detail.result = applied;
  });
  t.addEventListener('client_event', (event) => log(`sent: ${event.detail.type}`));
  t.addEventListener('server_event', (event) => {
    // Server events are the only reliable markers we get for Realtime-side VAD,
    // transcript, and response lifecycle timing. Keep a compact line in the UI
    // log for humans, and print the full payload in DevTools for debugging.
    log(formatServerEventForLog(event.detail));
    console.debug('[realtime server event]', event.detail.type, event.detail);
  });
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
  try {
    await transport.connect();
  } catch (error) {
    connected = false;
    els.status.textContent = 'connection failed';
    els.call.textContent = 'Call';
    log(`realtime error: ${error.message || error}`);
    await transport?.disconnect();
  }
}

async function stopCall() {
  await transport?.disconnect();
}

// Summary context mode uses a separate request from the Realtime voice session.
// The Realtime model receives only the short text summary returned by this
// endpoint. Image context mode skips this and sends the raw canvas image directly
// into the Realtime session over the data channel.
async function describeCanvasFrame(imageDataUrl) {
  const res = await fetch('/api/vision/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, model: els.visionModel.value }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).summary;
}

// This is the current scene-update policy: send every changed frame immediately
// on the selected cadence. It does not wait for assistant speech to finish and it
// does not cancel older audio. See docs/EVENT_AND_AUDIO_MODEL.md for the queue
// semantics and production alternatives.
function scheduleCanvasSending() {
  window.clearInterval(sendTimer);
  const interval = selectedIntervalMs();
  sendTimer = window.setInterval(async () => {
    // The dirty flag is set by user-visible canvas actions: draw, erase, clear,
    // and paste image. If the user has not changed the canvas, there is no reason
    // to spend vision tokens.
    if (!connected || !canvasState.hasChanged()) return;
    const contextMode = selectedCanvasContextMode();
    const imageDataUrl = contextMode === 'image'
      ? canvasState.captureRealtimeImage({ targetMaxBytes: transport.getSceneImageTargetBytes?.() })
      : canvasState.capture();
    const checksum = checksumString(imageDataUrl);
    // A failed vision request still records the checksum. Otherwise the app
    // would retry the exact same unchanged image forever and burn money every
    // interval while the model/config is broken.
    if (checksum === lastSubmittedCanvasChecksum) {
      log(`canvas frame skipped (unchanged checksum: ${checksum})`);
      canvasState.markSent();
      return;
    }
    lastSubmittedCanvasChecksum = checksum;
    log(`canvas frame sent (interval: ${interval}ms) checksum: ${checksum}`);
    try {
      if (contextMode === 'image') {
        canvasState.markSent();
        // This immediately creates a new Realtime response. It can happen while
        // previous assistant audio is still playing; the browser/OpenAI audio path
        // handles playback ordering.
        await transport.sendSceneImage(imageDataUrl);
      } else {
        const summary = await describeCanvasFrame(imageDataUrl);
        log(`vision summary: ${summary}`);
        canvasState.markSent();
        await transport.sendSceneSummary(summary);
      }
    } catch (error) {
      log(`vision error: ${error.message || error}`);
      console.error('vision error', error);
    }
  }, interval);
}

els.call.addEventListener('click', async () => {
  if (connected || els.status.textContent === 'connecting') await stopCall();
  else await startCall();
});
els.interval.addEventListener('change', () => {
  log(`canvas send interval changed to ${selectedIntervalMs()}ms`);
  if (connected) scheduleCanvasSending();
});
els.model.addEventListener('change', () => {
  log(`realtime model selected: ${els.model.value}`);
});
els.visionModel.addEventListener('change', () => {
  log(`vision model selected: ${els.visionModel.value}`);
});
els.contextMode.addEventListener('change', () => {
  log(`canvas context mode selected: ${selectedCanvasContextMode()}`);
});

canvasState = createDrawingCanvas(els.canvas, () => log('drawing changed'), {
  onCompanionCursorChange: updateCompanionPaw,
});
for (const tool of els.canvasTools) {
  tool.addEventListener('change', () => {
    if (!tool.checked) return;
    canvasState.setMode(tool.value);
    log(`canvas mode changed to ${tool.value}`);
  });
}

// Paste replaces the whole canvas instead of compositing over existing strokes.
// That makes screenshots behave like a new visual state for the companion to
// describe.
async function handlePaste(event) {
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) => item.type.startsWith('image/'));
  if (!imageItem) return;
  event.preventDefault();
  try {
    const blob = imageItem.getAsFile();
    await canvasState.pasteImage(blob);
    log('image pasted into canvas');
  } catch (error) {
    log(`paste image error: ${error.message || error}`);
    console.error('paste image error', error);
  }
}

els.clearCanvas.addEventListener('click', () => {
  canvasState.clear();
  log('canvas cleared');
});
window.addEventListener('paste', handlePaste);
await loadConfig();
log('app ready');
