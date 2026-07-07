import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const app = express();

const PORT = Number(process.env.PORT || 5179);
const APP_MODE = process.env.APP_MODE || 'mock';
const realtimeModel = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
const visionModel = process.env.OPENAI_VISION_MODEL || 'gpt-5.1-mini';
const voice = process.env.OPENAI_REALTIME_VOICE || 'marin';
const defaultCanvasIntervalMs = Number(process.env.CANVAS_SEND_INTERVAL_MS || 5000);

app.use(express.json({ limit: '12mb' }));
app.use(express.text({ type: ['application/sdp', 'text/plain'], limit: '2mb' }));

app.get('/api/config', (_req, res) => {
  res.json({
    mode: APP_MODE,
    realtimeModels: ['gpt-realtime-2.1', 'gpt-realtime-mini', 'gpt-realtime'],
    defaultRealtimeModel: realtimeModel,
    defaultVoice: voice,
    defaultCanvasIntervalMs,
  });
});

app.post('/api/realtime/session', async (req, res) => {
  const sdp = typeof req.body === 'string' ? req.body : req.body?.sdp;
  const model = req.query.model || realtimeModel;
  if (!sdp) return res.status(400).send('missing SDP offer');

  if (APP_MODE !== 'live') {
    res.type('application/sdp').send('v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Mock OpenAI Realtime Answer\r\n');
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY is required in live mode' });
    return;
  }

  const fd = new FormData();
  fd.set('sdp', sdp);
  fd.set('session', JSON.stringify({
    type: 'realtime',
    model,
    instructions: 'You are a concise realtime AI companion. Greet the user and comment on canvas/game state updates.',
    audio: { output: { voice } },
  }));

  const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Safety-Identifier': 'local-demo-user',
    },
    body: fd,
  });

  const answer = await upstream.text();
  res.status(upstream.status).type('application/sdp').send(answer);
});

app.post('/api/vision/describe', async (req, res) => {
  const { imageDataUrl } = req.body || {};
  if (!imageDataUrl) return res.status(400).json({ error: 'imageDataUrl is required' });

  if (APP_MODE !== 'live') {
    res.json({ summary: 'На канве появился пользовательский рисунок: линии и штрихи.' });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY is required in live mode' });
    return;
  }

  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: visionModel,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe this canvas drawing in one short Russian sentence for a realtime voice companion.' },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      }],
    }),
  });
  const data = await upstream.json();
  const summary = data.output_text || data.output?.flatMap(o => o.content || []).map(c => c.text).filter(Boolean).join(' ') || 'Canvas frame received.';
  res.status(upstream.status).json({ summary });
});

app.use(express.static(path.join(root, 'public')));
app.use('/src', express.static(path.join(root, 'src')));

if (process.env.NODE_ENV !== 'test-import') {
  app.listen(PORT, () => {
    console.log(`realtime-canvas-companion listening on http://localhost:${PORT} in ${APP_MODE} mode`);
  });
}

export default app;
