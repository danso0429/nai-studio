export interface ResolutionValue {
  resolution: string;
  width?: number;
  height?: number;
}

export function normalizeCustomResolution(
  widthText: string,
  heightText: string,
): ResolutionValue | null {
  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    resolution: 'custom',
    width: Math.max(64, Math.ceil(width / 64) * 64),
    height: Math.max(64, Math.ceil(height / 64) * 64),
  };
}
