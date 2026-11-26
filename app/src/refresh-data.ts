import { cloudSyncNow } from './cloud-sync';
import { syncLanNow } from './lan-sync';
import { useApp } from './store';
import { syncNow } from './sync';

/**
 * Reload this device's data, then sync every connection, once something has
 * failed. Sync waits for a clean load: it never runs over a load or save error.
 * Shared by the rail's Refresh and the save-error banner.
 */
export async function refreshData(): Promise<void> {
  try {
    await useApp.getState().load();
    const { loaded, loadError, saveError } = useApp.getState();
    if (!loaded || loadError || saveError) return;
    await Promise.all([syncNow(), cloudSyncNow(), syncLanNow()]);
  } catch (error) {
    useApp.setState({ loadError: error instanceof Error ? error.message : 'Local data operation failed.' });
  }
}
