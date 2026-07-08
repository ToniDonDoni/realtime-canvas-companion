import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const app = express();
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const PORT = Number(process.env.PORT || 5179);
const APP_MODE = process.env.APP_MODE || 'mock';
const realtimeModel = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1-mini';
const visionModel = process.env.OPENAI_VISION_MODEL || 'gpt-5.4-nano';
const voice = process.env.OPENAI_REALTIME_VOICE || 'marin';
const defaultCanvasIntervalMs = Number(process.env.CANVAS_SEND_INTERVAL_MS || 5000);
const defaultCanvasContextMode = process.env.CANVAS_CONTEXT_MODE || 'summary';
const verboseLogs = process.env.VERBOSE_LOGS === '1';
// The server is the source of truth for selectable models. Keeping this list on
// the backend prevents the browser from requesting arbitrary model names and
// gives tests a stable contract to assert against.
const realtimeModels = ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'];
const visionModels = ['gpt-5.4-nano', 'gpt-5.4-mini'];
const canvasContextModes = ['summary', 'image'];
const realtimeTransports = ['webrtc', 'websocket'];
const defaultRealtimeTransport = process.env.OPENAI_REALTIME_TRANSPORT || 'webrtc';

// Log only a fingerprint of the key. This makes environment debugging possible
// without leaking the full secret into terminal output or screenshots.
function maskedOpenAIKey() {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) return 'missing';
  if (key.length <= 12) return `present-but-too-short(length=${key.length})`;
  return `${key.slice(0, 7)}...${key.slice(-4)}(length=${key.length})`;
}

function requireLiveOpenAIKey(res) {
  const key = process.env.OPENAI_API_KEY || '';
  if (APP_MODE !== 'live') return true;
  if (!key) {
    res.status(500).json({ error: 'OPENAI_API_KEY is required in live mode' });
    return false;
  }
  if (!key.startsWith('sk-') || key.length < 40) {
    res.status(500).json({ error: `OPENAI_API_KEY looks invalid: ${maskedOpenAIKey()}` });
    return false;
  }
  return true;
}

function chooseAllowedModel(requested, allowed, fallback) {
  if (requested && allowed.includes(requested)) return requested;
  return fallback;
}

function logVerbose(message, ...args) {
  if (verboseLogs) console.log(message, ...args);
}

console.log(`[config] APP_VERSION=${packageJson.version}`);
console.log(`[config] APP_MODE=${APP_MODE}`);
console.log(`[config] OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? 'present' : 'missing'}`);
console.log(`[config] OPENAI_REALTIME_MODEL=${realtimeModel}`);
console.log(`[config] OPENAI_VISION_MODEL=${visionModel}`);
console.log(`[config] OPENAI_REALTIME_VOICE=${voice}`);
console.log(`[config] CANVAS_CONTEXT_MODE=${chooseAllowedModel(defaultCanvasContextMode, canvasContextModes, canvasContextModes[0])}`);

app.use(express.json({ limit: '12mb' }));
app.use(express.text({ type: ['application/sdp', 'text/plain'], limit: '2mb' }));

app.get('/api/config', (_req, res) => {
  res.json({
    mode: APP_MODE,
    version: packageJson.version,
    realtimeModels,
    realtimeTransports,
    visionModels,
    canvasContextModes,
    defaultRealtimeModel: chooseAllowedModel(realtimeModel, realtimeModels, realtimeModels[0]),
    defaultRealtimeTransport: chooseAllowedModel(defaultRealtimeTransport, realtimeTransports, realtimeTransports[0]),
    defaultVisionModel: chooseAllowedModel(visionModel, visionModels, visionModels[0]),
    defaultVoice: voice,
    defaultCanvasIntervalMs,
    defaultCanvasContextMode: chooseAllowedModel(defaultCanvasContextMode, canvasContextModes, canvasContextModes[0]),
    keyStatus: maskedOpenAIKey(),
  });
});

// The browser sends an SDP offer here. In live mode we forward that offer to
// OpenAI's Realtime WebRTC endpoint and return OpenAI's SDP answer to the
// browser. The browser then talks to OpenAI directly over WebRTC.
app.post('/api/realtime/session', async (req, res) => {
  const sdp = typeof req.body === 'string' ? req.body : req.body?.sdp;
  const model = chooseAllowedModel(req.query.model, realtimeModels, chooseAllowedModel(realtimeModel, realtimeModels, realtimeModels[0]));
  if (!sdp) return res.status(400).send('missing SDP offer');

  if (APP_MODE !== 'live') {
    res.type('application/sdp').send('v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Mock OpenAI Realtime Answer\r\n');
    return;
  }

  if (!requireLiveOpenAIKey(res)) return;
  console.log(`[realtime] creating call model=${model} voice=${voice}`);

  const fd = new FormData();
  fd.set('sdp', sdp);
  fd.set('session', JSON.stringify({
    type: 'realtime',
    model,
    instructions: 'You are a concise realtime AI companion. Greet the user and comment on canvas/game state updates.',
    audio: { output: { voice } },
  }));

  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Safety-Identifier': 'local-demo-user',
      },
      body: fd,
    });

    const answer = await upstream.text();
    console.log(`[realtime] OpenAI status=${upstream.status}`);
    if (!upstream.ok) {
      console.error(`[realtime] OpenAI error response ${answer}`);
      res.status(upstream.status).json({ error: 'OpenAI realtime call failed', status: upstream.status, body: answer });
      return;
    }
    res.status(upstream.status).type('application/sdp').send(answer);
  } catch (error) {
    console.error('[realtime] request failed', error);
    res.status(502).json({ error: 'OpenAI realtime request failed', detail: String(error?.message || error) });
  }
});

// Summary context mode intentionally handles canvas images outside the Realtime
// audio session. This endpoint turns a potentially large PNG data URL into a short
// text summary. Image context mode skips this endpoint and sends the image over
// the Realtime data channel instead.
app.post('/api/vision/describe', async (req, res) => {
  const { imageDataUrl } = req.body || {};
  const selectedVisionModel = chooseAllowedModel(req.body?.model, visionModels, chooseAllowedModel(visionModel, visionModels, visionModels[0]));
  if (!imageDataUrl) return res.status(400).json({ error: 'imageDataUrl is required' });

  if (APP_MODE !== 'live') {
    res.json({ summary: `На канве появился пользовательский рисунок: линии и штрихи. vision_model=${selectedVisionModel}` });
    return;
  }

  if (!requireLiveOpenAIKey(res)) return;
  logVerbose(`[vision] describing canvas with model=${selectedVisionModel} imageBytes=${imageDataUrl.length}`);

  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedVisionModel,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe this canvas drawing in one short Russian sentence for a realtime voice companion.' },
            { type: 'input_image', image_url: imageDataUrl },
          ],
        }],
      }),
    });
    const text = await upstream.text();
    logVerbose(`[vision] OpenAI status=${upstream.status}`);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    if (!upstream.ok) {
      console.error('[vision] OpenAI error response', data || text);
      res.status(upstream.status).json({ error: 'OpenAI vision request failed', status: upstream.status, body: data || text });
      return;
    }
    const summary = data?.output_text || data?.output?.flatMap(o => o.content || []).map(c => c.text).filter(Boolean).join(' ');
    if (!summary) {
      console.error(`[vision] OpenAI response had no summary body=${text}`);
      res.status(502).json({ error: 'OpenAI vision response had no summary', body: text });
      return;
    }
    logVerbose(`[vision] OpenAI summary=${summary}`);
    res.json({ summary });
  } catch (error) {
    console.error('[vision] request failed', error);
    res.status(502).json({ error: 'OpenAI vision request failed', detail: String(error?.message || error) });
  }
});

app.use(express.static(path.join(root, 'public')));
app.use('/src', express.static(path.join(root, 'src')));

function safeSend(socket, event) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

// The browser connects to our server instead of OpenAI directly for two reasons:
// the standard API key must never enter browser memory, and `app.turn` is our own
// correlation envelope rather than an OpenAI protocol event. This proxy owns both
// responsibilities: authenticate upstream and unwrap application metadata.
export function attachRealtimeWebSocketServer(server, {
  appMode = APP_MODE,
  openAIKey = process.env.OPENAI_API_KEY || '',
  upstreamWebSocketUrl = process.env.OPENAI_REALTIME_WS_URL || 'wss://api.openai.com/v1/realtime',
  verbose = verboseLogs,
  logger = console,
} = {}) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/realtime/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (browserSocket) => {
      wss.emit('connection', browserSocket, request);
    });
  });

  wss.on('connection', (browserSocket, request) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const model = chooseAllowedModel(requestUrl.searchParams.get('model'), realtimeModels, realtimeModels[0]);
    if (appMode !== 'live') {
      safeSend(browserSocket, { type: 'error', error: { message: 'WebSocket transport requires live mode' } });
      browserSocket.close(1008, 'live mode required');
      return;
    }
    if (!openAIKey) {
      safeSend(browserSocket, { type: 'error', error: { message: 'OPENAI_API_KEY is required in live mode' } });
      browserSocket.close(1008, 'missing OpenAI key');
      return;
    }

    const upstreamUrl = new URL(upstreamWebSocketUrl);
    upstreamUrl.searchParams.set('model', model);
    if (verbose) {
      logger.log(`[realtime/ws] connecting model=${model} upstream=${upstreamUrl.origin}${upstreamUrl.pathname}`);
    }
    // Authentication exists only on this server-to-OpenAI hop. The GA Realtime
    // endpoint must not receive the retired `OpenAI-Beta: realtime=v1` header.
    const upstream = new WebSocket(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${openAIKey}`,
      },
    });
    // Browser setup can finish before the upstream TLS/WebSocket handshake. Keep
    // those first events in order instead of dropping session instructions or the
    // beginning of the user's first utterance.
    const pendingBrowserMessages = [];
    // `app.turn` is removed before forwarding, so correlated event IDs preserve
    // the turn boundary in OpenAI diagnostics without sending unknown fields.
    const turnEventCounts = new Map();

    upstream.on('open', () => {
      if (verbose) logger.log(`[realtime/ws] OpenAI connected model=${model}`);
      for (const raw of pendingBrowserMessages.splice(0)) upstream.send(raw);
    });
    upstream.on('message', (raw) => {
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(raw.toString());
    });
    upstream.on('error', (error) => {
      logger.error('[realtime/ws] OpenAI error', error);
      safeSend(browserSocket, { type: 'error', error: { message: error.message } });
    });
    upstream.on('close', (code, reason) => {
      if (verbose) logger.log(`[realtime/ws] OpenAI closed code=${code} reason=${reason.toString()}`);
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, 'upstream closed');
    });

    browserSocket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        safeSend(browserSocket, { type: 'error', error: { message: 'Invalid JSON event' } });
        return;
      }

      const protocolEvents = message.type === 'app.turn' ? message.events : [message];
      if (!Array.isArray(protocolEvents) || protocolEvents.length === 0) {
        safeSend(browserSocket, { type: 'error', error: { message: 'app.turn requires events' } });
        return;
      }
      const turnId = message.type === 'app.turn' ? String(message.turn_id || '') : '';
      if (message.type === 'app.turn' && !turnId) {
        safeSend(browserSocket, { type: 'error', error: { message: 'app.turn requires turn_id' } });
        return;
      }
      protocolEvents.forEach((event, index) => {
        const eventNumber = (turnEventCounts.get(turnId) || 0) + index + 1;
        const forwarded = turnId && !event.event_id
          ? { ...event, event_id: `${turnId}:${eventNumber}` }
          : event;
        const payload = JSON.stringify(forwarded);
        if (upstream.readyState === WebSocket.OPEN) upstream.send(payload);
        else pendingBrowserMessages.push(payload);
      });
      if (turnId) turnEventCounts.set(turnId, (turnEventCounts.get(turnId) || 0) + protocolEvents.length);
      if (turnId) {
        // Audio produces dozens of append groups per utterance. Logging every one
        // hides lifecycle and error messages, so detailed forwarding is opt-in.
        if (verbose) {
          logger.log(`[realtime/ws] forwarded turn=${turnId} events=${protocolEvents.map((event) => event.type).join(',')}`);
        }
        safeSend(browserSocket, {
          type: 'app.turn.forwarded',
          turn_id: turnId,
          context: message.context || {},
          event_types: protocolEvents.map((event) => event.type),
        });
      }
    });

    browserSocket.on('close', () => {
      if (upstream.readyState === WebSocket.CONNECTING || upstream.readyState === WebSocket.OPEN) upstream.close();
    });
  });

  return wss;
}

export function createRealtimeHttpServer(options) {
  const server = createServer(app);
  attachRealtimeWebSocketServer(server, options);
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = createRealtimeHttpServer();
  server.listen(PORT, () => {
    console.log(`realtime-canvas-companion listening on http://localhost:${PORT} in ${APP_MODE} mode`);
  });
}

export default app;
