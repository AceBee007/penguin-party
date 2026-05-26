import { expect, test, type Page } from '@playwright/test';

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

  await page.goto('/?mode=local-test');

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

  const invalidMove = await getFirstLegalDrag(page);
  expect(invalidMove).not.toBeNull();

  if (!invalidMove) {
    throw new Error('Expected a legal drag move.');
  }

  await page.mouse.move(canvasBox.x + invalidMove.startX, canvasBox.y + invalidMove.startY);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + invalidMove.startX + 12, canvasBox.y + invalidMove.startY - 8, { steps: 4 });
  await page.mouse.up();

  await expect(page.locator('[data-board-count]')).toHaveText('0');
  await expect(page.locator('[data-active-player]')).toHaveText('You');
  await expect(page.locator('[data-target-readout]')).toHaveText('Returned to hand');
  await expect.poll(() => getStageCounts(page)).toEqual({
    handCards: 18,
    handLayerChildren: 18,
    dragLayerChildren: 0,
  });

  const validMove = await getFirstLegalDrag(page);
  expect(validMove).not.toBeNull();

  if (!validMove) {
    throw new Error('Expected a legal drag move after invalid drop reset.');
  }

  await page.mouse.move(canvasBox.x + validMove.startX, canvasBox.y + validMove.startY);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + validMove.endX, canvasBox.y + validMove.endY, { steps: 12 });
  await expect(page.locator('[data-target-readout]')).not.toHaveText('No target');
  await page.mouse.up();

  await expect(page.locator('[data-board-count]')).toHaveText('1');
  await expect(page.locator('[data-active-player]')).toHaveText('Player 2');
  await expect(page.locator('[data-revision]')).not.toHaveText('1');

  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

async function getFirstLegalDrag(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_STAGE_DEBUG__ as
      | {
          handCards: Array<{
            centerX: number;
            centerY: number;
            targets: Array<{ centerX: number; centerY: number }>;
          }>;
        }
      | undefined;
    const card = debug?.handCards.find((candidate) => candidate.targets.length > 0);
    const target = card?.targets[0];

    return card && target
      ? {
          startX: card.centerX,
          startY: card.centerY,
          endX: target.centerX,
          endY: target.centerY,
        }
      : null;
  });
}

async function getStageCounts(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_STAGE_DEBUG__ as
      | {
          handCards: unknown[];
          handLayerChildren: number;
          dragLayerChildren: number;
        }
      | undefined;

    return {
      handCards: debug?.handCards.length ?? -1,
      handLayerChildren: debug?.handLayerChildren ?? -1,
      dragLayerChildren: debug?.dragLayerChildren ?? -1,
    };
  });
}
