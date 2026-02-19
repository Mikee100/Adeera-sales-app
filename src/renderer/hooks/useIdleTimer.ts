import { useEffect, useRef, useCallback } from 'react';

interface UseIdleTimerOptions {
  idleTime: number; // Time in milliseconds before considered idle
  onIdle: () => void;
  onActive?: () => void;
  enabled?: boolean;
}

export const useIdleTimer = ({
  idleTime,
  onIdle,
  onActive,
  enabled = true,
}: UseIdleTimerOptions) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetTimer = useCallback(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Update last activity time
    lastActivityRef.current = Date.now();

    // Call onActive if provided
    if (onActive) {
      onActive();
    }

    // Set new timeout
    if (enabled) {
      timeoutRef.current = setTimeout(() => {
        console.log('User idle for', idleTime / 1000, 'seconds. Activating sleep mode...');
        onIdle();
      }, idleTime);
    }
  }, [idleTime, onIdle, onActive, enabled]);

  useEffect(() => {
    if (!enabled) {
      // Clear timeout if disabled
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    // Initial timer setup
    resetTimer();

    // Events that indicate user activity
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'keydown',
      'scroll',
      'touchstart',
      'click',
      'wheel',
    ];

    // Throttle mousemove to avoid too many resets
    let mousemoveTimeout: NodeJS.Timeout | null = null;
    const handleMouseMove = () => {
      if (mousemoveTimeout) {
        return;
      }
      mousemoveTimeout = setTimeout(() => {
        resetTimer();
        mousemoveTimeout = null;
      }, 1000); // Only reset timer once per second for mousemove
    };

    // Add event listeners
    events.forEach((event) => {
      if (event === 'mousemove') {
        window.addEventListener(event, handleMouseMove, { passive: true });
      } else {
        window.addEventListener(event, resetTimer, { passive: true });
      }
    });

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (mousemoveTimeout) {
        clearTimeout(mousemoveTimeout);
      }
      events.forEach((event) => {
        if (event === 'mousemove') {
          window.removeEventListener(event, handleMouseMove);
        } else {
          window.removeEventListener(event, resetTimer);
        }
      });
    };
  }, [resetTimer, enabled]);

  // Return function to manually reset timer
  return {
    reset: resetTimer,
    getLastActivity: () => lastActivityRef.current,
  };
};
