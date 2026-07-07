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
  await expect(page.getByRole('list')).toContainText('canvas frame sent', { timeout: 2500 });
  await expect(page.getByRole('list')).toContainText('sent: scene_summary.sent');
  await expect(page.getByRole('list')).toContainText('assistant: Вижу рисунок');
  await expect.poll(() => page.evaluate(() => window.__audioEvents.filter(e => e === 'oscillator-start').length)).toBeGreaterThanOrEqual(2);
});
