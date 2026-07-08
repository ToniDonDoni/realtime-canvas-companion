import { test, expect } from '@playwright/test';

async function installBrowserAudioInstrumentation(page) {
  await page.addInitScript(() => {
    window.__audioEvents = [];
    class FakeGain {
      constructor() { this.gain = { value: 1 }; }
      connect() { window.__audioEvents.push('gain-connect'); }
    }
    class FakeOscillator {
      constructor() { this.frequency = { value: 0 }; }
      connect() { window.__audioEvents.push('oscillator-connect'); }
      start() { window.__audioEvents.push('oscillator-start'); }
      stop() { window.__audioEvents.push('oscillator-stop'); }
    }
    class FakeAudioContext {
      constructor() {
        window.__audioEvents.push('audio-context-created');
        this.destination = {};
        this.currentTime = 0;
        this.sampleRate = 48000;
      }
      async resume() { window.__audioEvents.push('audio-context-resumed'); }
      createOscillator() { return new FakeOscillator(); }
      createGain() { return new FakeGain(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() {
        const processor = { onaudioprocess: null, connect() {}, disconnect() {} };
        window.__fakeScriptProcessor = processor;
        return processor;
      }
      async close() {}
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });
}


async function firstLogText(page) {
  return page.locator('#eventLog li').first().innerText();
}

async function expectTimestampedLogEntry(locator, messagePart) {
  await expect(locator).toContainText(messagePart);
  await expect(locator).toHaveText(/^\[\d{2}:\d{2}:\d{2}\] /);
}

test('AC-FR001-1 visible controls are available on first load', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Realtime Canvas Companion' })).toBeVisible();
  await expect(page.getByLabel('Model', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Canvas send interval')).toBeVisible();
  await expect(page.getByLabel('Canvas context mode')).toBeVisible();
  await expect(page.getByLabel('Canvas context mode')).toHaveValue('summary');
  await expect(page.getByLabel('Realtime engine')).toHaveValue('webrtc');
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();
  await expect(page.getByLabel('Drawing canvas')).toBeVisible();
  await expect(page.getByText('mode: mock')).toBeVisible();
  await expect(page.locator('#versionBadge')).toHaveText('version: 0.3.2');
  await expect(page.getByRole('list')).toContainText('app version: 0.3.2');
  await expect(page.getByRole('list')).toContainText('app ready');
  await expectTimestampedLogEntry(page.locator('#eventLog li').first(), 'app ready');
  await expect(page.locator('#eventLog')).toHaveCSS('list-style-type', 'none');
});

test('AC-FR018 WebSocket engine selector creates grouped contextual turns', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.addInitScript(() => {
    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      constructor(url) {
        super();
        this.url = url;
        this.readyState = FakeWebSocket.OPEN;
        this.sent = [];
        window.__lastFakeWebSocket = this;
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(raw) { this.sent.push(JSON.parse(raw)); }
      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent('close'));
      }
    }
    window.WebSocket = FakeWebSocket;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
  });
  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'live',
        version: '0.3.2',
        realtimeModels: ['gpt-realtime-2.1-mini'],
        realtimeTransports: ['webrtc', 'websocket'],
        defaultRealtimeTransport: 'webrtc',
        visionModels: ['gpt-5.4-nano'],
        canvasContextModes: ['summary', 'image'],
        defaultRealtimeModel: 'gpt-realtime-2.1-mini',
        defaultVisionModel: 'gpt-5.4-nano',
        defaultVoice: 'marin',
        defaultCanvasIntervalMs: 1000,
        defaultCanvasContextMode: 'summary',
        keyStatus: 'test-key',
      }),
    });
  });
  await page.route('**/api/vision/describe', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summary: 'A red square in the canvas center.' }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Realtime engine').selectOption('websocket');
  await expect(page.locator('#eventLog li').first()).toContainText('realtime engine selected: websocket');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');
  await expect(page.getByRole('list')).toContainText('connected via websocket');
  expect(await page.evaluate(() => window.__lastFakeWebSocket.url)).toContain('/api/realtime/ws?model=');

  await drawStroke(page, 100, 100, 220, 180);
  await expect(page.getByRole('list')).toContainText('sent: scene_summary.sent', { timeout: 2500 });
  const contextualTurn = await page.evaluate(() => window.__lastFakeWebSocket.sent.find((event) => (
    event.type === 'app.turn' && event.context?.screen_summary
  )));
  expect(contextualTurn.turn_id).toMatch(/^turn-/);
  expect(contextualTurn.context.screen_summary).toBe('A red square in the canvas center.');
  expect(contextualTurn.events.map((event) => event.type)).toEqual([
    'conversation.item.create',
    'response.create',
  ]);

  await page.evaluate(() => {
    const voiced = new Float32Array(4096).fill(0.1);
    window.__fakeScriptProcessor.onaudioprocess({ inputBuffer: { getChannelData: () => voiced } });
  });
  await page.waitForTimeout(750);
  await page.evaluate(() => {
    const silence = new Float32Array(4096);
    window.__fakeScriptProcessor.onaudioprocess({ inputBuffer: { getChannelData: () => silence } });
  });
  const audioTurns = await page.evaluate(() => window.__lastFakeWebSocket.sent.filter((event) => (
    event.type === 'app.turn' && event.events.some((item) => item.type.startsWith('input_audio_buffer.'))
  )));
  expect(audioTurns.length).toBeGreaterThanOrEqual(2);
  expect(new Set(audioTurns.map((turn) => turn.turn_id)).size).toBe(1);
  expect(audioTurns[0].context.screen_summary).toBe('A red square in the canvas center.');
  expect(audioTurns.flatMap((turn) => turn.events).map((event) => event.type)).toEqual([
    'conversation.item.create',
    'input_audio_buffer.append',
    'input_audio_buffer.append',
    'input_audio_buffer.commit',
    'response.create',
  ]);

  await page.evaluate(() => window.__lastFakeWebSocket.close());
  await expect(page.locator('#statusBadge')).toHaveText('disconnected');
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();
  expect(await page.evaluate(() => window.__fakeScriptProcessor.onaudioprocess === null)).toBe(true);
});

test('AC-FR002 call connects, greets with audio, and stop disconnects', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.goto('/');
  await page.getByLabel('Model', { exact: true }).selectOption('gpt-realtime-2.1');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.locator('#statusBadge')).toHaveText('connected');
  await expect(page.getByRole('list')).toContainText('connected with model gpt-realtime-2.1');
  await expect(page.getByRole('list')).toContainText('assistant: Привет');
  await expect(page.locator('#eventLog li').first()).toContainText('assistant: Привет');
  await expect.poll(() => page.evaluate(() => window.__audioEvents)).toContain('oscillator-start');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();
  await expect(page.locator('#statusBadge')).toHaveText('disconnected');
});

test('AC-FR003/004 drawing sends canvas frame on selected cadence and assistant comments with audio', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.goto('/');
  await page.getByLabel('Canvas send interval').selectOption('1000');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');

  const canvas = page.getByLabel('Drawing canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 180, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole('list')).toContainText('drawing changed');
  await expect(page.getByRole('list')).toContainText('canvas frame sent (interval: 1000ms)', { timeout: 2500 });
  await expect(page.getByRole('list')).toContainText('sent: scene_summary.sent');
  await expect(page.getByRole('list')).toContainText('assistant: Вижу рисунок');
  await expect.poll(() => page.evaluate(() => window.__audioEvents.filter(e => e === 'oscillator-start').length)).toBeGreaterThanOrEqual(2);
});


test('AC-FR005 newest log entries appear first and interval changes affect canvas send cadence', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  let visionDescribeRequests = 0;
  await page.route('**/api/vision/describe', async (route) => {
    visionDescribeRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summary: 'Тестовый рисунок получен.' }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Canvas send interval').selectOption('10000');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');

  const canvas = page.getByLabel('Drawing canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 120, { steps: 4 });
  await page.mouse.up();

  await expect(page.getByRole('list')).toContainText('drawing changed');
  await page.waitForTimeout(1500);
  expect(visionDescribeRequests).toBe(0);

  await page.getByLabel('Canvas send interval').selectOption('1000');
  await expect(page.locator('#eventLog li').first()).toContainText('canvas send interval changed to 1000ms');
  await expect(page.getByRole('list')).toContainText('canvas frame sent (interval: 1000ms)', { timeout: 2500 });
  await expect.poll(() => visionDescribeRequests).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#eventLog li').first()).toContainText('assistant: Вижу рисунок');
});

async function nonEmptyCanvasPixelCount(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#drawingCanvas');
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) count += 1;
    }
    return count;
  });
}

async function drawStroke(page, fromX, fromY, toX, toY) {
  const canvas = page.getByLabel('Drawing canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + fromX, box.y + fromY);
  await page.mouse.down();
  await page.mouse.move(box.x + toX, box.y + toY, { steps: 12 });
  await page.mouse.up();
}


test('AC-FR008 event log is timestamped, unnumbered, and newest-first', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.goto('/');
  await expectTimestampedLogEntry(page.locator('#eventLog li').first(), 'app ready');
  await expect(page.locator('#eventLog')).toHaveCSS('list-style-type', 'none');

  const firstBefore = await firstLogText(page);
  expect(firstBefore).toMatch(/^\[\d{2}:\d{2}:\d{2}\] app ready$/);
  expect(firstBefore).not.toMatch(/^\s*\d+\./);

  const canvas = page.getByLabel('Drawing canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 4 });
  await page.mouse.up();

  const newest = await firstLogText(page);
  expect(newest).toMatch(/^\[\d{2}:\d{2}:\d{2}\] drawing changed$/);
  expect(newest).not.toMatch(/^\s*\d+\./);
});

test('AC-FR007 draw, erase, and clear controls affect the visible canvas through user actions', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.goto('/');

  await expect(page.getByRole('radio', { name: 'Draw' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Erase' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Draw' })).toBeChecked();

  await drawStroke(page, 80, 80, 360, 230);
  const afterDraw = await nonEmptyCanvasPixelCount(page);
  expect(afterDraw).toBeGreaterThan(0);
  await expect(page.locator('#eventLog li').first()).toContainText('drawing changed');

  await page.getByRole('radio', { name: 'Erase' }).check();
  await expect(page.locator('#eventLog li').first()).toContainText('canvas mode changed to erase');
  await drawStroke(page, 80, 80, 360, 230);
  const afterErase = await nonEmptyCanvasPixelCount(page);
  expect(afterErase).toBeLessThan(afterDraw);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('#eventLog li').first()).toContainText('canvas cleared');
  await expect.poll(() => nonEmptyCanvasPixelCount(page)).toBe(0);
});


test('AC-FR012 app version is visible on screen and in the event log', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.goto('/');

  await expect(page.locator('#versionBadge')).toHaveText('version: 0.3.2');
  await expect(page.getByRole('list')).toContainText('app version: 0.3.2');
});

async function installFakeWebRTC(page) {
  await page.addInitScript(() => {
    class FakeDataChannel extends EventTarget {
      constructor(maxMessageSize) {
        super();
        this.readyState = 'open';
        this.sent = [];
        this.maxMessageSize = maxMessageSize;
      }
      send(value) {
        if (String(value).length > this.maxMessageSize) {
          throw new TypeError('Trying to send message larger than max-message-size');
        }
        this.sent.push(value);
      }
      close() { this.readyState = 'closed'; }
    }
    class FakeRTCPeerConnection extends EventTarget {
      constructor() {
        super();
        this.localDescription = null;
        this.remoteDescription = null;
        this.sctp = { maxMessageSize: 65536 };
        window.__lastFakePeerConnection = this;
      }
      addTrack() {}
      createDataChannel() {
        this.dc = new FakeDataChannel(this.sctp.maxMessageSize);
        return this.dc;
      }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\ns=fake-offer\r\n' }; }
      async setLocalDescription(offer) { this.localDescription = offer; }
      async setRemoteDescription(answer) { this.remoteDescription = answer; }
      close() {}
    }
    window.RTCPeerConnection = FakeRTCPeerConnection;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }],
        }),
      },
    });
  });
}

test('AC-FR009 realtime model selector is used when opening a live WebRTC session', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await installFakeWebRTC(page);
  let requestedRealtimeModel;

  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'live',
        version: '0.3.2',
        realtimeModels: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
        visionModels: ['gpt-5.4-nano', 'gpt-5.4-mini'],
        defaultRealtimeModel: 'gpt-realtime-2.1-mini',
        defaultVisionModel: 'gpt-5.4-nano',
        defaultVoice: 'marin',
        defaultCanvasIntervalMs: 5000,
        canvasContextModes: ['summary', 'image'],
        defaultCanvasContextMode: 'summary',
        keyStatus: 'test-key',
      }),
    });
  });
  await page.route('**/api/realtime/session**', async (route) => {
    requestedRealtimeModel = new URL(route.request().url()).searchParams.get('model');
    await route.fulfill({ status: 201, contentType: 'application/sdp', body: 'v=0\r\ns=fake-answer\r\n' });
  });

  await page.goto('/');
  await page.getByLabel('Model', { exact: true }).selectOption('gpt-realtime-2.1');
  await expect(page.locator('#eventLog li').first()).toContainText('realtime model selected: gpt-realtime-2.1');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');
  expect(requestedRealtimeModel).toBe('gpt-realtime-2.1');
});

test('AC-FR014 Realtime server events are visible in the event log', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await installFakeWebRTC(page);

  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'live',
        version: '0.3.2',
        realtimeModels: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
        visionModels: ['gpt-5.4-nano', 'gpt-5.4-mini'],
        defaultRealtimeModel: 'gpt-realtime-2.1-mini',
        defaultVisionModel: 'gpt-5.4-nano',
        defaultVoice: 'marin',
        defaultCanvasIntervalMs: 5000,
        canvasContextModes: ['summary', 'image'],
        defaultCanvasContextMode: 'summary',
        keyStatus: 'test-key',
      }),
    });
  });
  await page.route('**/api/realtime/session**', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/sdp', body: 'v=0\r\ns=fake-answer\r\n' });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');

  await page.evaluate(() => {
    window.__lastFakePeerConnection.dc.onmessage({
      data: JSON.stringify({
        type: 'input_audio_buffer.speech_started',
        event_id: 'evt_speech_started_test',
      }),
    });
    window.__lastFakePeerConnection.dc.onmessage({
      data: JSON.stringify({
        type: 'input_audio_buffer.speech_stopped',
        event_id: 'evt_speech_stopped_test',
      }),
    });
  });

  await expect(page.getByRole('list')).toContainText('server: input_audio_buffer.speech_started');
  await expect(page.getByRole('list')).toContainText('server: input_audio_buffer.speech_stopped');
  await expect(page.locator('#eventLog li').first()).toContainText('server: input_audio_buffer.speech_stopped');
});

test('AC-FR010 vision model selector is used for canvas describe requests', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  let requestedVisionModel;

  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'mock',
        version: '0.3.2',
        realtimeModels: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
        visionModels: ['gpt-5.4-nano', 'gpt-5.4-mini'],
        defaultRealtimeModel: 'gpt-realtime-2.1-mini',
        defaultVisionModel: 'gpt-5.4-nano',
        defaultVoice: 'marin',
        defaultCanvasIntervalMs: 1000,
        canvasContextModes: ['summary', 'image'],
        defaultCanvasContextMode: 'summary',
        keyStatus: 'mock',
      }),
    });
  });
  await page.route('**/api/vision/describe', async (route) => {
    requestedVisionModel = route.request().postDataJSON().model;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summary: `summary from ${requestedVisionModel}` }),
    });
  });

  await page.goto('/');
  await expect(page.getByLabel('Vision model')).toBeVisible();
  await page.getByLabel('Vision model').selectOption('gpt-5.4-mini');
  await expect(page.locator('#eventLog li').first()).toContainText('vision model selected: gpt-5.4-mini');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');
  await drawStroke(page, 90, 90, 250, 150);
  await expect(page.getByRole('list')).toContainText('canvas frame sent (interval: 1000ms)', { timeout: 2500 });
  await expect.poll(() => requestedVisionModel).toBe('gpt-5.4-mini');
  await expect(page.getByRole('list')).toContainText('vision summary: summary from gpt-5.4-mini');
});

test('AC-FR011 pasting an image replaces the canvas with aspect-fit content and white side margins', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5179' });
  await page.goto('/');

  await drawStroke(page, 40, 40, 600, 320);
  const afterDraw = await nonEmptyCanvasPixelCount(page);
  expect(afterDraw).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const source = document.createElement('canvas');
    source.width = 100;
    source.height = 300;
    const ctx = source.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, source.width, source.height);
    const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'));
    const item = new ClipboardItem({ 'image/png': blob });
    await navigator.clipboard.write([item]);
  });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await expect(page.locator('#eventLog li').first()).toContainText('image pasted into canvas');

  const samples = await page.evaluate(() => {
    const canvas = document.querySelector('#drawingCanvas');
    const ctx = canvas.getContext('2d');
    const pixel = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return {
      leftCenter: pixel(20, Math.floor(canvas.height / 2)),
      center: pixel(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)),
      rightCenter: pixel(canvas.width - 20, Math.floor(canvas.height / 2)),
    };
  });

  expect(samples.leftCenter).toEqual([255, 255, 255, 255]);
  expect(samples.rightCenter).toEqual([255, 255, 255, 255]);
  expect(samples.center[0]).toBeGreaterThan(220);
  expect(samples.center[1]).toBeLessThan(40);
  expect(samples.center[2]).toBeLessThan(40);
  expect(samples.center[3]).toBe(255);
});

test('AC-FR013 unchanged canvas frame is not resent to vision after a failed describe attempt', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  let visionDescribeRequests = 0;
  await page.route('**/api/vision/describe', async (route) => {
    visionDescribeRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'simulated vision failure' }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Canvas send interval').selectOption('1000');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');

  await drawStroke(page, 100, 120, 260, 190);
  await expect(page.getByRole('list')).toContainText('canvas frame sent (interval: 1000ms', { timeout: 2500 });
  await expect(page.getByRole('list')).toContainText('vision error:');

  await page.waitForTimeout(1600);
  expect(visionDescribeRequests).toBe(1);
  await expect(page.getByRole('list')).toContainText('canvas frame skipped (unchanged checksum:');

  await drawStroke(page, 300, 120, 420, 220);
  await expect.poll(() => visionDescribeRequests, { timeout: 2500 }).toBe(2);
});


test('AC-FR016 image context mode sends canvas snapshots directly over Realtime without vision summarize request', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await installFakeWebRTC(page);
  let visionDescribeRequests = 0;

  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'live',
        version: '0.3.2',
        realtimeModels: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
        visionModels: ['gpt-5.4-nano', 'gpt-5.4-mini'],
        canvasContextModes: ['summary', 'image'],
        defaultRealtimeModel: 'gpt-realtime-2.1-mini',
        defaultVisionModel: 'gpt-5.4-nano',
        defaultVoice: 'marin',
        defaultCanvasIntervalMs: 1000,
        defaultCanvasContextMode: 'summary',
        keyStatus: 'test-key',
      }),
    });
  });
  await page.route('**/api/realtime/session**', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/sdp', body: 'v=0\r\ns=fake-answer\r\n' });
  });
  await page.route('**/api/vision/describe', async (route) => {
    visionDescribeRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'vision should not be called in image mode' }),
    });
  });

  await page.goto('/');
  await page.getByLabel('Canvas context mode').selectOption('image');
  await expect(page.locator('#eventLog li').first()).toContainText('canvas context mode selected: image');
  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');

  await drawStroke(page, 100, 120, 260, 190);
  await expect(page.getByRole('list')).toContainText('canvas frame sent (interval: 1000ms', { timeout: 2500 });
  await expect(page.getByRole('list')).toContainText('sent: scene_image.sent');
  expect(visionDescribeRequests).toBe(0);

  const sentImageEvent = await page.evaluate(() => {
    const sent = window.__lastFakePeerConnection.dc.sent
      .map((value) => JSON.parse(value))
      .find((event) => event.type === 'conversation.item.create'
        && event.item?.content?.some((part) => part.type === 'input_image'));
    return sent;
  });
  expect(sentImageEvent.item.content[0].type).toBe('input_text');
  const imagePart = sentImageEvent.item.content.find((part) => part.type === 'input_image');
  expect(imagePart.image_url).toMatch(/^data:image\/jpeg;base64,/);
  const sentPayload = JSON.stringify(sentImageEvent);
  const maxMessageSize = await page.evaluate(() => window.__lastFakePeerConnection.sctp.maxMessageSize);
  expect(sentPayload.length).toBeLessThanOrEqual(Math.floor(maxMessageSize * 0.8));
});

async function emitRealtimeToolCall(page, name, args, callId = `${name}_test_call`) {
  await page.evaluate(({ name, args, callId }) => {
    window.__lastFakePeerConnection.dc.onmessage({
      data: JSON.stringify({
        type: 'response.function_call_arguments.done',
        name,
        call_id: callId,
        arguments: JSON.stringify(args),
      }),
    });
  }, { name, args, callId });
}

async function companionPawCenter(page) {
  return page.locator('#companionPaw').boundingBox().then((box) => {
    expect(box).not.toBeNull();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
}

test('AC-FR015 companion paw cursor is visible, starts centered, and realtime canvas tools move, draw, and erase', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await installFakeWebRTC(page);

  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'live',
        version: '0.3.2',
        realtimeModels: ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'],
        visionModels: ['gpt-5.4-nano', 'gpt-5.4-mini'],
        defaultRealtimeModel: 'gpt-realtime-2.1-mini',
        defaultVisionModel: 'gpt-5.4-nano',
        defaultVoice: 'marin',
        defaultCanvasIntervalMs: 5000,
        canvasContextModes: ['summary', 'image'],
        defaultCanvasContextMode: 'summary',
        keyStatus: 'test-key',
      }),
    });
  });
  await page.route('**/api/realtime/session**', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/sdp', body: 'v=0\r\ns=fake-answer\r\n' });
  });

  await page.goto('/');
  const canvasBox = await page.getByLabel('Drawing canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  await expect(page.getByLabel('Companion paw cursor')).toBeVisible();
  const initialPaw = await companionPawCenter(page);
  expect(Math.abs(initialPaw.x - (canvasBox.x + canvasBox.width / 2))).toBeLessThan(8);
  expect(Math.abs(initialPaw.y - (canvasBox.y + canvasBox.height / 2))).toBeLessThan(8);

  await page.getByRole('button', { name: 'Call' }).click();
  await expect(page.locator('#statusBadge')).toHaveText('connected');

  await emitRealtimeToolCall(page, 'canvas_cursor_move', { direction: 'up', distance_px: 40 }, 'move_paw_up');
  await expect(page.getByRole('list')).toContainText('sent: tool_output.sent');
  await expect(page.getByRole('list')).toContainText('tool: canvas_cursor_move up 40px');
  const movedPaw = await companionPawCenter(page);
  expect(movedPaw.y).toBeLessThan(initialPaw.y - 20);
  expect(await nonEmptyCanvasPixelCount(page)).toBe(0);

  await emitRealtimeToolCall(page, 'canvas_draw_line', { direction: 'right', distance_px: 140, color: '#ff66aa', line_width_px: 9 }, 'draw_pink_line');
  await expect(page.getByRole('list')).toContainText('tool: canvas_draw_line right 140px #ff66aa');
  const afterDraw = await nonEmptyCanvasPixelCount(page);
  expect(afterDraw).toBeGreaterThan(0);
  const afterDrawPaw = await companionPawCenter(page);
  expect(afterDrawPaw.x).toBeGreaterThan(movedPaw.x + 90);

  const pinkSample = await page.evaluate(() => {
    const canvas = document.querySelector('#drawingCanvas');
    const ctx = canvas.getContext('2d');
    return Array.from(ctx.getImageData(390, 140, 1, 1).data);
  });
  expect(pinkSample[0]).toBeGreaterThan(220);
  expect(pinkSample[1]).toBeGreaterThan(70);
  expect(pinkSample[2]).toBeGreaterThan(130);
  expect(pinkSample[3]).toBe(255);

  await emitRealtimeToolCall(page, 'canvas_erase_line', { direction: 'left', distance_px: 140, line_width_px: 32 }, 'erase_pink_line');
  await expect(page.getByRole('list')).toContainText('tool: canvas_erase_line left 140px');
  const afterErase = await nonEmptyCanvasPixelCount(page);
  expect(afterErase).toBeLessThan(afterDraw);
});
