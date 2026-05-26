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
    await expect.poll(() => getStateHash(peerA.page)).not.toBe('none');
    await expect.poll(() => getStateHash(peerB.page)).not.toBe('none');
    await expectActivePlayer(peerA.page, names[0]);
    await expectActivePlayer(peerB.page, names[0]);

    await dragCard(peerA.page, 0);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('1');
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('1');
    await expectActivePlayer(peerA.page, names[1]);
    await expectActivePlayer(peerB.page, names[1]);
    await expect.poll(() => getStateHash(peerB.page)).toBe(await getStateHash(peerA.page));

    await dragCard(peerB.page, -0.13);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('2');
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('2');
    await expectActivePlayer(peerA.page, names[0]);
    await expectActivePlayer(peerB.page, names[0]);
    await expect.poll(() => getStateHash(peerB.page)).toBe(await getStateHash(peerA.page));

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

    await expect.poll(() => getLocalRole(peerB.page), { timeout: 15000 }).toBe('host');
    await expect(peerB.page.locator('[data-player-count]')).toHaveText('2', { timeout: 15000 });
    await expect(peerC.page.locator('[data-player-count]')).toHaveText('2', { timeout: 15000 });
    await peerB.page.locator('[data-start-game]').click();

    await expect(peerB.page.locator('canvas')).toBeVisible();
    await expect(peerC.page.locator('canvas')).toBeVisible();
    await expectActivePlayer(peerB.page, names[1]);
    await expectActivePlayer(peerC.page, names[1]);

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

test('uses compact mobile scoreboard and confirms leaving during game play', async ({ browser }, testInfo) => {
  const names = peerNames('MobileUI', testInfo.project.name, 2);
  const peerA = await openPeer(browser, { width: 390, height: 700 });
  const peerB = await openPeer(browser, { width: 390, height: 700 });

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
    await expect(peerA.page.locator('canvas')).toBeVisible();

    await expect(peerA.page.locator('[data-compact-scoreboard]')).toBeVisible();
    await expect(peerA.page.locator('[data-compact-player]')).toHaveCount(2);
    await expect(peerA.page.locator('[data-compact-player][data-local="true"]')).toContainText(names[0]);
    await expect(peerA.page.locator('[data-compact-player][data-local="false"]')).not.toContainText(names[1]);
    await expect(peerA.page.locator('[data-compact-player][data-active="true"]')).toHaveCount(1);

    const activeAnimation = await peerA.page
      .locator('[data-compact-player][data-active="true"]')
      .evaluate((node) => {
        const style = window.getComputedStyle(node);

        return {
          duration: style.animationDuration,
          iterationCount: style.animationIterationCount,
          name: style.animationName,
        };
      });
    expect(activeAnimation.name).toContain('active-scoreboard-glow');
    expect(activeAnimation.duration).toBe('2s');
    expect(activeAnimation.iterationCount).toBe('infinite');

    await peerA.page.locator('[data-scoreboard-toggle]').click();
    await expect(peerA.page.locator('[data-scoreboard-overlay]')).toBeVisible();
    await expect(peerA.page.locator('[data-scoreboard-overlay]')).toContainText('Penguin Table');
    await expect(peerA.page.locator('[data-scoreboard-overlay]')).toContainText(names[0]);
    await expect(peerA.page.locator('[data-scoreboard-overlay]')).toContainText(names[1]);
    await expect(peerA.page.locator('[data-active-scoreboard-hint]')).toContainText('Active player');

    await peerA.page.mouse.click(5, 100);
    await expect(peerA.page.locator('[data-scoreboard-overlay]')).toHaveCount(0);

    await peerA.page.locator('[data-scoreboard-toggle]').click();
    await expect(peerA.page.locator('[data-scoreboard-overlay]')).toBeVisible();
    await peerA.page.getByLabel('Collapse scoreboard').last().click();
    await expect(peerA.page.locator('[data-scoreboard-overlay]')).toHaveCount(0);

    await peerA.page.locator('.action-bar').getByRole('button', { name: 'Leave' }).click();
    await expect(peerA.page.getByRole('dialog', { name: 'Leave game?' })).toBeVisible();
    await expect(peerA.page.locator('main[data-scene="game_play"]')).toBeVisible();
    await peerA.page.getByRole('button', { name: 'Stay' }).click();
    await expect(peerA.page.getByRole('dialog', { name: 'Leave game?' })).toHaveCount(0);

    await peerA.page.locator('.action-bar').getByRole('button', { name: 'Leave' }).click();
    await peerA.page.locator('[data-confirm-leave-room]').click();
    await expect(peerA.page.locator('main[data-scene="matchmaking_lobby"]')).toBeVisible({ timeout: 15000 });
    await expect(peerA.page.locator('[data-room-list]')).toBeVisible();
    await expect(peerA.page.locator('[data-player-name]')).toHaveValue(names[0]);

    expect(peerA.consoleErrors).toEqual([]);
    expect(peerB.consoleErrors).toEqual([]);
    expect(peerA.failedRequests).toEqual([]);
    expect(peerB.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close()]);
  }
});

test('keeps waiting canvas inside stage frame on a small smartphone viewport', async ({ browser }, testInfo) => {
  const names = peerNames('WaitUI', testInfo.project.name, 1);
  const peer = await openPeer(browser, { width: 360, height: 560 });

  try {
    await peer.page.goto('/');
    await enterMatchmaking(peer.page, names[0]);
    await createRoom(peer.page);
    await expect(peer.page.locator('[data-waiting-for-snapshot]')).toBeVisible();

    const boxes = await peer.page.evaluate(() => {
      const frame = document.querySelector('.stage-frame')?.getBoundingClientRect();
      const waiting = document.querySelector('[data-waiting-for-snapshot]')?.getBoundingClientRect();

      return frame && waiting
        ? {
            frameBottom: frame.bottom,
            frameHeight: frame.height,
            frameTop: frame.top,
            waitingBottom: waiting.bottom,
            waitingHeight: waiting.height,
            waitingTop: waiting.top,
          }
        : null;
    });

    expect(boxes).not.toBeNull();
    expect(boxes!.waitingTop).toBeGreaterThanOrEqual(boxes!.frameTop - 1);
    expect(boxes!.waitingBottom).toBeLessThanOrEqual(boxes!.frameBottom + 1);
    expect(boxes!.waitingHeight).toBeLessThanOrEqual(boxes!.frameHeight + 1);
    expect(peer.consoleErrors).toEqual([]);
    expect(peer.failedRequests).toEqual([]);
  } finally {
    await peer.context.close();
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

test('keeps duplicate names rejected after a player creates a room', async ({ browser }, testInfo) => {
  const names = peerNames('DupRoom', testInfo.project.name, 1);
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

    await expect.poll(() => getLocalPlayerName(peerBResume.page), { timeout: 15000 }).toBe(names[1]);
    await expect.poll(() => getStateHash(peerBResume.page), { timeout: 30000 }).not.toBe('none');
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
    await expectActivePlayer(peerA.page, names[0]);

    await dragCard(peerA.page, 0);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('1');
    await expectActivePlayer(peerA.page, names[1]);
    await peerB.context.close();

    await expect(peerA.page.locator('[data-board-count]')).toHaveText('2', { timeout: 25000 });
    await expectActivePlayer(peerA.page, names[0]);
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

async function expectActivePlayer(page: Page, expectedName: string) {
  await expect.poll(() => getActivePlayerName(page)).toBe(expectedName);
}

async function getActivePlayerName(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as
      | {
          game?: {
            currentRound?: { activePlayerId: string | null };
            players: Array<{ playerId: string; displayName: string }>;
          };
        }
      | undefined;
    const activePlayerId = debug?.game?.currentRound?.activePlayerId ?? null;

    return debug?.game?.players.find((player) => player.playerId === activePlayerId)?.displayName ?? 'none';
  });
}

async function getLocalPlayerName(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as { identity?: { displayName: string } } | undefined;

    return debug?.identity?.displayName ?? 'none';
  });
}

async function getLocalRole(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as { identity?: { role: string } } | undefined;

    return debug?.identity?.role ?? 'none';
  });
}

async function getStateHash(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as { game?: { stateHash: string } } | undefined;

    return debug?.game?.stateHash ?? 'none';
  });
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
