export interface VisibleViewport {
  top: number;
  height: number;
  width: number;
}

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
}

export const positionAutocompletePopup = (
  caretY: number,
  popupHeight: number,
  gap: number,
  viewport: Pick<VisibleViewport, 'top' | 'height'>,
) => {
  const visibleBottom = viewport.top + viewport.height;
  const below = caretY + gap;
  if (below + popupHeight <= visibleBottom) return below;

  const above = caretY - gap - popupHeight;
  if (above >= viewport.top) return above;

  return Math.max(viewport.top, visibleBottom - popupHeight);
};

export const positionAnchoredPanel = (
  anchor: AnchorRect,
  panel: { width: number; height: number },
  viewport: VisibleViewport,
  margin = 8,
) => {
  const visibleRight = viewport.width;
  const visibleBottom = viewport.top + viewport.height;
  const idealLeft = anchor.left + anchor.width / 2 - panel.width / 2;

  return {
    left: Math.max(margin, Math.min(idealLeft, visibleRight - panel.width - margin)),
    top: Math.max(
      viewport.top + margin,
      Math.min(anchor.top, visibleBottom - panel.height - margin),
    ),
  };
};
