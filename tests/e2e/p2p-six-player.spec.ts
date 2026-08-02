import { expect, test, type Browser, type Page } from '@playwright/test';

const SIGNALING_HTTP_URL = `http://127.0.0.1:${readPort(
  [process.env.SIGNALING_PORT, process.env.VITE_SIGNALING_PORT],
  15201,
)}`;

test.setTimeout(180_000);

test('runs six player mesh, spectator join, locked room, room full, and host election', async (
  { browser },
  testInfo,
) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'six-peer mesh is covered once on desktop');

  const runSuffix = Math.random().toString(16).slice(2, 6);
  const peers = await Promise.all(
    ['SixA', 'SixB', 'SixC', 'SixD', 'SixE', 'SixF']
      .map((prefix) => `${prefix}${runSuffix}`)
      .map((name) => openPeer(browser, name, { width: 1280, height: 720 })),
  );
  const rejectedPeer = await openPeer(browser, `SixG${runSuffix}`, { width: 1280, height: 720 });
  const spectator = await openPeer(browser, `Spec${runSuffix}`, { width: 1280, height: 720 });

  try {
    await peers[0].page.goto('/');
    await enterMatchmaking(peers[0].page, peers[0].name);
    await peers[0].page.locator('[data-open-create-room]').click();
    await peers[0].page.locator('[data-create-password]').fill('iceberg');
    await peers[0].page.locator('[data-create-room-submit]').click();
    await expect(peers[0].page.locator('[data-room-id]')).toBeVisible();
    const roomId = (await peers[0].page.locator('[data-room-id]').textContent())?.trim();

    if (!roomId) {
      throw new Error('Peer A did not create a room.');
    }

    const roomList = await peers[0].page.evaluate(async (signalingHttpUrl) => {
      const response = await fetch(`${signalingHttpUrl}/rooms`);
      return response.json() as Promise<{ rooms: Array<{ hasPassword: boolean; roomId: string; status: string }> }>;
    }, SIGNALING_HTTP_URL);
    expect(
      roomList.rooms.some((room) => room.roomId === roomId && room.hasPassword && room.status === 'waiting_for_start'),
    ).toBe(true);

    const joinedPeers = [peers[0]];

    for (const peer of peers.slice(1)) {
      await joinRoom(peer.page, roomId, peer.name, 'iceberg');
      joinedPeers.push(peer);

      for (const joinedPeer of joinedPeers) {
        await expect(joinedPeer.page.locator('[data-player-count]')).toHaveText(String(joinedPeers.length), {
          timeout: 20000,
        });
        await expect(joinedPeer.page.locator('[data-connected-count]')).toHaveText(String(joinedPeers.length), {
          timeout: 30000,
        });
      }
    }

    await rejectedPeer.page.goto('/');
    await enterMatchmaking(rejectedPeer.page, rejectedPeer.name);
    const fullRoom = rejectedPeer.page.locator(`[data-room-item][data-room-code="${roomId}"]`);
    await expect(fullRoom).toBeVisible({ timeout: 10000 });
    await expect(fullRoom).toBeDisabled();
    await expect(fullRoom).toContainText('Full');
    const fullJoinResponse = await rejectedPeer.page.evaluate(
      async ({ displayName, signalingHttpUrl, targetRoomId }) => {
        const response = await fetch(`${signalingHttpUrl}/rooms/${targetRoomId}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName, password: 'iceberg' }),
        });
        return response.json() as Promise<{ code: string; message: string }>;
      },
      { displayName: rejectedPeer.name, signalingHttpUrl: SIGNALING_HTTP_URL, targetRoomId: roomId },
    );
    expect(fullJoinResponse.code).toBe('room_full');

    for (const peer of peers) {
      await expect(peer.page.locator('[data-player-count]')).toHaveText('6', { timeout: 20000 });
      await expect(peer.page.locator('[data-connected-count]')).toHaveText('6', { timeout: 30000 });
    }

    await readyPlayers(...peers.map((peer) => peer.page));
    await expectAll(peers, '[data-revision]', '1');
    await expectAll(peers, '[data-board-count]', '0');
    await expectAllStateHash(peers, await getStateHash(peers[0].page));

    const offsets = [0, -0.13, 0.13, -0.25, 0.25, -0.36];

    for (let index = 0; index < peers.length; index += 1) {
      await expectAllActivePlayer(peers, peers[index].name);
      await dragCard(peers[index].page, offsets[index]);
      await expectAll(peers, '[data-board-count]', String(index + 1));
      await expectAllStateHash(peers, await getStateHash(peers[0].page));
    }

    await joinRoom(spectator.page, roomId, spectator.name, 'iceberg');
    await expect.poll(() => getLocalRole(spectator.page), { timeout: 15000 }).toBe('spectator');
    await expect(spectator.page.locator('[data-board-count]')).toHaveText('6', { timeout: 30000 });
    await expect(spectator.page.locator('[data-player-count]')).toHaveText('6', { timeout: 30000 });
    await expect(spectator.page.locator('[data-spectator-count]')).toHaveText('1', { timeout: 30000 });
    await expect.poll(() => getStateHash(spectator.page), { timeout: 30000 }).toBe(await getStateHash(peers[0].page));
    await expect(spectator.page.locator('[data-spectator-board-toggle]')).toBeVisible();

    const spectatorStageDebug = await waitForStageDebug(spectator.page, 'spectator-stage');
    expect(spectatorStageDebug.handCards).toHaveLength(0);
    expect(spectatorStageDebug.handLayerChildren).toBe(0);

    await spectator.page.locator('[data-spectator-board-toggle]').click();
    await expect(spectator.page.locator('[data-board-fullscreen]')).toBeVisible();
    await expect(spectator.page.locator('[data-board-fullscreen] canvas')).toBeVisible();
    const fullscreenDebug = await waitForStageDebug(spectator.page, 'spectator-fullscreen');
    expect(fullscreenDebug.fitMode).toBe('perfect-pyramid');
    expect(fullscreenDebug.handCards).toHaveLength(0);
    expect(fullscreenDebug.handLayerChildren).toBe(0);
    expect(fullscreenDebug.perfectPyramidWidth).toBeLessThanOrEqual(fullscreenDebug.stageWidth * 0.95 + 1);
    expect(fullscreenDebug.perfectPyramidHeight).toBeLessThanOrEqual(fullscreenDebug.stageHeight * 0.95 + 1);
    expect(fullscreenDebug.visibleBoardLeftX).toBeGreaterThanOrEqual(-1);
    expect(fullscreenDebug.visibleBoardRightX).toBeLessThanOrEqual(fullscreenDebug.stageWidth + 1);
    expect(
      Math.min(
        Math.abs(fullscreenDebug.perfectPyramidWidth - fullscreenDebug.stageWidth * 0.95),
        Math.abs(fullscreenDebug.perfectPyramidHeight - fullscreenDebug.stageHeight * 0.95),
      ),
    ).toBeLessThanOrEqual(1);
    await spectator.page.locator('[data-spectator-board-close]').click();
    await expect(spectator.page.locator('[data-board-fullscreen]')).toHaveCount(0);

    const spectatorDebug = await spectator.page.evaluate(() => {
      const debug = window.__PENGUIN_DEBUG__ as {
        game?: {
          randomSeed: string;
          currentRound?: {
            deck: { shuffledCardIds: string[]; dealtCardIdsByPlayer: Record<string, string[]> };
            players: Record<string, { handCardIds: string[] }>;
          };
        };
        identity?: { playerId: string | null };
      };

      return {
        playerId: debug.identity ? debug.identity.playerId : 'missing',
        randomSeed: debug.game?.randomSeed,
        deckCount: debug.game?.currentRound?.deck.shuffledCardIds.length,
        dealtKeys: Object.keys(debug.game?.currentRound?.deck.dealtCardIdsByPlayer ?? {}).length,
        handCounts: Object.values(debug.game?.currentRound?.players ?? {}).map((player) => player.handCardIds.length),
      };
    });
    expect(spectatorDebug).toEqual({
      playerId: null,
      randomSeed: 'redacted',
      deckCount: 0,
      dealtKeys: 0,
      handCounts: [0, 0, 0, 0, 0, 0],
    });

    const oldHostPeerId = await getLocalPeerId(peers[0].page);
    await peers[0].context.close();
    const remainingPlayers = peers.slice(1);
    await expect
      .poll(async () => findElectedHostPeerId(remainingPlayers, oldHostPeerId), { timeout: 30000 })
      .not.toBe('none');
    const newHostPeerId = await findElectedHostPeerId(remainingPlayers, oldHostPeerId);

    const electedHost = await findPeerByPeerId(remainingPlayers, newHostPeerId);
    await expect.poll(() => getLocalRole(electedHost.page)).toBe('host');
    await expectAllActivePlayer(remainingPlayers, electedHost.name);
    await dragCard(electedHost.page, 0.36);
    await expectAll(remainingPlayers, '[data-board-count]', '7');
    await expectAllStateHash(remainingPlayers, await getStateHash(electedHost.page));

    for (const peer of [...remainingPlayers, rejectedPeer, spectator]) {
      expect(peer.consoleErrors).toEqual([]);
      expect(peer.failedRequests).toEqual([]);
    }
  } finally {
    await Promise.allSettled([...peers, rejectedPeer, spectator].map((peer) => peer.context.close()));
  }
});

async function openPeer(browser: Browser, name: string, viewport: { width: number; height: number }) {
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

  return { context, page, name, consoleErrors, failedRequests };
}

function readPort(candidates: Array<string | undefined>, fallback: number): number {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();

    if (!trimmed) {
      continue;
    }

    const port = Number(trimmed);

    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      return port;
    }
  }

  return fallback;
}

async function enterMatchmaking(page: Page, name: string) {
  await page.locator('[data-player-name]').fill(name);
  await connectSignalingServer(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.locator('[data-room-list]')).toBeVisible({ timeout: 15000 });
}

async function connectSignalingServer(page: Page) {
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
  await page.locator('[data-connect-signaling]').click();
  await expect(page.locator('[data-signaling-status]')).toContainText('Connected', { timeout: 15000 });
  await expect(page).toHaveURL(/signaling-server=/);
  await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
}

async function joinRoom(page: Page, roomId: string, name: string, password: string) {
  await page.goto('/');
  await enterMatchmaking(page, name);
  const room = page.locator(`[data-room-item][data-room-code="${roomId}"]`);
  await expect(room).toBeVisible({ timeout: 10000 });
  await room.click();
  await page.locator('[data-join-password]').fill(password);
  await page.locator('[data-join-room-submit]').click();
  await expect.poll(() => getLocalPlayerName(page), { timeout: 15000 }).toBe(name);
}

async function readyPlayers(...pages: Page[]) {
  for (const page of pages) {
    await expect(page.locator('[data-ready-toggle]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-ready-toggle]').click();
  }
}

async function expectAllActivePlayer(peers: Array<{ page: Page }>, expectedName: string) {
  await Promise.all(peers.map((peer) => expect.poll(() => getActivePlayerName(peer.page)).toBe(expectedName)));
}

async function expectAllStateHash(peers: Array<{ page: Page }>, expectedHash: string) {
  await Promise.all(peers.map((peer) => expect.poll(() => getStateHash(peer.page), { timeout: 30000 }).toBe(expectedHash)));
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

async function waitForStageDebug(page: Page, debugId: string) {
  await expect.poll(() => getStageDebug(page, debugId), { timeout: 15000 }).not.toBeNull();
  const debug = await getStageDebug(page, debugId);

  if (!debug) {
    throw new Error(`Missing stage debug for ${debugId}.`);
  }

  return debug;
}

async function getStageDebug(page: Page, debugId: string) {
  return page.evaluate((expectedDebugId) => {
    const debug = window.__PENGUIN_STAGE_DEBUG__ as
      | {
          debugId: string;
          fitMode: string;
          handCards: unknown[];
          handLayerChildren: number;
          perfectPyramidHeight: number;
          perfectPyramidWidth: number;
          stageHeight: number;
          stageWidth: number;
          visibleBoardLeftX: number;
          visibleBoardRightX: number;
        }
      | undefined;

    return debug?.debugId === expectedDebugId ? debug : null;
  }, debugId);
}

async function dragCard(page: Page, targetXOffsetRatio: number) {
  const canvasBox = await page.locator('canvas').boundingBox();

  if (!canvasBox) {
    throw new Error('Canvas was visible but did not have a bounding box.');
  }

  const debugMove = await page.evaluate(() => {
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

  const start = debugMove
    ? {
        x: canvasBox.x + debugMove.startX,
        y: canvasBox.y + debugMove.startY,
      }
    : {
        x: canvasBox.x + canvasBox.width * 0.44,
        y: canvasBox.y + canvasBox.height * 0.9,
      };
  const end = debugMove
    ? {
        x: canvasBox.x + debugMove.endX,
        y: canvasBox.y + debugMove.endY,
      }
    : {
        x: canvasBox.x + canvasBox.width * (0.5 + targetXOffsetRatio),
        y: canvasBox.y + canvasBox.height * 0.4,
      };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function expectAll(peers: Array<{ page: Page }>, selector: string, value: string) {
  for (const peer of peers) {
    await expect(peer.page.locator(selector)).toHaveText(value, { timeout: 15000 });
  }
}

async function uniqueHostIds(peers: Array<{ page: Page }>) {
  const ids = await Promise.all(peers.map((peer) => peer.page.locator('[data-host-peer]').innerText()));
  return [...new Set(ids.filter((id) => id !== 'none'))];
}

async function findElectedHostPeerId(peers: Array<{ page: Page }>, oldHostPeerId: string) {
  const hostIds = await uniqueHostIds(peers);

  if (hostIds.length !== 1 || hostIds[0] === oldHostPeerId) {
    return 'none';
  }

  const remainingPeerIds = await Promise.all(peers.map((peer) => getLocalPeerId(peer.page)));
  return remainingPeerIds.includes(hostIds[0]) ? hostIds[0] : 'none';
}

async function getLocalPeerId(page: Page) {
  const peerId = await page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as { identity?: { peerId: string } };
    return debug.identity?.peerId ?? null;
  });

  if (!peerId) {
    throw new Error('Local peer id was not available.');
  }

  return peerId;
}

async function findPeerByPeerId<TPeer extends { page: Page }>(peers: TPeer[], peerId: string): Promise<TPeer> {
  for (const peer of peers) {
    const candidate = await getLocalPeerId(peer.page);

    if (candidate === peerId) {
      return peer;
    }
  }

  throw new Error(`Peer ${peerId} was not found.`);
}
