export const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export function autoDetectInitialThumbSize(): number {
  if (typeof window === 'undefined') return 200;
  const width = window.innerWidth;
  if (width < 480) return 80;
  if (width < 768) return 200;
  if (width < 1280) return 400;
  return 500;
}

export function getInitialThumbSize(configValue: number | undefined): number {
  if (configValue && configValue > 0) return configValue;
  return autoDetectInitialThumbSize();
}
