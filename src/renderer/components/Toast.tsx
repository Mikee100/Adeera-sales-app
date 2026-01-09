import React, { useEffect } from 'react';
import '../toast.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
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
    const duration = toast.duration || 4000;
    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return 'ℹ️';
    }
  };

  return (
    <div className={`toast toast-${toast.type}`} onClick={() => !toast.action && onRemove(toast.id)}>
      <span className="toast-icon">{getIcon()}</span>
      <span className="toast-message">{toast.message}</span>
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
      <button className="toast-close" onClick={(e) => { e.stopPropagation(); onRemove(toast.id); }}>×</button>
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

export const showToast = (
  message: string,
  type: ToastType = 'info',
  duration?: number,
  action?: { label: string; onClick: () => void }
) => {
  const toast: Toast = {
    id: `toast-${++toastIdCounter}`,
    message,
    type,
    duration,
    action,
  };

  currentToasts = [...currentToasts, toast];
  toastListeners.forEach(listener => listener(currentToasts));
};

export const removeToast = (id: string) => {
  currentToasts = currentToasts.filter(toast => toast.id !== id);
  toastListeners.forEach(listener => listener(currentToasts));
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


