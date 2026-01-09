import React, { useState, useEffect } from 'react';
import './SyncStatus.css';
import { showToast } from './Toast';
import { handleError, handleNetworkOperation, AppError } from '../utils/error-handler';

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
      const response = await handleNetworkOperation(
        () => window.electronAPI.syncOfflineSales(),
        {
          operation: 'syncOfflineSales',
          component: 'SyncStatus',
        },
        {
          maxRetries: 2,
          showRetryToast: true,
        }
      );

      if (response.success) {
        console.log(`Synced ${response.syncedCount} sales`);
        if (response.errors && response.errors.length > 0) {
          console.warn('Sync errors:', response.errors);
          // Show detailed error messages to user
          const errorMessages = response.errors.slice(0, 3).map((error: string, index: number) =>
            `${index + 1}. ${error}`
          ).join('\n');
          const moreErrors = response.errors.length > 3 ? `\n...and ${response.errors.length - 3} more errors` : '';
          
          handleError(
            new AppError(
              `Sync completed with ${response.errors.length} errors`,
              'SYNC_PARTIAL',
              {
                operation: 'syncOfflineSales',
                component: 'SyncStatus',
                metadata: {
                  syncedCount: response.syncedCount,
                  errorCount: response.errors.length,
                  errors: response.errors,
                },
              },
              undefined,
              'medium'
            ),
            {
              operation: 'syncOfflineSales',
              component: 'SyncStatus',
            }
          );
          
          showToast(
            `Sync completed with ${response.errors.length} errors:\n${errorMessages}${moreErrors}`,
            'warning',
            8000
          );
        } else {
          showToast(`Successfully synced ${response.syncedCount} sales!`, 'success');
        }
        // Refresh status
        await updateSyncStatus();
      } else {
        handleError(
          new AppError(response.error || 'Sync failed', 'SYNC_FAILED', {
            operation: 'syncOfflineSales',
            component: 'SyncStatus',
          }),
          {
            operation: 'syncOfflineSales',
            component: 'SyncStatus',
          },
          {
            retryable: true,
            maxRetries: 2,
          }
        );
      }
    } catch (error) {
      handleError(error, {
        operation: 'syncOfflineSales',
        component: 'SyncStatus',
      }, {
        retryable: true,
        maxRetries: 2,
      });
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
