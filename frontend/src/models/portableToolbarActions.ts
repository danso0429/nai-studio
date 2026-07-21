export const PORTABLE_TOOLBAR_ACTION_EVENT = 'portable-toolbar-action';

export type LocallyOwnedPortableAction =
  | 'add-session'
  | 'character-presets'
  | 'scene-template'
  | 'scene-trash';

export function requestLocallyOwnedPortableAction(
  action: LocallyOwnedPortableAction,
): void {
  window.dispatchEvent(
    new CustomEvent(PORTABLE_TOOLBAR_ACTION_EVENT, { detail: { action } }),
  );
}
