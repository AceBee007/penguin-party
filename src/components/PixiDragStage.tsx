import { useEffect, useMemo, useRef } from 'react';
import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
} from 'pixi.js';
import { CARD_COLOR_LABELS, getCurrentRoundPlayer, sameTarget } from '../game/rules';
import type { CardColor, CardId, GameSessionState, LegalMove, MoveTarget, PlayerId } from '../game/types';
import {
  HAND_ROW_SPACING_RATIO,
  HAND_Y_OFFSET_RATIO,
  createBoardGeometry,
  getVisualBoardX,
} from './boardGeometry';

interface PixiDragStageProps {
  game: GameSessionState;
  activePlayerId: PlayerId | null;
  handPlayerId?: PlayerId | null;
  canPlay?: boolean;
  legalMoves: LegalMove[];
  onPlayCard: (cardId: CardId, target: MoveTarget) => void;
  onDragStatusChange: (status: StageDragStatus) => void;
}

export interface StageDragStatus {
  selectedCard: string;
  target: string;
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
}

interface DragState {
  cardId: CardId;
  container: Container;
  legalTargets: MoveTarget[];
  offsetX: number;
  offsetY: number;
}

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
  legalMoves,
  onPlayCard,
  onDragStatusChange,
}: PixiDragStageProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const legalMoveKey = useMemo(() => serializeLegalMoves(legalMoves), [legalMoves]);

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return undefined;
    }

    let destroyed = false;
    let app: Application | null = null;

    void startPixiGameStage(
      mount,
      game,
      handPlayerId ?? activePlayerId,
      canPlay,
      legalMoves,
      onPlayCard,
      onDragStatusChange,
      () => destroyed,
    ).then((createdApp) => {
      app = createdApp;

      if (destroyed) {
        app.destroy({ removeView: true }, DESTROY_OPTIONS);
      }
    });

    return () => {
      destroyed = true;

      if (app) {
        app.destroy({ removeView: true }, DESTROY_OPTIONS);
        app = null;
      }
    };
  }, [activePlayerId, canPlay, game, handPlayerId, legalMoveKey, legalMoves, onDragStatusChange, onPlayCard]);

  return <div className="pixi-root" data-pixi-root ref={mountRef} />;
}

async function startPixiGameStage(
  mount: HTMLDivElement,
  game: GameSessionState,
  handPlayerId: PlayerId | null,
  canPlay: boolean,
  legalMoves: LegalMove[],
  onPlayCard: (cardId: CardId, target: MoveTarget) => void,
  onDragStatusChange: (status: StageDragStatus) => void,
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

  app.canvas.setAttribute('aria-label', 'Penguin Party game board');
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
    const boardLayout = createBoardLayout(app.screen.width, app.screen.height, game, legalMoves, handPlayerId);
    const hovered = findNearestTarget(pointer.x, pointer.y, dragState.legalTargets, boardLayout);

    drawLegalTargets(targetLayer, boardLayout, dragState.legalTargets, hovered);
    onDragStatusChange({
      selectedCard: readableCardName(game, dragState.cardId),
      target: hovered ? `L${hovered.level + 1} X${hovered.x}` : 'No target',
    });
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
    const boardLayout = createBoardLayout(width, height, game, legalMoves, handPlayerId);

    background.clear();
    drawBackground(background, width, height);
    targetLayer.removeChildren();
    boardLayer.removeChildren();
    handLayer.removeChildren();
    if (!dragState) {
      dragLayer.removeChildren();
    }
    drawBoard(boardLayer, boardLayout, game);
    drawHand(handLayer, dragLayer, boardLayout, game, handPlayerId, canPlay, legalMoves, (nextDragState) => {
      dragState = nextDragState;
      drawLegalTargets(targetLayer, boardLayout, dragState.legalTargets, null);
      onDragStatusChange({
        selectedCard: readableCardName(game, dragState.cardId),
        target: 'Choose a highlighted slot',
      });
    });
  }

  function finishDrag() {
    if (!dragState) {
      return;
    }

    const boardLayout = createBoardLayout(app.screen.width, app.screen.height, game, legalMoves, handPlayerId);
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
      onDragStatusChange({
        selectedCard: readableCardName(game, cardId),
        target: 'Returned to hand',
      });
    }
  }
}

function drawBackground(background: Graphics, width: number, height: number) {
  background.rect(0, 0, width, height).fill(0xe8f4f3);
  background.rect(0, height * 0.64, width, height * 0.36).fill(0xf4ead6);
  background.roundRect(24, 24, width - 48, height * 0.58, 8).fill({ color: 0xffffff, alpha: 0.34 });
  background.moveTo(32, height * 0.64).lineTo(width - 32, height * 0.64).stroke({
    color: 0x17313a,
    alpha: 0.16,
    width: 2,
  });
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
      CARD_COLOR_LABELS[card.color],
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
) {
  const round = game.currentRound;

  if (!round || !handPlayerId || game.status !== 'round_active') {
    drawCenteredLabel(handLayer, 'Round complete', boardLayout.originX, boardLayout.baseY + boardLayout.cardHeight * 2.2);
    return;
  }

  const player = getCurrentRoundPlayer(game, handPlayerId);

  if (!player) {
    return;
  }

  if (player.handCardIds.length === 0) {
    drawCenteredLabel(handLayer, 'No cards', boardLayout.originX, boardLayout.baseY + boardLayout.cardHeight * 2.2);
    return;
  }

  const maxCards = player.handCardIds.length;
  const handY = boardLayout.baseY + boardLayout.cardHeight * HAND_Y_OFFSET_RATIO;
  const cardLayouts = getHandCardLayouts(boardLayout, maxCards);
  const stageDebugCards: Array<{
    cardId: CardId;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    targets: Array<MoveTarget & { centerX: number; centerY: number }>;
  }> = [];

  player.handCardIds.forEach((cardId, index) => {
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
      CARD_COLOR_LABELS[card.color],
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

  window.__PENGUIN_STAGE_DEBUG__ = {
    handCards: stageDebugCards,
    handLayerChildren: handLayer.children.length,
    dragLayerChildren: dragLayer.children.length,
    boardTopY: boardLayout.boardTopY,
    handBottomY: boardLayout.handBottomY,
    handRows: boardLayout.handRows,
    stageWidth: boardLayout.stageWidth,
    stageHeight: boardLayout.stageHeight,
    scale: boardLayout.scale,
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
): BoardLayout {
  const board = game.currentRound?.board;
  const xValues = [
    ...(board?.occupiedCellKeys.map((key) => getVisualBoardX(board.cardsByCell[key])) ?? []),
    ...legalMoves.map((move) => getVisualBoardX(move.target)),
    0,
  ];
  const levelValues = [
    ...(board?.occupiedCellKeys.map((key) => board.cardsByCell[key].level) ?? []),
    ...legalMoves.map((move) => move.target.level),
    0,
  ];
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const maxLevel = Math.max(...levelValues);
  const handCardCount = handPlayerId ? getCurrentRoundPlayer(game, handPlayerId)?.handCardIds.length ?? 0 : 0;

  return {
    ...createBoardGeometry({ width, height, minVisualX: minX, maxVisualX: maxX, maxLevel, handCardCount }),
    stageWidth: width,
    stageHeight: height,
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

function readableCardName(game: GameSessionState, cardId: CardId): string {
  const card = game.cardsById[cardId];
  return card ? `${CARD_COLOR_LABELS[card.color]} ${card.serial}` : cardId;
}

function ownerInitial(game: GameSessionState, playerId: PlayerId): string {
  if (playerId === 'initial-board') {
    return 'B';
  }

  const player = game.players.find((candidate) => candidate.playerId === playerId);
  return player?.displayName.slice(0, 1).toUpperCase() ?? '?';
}

function serializeLegalMoves(legalMoves: LegalMove[]): string {
  return legalMoves.map((move) => `${move.cardId}:${move.target.level}:${move.target.x}`).join('|');
}
