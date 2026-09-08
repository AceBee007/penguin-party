import { useEffect, useMemo, useRef } from 'react';
import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
} from 'pixi.js';
import { getCurrentRoundPlayer, sameTarget } from '../game/rules';
import type { CardColor, CardId, GameSessionState, LegalMove, MoveTarget, PlayerId } from '../game/types';
import { cardColorLabel, t } from '../i18n/uiText';
import {
  HAND_ROW_SPACING_RATIO,
  HAND_Y_OFFSET_RATIO,
  createBoardOnlyGeometry,
  createBoardGeometry,
  createPerfectPyramidBoardGeometry,
  getBoardVisualBounds,
  getVisualBoardX,
} from './boardGeometry';
import { useSelectedLocale } from './LanguageSelector';

type BoardFitMode = 'dynamic' | 'perfect-pyramid';

interface PixiDragStageProps {
  game: GameSessionState;
  activePlayerId: PlayerId | null;
  handPlayerId?: PlayerId | null;
  canPlay?: boolean;
  debugId?: string;
  fitMode?: BoardFitMode;
  legalMoves: LegalMove[];
  showHand?: boolean;
  onPlayCard: (cardId: CardId, target: MoveTarget) => void;
}

interface CardLayout {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface BoardLayout {
  cardWidth: number;
  cardHeight: number;
  gapX: number;
  rowRise: number;
  originX: number;
  baseY: number;
  boardTopY: number;
  handBottomY: number;
  handRows: number;
  stageWidth: number;
  stageHeight: number;
  scale: number;
  minVisualX: number;
  maxVisualX: number;
}

interface DragState {
  cardId: CardId;
  container: Container;
  legalTargets: MoveTarget[];
  offsetX: number;
  offsetY: number;
}

type StageDebugCard = {
  cardId: CardId;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  targets: Array<MoveTarget & { centerX: number; centerY: number }>;
};

const COLOR_HEX: Record<CardColor, number> = {
  green: 0x38a169,
  yellow: 0xf2c94c,
  red: 0xeb5757,
  purple: 0x8d5bb5,
  blue: 0x2f80ed,
};

const COLOR_TEXT: Record<CardColor, number> = {
  green: 0xf7fff7,
  yellow: 0x1d2b32,
  red: 0xffffff,
  purple: 0xffffff,
  blue: 0xffffff,
};

const DESTROY_OPTIONS = { children: true };
const HAND_HORIZONTAL_PADDING = 30;

export function PixiDragStage({
  game,
  activePlayerId,
  handPlayerId,
  canPlay = true,
  debugId = 'game-stage',
  fitMode = 'dynamic',
  legalMoves,
  showHand = true,
  onPlayCard,
}: PixiDragStageProps) {
  const locale = useSelectedLocale();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const legalMoveKey = useMemo(() => serializeLegalMoves(legalMoves), [legalMoves]);
  const resolvedHandPlayerId = showHand ? handPlayerId ?? activePlayerId : null;

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return undefined;
    }

    let destroyed = false;
    let app: Application | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let visualViewport: VisualViewport | null = null;
    const queueResize = () => app?.queueResize();

    void startPixiGameStage(
      mount,
      game,
      resolvedHandPlayerId,
      canPlay,
      debugId,
      fitMode,
      legalMoves,
      showHand,
      onPlayCard,
      () => destroyed,
    ).then((createdApp) => {
      if (destroyed) {
        createdApp.destroy({ removeView: true }, DESTROY_OPTIONS);
        return;
      }

      app = createdApp;
      resizeObserver = new ResizeObserver(queueResize);
      resizeObserver.observe(mount);
      visualViewport = window.visualViewport;
      visualViewport?.addEventListener('resize', queueResize);
      createdApp.queueResize();
    });

    return () => {
      destroyed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      visualViewport?.removeEventListener('resize', queueResize);
      visualViewport = null;

      if (app) {
        app.destroy({ removeView: true }, DESTROY_OPTIONS);
        app = null;
      }
    };
  }, [canPlay, debugId, fitMode, game, legalMoveKey, legalMoves, locale, onPlayCard, resolvedHandPlayerId, showHand]);

  return <div className="pixi-root" data-pixi-root ref={mountRef} />;
}

async function startPixiGameStage(
  mount: HTMLDivElement,
  game: GameSessionState,
  handPlayerId: PlayerId | null,
  canPlay: boolean,
  debugId: string,
  fitMode: BoardFitMode,
  legalMoves: LegalMove[],
  showHand: boolean,
  onPlayCard: (cardId: CardId, target: MoveTarget) => void,
  isDestroyed: () => boolean,
) {
  const app = new Application();

  await app.init({
    antialias: true,
    autoDensity: true,
    background: '#e8f4f3',
    resizeTo: mount,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });

  if (isDestroyed()) {
    return app;
  }

  app.canvas.setAttribute('aria-label', t('aria.gameBoard'));
  mount.appendChild(app.canvas);

  const background = new Graphics();
  const boardLayer = new Container();
  const targetLayer = new Container();
  const handLayer = new Container();
  const dragLayer = new Container();

  app.stage.addChild(background, targetLayer, boardLayer, handLayer, dragLayer);
  app.stage.eventMode = 'static';
  app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);

  let dragState: DragState | null = null;
  const lastScreenSize = { width: 0, height: 0 };

  app.stage.on('globalpointermove', (event: FederatedPointerEvent) => {
    if (!dragState) {
      return;
    }

    const pointer = dragLayer.toLocal(event.global);
    dragState.container.position.set(pointer.x + dragState.offsetX, pointer.y + dragState.offsetY);
    const boardLayout = createBoardLayout(app.screen.width, app.screen.height, game, legalMoves, handPlayerId, showHand, fitMode);
    const hovered = findNearestTarget(pointer.x, pointer.y, dragState.legalTargets, boardLayout);

    drawLegalTargets(targetLayer, boardLayout, dragState.legalTargets, hovered);
  });
  app.stage.on('pointerup', () => finishDrag());
  app.stage.on('pointerupoutside', () => finishDrag());

  app.ticker.add(() => {
    if (lastScreenSize.width === app.screen.width && lastScreenSize.height === app.screen.height) {
      return;
    }

    lastScreenSize.width = app.screen.width;
    lastScreenSize.height = app.screen.height;
    app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
    renderScene();
  });

  renderScene();

  return app;

  function renderScene() {
    const width = app.screen.width;
    const height = app.screen.height;
    const boardLayout = createBoardLayout(width, height, game, legalMoves, handPlayerId, showHand, fitMode);

    background.clear();
    drawBackground(background, width, height, showHand);
    targetLayer.removeChildren();
    boardLayer.removeChildren();
    handLayer.removeChildren();
    if (!dragState) {
      dragLayer.removeChildren();
    }
    drawBoard(boardLayer, boardLayout, game);
    const handDebugCards = showHand
      ? drawHand(
        handLayer,
        dragLayer,
        boardLayout,
        game,
        handPlayerId,
        canPlay,
        legalMoves,
        (nextDragState) => {
          dragState = nextDragState;
          drawLegalTargets(targetLayer, boardLayout, dragState.legalTargets, null);
        },
      )
      : [];
    writeStageDebug(debugId, boardLayout, handLayer, dragLayer, handDebugCards, fitMode);
  }

  function finishDrag() {
    if (!dragState) {
      return;
    }

    const boardLayout = createBoardLayout(app.screen.width, app.screen.height, game, legalMoves, handPlayerId, showHand, fitMode);
    const target = findNearestTarget(dragState.container.x, dragState.container.y, dragState.legalTargets, boardLayout);
    const cardId = dragState.cardId;
    const draggedContainer = dragState.container;

    dragState = null;
    targetLayer.removeChildren();
    draggedContainer.parent?.removeChild(draggedContainer);

    if (target) {
      onPlayCard(cardId, target);
    } else {
      renderScene();
    }
  }
}

function drawBackground(background: Graphics, width: number, height: number, showHand: boolean) {
  background.rect(0, 0, width, height).fill(0xe8f4f3);
  if (showHand) {
    background.rect(0, height * 0.64, width, height * 0.36).fill(0xf4ead6);
  }
  background.roundRect(24, 24, width - 48, height * 0.58, 8).fill({ color: 0xffffff, alpha: 0.34 });
  if (showHand) {
    background.moveTo(32, height * 0.64).lineTo(width - 32, height * 0.64).stroke({
      color: 0x17313a,
      alpha: 0.16,
      width: 2,
    });
  }
}

function drawBoard(layer: Container, layout: BoardLayout, game: GameSessionState) {
  const round = game.currentRound;

  if (!round) {
    return;
  }

  for (const key of round.board.occupiedCellKeys) {
    const card = round.board.cardsByCell[key];
    const cardLayout = getCardLayoutForTarget(layout, card);
    const container = createCardContainer(
      card.color,
      cardColorLabel(card.color),
      ownerInitial(game, card.ownerPlayerId),
      cardLayout,
      1,
    );
    layer.addChild(container);
  }
}

function drawLegalTargets(
  layer: Container,
  layout: BoardLayout,
  targets: MoveTarget[],
  hoveredTarget: MoveTarget | null,
) {
  layer.removeChildren();

  for (const target of targets) {
    const cardLayout = getCardLayoutForTarget(layout, target);
    const isHovered = hoveredTarget ? sameTarget(target, hoveredTarget) : false;
    const marker = new Graphics()
      .roundRect(-cardLayout.width / 2, -cardLayout.height / 2, cardLayout.width, cardLayout.height, 8)
      .fill({ color: isHovered ? 0xffffff : 0x17313a, alpha: isHovered ? 0.54 : 0.12 })
      .stroke({ color: isHovered ? 0x17313a : 0xffffff, alpha: 0.72, width: isHovered ? 3 : 2 });
    marker.position.set(cardLayout.centerX, cardLayout.centerY);
    layer.addChild(marker);
  }
}

function drawHand(
  handLayer: Container,
  dragLayer: Container,
  boardLayout: BoardLayout,
  game: GameSessionState,
  handPlayerId: PlayerId | null,
  canPlay: boolean,
  legalMoves: LegalMove[],
  onStartDrag: (dragState: DragState) => void,
): StageDebugCard[] {
  const round = game.currentRound;

  if (!round || !handPlayerId) {
    drawCenteredLabel(handLayer, t('waiting.roundComplete'), boardLayout.originX, getHandStatusLabelY(boardLayout));
    return [];
  }

  const player = getCurrentRoundPlayer(game, handPlayerId);

  if (!player) {
    return [];
  }

  if (game.status !== 'round_active') {
    const handCards = drawHandCards(
      handLayer,
      dragLayer,
      boardLayout,
      game,
      player.handCardIds,
      false,
      legalMoves,
      onStartDrag,
    );

    drawCenteredLabel(handLayer, t('waiting.roundComplete'), boardLayout.originX, getHandStatusLabelY(boardLayout));
    return handCards;
  }

  if (player.handCardIds.length === 0) {
    drawCenteredLabel(handLayer, t('waiting.noCards'), boardLayout.originX, boardLayout.baseY + boardLayout.cardHeight * 2.2);
    return [];
  }

  return drawHandCards(
    handLayer,
    dragLayer,
    boardLayout,
    game,
    player.handCardIds,
    canPlay,
    legalMoves,
    onStartDrag,
  );
}

function drawHandCards(
  handLayer: Container,
  dragLayer: Container,
  boardLayout: BoardLayout,
  game: GameSessionState,
  handCardIds: CardId[],
  canPlay: boolean,
  legalMoves: LegalMove[],
  onStartDrag: (dragState: DragState) => void,
): StageDebugCard[] {
  const maxCards = handCardIds.length;
  const handY = boardLayout.baseY + boardLayout.cardHeight * HAND_Y_OFFSET_RATIO;
  const cardLayouts = getHandCardLayouts(boardLayout, maxCards);
  const stageDebugCards: StageDebugCard[] = [];

  handCardIds.forEach((cardId, index) => {
    const card = game.cardsById[cardId];
    const cardLegalMoves = canPlay ? legalMoves.filter((move) => move.cardId === cardId) : [];
    const cardLayout: CardLayout = cardLayouts[index] ?? {
      centerX: boardLayout.stageWidth / 2,
      centerY: handY,
      width: boardLayout.cardWidth,
      height: boardLayout.cardHeight,
    };
    stageDebugCards.push({
      cardId,
      centerX: cardLayout.centerX,
      centerY: cardLayout.centerY,
      width: cardLayout.width,
      height: cardLayout.height,
      targets: cardLegalMoves.map((move) => {
        const targetLayout = getCardLayoutForTarget(boardLayout, move.target);

        return {
          ...move.target,
          centerX: targetLayout.centerX,
          centerY: targetLayout.centerY,
        };
      }),
    });
    const container = createCardContainer(
      card.color,
      cardColorLabel(card.color),
      `${card.serial}`,
      cardLayout,
      cardLegalMoves.length > 0 ? 1 : 0.42,
    );

    if (cardLegalMoves.length > 0) {
      container.eventMode = 'static';
      container.cursor = 'grab';
      container.hitArea = new Rectangle(
        -cardLayout.width / 2,
        -cardLayout.height / 2,
        cardLayout.width,
        cardLayout.height,
      );
      container.on('pointerdown', (event: FederatedPointerEvent) => {
        dragLayer.addChild(container);
        container.cursor = 'grabbing';
        container.alpha = 0.9;
        container.scale.set(1.06);
        const pointer = dragLayer.toLocal(event.global);
        onStartDrag({
          cardId,
          container,
          legalTargets: cardLegalMoves.map((move) => move.target),
          offsetX: container.x - pointer.x,
          offsetY: container.y - pointer.y,
        });
      });
    }

    handLayer.addChild(container);
  });

  return stageDebugCards;
}

function getHandStatusLabelY(boardLayout: BoardLayout): number {
  return boardLayout.baseY + boardLayout.cardHeight * (HAND_Y_OFFSET_RATIO - 0.82);
}

function writeStageDebug(
  debugId: string,
  boardLayout: BoardLayout,
  handLayer: Container,
  dragLayer: Container,
  handCards: StageDebugCard[],
  fitMode: BoardFitMode,
) {
  const perfectPyramidWidth = boardLayout.cardWidth + 7 * boardLayout.gapX;
  const perfectPyramidHeight = boardLayout.cardHeight + 7 * boardLayout.rowRise;
  const visibleBoardLeftX = boardLayout.originX + boardLayout.minVisualX * boardLayout.gapX - boardLayout.cardWidth / 2;
  const visibleBoardRightX = boardLayout.originX + boardLayout.maxVisualX * boardLayout.gapX + boardLayout.cardWidth / 2;

  window.__PENGUIN_STAGE_DEBUG__ = {
    debugId,
    fitMode,
    handCards,
    handLayerChildren: handLayer.children.length,
    dragLayerChildren: dragLayer.children.length,
    boardTopY: boardLayout.boardTopY,
    handBottomY: boardLayout.handBottomY,
    handRows: boardLayout.handRows,
    stageWidth: boardLayout.stageWidth,
    stageHeight: boardLayout.stageHeight,
    scale: boardLayout.scale,
    perfectPyramidWidth,
    perfectPyramidHeight,
    visibleBoardLeftX,
    visibleBoardRightX,
  };
}

function getHandCardLayouts(layout: BoardLayout, cardCount: number): CardLayout[] {
  if (cardCount <= 0) {
    return [];
  }

  const rows = Math.max(1, Math.min(layout.handRows, cardCount));
  const columns = Math.ceil(cardCount / rows);
  const availableWidth = Math.max(layout.cardWidth, layout.stageWidth - HAND_HORIZONTAL_PADDING * 2);
  const handY = layout.baseY + layout.cardHeight * HAND_Y_OFFSET_RATIO;
  const rowSpacingY = layout.cardHeight * HAND_ROW_SPACING_RATIO;

  return Array.from({ length: cardCount }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const rowStartIndex = row * columns;
    const rowCardCount = Math.min(columns, cardCount - rowStartIndex);
    const maxSpacing = rowCardCount > 1 ? Math.max(0, (availableWidth - layout.cardWidth) / (rowCardCount - 1)) : 0;
    const spacing = rowCardCount > 1 ? Math.min(layout.cardWidth + 10, maxSpacing) : 0;
    const rowWidth = spacing * (rowCardCount - 1);

    return {
      centerX: layout.stageWidth / 2 - rowWidth / 2 + spacing * column,
      centerY: handY + rowSpacingY * row,
      width: layout.cardWidth,
      height: layout.cardHeight,
    };
  });
}

function createCardContainer(
  color: CardColor,
  label: string,
  footer: string,
  layout: CardLayout,
  alpha: number,
): Container {
  const container = new Container();
  const card = new Graphics()
    .roundRect(-layout.width / 2, -layout.height / 2, layout.width, layout.height, 8)
    .fill(COLOR_HEX[color])
    .stroke({ color: 0x17313a, alpha: 0.22, width: 2 });
  const shine = new Graphics()
    .roundRect(-layout.width / 2 + 7, -layout.height / 2 + 7, layout.width - 14, layout.height * 0.28, 6)
    .fill({ color: 0xffffff, alpha: 0.2 });
  const text = new Text({
    text: label,
    resolution: 2,
    style: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: Math.max(10, Math.round(layout.width * 0.18)),
      fontWeight: '800',
      fill: COLOR_TEXT[color],
      align: 'center',
    },
    anchor: 0.5,
  });
  const footerText = new Text({
    text: footer,
    resolution: 2,
    style: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: Math.max(10, Math.round(layout.width * 0.17)),
      fontWeight: '800',
      fill: COLOR_TEXT[color],
    },
    anchor: 0.5,
  });

  text.y = -layout.height * 0.05;
  footerText.y = layout.height * 0.31;
  container.position.set(layout.centerX, layout.centerY);
  container.alpha = alpha;
  container.addChild(card, shine, text, footerText);

  return container;
}

function drawCenteredLabel(layer: Container, label: string, x: number, y: number) {
  const text = new Text({
    text: label,
    resolution: 2,
    style: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 18,
      fontWeight: '800',
      fill: 0x17313a,
    },
    anchor: 0.5,
  });
  text.position.set(x, y);
  layer.addChild(text);
}

function createBoardLayout(
  width: number,
  height: number,
  game: GameSessionState,
  legalMoves: LegalMove[],
  handPlayerId: PlayerId | null,
  showHand: boolean,
  fitMode: BoardFitMode,
): BoardLayout {
  const board = game.currentRound?.board;
  const displayTargets = [
    ...(board?.occupiedCellKeys.map((key) => board.cardsByCell[key]) ?? []),
    ...legalMoves.map((move) => move.target),
  ];
  const { minVisualX: minX, maxVisualX: maxX, maxLevel } = getBoardVisualBounds(displayTargets);
  const handCardCount = handPlayerId ? getCurrentRoundPlayer(game, handPlayerId)?.handCardIds.length ?? 0 : 0;
  let geometry: ReturnType<typeof createBoardGeometry>;

  if (fitMode === 'perfect-pyramid') {
    geometry = createPerfectPyramidBoardGeometry({ width, height, minVisualX: minX, maxVisualX: maxX });
  } else if (showHand) {
    geometry = createBoardGeometry({ width, height, minVisualX: minX, maxVisualX: maxX, maxLevel, handCardCount });
  } else {
    geometry = createBoardOnlyGeometry({ width, height, minVisualX: minX, maxVisualX: maxX, maxLevel });
  }

  return {
    ...geometry,
    stageWidth: width,
    stageHeight: height,
    minVisualX: minX,
    maxVisualX: maxX,
  };
}

function getCardLayoutForTarget(layout: BoardLayout, target: MoveTarget): CardLayout {
  return {
    centerX: layout.originX + getVisualBoardX(target) * layout.gapX,
    centerY: layout.baseY - target.level * layout.rowRise,
    width: layout.cardWidth,
    height: layout.cardHeight,
  };
}

function findNearestTarget(
  x: number,
  y: number,
  targets: MoveTarget[],
  layout: BoardLayout,
): MoveTarget | null {
  let best: { target: MoveTarget; distance: number } | null = null;

  for (const target of targets) {
    const targetLayout = getCardLayoutForTarget(layout, target);
    const distance = Math.hypot(targetLayout.centerX - x, targetLayout.centerY - y);

    if (!best || distance < best.distance) {
      best = { target, distance };
    }
  }

  const threshold = Math.max(layout.cardWidth * 0.82, 40);
  return best && best.distance <= threshold ? best.target : null;
}

function ownerInitial(game: GameSessionState, playerId: PlayerId): string {
  if (playerId === 'initial-board') {
    return t('card.initialBoardFooter');
  }

  const player = game.players.find((candidate) => candidate.playerId === playerId);
  return player?.displayName.slice(0, 1).toUpperCase() ?? '?';
}

function serializeLegalMoves(legalMoves: LegalMove[]): string {
  return legalMoves.map((move) => `${move.cardId}:${move.target.level}:${move.target.x}`).join('|');
}
