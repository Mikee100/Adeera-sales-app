import { useState, useEffect, useCallback, useRef } from 'react';

interface SyncProgress {
  isSyncing: boolean;
  progress: number; // 0-100
  status: string;
  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;
}

export const useSyncProgress = () => {
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({
    isSyncing: false,
    progress: 0,
    status: 'Ready',
  });

  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const estimatedDurationRef = useRef<number>(5000); // Default 5 seconds

  const updateProgress = useCallback((phase: string, progressValue: number, step?: string) => {
    setSyncProgress((prev) => ({
      ...prev,
      progress: progressValue,
      status: phase,
      currentStep: step,
    }));
  }, []);

  const startSync = useCallback(async () => {
    // Clear any existing interval
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    setSyncProgress({
      isSyncing: true,
      progress: 0,
      status: 'Initializing synchronization...',
      currentStep: undefined,
      totalSteps: undefined,
      completedSteps: undefined,
    });

    startTimeRef.current = Date.now();

    try {
      // Phase 1: Check sync status (0-10%)
      updateProgress('Checking for pending data...', 5, 'Connecting');
      
      const syncStatus = await window.electronAPI.getSyncStatus();
      const pendingCount = syncStatus.pendingSyncs || 0;

      if (pendingCount === 0) {
        setSyncProgress({
          isSyncing: false,
          progress: 100,
          status: 'All data synchronized',
          currentStep: 'Complete',
          totalSteps: 0,
          completedSteps: 0,
        });
        return;
      }

      // Estimate duration based on pending count (roughly 1-2 seconds per sale)
      estimatedDurationRef.current = Math.max(3000, Math.min(30000, pendingCount * 1500));

      // Phase 2: Preparing sync (10-20%)
      updateProgress(`Preparing to sync ${pendingCount} sale${pendingCount > 1 ? 's' : ''}...`, 15, 'Preparing');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Phase 3: Starting sync (20-30%)
      updateProgress(`Synchronizing with server...`, 25, 'Connecting to server');
      
      // Start progress simulation
      let simulatedProgress = 25;
      const progressStep = 70 / Math.max(10, Math.ceil(estimatedDurationRef.current / 200)); // Distribute 70% over estimated time

      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - (startTimeRef.current || Date.now());
        const timeBasedProgress = Math.min(95, 25 + (elapsed / estimatedDurationRef.current) * 70);
        
        simulatedProgress = Math.min(95, simulatedProgress + progressStep);
        
        setSyncProgress((prev) => {
          if (!prev.isSyncing) {
            return prev;
          }
          // Use the higher of time-based or simulated progress
          const currentProgress = Math.max(timeBasedProgress, simulatedProgress);
          
          // Update status based on progress
          let status = prev.status;
          let step = prev.currentStep;
          
          if (currentProgress < 40) {
            status = 'Connecting to server...';
            step = 'Establishing connection';
          } else if (currentProgress < 60) {
            status = `Syncing sale data...`;
            step = `Processing ${pendingCount} sale${pendingCount > 1 ? 's' : ''}`;
          } else if (currentProgress < 85) {
            status = 'Finalizing synchronization...';
            step = 'Completing sync';
          } else {
            status = 'Almost done...';
            step = 'Finalizing';
          }
          
          return {
            ...prev,
            progress: currentProgress,
            status,
            currentStep: step,
            totalSteps: pendingCount,
            completedSteps: Math.floor((currentProgress / 100) * pendingCount),
          };
        });
      }, 200);

      // Perform actual sync
      const response = await window.electronAPI.syncOfflineSales();

      // Clear progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      if (response.success) {
        const syncedCount = response.syncedCount || 0;
        const errorCount = response.errors?.length || 0;

        setSyncProgress({
          isSyncing: false,
          progress: 100,
          status: errorCount > 0
            ? `Synchronized ${syncedCount} sale${syncedCount !== 1 ? 's' : ''} with ${errorCount} error${errorCount !== 1 ? 's' : ''}`
            : `Successfully synchronized ${syncedCount} sale${syncedCount !== 1 ? 's' : ''}`,
          currentStep: 'Complete',
          totalSteps: pendingCount,
          completedSteps: syncedCount,
        });

        // Auto-hide after 2 seconds
        setTimeout(() => {
          setSyncProgress({
            isSyncing: false,
            progress: 0,
            status: 'Ready',
          });
        }, 2000);
      } else {
        setSyncProgress({
          isSyncing: false,
          progress: 0,
          status: `Synchronization failed: ${response.error || 'Unknown error'}`,
          currentStep: 'Error',
          totalSteps: pendingCount,
          completedSteps: 0,
        });

        // Auto-hide after 3 seconds on error
        setTimeout(() => {
          setSyncProgress({
            isSyncing: false,
            progress: 0,
            status: 'Ready',
          });
        }, 3000);
      }
    } catch (error: any) {
      // Clear progress interval on error
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      setSyncProgress({
        isSyncing: false,
        progress: 0,
        status: `Synchronization error: ${error.message || 'Unknown error'}`,
        currentStep: 'Error',
        totalSteps: undefined,
        completedSteps: undefined,
      });

      // Auto-hide after 3 seconds on error
      setTimeout(() => {
        setSyncProgress({
          isSyncing: false,
          progress: 0,
          status: 'Ready',
        });
      }, 3000);
    }
  }, [updateProgress]);

  const stopSync = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setSyncProgress({
      isSyncing: false,
      progress: 0,
      status: 'Synchronization cancelled',
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  return {
    syncProgress,
    startSync,
    stopSync,
  };
};
