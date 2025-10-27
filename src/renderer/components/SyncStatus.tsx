import React, { useState, useEffect } from 'react';
import './SyncStatus.css';

interface SyncStatusData {
  online: boolean;
  pendingSyncs: number;
  lastSync?: string;
}

const SyncStatus: React.FC = () => {
  const [syncStatus, setSyncStatus] = useState<SyncStatusData>({ online: true, pendingSyncs: 0 });
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Initial status check
    updateSyncStatus();

    // Update status every 30 seconds
    const interval = setInterval(updateSyncStatus, 30000);

    return () => clearInterval(interval);
  }, []);

  const updateSyncStatus = async () => {
    try {
      const response = await window.electronAPI.getSyncStatus();
      if (response) {
        setSyncStatus(response);
      }
    } catch (error) {
      console.error('Failed to get sync status:', error);
    }
  };

  const handleSyncNow = async () => {
    if (isSyncing || syncStatus.pendingSyncs === 0) return;

    setIsSyncing(true);
    try {
      const response = await window.electronAPI.syncOfflineSales();
      if (response.success) {
        console.log(`Synced ${response.syncedCount} sales`);
        if (response.errors && response.errors.length > 0) {
          console.warn('Sync errors:', response.errors);
          // Show detailed error messages to user
          const errorMessages = response.errors.map((error: string, index: number) =>
            `${index + 1}. ${error}`
          ).join('\n');
          alert(`Sync completed with ${response.errors.length} errors:\n\n${errorMessages}`);
        } else {
          alert(`Successfully synced ${response.syncedCount} sales!`);
        }
        // Refresh status
        await updateSyncStatus();
      } else {
        console.error('Sync failed:', response.error);
        alert(`Sync failed: ${response.error}`);
      }
    } catch (error) {
      console.error('Sync error:', error);
      alert('An unexpected error occurred during sync. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  };

  const formatLastSync = (lastSync?: string) => {
    if (!lastSync) return 'Never';

    const date = new Date(lastSync);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString();
  };

  return (
    <div className="sync-status">
      <div className="sync-status-indicator">
        <div className={`status-dot ${syncStatus.online ? 'online' : 'offline'}`}></div>
        <span className="status-text">
          {syncStatus.online ? 'Online' : 'Offline'}
        </span>
      </div>

      {syncStatus.pendingSyncs > 0 && (
        <div className="pending-syncs">
          <span className="pending-count">{syncStatus.pendingSyncs} pending</span>
          <button
            className="sync-button"
            onClick={handleSyncNow}
            disabled={isSyncing || !syncStatus.online}
          >
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}

      <div className="last-sync">
        Last sync: {formatLastSync(syncStatus.lastSync)}
      </div>
    </div>
  );
};

export default SyncStatus;
