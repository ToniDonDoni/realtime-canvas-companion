import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
const realtimeModels = ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'];
const visionModels = ['gpt-5.4-nano', 'gpt-5.4-mini'];

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

console.log(`[config] APP_VERSION=${packageJson.version}`);
console.log(`[config] APP_MODE=${APP_MODE}`);
console.log(`[config] OPENAI_API_KEY=${maskedOpenAIKey()}`);
console.log(`[config] OPENAI_REALTIME_MODEL=${realtimeModel}`);
console.log(`[config] OPENAI_VISION_MODEL=${visionModel}`);
console.log(`[config] OPENAI_REALTIME_VOICE=${voice}`);

app.use(express.json({ limit: '12mb' }));
app.use(express.text({ type: ['application/sdp', 'text/plain'], limit: '2mb' }));

app.get('/api/config', (_req, res) => {
  res.json({
    mode: APP_MODE,
    version: packageJson.version,
    realtimeModels,
    visionModels,
    defaultRealtimeModel: chooseAllowedModel(realtimeModel, realtimeModels, realtimeModels[0]),
    defaultVisionModel: chooseAllowedModel(visionModel, visionModels, visionModels[0]),
    defaultVoice: voice,
    defaultCanvasIntervalMs,
    keyStatus: maskedOpenAIKey(),
  });
});

app.post('/api/realtime/session', async (req, res) => {
  const sdp = typeof req.body === 'string' ? req.body : req.body?.sdp;
  const model = chooseAllowedModel(req.query.model, realtimeModels, chooseAllowedModel(realtimeModel, realtimeModels, realtimeModels[0]));
  if (!sdp) return res.status(400).send('missing SDP offer');

  if (APP_MODE !== 'live') {
    res.type('application/sdp').send('v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Mock OpenAI Realtime Answer\r\n');
    return;
  }

  if (!requireLiveOpenAIKey(res)) return;
  console.log(`[realtime] creating call model=${model} voice=${voice} key=${maskedOpenAIKey()}`);

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

app.post('/api/vision/describe', async (req, res) => {
  const { imageDataUrl } = req.body || {};
  const selectedVisionModel = chooseAllowedModel(req.body?.model, visionModels, chooseAllowedModel(visionModel, visionModels, visionModels[0]));
  if (!imageDataUrl) return res.status(400).json({ error: 'imageDataUrl is required' });

  if (APP_MODE !== 'live') {
    res.json({ summary: `На канве появился пользовательский рисунок: линии и штрихи. vision_model=${selectedVisionModel}` });
    return;
  }

  if (!requireLiveOpenAIKey(res)) return;
  console.log(`[vision] describing canvas with model=${selectedVisionModel} key=${maskedOpenAIKey()} imageBytes=${imageDataUrl.length}`);

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
    console.log(`[vision] OpenAI status=${upstream.status}`);
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
    console.log(`[vision] OpenAI summary=${summary}`);
    res.json({ summary });
  } catch (error) {
    console.error('[vision] request failed', error);
    res.status(502).json({ error: 'OpenAI vision request failed', detail: String(error?.message || error) });
  }
});

app.use(express.static(path.join(root, 'public')));
app.use('/src', express.static(path.join(root, 'src')));

if (process.env.NODE_ENV !== 'test-import') {
  app.listen(PORT, () => {
    console.log(`realtime-canvas-companion listening on http://localhost:${PORT} in ${APP_MODE} mode`);
  });
}

export default app;
