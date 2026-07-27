/**
 * @typedef {{
 *   initialized: boolean;
 *   initialActive: boolean;
 *   observedMigration: boolean;
 *   reloadStarted: boolean;
 * }} StorageMigrationReloadTracker
 */

/** @returns {StorageMigrationReloadTracker} */
export function createStorageMigrationReloadTracker() {
  return {
    initialized: false,
    initialActive: false,
    observedMigration: false,
    reloadStarted: false,
  };
}

/** @param {StorageMigrationReloadTracker} tracker */
export function noteStorageMigrationStarted(tracker) {
  tracker.observedMigration = true;
}

/**
 * Reload only when this page existed before the layout switched or actually
 * observed/started the migration. A page whose first status is already active
 * was booted against v2 and must not reload on every new PWA page session.
 *
 * @param {StorageMigrationReloadTracker} tracker
 * @param {{
 *   active?: boolean;
 *   legacyProjects?: number;
 *   runtime?: { running?: boolean; phase?: string };
 * }} status
 */
export function observeStorageMigrationStatus(tracker, status) {
  if (!tracker.initialized) {
    tracker.initialized = true;
    tracker.initialActive = status.active === true;
  }
  if (status.runtime?.running) tracker.observedMigration = true;

  const completed =
    status.active === true &&
    status.runtime?.phase === 'done' &&
    (status.legacyProjects ?? 0) === 0;
  if (!completed || tracker.reloadStarted) return false;

  const pagePredatesActivation = tracker.initialActive === false;
  if (!pagePredatesActivation && !tracker.observedMigration) return false;

  tracker.reloadStarted = true;
  return true;
}

/** @param {StorageMigrationReloadTracker} tracker */
export function resetStorageMigrationReload(tracker) {
  tracker.reloadStarted = false;
}
