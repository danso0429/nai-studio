export function horizontalSwipeDirection(
  deltaX: number,
  deltaY: number,
  minimumDistance = 50,
): -1 | 0 | 1 {
  if (Math.abs(deltaX) < minimumDistance) return 0;
  if (Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return 0;
  return deltaX < 0 ? 1 : -1;
}
