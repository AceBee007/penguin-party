import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

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
    await peerA.page.locator('[data-ready-toggle]').click();
    await expect(peerA.page.locator('[data-ready-status]')).toContainText(/1(?: not ready|名)/);
    await expectAllowsFullText(peerA.page.locator('[data-ready-status]'));
    await expect(peerA.page.locator('canvas')).toHaveCount(0);
    await peerB.page.locator('[data-ready-toggle]').click();

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
    await readyPlayers(peerB.page, peerC.page);

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
    await readyPlayers(peerA.page, peerB.page);
    await expect(peerA.page.locator('canvas')).toBeVisible();
    await expect.poll(() => getStoredRejoinSessions(peerA.page), { timeout: 15000 }).toHaveLength(1);
    const [peerARejoinSession] = await getStoredRejoinSessions(peerA.page);

    if (!peerARejoinSession) {
      throw new Error('Peer A did not persist a re-join session.');
    }

    expect(new URL(peerA.page.url()).searchParams.get('rejoin-code')).toBe(peerARejoinSession.rejoinCode);
    const playAreaLayout = await peerA.page.evaluate(() => {
      const actionBar = document.querySelector('.action-bar')?.getBoundingClientRect();
      const message = document.querySelector('[data-game-message]')?.getBoundingClientRect();
      const stage = document.querySelector('.stage-frame')?.getBoundingClientRect();

      return actionBar && message && stage
        ? {
            actionBottom: actionBar.bottom,
            messageBottomGap: window.innerHeight - message.bottom,
            messageTop: message.top,
            stageBottom: stage.bottom,
            stageHeight: stage.height,
            stageTop: stage.top,
          }
        : null;
    });

    expect(playAreaLayout).not.toBeNull();
    expect(playAreaLayout!.actionBottom).toBeLessThanOrEqual(playAreaLayout!.stageTop);
    expect(playAreaLayout!.messageTop).toBeGreaterThanOrEqual(playAreaLayout!.stageBottom);
    expect(playAreaLayout!.messageBottomGap).toBeGreaterThanOrEqual(8);
    expect(playAreaLayout!.messageBottomGap).toBeLessThanOrEqual(40);
    expect(playAreaLayout!.stageHeight).toBeGreaterThan(430);

    await peerA.page.setViewportSize({ width: 390, height: 560 });
    await expect.poll(async () => peerA.page.evaluate(() => {
      const app = document.querySelector('main[data-scene="game_play"]')?.getBoundingClientRect();
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
      const scoreboard = document.querySelector('.scoreboard')?.getBoundingClientRect();
      const playArea = document.querySelector('.play-area')?.getBoundingClientRect();
      const stage = document.querySelector('.stage-frame')?.getBoundingClientRect();
      const pixiRoot = document.querySelector<HTMLElement>('[data-pixi-root]');
      const canvasElement = document.querySelector<HTMLCanvasElement>('canvas');
      const canvas = canvasElement?.getBoundingClientRect();
      const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
      const rendererResolution = Math.min(window.devicePixelRatio || 1, 2);

      return app && topbar && scoreboard && playArea && stage && pixiRoot && canvasElement && canvas
        ? {
            allInsideVisibleViewport:
              app.top >= 0
              && topbar.top >= app.top
              && scoreboard.top >= topbar.bottom
              && playArea.top >= scoreboard.bottom
              && playArea.bottom <= visibleHeight + 1
              && app.bottom <= visibleHeight + 1,
            canvasInsidePlayArea: canvas.top >= stage.top && canvas.bottom <= stage.bottom + 1,
            canvasVisible: canvas.height > 0 && canvas.width > 0,
            rendererMatchesContainer:
              Math.abs(canvasElement.height / rendererResolution - pixiRoot.clientHeight) <= 1
              && Math.abs(canvasElement.width / rendererResolution - pixiRoot.clientWidth) <= 1,
            viewportHeight: Math.round(visibleHeight),
          }
        : null;
    })).toEqual({
      allInsideVisibleViewport: true,
      canvasInsidePlayArea: true,
      canvasVisible: true,
      rendererMatchesContainer: true,
      viewportHeight: 560,
    });

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
    expect(new URL(peerA.page.url()).searchParams.get('rejoin-code')).toBeNull();
    expect((await getStoredRejoinSessions(peerA.page)).map((session) => session.rejoinCode))
      .not.toContain(peerARejoinSession.rejoinCode);

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
    await expectAllowsFullText(peer.page.locator('[data-game-message]'));

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

test('allows waiting and result copy to wrap instead of ellipsizing', async ({ browser }) => {
  const peer = await openPeer(browser, { width: 320, height: 520 });

  try {
    await peer.page.goto('/');
    await peer.page.evaluate(() => {
      const shell = document.querySelector('.app-shell');
      const probe = document.createElement('section');

      probe.className = 'game-shell';
      probe.dataset.scene = 'round_result';
      probe.dataset.styleProbe = 'text-wrap';
      probe.innerHTML = `
        <p class="game-message">結果確認中のプレイヤーを待っている（準備未完了はあと12名）</p>
        <div class="summary-row">
          <span>#1 VeryLongPlayerNameThatMustRemainFullyVisible</span>
          <span>+12</span>
          <strong>12 pts</strong>
        </div>
        <div class="ready-gate ready-gate--result">
          <p class="ready-gate__status">結果確認中のプレイヤーを待っている（準備未完了はあと12名）</p>
        </div>
      `;
      shell?.append(probe);
    });

    await expectAllowsFullText(peer.page.locator('[data-style-probe="text-wrap"] .game-message'));
    await expectAllowsFullText(peer.page.locator('[data-style-probe="text-wrap"] .ready-gate__status'));
    await expectAllowsFullText(peer.page.locator('[data-style-probe="text-wrap"] .summary-row span').first());

    expect(peer.consoleErrors).toEqual([]);
    expect(peer.failedRequests).toEqual([]);
  } finally {
    await peer.context.close();
  }
});

test('keeps the result scoreboard and next-round action together on mobile result screens', async ({ browser }) => {
  const peer = await openPeer(browser, { width: 360, height: 560 });

  try {
    await peer.page.goto('/');
    await peer.page.evaluate(() => {
      document.body.innerHTML = `
        <main class="app-shell">
          <header class="topbar">
            <div class="brand">
              <div class="brand__copy">
                <h1 class="brand__title">Penguin Party</h1>
                <span class="brand__mode">P2P</span>
              </div>
            </div>
            <div class="connection-indicator">Connected</div>
          </header>
          <section class="game-shell" data-scene="round_result" data-style-probe="result-actions">
            <aside class="scoreboard" aria-label="Players">
              <div class="scoreboard__header">
                <span>Round 1 / 2</span>
                <strong>round result</strong>
              </div>
            </aside>
            <section class="play-area">
              <div class="result-review-panel" data-result-review-panel>
                <div class="summary-panel summary-panel--result-review" data-round-result>
                  <h2>Round result 1 / 2</h2>
                  <div class="summary-row">
                    <span>#1 Player</span>
                    <span>+0</span>
                    <strong>0 pts</strong>
                  </div>
                  <div class="ready-gate ready-gate--result" data-ready-gate="round_result">
                    <div class="action-bar__buttons result-review-actions">
                      <button data-ready-toggle data-result-primary-action type="button">Next round</button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="stage-frame"><div class="waiting-canvas">Result board</div></div>
              <p class="game-message">Round complete.</p>
            </section>
            <aside class="round-panel">
              <div class="metric-grid"><div><span>Board</span><strong>12</strong></div></div>
              <div class="result-exit-actions" data-result-exit-actions>
                <button class="button-secondary" data-result-secondary-action type="button">Leave</button>
              </div>
            </aside>
          </section>
        </main>
      `;
    });

    const layout = await peer.page.evaluate(() => {
      const resultPanel = document.querySelector('[data-result-review-panel]');
      const summary = document.querySelector('[data-round-result]');
      const primary = document.querySelector('[data-result-primary-action]');
      const secondary = document.querySelector('[data-result-secondary-action]');
      const roundPanel = document.querySelector('.round-panel');
      const stage = document.querySelector('.stage-frame')?.getBoundingClientRect();
      const resultPanelBox = resultPanel?.getBoundingClientRect();
      const primaryBox = primary?.getBoundingClientRect();
      const secondaryBox = secondary?.getBoundingClientRect();
      const roundPanelBox = roundPanel?.getBoundingClientRect();

      return resultPanel && summary && primary && secondary && roundPanel && stage && resultPanelBox && primaryBox && secondaryBox && roundPanelBox
        ? {
            resultPanelContainsSecondary: resultPanel.contains(secondary),
            roundPanelContainsSecondary: roundPanel.contains(secondary),
            roundPanelTop: roundPanelBox.top,
            primaryBottom: primaryBox.bottom,
            primaryInsideResultPanel: resultPanel.contains(primary),
            primaryTop: primaryBox.top,
            resultPanelBottom: resultPanelBox.bottom,
            resultPanelTop: resultPanelBox.top,
            secondaryTop: secondaryBox.top,
            stageTop: stage.top,
            summaryInsideResultPanel: resultPanel.contains(summary),
            viewportHeight: window.innerHeight,
          }
        : null;
    });

    expect(layout).not.toBeNull();
    expect(layout!.summaryInsideResultPanel).toBe(true);
    expect(layout!.primaryInsideResultPanel).toBe(true);
    expect(layout!.resultPanelTop).toBeLessThan(layout!.stageTop);
    expect(layout!.resultPanelBottom).toBeLessThanOrEqual(layout!.stageTop);
    expect(layout!.resultPanelContainsSecondary).toBe(false);
    expect(layout!.roundPanelContainsSecondary).toBe(true);
    expect(layout!.secondaryTop).toBeGreaterThanOrEqual(layout!.roundPanelTop);
    expect(layout!.secondaryTop).toBeGreaterThan(layout!.stageTop);
    expect(layout!.primaryBottom).toBeLessThanOrEqual(layout!.viewportHeight);
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
    await connectSignalingServer(peerB.page);
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
    await connectSignalingServer(peerB.page);
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
    await readyPlayers(peerA.page, peerB.page);
    await expect(peerB.page.locator('[data-rejoin-code-input]')).toHaveCount(0);
    await expect(peerB.page.locator('[data-rejoin-code]')).toHaveCount(0);
    await expect.poll(() => getStoredRejoinSessions(peerB.page), { timeout: 15000 }).toHaveLength(1);
    const [storedSession] = await getStoredRejoinSessions(peerB.page);

    if (!storedSession) {
      throw new Error('Peer B did not persist a re-join session.');
    }

    const expiresAt = Number.parseInt(storedSession?.rejoinCode.split('.')[1] ?? '', 36);

    expect(storedSession?.rejoinCode).toBeTruthy();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
    expect(new URL(peerB.page.url()).searchParams.get('rejoin-code')).toBe(storedSession?.rejoinCode);
    await startConnectionIndicatorAudit(peerA.page);

    await peerB.page.evaluate((rejoinCode) => {
      window.localStorage.removeItem(`penguin-party.rejoinSession.${encodeURIComponent(rejoinCode)}`);
    }, storedSession.rejoinCode);
    expect(await getStoredRejoinSessions(peerB.page)).toHaveLength(0);

    await peerB.page.reload();
    await expect(peerB.page.locator('[data-rejoin-current-tab="true"]')).toBeVisible({ timeout: 15000 });
    await expect(peerB.page.locator('[data-rejoin-room-id]')).toHaveAttribute('data-current-tab', 'true');
    await expect.poll(() => getStoredRejoinSessions(peerB.page)).toHaveLength(1);
    expect(await getLocalPlayerName(peerB.page)).toBe('none');
    await peerB.page.locator('[data-rejoin-current-tab="true"]').click();

    await expect.poll(() => getLocalPlayerName(peerB.page), { timeout: 15000 }).toBe(names[1]);
    await expect.poll(() => getStateHash(peerB.page), { timeout: 30000 }).not.toBe('none');
    await expectLocalPlayerHasMatchingGameState(peerB.page, names[1]);
    await expect.poll(async () => (await getStoredRejoinSessions(peerB.page))[0]?.recoveryKey ?? null, {
      timeout: 15000,
    }).not.toBeNull();
    await expect(peerA.page.locator('[data-channel-state]')).toHaveText('Open', { timeout: 15000 });
    await expect(peerA.page.locator('.connection-indicator')).not.toContainText('Target peer is not connected.');
    expect(await getConnectionIndicatorHistory(peerA.page)).not.toContain('Target peer is not connected.');

    expect(peerA.consoleErrors).toEqual([]);
    expect(peerB.consoleErrors).toEqual([]);
    expect(peerA.failedRequests).toEqual([]);
    expect(peerB.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close()]);
  }
});

test('recovers a frozen two-player game from an encrypted spectator snapshot', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'multi-peer recovery is covered once on desktop');
  test.setTimeout(120_000);

  const names = peerNames('Recover', testInfo.project.name, 3);
  const peerA = await openPeer(browser, { width: 1280, height: 720 });
  const peerB = await openPeer(browser, { width: 1280, height: 720 });
  const spectator = await openPeer(browser, { width: 1280, height: 720 });

  try {
    await Promise.all([peerA.page.goto('/'), peerB.page.goto('/'), spectator.page.goto('/')]);
    await enterMatchmaking(peerA.page, names[0]);
    await enterMatchmaking(peerB.page, names[1]);
    await createRoom(peerA.page);
    const roomId = (await peerA.page.locator('[data-room-id]').textContent())?.trim();

    if (!roomId) {
      throw new Error('Peer A did not create a room code.');
    }

    await joinRoomFromList(peerB.page, roomId);
    await expect(peerA.page.locator('[data-connected-count]')).toHaveText('2', { timeout: 15000 });
    await expect(peerB.page.locator('[data-connected-count]')).toHaveText('2', { timeout: 15000 });
    await readyPlayers(peerA.page, peerB.page);
    await expectActivePlayer(peerA.page, names[0]);
    await dragCard(peerA.page, 0);
    await expectActivePlayer(peerB.page, names[1]);
    await dragCard(peerB.page, -0.13);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('2');

    await enterMatchmaking(spectator.page, names[2]);
    await joinRoomFromList(spectator.page, roomId);
    await expect.poll(() => getLocalRole(spectator.page), { timeout: 15000 }).toBe('spectator');
    await expect(spectator.page.locator('[data-board-count]')).toHaveText('2', { timeout: 30000 });
    await expect.poll(() => getStateHash(spectator.page)).toBe(await getStateHash(peerA.page));
    await spectator.page.waitForTimeout(1500);

    const [sessionA] = await getStoredRejoinSessions(peerA.page);
    const [sessionB] = await getStoredRejoinSessions(peerB.page);

    expect(sessionA?.recoveryKey).toBeTruthy();
    expect(sessionB?.recoveryKey).toBe(sessionA?.recoveryKey);
    expect(await getStoredRejoinSessions(spectator.page)).toHaveLength(0);
    await expectSpectatorStateIsRedacted(spectator.page, 2);

    await Promise.all([peerA.page.reload(), peerB.page.reload()]);
    await expect.poll(() => getHostPeerId(spectator.page), { timeout: 15000 }).toBeNull();
    const frozenState = await getGameMarker(spectator.page);

    await spectator.page.waitForTimeout(8500);
    expect(await getGameMarker(spectator.page)).toEqual(frozenState);

    await expect(peerA.page.locator('[data-rejoin-current-tab="true"]')).toBeVisible({ timeout: 15000 });
    await peerA.page.locator('[data-rejoin-current-tab="true"]').click();
    await expect.poll(() => getLocalRole(peerA.page), { timeout: 20000 }).toBe('host');
    await expect.poll(() => getStateHash(peerA.page), { timeout: 20000 }).toBe(frozenState.stateHash);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('2');
    await expectLocalPlayerHasMatchingGameState(peerA.page, names[0]);
    await expect.poll(() => getHostPeerId(spectator.page), { timeout: 15000 }).toBe(await getLocalPeerId(peerA.page));

    await dragCard(peerA.page, 0.13);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('3');
    await expect(spectator.page.locator('[data-board-count]')).toHaveText('3');

    await expect(peerB.page.locator('[data-rejoin-current-tab="true"]')).toBeVisible({ timeout: 15000 });
    await peerB.page.locator('[data-rejoin-current-tab="true"]').click();
    await expect.poll(() => getLocalRole(peerB.page), { timeout: 20000 }).toBe('player');
    await expect.poll(async () => {
      const [hostHash, playerHash] = await Promise.all([getStateHash(peerA.page), getStateHash(peerB.page)]);
      return playerHash === hostHash;
    }, { timeout: 20000 }).toBe(true);
    await expectLocalPlayerHasMatchingGameState(peerB.page, names[1]);

    const [restoredSessionA] = await getStoredRejoinSessions(peerA.page);
    const [restoredSessionB] = await getStoredRejoinSessions(peerB.page);
    expect(restoredSessionA?.recoveryKey).toBe(sessionA?.recoveryKey);
    expect(restoredSessionB?.recoveryKey).toBe(sessionA?.recoveryKey);
    await expectSpectatorStateIsRedacted(spectator.page, 2);

    for (const peer of [peerA, peerB, spectator]) {
      expect(peer.consoleErrors).toEqual([]);
      expect(peer.failedRequests).toEqual([]);
    }
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close(), spectator.context.close()]);
  }
});

test('keeps tab-specific re-join codes across two simultaneous reloads', async ({ browser }, testInfo) => {
  const names = peerNames('Tabs', testInfo.project.name, 3);
  const host = await openPeer(browser, { width: 1280, height: 720 });
  const sharedContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tabOne = await sharedContext.newPage();
  const tabTwo = await sharedContext.newPage();
  const tabOneTelemetry = trackPageErrors(tabOne);
  const tabTwoTelemetry = trackPageErrors(tabTwo);

  try {
    await host.page.goto('/');
    await tabOne.goto('/');
    await tabTwo.goto('/');

    await enterMatchmaking(host.page, names[0]);
    await enterMatchmaking(tabOne, names[1]);
    await enterMatchmaking(tabTwo, names[2]);
    await createRoom(host.page);
    const roomId = (await host.page.locator('[data-room-id]').textContent())?.trim();

    if (!roomId) {
      throw new Error('Host did not create a room code.');
    }

    await joinRoomFromList(tabOne, roomId);
    await joinRoomFromList(tabTwo, roomId);
    await expect(host.page.locator('[data-player-count]')).toHaveText('3', { timeout: 15000 });

    for (const page of [host.page, tabOne, tabTwo]) {
      await expect(page.locator('[data-connected-count]')).toHaveText('3', { timeout: 15000 });
    }

    await readyPlayers(host.page, tabOne, tabTwo);
    await expect(host.page.locator('canvas')).toBeVisible();
    await expect(tabOne.locator('canvas')).toBeVisible();
    await expect(tabTwo.locator('canvas')).toBeVisible();
    await expect.poll(() => getStoredRejoinSessions(tabOne), { timeout: 15000 }).toHaveLength(2);

    const tabOneCode = new URL(tabOne.url()).searchParams.get('rejoin-code');
    const tabTwoCode = new URL(tabTwo.url()).searchParams.get('rejoin-code');
    const storedCodes = (await getStoredRejoinSessions(tabOne)).map((session) => session.rejoinCode);

    expect(tabOneCode).toBeTruthy();
    expect(tabTwoCode).toBeTruthy();
    expect(tabOneCode).not.toBe(tabTwoCode);
    expect(storedCodes).toEqual(expect.arrayContaining([tabOneCode, tabTwoCode]));

    await Promise.all([tabOne.reload(), tabTwo.reload()]);

    for (const tab of [tabOne, tabTwo]) {
      await expect(tab.locator('[data-rejoin-room-id]')).toHaveCount(2, { timeout: 15000 });
      await expect(tab.locator('[data-rejoin-room-id]').first()).toHaveAttribute('data-current-tab', 'true');
      await expect(tab.locator('[data-rejoin-room-id]').first()).toContainText('3 / 6 players');
    }

    await Promise.all([
      tabOne.locator('[data-rejoin-current-tab="true"]').click(),
      tabTwo.locator('[data-rejoin-current-tab="true"]').click(),
    ]);

    await expect.poll(() => getLocalPlayerName(tabOne), { timeout: 15000 }).toBe(names[1]);
    await expect.poll(() => getLocalPlayerName(tabTwo), { timeout: 15000 }).toBe(names[2]);
    await expect.poll(() => getStateHash(tabOne), { timeout: 30000 }).toBe(await getStateHash(host.page));
    await expect.poll(() => getStateHash(tabTwo), { timeout: 30000 }).toBe(await getStateHash(host.page));
    expect(new URL(tabOne.url()).searchParams.get('rejoin-code')).toBe(tabOneCode);
    expect(new URL(tabTwo.url()).searchParams.get('rejoin-code')).toBe(tabTwoCode);

    expect(host.consoleErrors).toEqual([]);
    expect(tabOneTelemetry.consoleErrors).toEqual([]);
    expect(tabTwoTelemetry.consoleErrors).toEqual([]);
    expect(host.failedRequests).toEqual([]);
    expect(tabOneTelemetry.failedRequests).toEqual([]);
    expect(tabTwoTelemetry.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([host.context.close(), sharedContext.close()]);
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
    await readyPlayers(peerA.page, peerB.page);
    await expectActivePlayer(peerA.page, names[0]);

    await dragCard(peerA.page, 0);
    await expect(peerA.page.locator('[data-board-count]')).toHaveText('1');
    await expectActivePlayer(peerA.page, names[1]);
    await peerB.context.close();

    await expect(peerA.page.locator('[data-board-count]')).toHaveText('2', { timeout: 25000 });
    await expectActivePlayer(peerA.page, names[0]);
    const disconnectedPlayerRow = peerA.page.locator('.player-row').filter({ hasText: names[1] });
    await expect(disconnectedPlayerRow).not.toContainText(/closed|disconnected|reconnecting/i);
    await expect(peerA.page.locator('.connection-indicator')).not.toContainText('Target peer is not connected.');

    expect(peerA.consoleErrors).toEqual([]);
    expect(peerA.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close()]);
  }
});

test('promotes a new host and auto-plays for the disconnected host without changing the active seat', async ({ browser }, testInfo) => {
  const names = peerNames('HostAuto', testInfo.project.name, 3);
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
    await expect(peerA.page.locator('[data-connected-count]')).toHaveText('3', { timeout: 15000 });
    await readyPlayers(peerA.page, peerB.page, peerC.page);
    await expectActivePlayer(peerB.page, names[0]);
    await expectActivePlayer(peerC.page, names[0]);
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('0');
    const originalHostPeerId = await getLocalPeerId(peerA.page);
    await startConnectionIndicatorAudit(peerB.page);
    await startConnectionIndicatorAudit(peerC.page);

    await peerA.context.close();

    await expect.poll(() => getLocalRole(peerB.page), { timeout: 15000 }).toBe('host');
    await expect.poll(() => getLocalRole(peerC.page), { timeout: 15000 }).toBe('player');
    const promotedHostPeerId = await getLocalPeerId(peerB.page);

    expect(promotedHostPeerId).not.toBe(originalHostPeerId);
    await expect(peerB.page.locator('[data-host-peer]')).toHaveText(promotedHostPeerId);
    await expect(peerC.page.locator('[data-host-peer]')).toHaveText(promotedHostPeerId);
    await expectActivePlayer(peerB.page, names[0]);
    await expectActivePlayer(peerC.page, names[0]);
    await expect(peerB.page.locator('[data-player-count]')).toHaveText('3');
    await expect(peerC.page.locator('[data-player-count]')).toHaveText('3');

    await peerB.page.waitForTimeout(3000);
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('0');
    await expect(peerC.page.locator('[data-board-count]')).toHaveText('0');

    await expect(peerB.page.locator('[data-board-count]')).toHaveText('1', { timeout: 8000 });
    await expect(peerC.page.locator('[data-board-count]')).toHaveText('1', { timeout: 8000 });
    await expectActivePlayer(peerB.page, names[1]);
    await expectActivePlayer(peerC.page, names[1]);
    await expect.poll(() => getStateHash(peerC.page)).toBe(await getStateHash(peerB.page));

    await dragCard(peerB.page, -0.13);
    await expect(peerB.page.locator('[data-board-count]')).toHaveText('2');
    await expect(peerC.page.locator('[data-board-count]')).toHaveText('2');
    await expect.poll(() => getStateHash(peerC.page)).toBe(await getStateHash(peerB.page));

    for (const page of [peerB.page, peerC.page]) {
      await expect(page.locator('.connection-indicator')).not.toContainText('Target peer is not connected.');
      expect(await getConnectionIndicatorHistory(page)).not.toContain('Target peer is not connected.');
    }

    expect(peerB.consoleErrors).toEqual([]);
    expect(peerC.consoleErrors).toEqual([]);
    expect(peerB.failedRequests).toEqual([]);
    expect(peerC.failedRequests).toEqual([]);
  } finally {
    await Promise.allSettled([peerA.context.close(), peerB.context.close(), peerC.context.close()]);
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
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });

  return { context, page, consoleErrors, failedRequests };
}

function trackPageErrors(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });

  return { consoleErrors, failedRequests };
}

function peerNames(prefix: string, projectName: string, count: number) {
  const projectSuffix = projectName.startsWith('mobile') ? 'M' : 'D';
  const runSuffix = Math.random().toString(16).slice(2, 6);
  return Array.from({ length: count }, (_, index) => `${prefix.slice(0, 6)}${projectSuffix}${index + 1}${runSuffix}`);
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

async function createRoom(page: Page) {
  await page.locator('[data-open-create-room]').click();
  await page.locator('[data-create-room-submit]').click();
}

async function joinRoomFromList(page: Page, roomId: string) {
  const room = page.locator(`[data-room-item][data-room-code="${roomId}"]`);
  await expect(room).toBeVisible({ timeout: 10000 });
  await room.click();
}

async function readyPlayers(...pages: Page[]) {
  for (const page of pages) {
    await expect(page.locator('[data-ready-toggle]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-ready-toggle]').click();
  }
}

async function expectAllowsFullText(locator: Locator) {
  const style = await locator.evaluate((node) => {
    const computedStyle = window.getComputedStyle(node);

    return {
      overflowX: computedStyle.overflowX,
      textOverflow: computedStyle.textOverflow,
      whiteSpace: computedStyle.whiteSpace,
    };
  });

  expect(style.overflowX).not.toBe('hidden');
  expect(style.textOverflow).toBe('clip');
  expect(style.whiteSpace).not.toBe('nowrap');
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

async function getLocalPeerId(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as { identity?: { peerId: string } } | undefined;

    return debug?.identity?.peerId ?? 'none';
  });
}

async function getStateHash(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as { game?: { stateHash: string } } | undefined;

    return debug?.game?.stateHash ?? 'none';
  });
}

async function getHostPeerId(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as { hostPeerId?: string | null } | undefined;

    return debug?.hostPeerId ?? null;
  });
}

async function getGameMarker(page: Page) {
  return page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as {
      game?: {
        currentRound?: { board: { occupiedCellKeys: string[] } };
        revision: number;
        stateHash: string;
      };
    } | undefined;

    return {
      boardCount: debug?.game?.currentRound?.board.occupiedCellKeys.length ?? -1,
      revision: debug?.game?.revision ?? -1,
      stateHash: debug?.game?.stateHash ?? 'none',
    };
  });
}

async function expectSpectatorStateIsRedacted(page: Page, playerCount: number) {
  const state = await page.evaluate(() => {
    const debug = window.__PENGUIN_DEBUG__ as {
      game?: {
        currentRound?: {
          deck: { shuffledCardIds: string[]; dealtCardIdsByPlayer: Record<string, string[]> };
          players: Record<string, { handCardIds: string[] }>;
        };
        randomSeed: string;
      };
    } | undefined;

    return {
      dealtPlayerCount: Object.keys(debug?.game?.currentRound?.deck.dealtCardIdsByPlayer ?? {}).length,
      handCounts: Object.values(debug?.game?.currentRound?.players ?? {}).map((player) => player.handCardIds.length),
      randomSeed: debug?.game?.randomSeed,
      shuffledCardCount: debug?.game?.currentRound?.deck.shuffledCardIds.length,
    };
  });

  expect(state).toEqual({
    dealtPlayerCount: 0,
    handCounts: Array.from({ length: playerCount }, () => 0),
    randomSeed: 'redacted',
    shuffledCardCount: 0,
  });
}

async function startConnectionIndicatorAudit(page: Page) {
  await page.evaluate(() => {
    const auditWindow = window as Window & {
      __connectionIndicatorHistory?: string[];
      __connectionIndicatorObserver?: MutationObserver;
    };
    const indicator = document.querySelector('.connection-indicator');
    const history: string[] = [];
    const recordIndicator = () => history.push(indicator?.textContent?.trim() ?? '');

    auditWindow.__connectionIndicatorObserver?.disconnect();
    auditWindow.__connectionIndicatorHistory = history;
    recordIndicator();

    if (indicator) {
      const observer = new MutationObserver(recordIndicator);
      observer.observe(indicator, { characterData: true, childList: true, subtree: true });
      auditWindow.__connectionIndicatorObserver = observer;
    }
  });
}

async function getConnectionIndicatorHistory(page: Page) {
  return page.evaluate(() => {
    const auditWindow = window as Window & { __connectionIndicatorHistory?: string[] };

    return auditWindow.__connectionIndicatorHistory ?? [];
  });
}

async function getStoredRejoinSessions(page: Page) {
  return page.evaluate(() => Object.keys(window.localStorage)
    .filter((key) => key.startsWith('penguin-party.rejoinSession.'))
    .map((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null') as {
      rejoinCode: string;
      recoveryKey?: string;
      signalingServerUrl: string;
    })
    .filter(Boolean));
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
