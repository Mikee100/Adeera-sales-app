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
  const { toasts, removeToast } = useToast();
  const { syncProgress, performInitialSync } = useInitialSync();
  const { isSleepMode, exitSleepMode, enterSleepMode } = useSleepMode();
  const idleTimerRef = useRef<{ reset: () => void } | null>(null);
  const [restaurantEnabled, setRestaurantEnabled] = useState(false);

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
        setRestaurantEnabled(false);
        return;
      }

      try {
        const config = await window.electronAPI.getRestaurantConfig();
        setRestaurantEnabled(!!(config.success && config.enabled));
      } catch {
        setRestaurantEnabled(false);
      }
    };

    loadRestaurantConfig();
  }, [isAuthenticated]);

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
        {isAuthenticated ? (restaurantEnabled ? <RestaurantRenderer /> : <POS />) : <Login />}
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
