import { expect, test } from '@playwright/test';

test('renders the local Pixi game and commits a drag/drop move', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Penguin Party' })).toBeVisible();
  await expect(page.getByText('Local verification mode')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('[data-active-player]')).toHaveText('You');
  await expect(page.locator('[data-board-count]')).toHaveText('0');

  const canvas = page.locator('canvas');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  if (!canvasBox) {
    throw new Error('Canvas was visible but did not have a bounding box.');
  }

  const dataUrlLength = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL('image/png').length);
  expect(dataUrlLength).toBeGreaterThan(1000);

  const start = {
    x: canvasBox.x + Math.max(48, canvasBox.width * 0.08),
    y: canvasBox.y + canvasBox.height * 0.9,
  };
  const end = {
    x: canvasBox.x + canvasBox.width * 0.5,
    y: canvasBox.y + canvasBox.height * 0.55,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(page.locator('[data-target-readout]')).not.toHaveText('No target');
  await page.mouse.up();

  await expect(page.locator('[data-board-count]')).toHaveText('1');
  await expect(page.locator('[data-active-player]')).toHaveText('Player 2');
  await expect(page.locator('[data-revision]')).not.toHaveText('1');

  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
