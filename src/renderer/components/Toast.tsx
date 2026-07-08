import React, { useEffect } from 'react';
import '../toast.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 1800,
  info: 2200,
  warning: 4200,
  error: 0,
};

const TOAST_RATE_LIMIT_WINDOW_MS = 900;
const TOAST_REPEAT_WINDOW_MS = 3500;
const MAX_VISIBLE_TOASTS = 4;

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  sticky?: boolean;
  dedupeKey?: string;
  repeatCount?: number;
  createdAt: number;
  updatedAt: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const ToastItem: React.FC<ToastProps> = ({ toast, onRemove }) => {
  useEffect(() => {
    if (toast.sticky || toast.duration === 0) {
      return;
    }

    const duration = toast.duration ?? DEFAULT_DURATIONS[toast.type];
    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      className={`toast toast-${toast.type}`}
      onClick={() => !toast.action && onRemove(toast.id)}
    >
      <span className={`toast-icon toast-icon-${toast.type}`} aria-hidden="true"></span>
      <span className="toast-message">{toast.message}</span>
      {!!toast.repeatCount && toast.repeatCount > 1 && (
        <span className="toast-repeat-badge" aria-label={`${toast.repeatCount} repeated notifications`}>
          x{toast.repeatCount}
        </span>
      )}
      {toast.action && (
        <button
          className="toast-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            toast.action!.onClick();
            onRemove(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="toast-close" onClick={(e) => { e.stopPropagation(); onRemove(toast.id); }}>x</button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
};

// Toast hook/context for easy access
let toastIdCounter = 0;
let toastListeners: Array<(toasts: Toast[]) => void> = [];
let currentToasts: Toast[] = [];
let lastToastShownByKey: Record<string, number> = {};

const notifyListeners = () => {
  toastListeners.forEach(listener => listener(currentToasts));
};

const getToastKey = (message: string, type: ToastType) => `${type}:${message.trim().toLowerCase()}`;

const trimToastQueue = () => {
  if (currentToasts.length <= MAX_VISIBLE_TOASTS) {
    return;
  }

  currentToasts = currentToasts
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(currentToasts.length - MAX_VISIBLE_TOASTS);
};

export const showToast = (
  message: string,
  type: ToastType = 'info',
  duration?: number,
  action?: { label: string; onClick: () => void }
) => {
  const now = Date.now();
  const dedupeKey = getToastKey(message, type);
  const isRateLimited = now - (lastToastShownByKey[dedupeKey] || 0) < TOAST_RATE_LIMIT_WINDOW_MS;
  if (isRateLimited && type !== 'error') {
    return;
  }

  const existingToastIndex = currentToasts.findIndex(toast => {
    if (toast.dedupeKey !== dedupeKey) return false;
    return now - toast.updatedAt <= TOAST_REPEAT_WINDOW_MS;
  });

  const resolvedDuration = duration ?? DEFAULT_DURATIONS[type];
  const sticky = resolvedDuration === 0 || type === 'error';

  if (existingToastIndex !== -1) {
    const existingToast = currentToasts[existingToastIndex];
    const updatedToast: Toast = {
      ...existingToast,
      updatedAt: now,
      duration: resolvedDuration,
      sticky,
      action: action ?? existingToast.action,
      repeatCount: (existingToast.repeatCount || 1) + 1,
    };

    currentToasts = [
      ...currentToasts.slice(0, existingToastIndex),
      updatedToast,
      ...currentToasts.slice(existingToastIndex + 1),
    ];

    lastToastShownByKey[dedupeKey] = now;
    notifyListeners();
    return;
  }

  const toast: Toast = {
    id: `toast-${++toastIdCounter}`,
    message,
    type,
    duration: resolvedDuration,
    sticky,
    dedupeKey,
    repeatCount: 1,
    createdAt: now,
    updatedAt: now,
    action,
  };

  currentToasts = [...currentToasts, toast];
  trimToastQueue();
  lastToastShownByKey[dedupeKey] = now;
  notifyListeners();
};

export const removeToast = (id: string) => {
  currentToasts = currentToasts.filter(toast => toast.id !== id);
  notifyListeners();
};

export const useToast = () => {
  const [toasts, setToasts] = React.useState<Toast[]>(currentToasts);

  useEffect(() => {
    const listener = (newToasts: Toast[]) => {
      setToasts(newToasts);
    };

    toastListeners.push(listener);
    setToasts(currentToasts);

    return () => {
      toastListeners = toastListeners.filter(l => l !== listener);
    };
  }, []);

  return {
    toasts,
    showToast,
    removeToast,
  };
};


