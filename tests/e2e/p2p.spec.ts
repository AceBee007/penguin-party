import { expect, test, type Browser, type Page } from '@playwright/test';

test('syncs one host move and one joiner move over WebRTC DataChannel', async ({ browser }, testInfo) => {
  const names = peerNames('Sync', testInfo.project.name, 2);
  const peerA = await openPeer(browser, { width: 1280, height: 720 });
  const peerB = await openPeer(browser, { width: 1280, height: 720 });

  try {
    await peerA.page.goto('/');
    await peerB.page.goto('/');

    await enterMatchmaking(peerA.page, names[0]);
    await enterMatchmaking(peerB.page, names[1]);
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
    await expect(peerA.page.locator('[data-active-player]')).toHaveText(names[0]);
    await expect(peerB.page.locator('[data-active-player]')).toHaveText(names[0]);

    await dragCard(peerA.page, 0);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('1');
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('1');
    await expect(peerA.page.locator('[data-active-player]')).toHaveText(names[1]);
    await expect(peerB.page.locator('[data-active-player]')).toHaveText(names[1]);
    await expect(peerB.page.locator('[data-state-hash]')).toHaveText(await peerA.page.locator('[data-state-hash]').innerText());

    await dragCard(peerB.page, -0.13);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('2');
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('2');
    await expect(peerA.page.locator('[data-active-player]')).toHaveText(names[0]);
    await expect(peerB.page.locator('[data-active-player]')).toHaveText(names[0]);
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

test('starts correctly after the waiting room host leaves', async ({ browser }, testInfo) => {
  const names = peerNames('Leave', testInfo.project.name, 3);
  const peerA = await openPeer(browser, { width: 1280, height: 720 });
  const peerB = await openPeer(browser, { width: 1280, height: 720 });
  const peerC = await openPeer(browser, { width: 1280, height: 720 });

  try {
    await peerA.page.goto('/');
    await peerB.page.goto('/');
    await peerC.page.goto('/');

    await enterMatchmaking(peerA.page, names[0]);
    await enterMatchmaking(peerB.page, names[1]);
    await enterMatchmaking(peerC.page, names[2]);
    await createRoom(peerA.page);
    const roomId = (await peerA.page.locator('[data-room-id]').textContent())?.trim();

    if (!roomId) {
      throw new Error('Peer A did not create a room code.');
    }

    await joinRoomFromList(peerB.page, roomId);
    await joinRoomFromList(peerC.page, roomId);

    await expect(peerA.page.locator('[data-player-count]')).toHaveText('3', { timeout: 15000 });
    await expect(peerB.page.locator('[data-player-count]')).toHaveText('3', { timeout: 15000 });
    await expect(peerC.page.locator('[data-player-count]')).toHaveText('3', { timeout: 15000 });

    await peerA.context.close();

    await expect(peerB.page.locator('[data-local-role]')).toHaveText('host', { timeout: 15000 });
    await expect(peerB.page.locator('[data-player-count]')).toHaveText('2', { timeout: 15000 });
    await expect(peerC.page.locator('[data-player-count]')).toHaveText('2', { timeout: 15000 });
    await peerB.page.locator('[data-start-game]').click();

    await expect(peerB.page.locator('canvas')).toBeVisible();
    await expect(peerC.page.locator('canvas')).toBeVisible();
    await expect(peerB.page.locator('[data-active-player]')).toHaveText(names[1]);
    await expect(peerC.page.locator('[data-active-player]')).toHaveText(names[1]);

    await expectLocalPlayerHasMatchingGameState(peerB.page, names[1]);
    await expectLocalPlayerHasMatchingGameState(peerC.page, names[2]);
    await dragCard(peerB.page, 0);
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('1');
    await expect(peerC.page.locator('[data-board-count]')).toHaveText('1');

    expect(peerB.consoleErrors).toEqual([]);
    expect(peerC.consoleErrors).toEqual([]);
    expect(peerB.failedRequests).toEqual([]);
    expect(peerC.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close(), peerC.context.close()]);
  }
});

test('rejects duplicate online player names before matchmaking', async ({ browser }, testInfo) => {
  const names = peerNames('Dup', testInfo.project.name, 1);
  const peerA = await openPeer(browser, { width: 1280, height: 720 });
  const peerB = await openPeer(browser, { width: 1280, height: 720 });

  try {
    await peerA.page.goto('/');
    await peerB.page.goto('/');

    await enterMatchmaking(peerA.page, names[0]);
    await createRoom(peerA.page);
    await expect(peerA.page.locator('[data-room-id]')).toBeVisible();

    await peerB.page.locator('[data-player-name]').fill(names[0]);
    await peerB.page.getByRole('button', { name: 'Start' }).click();
    await expect(peerB.page.locator('[data-game-message]')).toContainText('already online');
    await expect(peerB.page.locator('[data-room-list]')).toHaveCount(0);

    expect(peerA.consoleErrors).toEqual([]);
    expect(peerB.consoleErrors).toEqual([]);
    expect(peerA.failedRequests).toEqual([]);
    expect(peerB.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close()]);
  }
});

test('resumes a disconnected player with a re-join code', async ({ browser }, testInfo) => {
  const names = peerNames('Rejoin', testInfo.project.name, 2);
  const peerA = await openPeer(browser, { width: 1280, height: 720 });
  const peerB = await openPeer(browser, { width: 1280, height: 720 });
  const peerBResume = await openPeer(browser, { width: 1280, height: 720 });

  try {
    await peerA.page.goto('/');
    await peerB.page.goto('/');

    await enterMatchmaking(peerA.page, names[0]);
    await enterMatchmaking(peerB.page, names[1]);
    await createRoom(peerA.page);
    const roomId = (await peerA.page.locator('[data-room-id]').textContent())?.trim();

    if (!roomId) {
      throw new Error('Peer A did not create a room code.');
    }

    await joinRoomFromList(peerB.page, roomId);
    await expect(peerA.page.locator('[data-channel-state]')).toHaveText('Open', { timeout: 15000 });
    await peerA.page.locator('[data-start-game]').click();
    await expect(peerB.page.locator('[data-rejoin-code]')).not.toHaveText('none');
    const rejoinCode = (await peerB.page.locator('[data-rejoin-code]').textContent())?.trim();

    if (!rejoinCode) {
      throw new Error('Peer B did not receive a re-join code.');
    }

    await peerB.context.close();
    await peerBResume.page.goto('/');
    await peerBResume.page.locator('[data-player-name]').fill('IgnoredName');
    await peerBResume.page.locator('[data-rejoin-code-input]').fill(rejoinCode);
    await peerBResume.page.getByRole('button', { name: 'Start' }).click();

    await expect(peerBResume.page.locator('[data-local-player]')).toHaveText(names[1], { timeout: 15000 });
    await expect(peerBResume.page.locator('[data-state-hash]')).not.toHaveText('none', { timeout: 30000 });
    await expectLocalPlayerHasMatchingGameState(peerBResume.page, names[1]);

    expect(peerA.consoleErrors).toEqual([]);
    expect(peerBResume.consoleErrors).toEqual([]);
    expect(peerA.failedRequests).toEqual([]);
    expect(peerBResume.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close(), peerBResume.context.close()]);
  }
});

test('host silently auto-plays for a disconnected active player', async ({ browser }, testInfo) => {
  const names = peerNames('Auto', testInfo.project.name, 2);
  const peerA = await openPeer(browser, { width: 1280, height: 720 });
  const peerB = await openPeer(browser, { width: 1280, height: 720 });

  try {
    await peerA.page.goto('/');
    await peerB.page.goto('/');

    await enterMatchmaking(peerA.page, names[0]);
    await enterMatchmaking(peerB.page, names[1]);
    await createRoom(peerA.page);
    const roomId = (await peerA.page.locator('[data-room-id]').textContent())?.trim();

    if (!roomId) {
      throw new Error('Peer A did not create a room code.');
    }

    await joinRoomFromList(peerB.page, roomId);
    await expect(peerA.page.locator('[data-channel-state]')).toHaveText('Open', { timeout: 15000 });
    await peerA.page.locator('[data-start-game]').click();
    await expect(peerA.page.locator('[data-active-player]')).toHaveText(names[0]);

    await dragCard(peerA.page, 0);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('1');
    await expect(peerA.page.locator('[data-active-player]')).toHaveText(names[1]);
    await peerB.context.close();

    await expect(peerA.page.locator('[data-board-count]')).toHaveText('2', { timeout: 25000 });
    await expect(peerA.page.locator('[data-active-player]')).toHaveText(names[0]);
    const disconnectedPlayerRow = peerA.page.locator('.player-row').filter({ hasText: names[1] });
    await expect(disconnectedPlayerRow).not.toContainText(/closed|disconnected|reconnecting/i);

    expect(peerA.consoleErrors).toEqual([]);
    expect(peerA.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close()]);
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

function peerNames(prefix: string, projectName: string, count: number) {
  const projectSuffix = projectName.startsWith('mobile') ? 'M' : 'D';
  const runSuffix = Math.random().toString(16).slice(2, 6);
  return Array.from({ length: count }, (_, index) => `${prefix.slice(0, 6)}${projectSuffix}${index + 1}${runSuffix}`);
}

async function enterMatchmaking(page: Page, name: string) {
  await page.locator('[data-player-name]').fill(name);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('[data-room-list]')).toBeVisible({ timeout: 15000 });
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

async function expectLocalPlayerHasMatchingGameState(page: Page, expectedName: string) {
  const localState = await page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as {
      game?: {
        players: Array<{ playerId: string; displayName: string }>;
        currentRound?: {
          players: Record<string, { handCardIds: string[]; remainingCardCount: number }>;
        };
      };
      identity?: { playerId: string | null; displayName: string };
    };
    const playerId = debug.identity?.playerId ?? null;
    const gamePlayer = playerId ? debug.game?.players.find((player) => player.playerId === playerId) : null;
    const roundPlayer = playerId ? debug.game?.currentRound?.players[playerId] : null;

    return {
      displayName: debug.identity?.displayName,
      gameDisplayName: gamePlayer?.displayName ?? null,
      handCount: roundPlayer?.handCardIds.length ?? 0,
      playerId,
      remainingCardCount: roundPlayer?.remainingCardCount ?? 0,
    };
  });

  expect(localState.displayName).toBe(expectedName);
  expect(localState.gameDisplayName).toBe(expectedName);
  expect(localState.playerId).toBeTruthy();
  expect(localState.handCount).toBeGreaterThan(0);
  expect(localState.remainingCardCount).toBe(localState.handCount);
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
