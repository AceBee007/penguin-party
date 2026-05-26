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
  handCardCount?: number;
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
  handRows: number;
  scale: number;
}

const MAX_CARD_WIDTH = 78;
const BASE_MIN_CARD_WIDTH = 42;
const ABSOLUTE_MIN_CARD_WIDTH = 18;
const CARD_ASPECT_RATIO = 1.28;
const ROW_RISE_RATIO = 0.8;
export const HAND_Y_OFFSET_RATIO = 2.22;
export const HAND_ROW_SPACING_RATIO = 0.74;
const EDGE_PADDING = 18;
const HAND_HORIZONTAL_PADDING = 30;
const HAND_WRAP_STAGE_WIDTH = 520;
const HAND_COMPACT_SPACING_RATIO = 0.66;
const HAND_SINGLE_ROW_SPAN_RATIO = 8.8;

export function getVisualBoardX(target: PyramidTarget): number {
  return target.x + target.level * 0.5;
}

export function createBoardGeometry(input: BoardGeometryInput): BoardGeometry {
  const availableWidth = Math.max(220, input.width - 60);
  const baseCardWidth = Math.min(MAX_CARD_WIDTH, Math.max(BASE_MIN_CARD_WIDTH, availableWidth / 9.7));
  const maxLevel = Math.max(0, input.maxLevel);
  const handCardCount = Math.max(0, input.handCardCount ?? 0);
  let handRows = getHandRowCount(input.width, baseCardWidth, handCardCount);
  let verticalCardWidth = getVerticalFitCardWidth(input.height, maxLevel, handRows);
  let cardWidth = Math.max(ABSOLUTE_MIN_CARD_WIDTH, Math.min(baseCardWidth, verticalCardWidth));

  handRows = getHandRowCount(input.width, cardWidth, handCardCount);
  verticalCardWidth = getVerticalFitCardWidth(input.height, maxLevel, handRows);
  cardWidth = Math.max(ABSOLUTE_MIN_CARD_WIDTH, Math.min(baseCardWidth, verticalCardWidth));

  const cardHeight = cardWidth * CARD_ASPECT_RATIO;
  const gap = Math.max(4, cardWidth * 0.13);
  const columns = Math.max(1, input.maxVisualX - input.minVisualX + 1);
  const gapX = Math.min(cardWidth + gap, availableWidth / columns);
  const originX = input.width / 2 - ((input.minVisualX + input.maxVisualX) / 2) * gapX;
  const rowRise = cardHeight * ROW_RISE_RATIO;
  const handBottomOffsetRatio = getHandBottomOffsetRatio(handRows);
  const topBaseY = EDGE_PADDING + cardHeight / 2 + maxLevel * rowRise;
  const bottomBaseY = input.height - EDGE_PADDING - cardHeight * handBottomOffsetRatio;
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
    handBottomY: baseY + cardHeight * handBottomOffsetRatio,
    handRows,
    scale: cardWidth / baseCardWidth,
  };
}

function getVerticalFitCardWidth(height: number, maxLevel: number, handRows: number): number {
  const availableHeight = Math.max(80, height - EDGE_PADDING * 2);
  const heightUnits = CARD_ASPECT_RATIO * (maxLevel * ROW_RISE_RATIO + 0.5 + getHandBottomOffsetRatio(handRows));

  return availableHeight / heightUnits;
}

function getHandBottomOffsetRatio(handRows: number): number {
  return HAND_Y_OFFSET_RATIO + HAND_ROW_SPACING_RATIO * Math.max(0, handRows - 1) + 0.5;
}

function getHandRowCount(stageWidth: number, cardWidth: number, cardCount: number): number {
  if (cardCount <= 1) {
    return 1;
  }

  const availableHandWidth = Math.max(cardWidth, stageWidth - HAND_HORIZONTAL_PADDING * 2);
  const compactSpacing = Math.max(12, cardWidth * HAND_COMPACT_SPACING_RATIO);
  const compactColumns = Math.max(1, Math.floor((availableHandWidth - cardWidth) / compactSpacing) + 1);

  if (stageWidth > HAND_WRAP_STAGE_WIDTH || compactColumns >= cardCount) {
    return 1;
  }

  const singleRowWidth = Math.min((cardWidth + 10) * (cardCount - 1), cardWidth * HAND_SINGLE_ROW_SPAN_RATIO) + cardWidth;

  if (singleRowWidth <= availableHandWidth) {
    return 1;
  }

  return Math.ceil(cardCount / compactColumns);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
