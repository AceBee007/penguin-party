interface PyramidTarget {
  level: number;
  x: number;
}

export function getVisualBoardX(target: PyramidTarget): number {
  return target.x + target.level * 0.5;
}
