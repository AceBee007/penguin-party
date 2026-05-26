import { expect, test, type Browser, type Page } from '@playwright/test';

test('syncs one host move and one joiner move over WebRTC DataChannel', async ({ browser }) => {
  const peerA = await openPeer(browser, { width: 1280, height: 720 });
  const peerB = await openPeer(browser, { width: 1280, height: 720 });

  try {
    await peerA.page.goto('/');
    await peerB.page.goto('/');

    await enterMatchmaking(peerA.page, 'Peer A');
    await enterMatchmaking(peerB.page, 'Peer B');
    await createRoom(peerA.page);
    await expect(peerA.page.locator('[data-room-id]')).toBeVisible();
    const roomId = (await peerA.page.locator('[data-room-id]').textContent())?.trim();

    if (!roomId) {
      throw new Error('Peer A did not create a room code.');
    }

    await joinRoomFromList(peerB.page, roomId);

    await expect(peerA.page.locator('[data-channel-state]')).toHaveText('Open', { timeout: 15000 });
    await expect(peerB.page.locator('[data-channel-state]')).toHaveText('Open', { timeout: 15000 });
    await expect(peerA.page.locator('[data-player-count]')).toHaveText('2');
    await peerA.page.locator('[data-start-game]').click();

    await expect(peerA.page.locator('canvas')).toBeVisible();
    await expect(peerB.page.locator('canvas')).toBeVisible();
    await expect(peerA.page.locator('[data-state-hash]')).not.toHaveText('none');
    await expect(peerB.page.locator('[data-state-hash]')).not.toHaveText('none');
    await expect(peerA.page.locator('[data-active-player]')).toHaveText('Peer A');
    await expect(peerB.page.locator('[data-active-player]')).toHaveText('Peer A');

    await dragCard(peerA.page, 0);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('1');
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('1');
    await expect(peerA.page.locator('[data-active-player]')).toHaveText('Peer B');
    await expect(peerB.page.locator('[data-active-player]')).toHaveText('Peer B');
    await expect(peerB.page.locator('[data-state-hash]')).toHaveText(await peerA.page.locator('[data-state-hash]').innerText());

    await dragCard(peerB.page, -0.13);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('2');
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('2');
    await expect(peerA.page.locator('[data-active-player]')).toHaveText('Peer A');
    await expect(peerB.page.locator('[data-active-player]')).toHaveText('Peer A');
    await expect(peerB.page.locator('[data-state-hash]')).toHaveText(await peerA.page.locator('[data-state-hash]').innerText());

    expect(peerA.consoleErrors).toEqual([]);
    expect(peerB.consoleErrors).toEqual([]);
    expect(peerA.failedRequests).toEqual([]);
    expect(peerB.failedRequests).toEqual([]);
  } finally {
    await peerA.context.close();
    await peerB.context.close();
  }
});

async function openPeer(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
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

  return { context, page, consoleErrors, failedRequests };
}

async function enterMatchmaking(page: Page, name: string) {
  await page.locator('[data-player-name]').fill(name);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('[data-room-list]')).toBeVisible();
}

async function createRoom(page: Page) {
  await page.locator('[data-open-create-room]').click();
  await page.locator('[data-create-room-submit]').click();
}

async function joinRoomFromList(page: Page, roomId: string) {
  const room = page.locator(`[data-room-item][data-room-code="${roomId}"]`);
  await expect(room).toBeVisible({ timeout: 10000 });
  await room.click();
}

async function dragCard(page: Page, targetXOffsetRatio: number) {
  const canvasBox = await page.locator('canvas').boundingBox();

  if (!canvasBox) {
    throw new Error('Canvas was visible but did not have a bounding box.');
  }

  const start = {
    x: canvasBox.x + Math.max(48, canvasBox.width * 0.08),
    y: canvasBox.y + canvasBox.height * 0.9,
  };
  const end = {
    x: canvasBox.x + canvasBox.width * (0.5 + targetXOffsetRatio),
    y: canvasBox.y + canvasBox.height * 0.55,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}
