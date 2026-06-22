import React, { useState, useEffect, useRef, useCallback } from 'react';
import './SyncStatus.css';
import { showToast } from './Toast';
import { handleError, handleNetworkOperation, AppError } from '../utils/error-handler';
import { useSyncProgress } from '../hooks/useSyncProgress';

interface SyncStatusData {
  online: boolean;
  pendingSyncs: number;
  lastSync?: string;
  queueSize?: number;
  maxQueueSize?: number;
  warningThreshold?: number;
  isWarning?: boolean;
  isCritical?: boolean;
}

const SyncStatus: React.FC = () => {
  const [syncStatus, setSyncStatus] = useState<SyncStatusData>({ online: true, pendingSyncs: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    total: number;
    processed: number;
    synced: number;
    failed: number;
    currentBatch: number;
    totalBatches: number;
    percentage: number;
  } | null>(null);
  const wasOfflineRef = useRef(false);
  const autoSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoSyncedRef = useRef(false);
  const lastPendingCountRef = useRef(0);
  const autoSyncCycleRunningRef = useRef(false);
  const { startSync } = useSyncProgress();

  // Listen for sync progress updates
  useEffect(() => {
    const cleanup = window.electronAPI.onSyncProgress((progress) => {
      setSyncProgress({
        total: progress.total,
        processed: progress.processed,
        synced: progress.synced,
        failed: progress.failed,
        currentBatch: progress.currentBatch,
        totalBatches: progress.totalBatches,
        percentage: progress.percentage,
      });

      // Handle completion or cancellation
      if (progress.completed || progress.cancelled) {
        setIsSyncing(false);
        setSyncProgress(null);
      }

      // Handle errors
      if (progress.failed && progress.error) {
        setIsSyncing(false);
        setSyncProgress(null);
      }
    });

    return cleanup;
  }, []);

  const handleCancelSync = useCallback(async () => {
    try {
      await window.electronAPI.cancelSyncOfflineSales();
      setIsSyncing(false);
      setSyncProgress(null);
      showToast('Sync cancelled', 'info', 3000);
    } catch (error) {
      console.error('Failed to cancel sync:', error);
    }
  }, []);

  const handleSyncNow = useCallback(async (isAutoSync: boolean = false) => {
    // Get current status to check conditions
    const currentStatus = await window.electronAPI.getSyncStatus();
    if (isSyncing || currentStatus.pendingSyncs === 0 || !currentStatus.online) {
      return;
    }

    setIsSyncing(true);
    setSyncProgress(null); // Reset progress
    
    // Start sync with progress screen
    if (!isAutoSync) {
      startSync();
    }
    
    try {
      const response = await handleNetworkOperation(
        () => window.electronAPI.syncOfflineSales(),
        {
          operation: 'syncOfflineSales',
          component: 'SyncStatus',
        },
        {
          maxRetries: 2,
          showRetryToast: !isAutoSync, // Don't show retry toast for auto-sync
        }
      );

      // Handle cancellation
      if (response.cancelled) {
        showToast('Sync cancelled by user', 'info', 3000);
        setIsSyncing(false);
        setSyncProgress(null);
        return;
      }

      if (response.success) {
        console.log(`Synced ${response.syncedCount} sales${isAutoSync ? ' (auto-sync)' : ''}`);
        if (response.errors && response.errors.length > 0) {
          console.warn('Sync errors:', response.errors);
          // Only show detailed errors for manual syncs or if there are many errors
          if (!isAutoSync || response.errors.length > 3) {
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
            // For auto-sync with few errors, just show a brief message
            showToast(`Auto-sync: ${response.syncedCount} synced, ${response.errors.length} failed`, 'warning', 3000);
          }
        } else {
          // Show success message (shorter for auto-sync)
          if (isAutoSync) {
            showToast(`Auto-synced ${response.syncedCount} sales`, 'success', 2000);
          } else {
            showToast(`Successfully synced ${response.syncedCount} sales!`, 'success');
          }
        }
        // Refresh status after sync
        const updatedStatus = await window.electronAPI.getSyncStatus();
        setSyncStatus(updatedStatus);
        lastPendingCountRef.current = updatedStatus.pendingSyncs;
        // Reset auto-sync flag after successful sync
        if (updatedStatus.pendingSyncs === 0) {
          hasAutoSyncedRef.current = false;
        }
      } else {
        if (!isAutoSync) {
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
        } else {
          console.warn('Auto-sync failed:', response.error);
        }
      }
    } catch (error) {
      if (!isAutoSync) {
        handleError(error, {
          operation: 'syncOfflineSales',
          component: 'SyncStatus',
        }, {
          retryable: true,
          maxRetries: 2,
        });
      } else {
        console.error('Auto-sync error:', error);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  const updateSyncStatus = useCallback(async () => {
    try {
      const response = await window.electronAPI.getSyncStatus();
      if (response) {
        setSyncStatus((prevStatus) => {
          const justCameOnline = !prevStatus.online && response.online;
          const hasPendingSales = response.pendingSyncs > 0;
          const pendingCountIncreased = response.pendingSyncs > lastPendingCountRef.current;
          
          // Track offline state
          if (!response.online) {
            wasOfflineRef.current = true;
            hasAutoSyncedRef.current = false; // Reset when going offline
          }
          
          // Auto-sync conditions:
          // 1. Just came back online with pending sales, OR
          // 2. Online with pending sales that we haven't auto-synced yet, OR
          // 3. Pending count increased (new offline sale created)
          const shouldAutoSync = response.online && hasPendingSales && !isSyncing && (
            justCameOnline || 
            (!hasAutoSyncedRef.current && prevStatus.online) ||
            pendingCountIncreased
          );
          
          if (shouldAutoSync) {
            // Clear any existing timeout
            if (autoSyncTimeoutRef.current) {
              clearTimeout(autoSyncTimeoutRef.current);
            }
            // Trigger auto-sync after a short delay to ensure backend is ready
            autoSyncTimeoutRef.current = setTimeout(() => {
              if (!isSyncing) {
                console.log('Auto-syncing pending sales...', {
                  justCameOnline,
                  hasAutoSynced: hasAutoSyncedRef.current,
                  pendingCount: response.pendingSyncs
                });
                hasAutoSyncedRef.current = true;
                // For auto-sync, also show the sync screen if there are many pending items
                if (response.pendingSyncs > 3) {
                  startSync();
                }
                handleSyncNow(true);
              }
            }, 1500);
          }
          
          // Update last pending count
          lastPendingCountRef.current = response.pendingSyncs;
          
          // Reset auto-sync flag after being online for a while
          if (response.online && wasOfflineRef.current) {
            setTimeout(() => {
              wasOfflineRef.current = false;
              hasAutoSyncedRef.current = false; // Allow auto-sync again if new sales come in
            }, 10000);
          }
          
          return response;
        });
      }
    } catch (error) {
      console.error('Failed to get sync status:', error);
    }
  }, [isSyncing, handleSyncNow]);

  const runSalesQueueAutoSyncCycle = useCallback(async () => {
    if (autoSyncCycleRunningRef.current) {
      return;
    }

    autoSyncCycleRunningRef.current = true;
    try {
      const status = await window.electronAPI.getSyncStatus();
      if (!status) {
        return;
      }

      setSyncStatus(status);
      lastPendingCountRef.current = status.pendingSyncs;

      if (!status.online || isSyncing) {
        return;
      }

      if (status.pendingSyncs > 0) {
        hasAutoSyncedRef.current = true;
        await handleSyncNow(true);
      }
    } catch (error) {
      console.warn('Auto-sync cycle failed:', error);
    } finally {
      autoSyncCycleRunningRef.current = false;
    }
  }, [handleSyncNow, isSyncing]);

  useEffect(() => {
    let mounted = true;
    
    // Initial status check - with immediate auto-sync if needed
    const initialCheck = async () => {
      try {
        const status = await window.electronAPI.getSyncStatus();
        if (status && mounted) {
          setSyncStatus(status);
          lastPendingCountRef.current = status.pendingSyncs;
          
          // If online with pending sales on initial load, auto-sync immediately
          if (status.online && status.pendingSyncs > 0) {
            console.log('Initial load: Auto-syncing pending sales...', status);
            hasAutoSyncedRef.current = true;
            // Use a timeout to ensure component is fully mounted
            autoSyncTimeoutRef.current = setTimeout(async () => {
              if (mounted && !isSyncing) {
                // Double-check status before syncing
                const currentStatus = await window.electronAPI.getSyncStatus();
                if (currentStatus.online && currentStatus.pendingSyncs > 0) {
                  console.log('Triggering auto-sync from initial load');
                  handleSyncNow(true);
                }
              }
            }, 2000); // Slightly longer delay on initial load
          }
        }
      } catch (error) {
        console.error('Failed initial sync status check:', error);
      }
    };
    
    initialCheck();

    // Update status every 10 seconds (more frequent for better auto-sync detection)
    const interval = setInterval(() => {
      if (mounted) {
        updateSyncStatus();
      }
    }, 10000);

    return () => {
      mounted = false;
      clearInterval(interval);
      if (autoSyncTimeoutRef.current) {
        clearTimeout(autoSyncTimeoutRef.current);
      }
    };
  }, [handleSyncNow, updateSyncStatus, isSyncing, startSync]); // Include dependencies

  useEffect(() => {
    const handleOnline = () => {
      void runSalesQueueAutoSyncCycle();
    };

    void runSalesQueueAutoSyncCycle();
    window.addEventListener('online', handleOnline);

    const timer = window.setInterval(() => {
      void runSalesQueueAutoSyncCycle();
    }, 45000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.clearInterval(timer);
    };
  }, [runSalesQueueAutoSyncCycle]);

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
    <div className="sync-status sync-status-inline">
      <div className="sync-status-indicator">
        <div className={`status-dot ${syncStatus.online ? 'online' : 'offline'}`}></div>
        <span className="status-text">
          {syncStatus.online ? 'Online' : 'Offline'}
        </span>
      </div>
      <span className="sync-status-divider">•</span>
      <span className="last-sync-inline">Last sync: {formatLastSync(syncStatus.lastSync)}</span>
    </div>
  );
};

export default SyncStatus;
