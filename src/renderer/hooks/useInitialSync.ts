import { useState, useEffect, useCallback, useRef } from 'react';

interface InitialSyncProgress {
  isSyncing: boolean;
  progress: number; // 0-100
  status: string;
  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;
  isComplete: boolean;
}

export const useInitialSync = () => {
  const [syncProgress, setSyncProgress] = useState<InitialSyncProgress>({
    isSyncing: true, // Start as syncing
    progress: 0,
    status: 'Initializing...',
    isComplete: false,
  });

  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const estimatedDurationRef = useRef<number>(3000);

  const performInitialSync = useCallback(async (): Promise<void> => {
    startTimeRef.current = Date.now();

    try {
      // Phase 1: Checking for pending data (0-15%)
      setSyncProgress({
        isSyncing: true,
        progress: 5,
        status: 'Checking for pending data...',
        currentStep: 'Connecting',
        isComplete: false,
      });

      // Small delay for smooth transition
      await new Promise(resolve => setTimeout(resolve, 300));

      const syncStatus = await window.electronAPI.getSyncStatus();
      const pendingCount = syncStatus.pendingSyncs || 0;
      const isOnline = syncStatus.online || false;

      if (!isOnline) {
        setSyncProgress({
          isSyncing: false,
          progress: 100,
          status: 'Offline mode - No synchronization needed',
          currentStep: 'Complete',
          isComplete: true,
        });
        return;
      }

      if (pendingCount === 0) {
        setSyncProgress({
          isSyncing: false,
          progress: 100,
          status: 'All data synchronized',
          currentStep: 'Complete',
          totalSteps: 0,
          completedSteps: 0,
          isComplete: true,
        });
        return;
      }

      // Estimate duration based on pending count
      estimatedDurationRef.current = Math.max(2000, Math.min(20000, pendingCount * 1200));

      // Phase 2: Preparing sync (15-25%)
      setSyncProgress({
        isSyncing: true,
        progress: 20,
        status: `Preparing to sync ${pendingCount} pending sale${pendingCount > 1 ? 's' : ''}...`,
        currentStep: 'Preparing',
        totalSteps: pendingCount,
        completedSteps: 0,
        isComplete: false,
      });

      await new Promise(resolve => setTimeout(resolve, 400));

      // Phase 3: Starting sync (25-30%)
      setSyncProgress({
        isSyncing: true,
        progress: 25,
        status: 'Connecting to server...',
        currentStep: 'Connecting to server',
        totalSteps: pendingCount,
        completedSteps: 0,
        isComplete: false,
      });

      // Start progress simulation
      let simulatedProgress = 25;
      const progressStep = 70 / Math.max(10, Math.ceil(estimatedDurationRef.current / 200));

      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - (startTimeRef.current || Date.now());
        const timeBasedProgress = Math.min(95, 25 + (elapsed / estimatedDurationRef.current) * 70);
        
        simulatedProgress = Math.min(95, simulatedProgress + progressStep);
        
        setSyncProgress((prev) => {
          if (!prev.isSyncing) {
            return prev;
          }
          
          const currentProgress = Math.max(timeBasedProgress, simulatedProgress);
          
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
          isComplete: true,
        });
      } else {
        setSyncProgress({
          isSyncing: false,
          progress: 100,
          status: `Synchronization completed with issues: ${response.error || 'Unknown error'}`,
          currentStep: 'Complete',
          totalSteps: pendingCount,
          completedSteps: 0,
          isComplete: true,
        });
      }
    } catch (error: any) {
      // Clear progress interval on error
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      setSyncProgress({
        isSyncing: false,
        progress: 100,
        status: `Synchronization completed: ${error.message || 'Unknown error'}`,
        currentStep: 'Complete',
        isComplete: true,
      });
    }
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
    performInitialSync,
  };
};
