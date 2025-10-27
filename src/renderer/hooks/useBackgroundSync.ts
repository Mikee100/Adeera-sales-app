import { useEffect, useState, useCallback } from 'react';
import syncScheduler from '../../shared/sync-scheduler';

interface SyncStatus {
  isOnline: boolean;
  pendingSyncs: number;
  lastSync: string | null;
  isSyncing: boolean;
}

export const useBackgroundSync = () => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: navigator.onLine,
    pendingSyncs: 0,
    lastSync: null,
    isSyncing: false,
  });

  // Update sync status
  const updateSyncStatus = useCallback(async () => {
    try {
      const response = await window.electronAPI.getSyncStatus();
      if (response) {
        setSyncStatus(prev => ({
          ...prev,
          isOnline: response.online,
          pendingSyncs: response.pendingSyncs,
          lastSync: response.lastSync,
        }));
      }
    } catch (error) {
      console.error('Failed to get sync status:', error);
    }
  }, []);

  // Force immediate sync
  const forceSync = useCallback(async (type: 'full' | 'incremental' = 'incremental') => {
    setSyncStatus(prev => ({ ...prev, isSyncing: true }));

    try {
      const result = await syncScheduler.forceSync(type);
      await updateSyncStatus(); // Refresh status after sync
      return result;
    } catch (error) {
      console.error('Force sync failed:', error);
      throw error;
    } finally {
      setSyncStatus(prev => ({ ...prev, isSyncing: false }));
    }
  }, [updateSyncStatus]);

  // Schedule a sync job
  const scheduleSync = useCallback((type: 'full' | 'incremental' | 'selective' = 'incremental', delay = 0) => {
    return syncScheduler.scheduleSync(type, 'normal', undefined, delay);
  }, []);

  // Get sync statistics
  const getSyncStats = useCallback(() => {
    return syncScheduler.getStats();
  }, []);

  // Handle online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setSyncStatus(prev => ({ ...prev, isOnline: true }));
      // Auto-sync when coming back online
      if (syncStatus.pendingSyncs > 0) {
        forceSync('incremental').catch(console.error);
      }
    };

    const handleOffline = () => {
      setSyncStatus(prev => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial status check
    updateSyncStatus();

    // Set up periodic status updates
    const interval = setInterval(updateSyncStatus, 30000); // Every 30 seconds

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [updateSyncStatus, forceSync, syncStatus.pendingSyncs]);

  // Listen for sync scheduler events
  useEffect(() => {
    const handleJobCompleted = () => {
      updateSyncStatus();
    };

    const handleJobFailed = () => {
      updateSyncStatus();
    };

    syncScheduler.on('jobCompleted', handleJobCompleted);
    syncScheduler.on('jobFailed', handleJobFailed);

    return () => {
      syncScheduler.off('jobCompleted', handleJobCompleted);
      syncScheduler.off('jobFailed', handleJobFailed);
    };
  }, [updateSyncStatus]);

  return {
    syncStatus,
    forceSync,
    scheduleSync,
    updateSyncStatus,
    getSyncStats,
  };
};

export default useBackgroundSync;
