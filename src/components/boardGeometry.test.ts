import { describe, expect, it } from 'vitest';
import { createBoardGeometry, createPerfectPyramidBoardGeometry, getVisualBoardX } from './boardGeometry';

describe('board geometry', () => {
  it('centers upper pyramid cards over their two supporting cards', () => {
    expect(getVisualBoardX({ level: 0, x: 0 })).toBe(0);
    expect(getVisualBoardX({ level: 0, x: 1 })).toBe(1);
    expect(getVisualBoardX({ level: 1, x: 0 })).toBe(0.5);
    expect(getVisualBoardX({ level: 2, x: 0 })).toBe(1);
  });

  it('scales a tall pyramid so board and hand stay inside a short viewport', () => {
    const regular = createBoardGeometry({
      width: 390,
      height: 720,
      minVisualX: 0,
      maxVisualX: 8,
      maxLevel: 0,
    });
    const compact = createBoardGeometry({
      width: 390,
      height: 360,
      minVisualX: 0,
      maxVisualX: 8,
      maxLevel: 7,
    });

    expect(compact.scale).toBeLessThan(regular.scale);
    expect(compact.boardTopY).toBeGreaterThanOrEqual(18);
    expect(compact.handBottomY).toBeLessThanOrEqual(360 - 18 + 0.001);
  });

  it('wraps large hands on narrow stages and reserves vertical space for them', () => {
    const narrow = createBoardGeometry({
      width: 344,
      height: 360,
      minVisualX: 0,
      maxVisualX: 8,
      maxLevel: 0,
      handCardCount: 18,
    });

    expect(narrow.handRows).toBeGreaterThan(1);
    expect(narrow.handBottomY).toBeLessThanOrEqual(360 - 18 + 0.001);
  });

  it('fits spectator fullscreen boards to the stricter viewport dimension', () => {
    const widthConstrained = createPerfectPyramidBoardGeometry({ width: 200, height: 1000 });
    const widthConstrainedPyramidWidth = widthConstrained.cardWidth + 7 * widthConstrained.gapX;
    const widthConstrainedPyramidHeight = widthConstrained.cardHeight + 7 * widthConstrained.rowRise;

    expect(widthConstrainedPyramidWidth).toBeCloseTo(200 * 0.95, 4);
    expect(widthConstrainedPyramidHeight).toBeLessThan(1000 * 0.95);

    const heightConstrained = createPerfectPyramidBoardGeometry({ width: 1200, height: 300 });
    const heightConstrainedPyramidWidth = heightConstrained.cardWidth + 7 * heightConstrained.gapX;
    const heightConstrainedPyramidHeight = heightConstrained.cardHeight + 7 * heightConstrained.rowRise;

    expect(heightConstrainedPyramidHeight).toBeCloseTo(300 * 0.95, 4);
    expect(heightConstrainedPyramidWidth).toBeLessThan(1200 * 0.95);
  });
});
