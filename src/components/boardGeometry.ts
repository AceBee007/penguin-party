interface PyramidTarget {
  level: number;
  x: number;
}

export interface BoardGeometryInput {
  width: number;
  height: number;
  minVisualX: number;
  maxVisualX: number;
  maxLevel: number;
}

export interface BoardGeometry {
  cardWidth: number;
  cardHeight: number;
  gapX: number;
  rowRise: number;
  originX: number;
  baseY: number;
  boardTopY: number;
  handBottomY: number;
  scale: number;
}

const MAX_CARD_WIDTH = 78;
const BASE_MIN_CARD_WIDTH = 42;
const ABSOLUTE_MIN_CARD_WIDTH = 18;
const CARD_ASPECT_RATIO = 1.28;
const ROW_RISE_RATIO = 0.8;
const HAND_Y_OFFSET_RATIO = 2.22;
const EDGE_PADDING = 18;

export function getVisualBoardX(target: PyramidTarget): number {
  return target.x + target.level * 0.5;
}

export function createBoardGeometry(input: BoardGeometryInput): BoardGeometry {
  const availableWidth = Math.max(220, input.width - 60);
  const baseCardWidth = Math.min(MAX_CARD_WIDTH, Math.max(BASE_MIN_CARD_WIDTH, availableWidth / 9.7));
  const maxLevel = Math.max(0, input.maxLevel);
  const verticalCardWidth = getVerticalFitCardWidth(input.height, maxLevel);
  const cardWidth = Math.max(ABSOLUTE_MIN_CARD_WIDTH, Math.min(baseCardWidth, verticalCardWidth));
  const cardHeight = cardWidth * CARD_ASPECT_RATIO;
  const gap = Math.max(4, cardWidth * 0.13);
  const columns = Math.max(1, input.maxVisualX - input.minVisualX + 1);
  const gapX = Math.min(cardWidth + gap, availableWidth / columns);
  const originX = input.width / 2 - ((input.minVisualX + input.maxVisualX) / 2) * gapX;
  const rowRise = cardHeight * ROW_RISE_RATIO;
  const topBaseY = EDGE_PADDING + cardHeight / 2 + maxLevel * rowRise;
  const bottomBaseY = input.height - EDGE_PADDING - cardHeight * (HAND_Y_OFFSET_RATIO + 0.5);
  const preferredBaseY = Math.min(input.height * 0.55, input.height - cardHeight * 2.95);
  const baseY = clamp(preferredBaseY, topBaseY, Math.max(topBaseY, bottomBaseY));

  return {
    cardWidth,
    cardHeight,
    gapX,
    rowRise,
    originX,
    baseY,
    boardTopY: baseY - maxLevel * rowRise - cardHeight / 2,
    handBottomY: baseY + cardHeight * (HAND_Y_OFFSET_RATIO + 0.5),
    scale: cardWidth / baseCardWidth,
  };
}

function getVerticalFitCardWidth(height: number, maxLevel: number): number {
  const availableHeight = Math.max(80, height - EDGE_PADDING * 2);
  const heightUnits = CARD_ASPECT_RATIO * (maxLevel * ROW_RISE_RATIO + HAND_Y_OFFSET_RATIO + 1);

  return availableHeight / heightUnits;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
