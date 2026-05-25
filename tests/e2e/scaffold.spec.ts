import { expect, test } from '@playwright/test';

test('renders the Pixi stage and updates the HUD after dragging a sprite', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Penguin Party' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('[data-selected-token]')).toHaveText('Ready');
  await expect(page.locator('[data-position-readout]')).toHaveText('0, 0');

  const canvasBox = await page.locator('canvas').boundingBox();
  expect(canvasBox).not.toBeNull();

  if (!canvasBox) {
    throw new Error('Canvas was visible but did not have a bounding box.');
  }

  const start = {
    x: canvasBox.x + 134,
    y: canvasBox.y + 268,
  };
  const end = {
    x: canvasBox.x + 420,
    y: canvasBox.y + 450,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('[data-selected-token]')).toHaveText('Penguin 1');
  await expect(page.locator('[data-position-readout]')).not.toHaveText('0, 0');
  expect(consoleErrors).toEqual([]);
});
