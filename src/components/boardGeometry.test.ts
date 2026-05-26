import { describe, expect, it } from 'vitest';
import { getVisualBoardX } from './boardGeometry';

describe('board geometry', () => {
  it('centers upper pyramid cards over their two supporting cards', () => {
    expect(getVisualBoardX({ level: 0, x: 0 })).toBe(0);
    expect(getVisualBoardX({ level: 0, x: 1 })).toBe(1);
    expect(getVisualBoardX({ level: 1, x: 0 })).toBe(0.5);
    expect(getVisualBoardX({ level: 2, x: 0 })).toBe(1);
  });
});
