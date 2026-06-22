import React, { useEffect, useRef, useState } from 'react';
import Login from './components/Login';
import POS from './components/POS';
import RestaurantRenderer from './restaurant/RestaurantRenderer';
import SyncScreen from './components/SyncScreen';
import SleepScreen from './components/SleepScreen';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { SleepModeProvider, useSleepMode } from './contexts/SleepModeContext';
import { ToastContainer, useToast } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { useInitialSync } from './hooks/useInitialSync';
import { useIdleTimer } from './hooks/useIdleTimer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './error-boundary.css';

const POS_KIOSK_MODE = true;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15000,
      refetchOnWindowFocus: false,
    },
  },
});

const AppContent: React.FC = () => {
  const { isAuthenticated, loading, initialSyncComplete, onInitialSyncComplete } = useAuth();
  const { toasts, removeToast, showToast } = useToast();
  const { syncProgress, performInitialSync } = useInitialSync();
  const { isSleepMode, exitSleepMode, enterSleepMode } = useSleepMode();
  const idleTimerRef = useRef<{ reset: () => void } | null>(null);
  const shownAvailableVersionRef = useRef<string | null>(null);
  const downloadedNotifiedRef = useRef(false);
  const installingNotifiedRef = useRef(false);
  const lastUpdateErrorRef = useRef<string | null>(null);
  const [restaurantEnabled, setRestaurantEnabled] = useState(true);

  // Debug: Log sleep mode state changes
  useEffect(() => {
    console.log('Sleep mode state changed:', isSleepMode);
  }, [isSleepMode]);

  // Idle timer - activate sleep mode after 5 minutes of inactivity
  // Only enable when user is authenticated and not already in sleep mode
  const idleTimer = useIdleTimer({
    idleTime: 5 * 60 * 1000, // 5 minutes in milliseconds
    onIdle: () => {
      if (!isSleepMode && isAuthenticated) {
        console.log('Auto-activating sleep mode due to inactivity');
        enterSleepMode();
      }
    },
    enabled: isAuthenticated && !isSleepMode && initialSyncComplete,
  });

  // Store timer reference
  useEffect(() => {
    idleTimerRef.current = idleTimer;
  }, [idleTimer]);

  // Reset idle timer when waking from sleep mode
  useEffect(() => {
    if (!isSleepMode && isAuthenticated && idleTimerRef.current) {
      console.log('Resetting idle timer after waking from sleep mode');
      idleTimerRef.current.reset();
    }
  }, [isSleepMode, isAuthenticated]);

  // Perform initial sync on mount
  useEffect(() => {
    if (!initialSyncComplete) {
      performInitialSync().then(() => {
        // Wait a moment after sync completes before checking auth
        setTimeout(() => {
          onInitialSyncComplete();
        }, 500);
      });
    }
  }, [initialSyncComplete, performInitialSync, onInitialSyncComplete]);

  useEffect(() => {
    const loadRestaurantConfig = async () => {
      if (!isAuthenticated) {
        setRestaurantEnabled(true);
        return;
      }

      try {
        const config = await window.electronAPI.getRestaurantConfig();
        setRestaurantEnabled(!!(config.success && config.enabled));
      } catch {
        setRestaurantEnabled(true);
      }
    };

    loadRestaurantConfig();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !initialSyncComplete) return;

    let active = true;
    let isPackagedBuild = false;

    const initializeUpdateNotifications = async () => {
      try {
        const settings = await window.electronAPI.getUpdateSettings();
        isPackagedBuild = !!settings?.isPackaged;

        if (!isPackagedBuild) return;

        // Trigger a foreground check when a user session is active.
        await window.electronAPI.checkForAppUpdates();
      } catch {
        // No-op to avoid interrupting normal POS flow.
      }
    };

    const unsubscribe = window.electronAPI.onAppUpdateStatus((status: any) => {
      if (!active || !status) return;

      if (status.status === 'update-available') {
        const version = status.availableVersion || 'new version';
        if (shownAvailableVersionRef.current === version) return;
        shownAvailableVersionRef.current = version;

        showToast(`Update available: ${version}. Downloading in background...`, 'info', 7000);
      }

      if (status.status === 'downloaded') {
        if (downloadedNotifiedRef.current) return;
        downloadedNotifiedRef.current = true;

        showToast('Update downloaded. POS will restart automatically to install.', 'success', 8000);
      }

      if (status.status === 'installing') {
        if (installingNotifiedRef.current) return;
        installingNotifiedRef.current = true;
        showToast('Installing update now. POS is restarting...', 'info', 10000);
      }

      if (status.status === 'error') {
        const errorMessage = String(status.message || 'Update check failed');
        if (lastUpdateErrorRef.current === errorMessage) return;
        lastUpdateErrorRef.current = errorMessage;

        showToast(`Update error: ${errorMessage}`, 'warning', 8000);
      }
    });

    initializeUpdateNotifications();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [isAuthenticated, initialSyncComplete, showToast]);

  // Show sleep screen if sleep mode is active (highest priority)
  if (isSleepMode) {
    console.log('Rendering SleepScreen - isSleepMode is true');
    return <SleepScreen onWake={exitSleepMode} />;
  }

  // Show sync screen until initial sync is complete
  if (!initialSyncComplete) {
    return (
      <SyncScreen
        progress={syncProgress.progress}
        status={syncProgress.status}
        currentStep={syncProgress.currentStep}
        totalSteps={syncProgress.totalSteps}
        completedSteps={syncProgress.completedSteps}
      />
    );
  }

  // Show loading screen while checking auth (after sync completes)
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Loading SaaS POS...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app">
        {POS_KIOSK_MODE ? (
          isAuthenticated ? (
            restaurantEnabled ? <RestaurantRenderer /> : <POS />
          ) : (
            <div>
              <div className="mx-auto mt-4 mb-2 max-w-4xl rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Kiosk mode enabled. Manager/Admin sign-in is only required for initial device provisioning. Staff will use PIN check-in inside POS.
              </div>
              <Login />
            </div>
          )
        ) : isAuthenticated ? (
          restaurantEnabled ? <RestaurantRenderer /> : <POS />
        ) : (
          <Login />
        )}
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </ErrorBoundary>
  );
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <SleepModeProvider>
            <AppContent />
          </SleepModeProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
