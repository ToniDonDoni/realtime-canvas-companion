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
      }
      async resume() { window.__audioEvents.push('audio-context-resumed'); }
      createOscillator() { return new FakeOscillator(); }
      createGain() { return new FakeGain(); }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });
}

test('AC-FR001-1 visible controls are available on first load', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Realtime Canvas Companion' })).toBeVisible();
  await expect(page.getByLabel('Model')).toBeVisible();
  await expect(page.getByLabel('Canvas send interval')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();
  await expect(page.getByLabel('Drawing canvas')).toBeVisible();
  await expect(page.getByText('mode: mock')).toBeVisible();
  await expect(page.getByRole('list')).toContainText('app ready');
});

test('AC-FR002 call connects, greets with audio, and stop disconnects', async ({ page }) => {
  await installBrowserAudioInstrumentation(page);
  await page.goto('/');
  await page.getByLabel('Model').selectOption('gpt-realtime-2.1');
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

  await expect(page.locator('#eventLog li').first()).toContainText('drawing changed');
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
