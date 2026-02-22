/**
 * Enhanced error handling utility with recovery mechanisms
 */

import { showToast } from '../components/Toast';
import { auditLogger, AuditEventType } from './audit-logger';
import { parseNestJSError, getUserFriendlyMessage, enhanceErrorMessage } from '../../shared/error-parser';

export interface ErrorContext {
  operation: string;
  component?: string;
  userId?: string;
  userName?: string;
  metadata?: Record<string, any>;
}

export interface ErrorRecoveryOptions {
  retryable?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  fallbackAction?: () => void;
  showRetryButton?: boolean;
}

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: ErrorContext,
    public recovery?: ErrorRecoveryOptions,
    public severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * User-friendly error messages
 */
const ERROR_MESSAGES: Record<string, { message: string; action?: string }> = {
  // Network errors
  'NETWORK_ERROR': {
    message: 'Unable to connect to the server. Please check your internet connection.',
    action: 'Check your connection and try again'
  },
  'TIMEOUT': {
    message: 'The request took too long. The server might be busy.',
    action: 'Please try again in a moment'
  },
  'CONNECTION_REFUSED': {
    message: 'Cannot connect to the server. Please ensure the backend is running.',
    action: 'Contact your administrator'
  },

  // Authentication errors
  'UNAUTHORIZED': {
    message: 'Your session has expired. Please log in again.',
    action: 'You will be redirected to the login page'
  },
  'FORBIDDEN': {
    message: 'You do not have permission to perform this action.',
    action: 'Contact your administrator for access'
  },
  'TOKEN_EXPIRED': {
    message: 'Your session has expired. Please log in again.',
    action: 'You will be redirected to the login page'
  },

  // Validation errors
  'VALIDATION_ERROR': {
    message: 'The information you entered is invalid.',
    action: 'Please check your input and try again'
  },
  'INSUFFICIENT_STOCK': {
    message: 'Not enough items in stock to complete this sale.',
    action: 'Please reduce the quantity or remove the item'
  },
  'STOCK_CONFLICT': {
    message: 'Stock conflict detected. Another sale may have changed the stock levels.',
    action: 'Please refresh products and try again'
  },
  'INVALID_PRICE': {
    message: 'The product price is invalid.',
    action: 'Please contact support'
  },
  'INVALID_PAYMENT': {
    message: 'The payment amount is invalid.',
    action: 'Please check the amount and try again'
  },

  // Sale errors
  'SALE_FAILED': {
    message: 'Unable to complete the sale. Please try again.',
    action: 'If the problem persists, contact support'
  },
  'PAYMENT_FAILED': {
    message: 'Payment processing failed.',
    action: 'Please try a different payment method'
  },
  'RECEIPT_ERROR': {
    message: 'Unable to generate receipt.',
    action: 'The sale was completed, but receipt generation failed'
  },

  // Product errors
  'PRODUCT_NOT_FOUND': {
    message: 'The product you are looking for was not found.',
    action: 'Please refresh the product list'
  },
  'PRODUCTS_LOAD_FAILED': {
    message: 'Unable to load products. Using cached data.',
    action: 'Some products may be outdated'
  },

  // Sync errors
  'SYNC_FAILED': {
    message: 'Unable to sync offline sales.',
    action: 'Your sales are saved locally and will sync when connection is restored'
  },
  'SYNC_PARTIAL': {
    message: 'Some sales failed to sync.',
    action: 'Check the sync status for details'
  },

  // Printer errors
  'PRINTER_ERROR': {
    message: 'Unable to print receipt.',
    action: 'The sale was completed. You can print the receipt later'
  },
  'CASH_DRAWER_ERROR': {
    message: 'Unable to open cash drawer.',
    action: 'Please open it manually'
  },

  // Generic errors
  'UNKNOWN_ERROR': {
    message: 'An unexpected error occurred.',
    action: 'Please try again or contact support if the problem persists'
  },
  'OPERATION_FAILED': {
    message: 'The operation could not be completed.',
    action: 'Please try again'
  }
};

/**
 * Get user-friendly error message with improved parsing
 */
export const getErrorMessage = (error: any, context?: ErrorContext): { message: string; action?: string; fieldErrors?: Record<string, string[]> } => {
  // Check if it's an AppError
  if (error instanceof AppError) {
    const errorInfo = ERROR_MESSAGES[error.code] || ERROR_MESSAGES['UNKNOWN_ERROR'];
    return {
      message: error.message || errorInfo.message,
      action: errorInfo.action
    };
  }

  // Try to parse as NestJS/backend error format
  let parsedError;
  try {
    // Check if error has response.data (axios error)
    if (error?.response?.data) {
      parsedError = enhanceErrorMessage(parseNestJSError(error.response.data));
    } else if (error?.data) {
      // Direct error data
      parsedError = enhanceErrorMessage(parseNestJSError(error.data));
    } else if (error?.message && typeof error.message === 'object') {
      // Error message might be an object
      parsedError = enhanceErrorMessage(parseNestJSError(error.message));
    } else {
      // Try parsing the error itself
      parsedError = enhanceErrorMessage(parseNestJSError(error));
    }
  } catch (parseError) {
    // If parsing fails, fall back to original logic
    parsedError = null;
  }

  // If we successfully parsed the error, use the parsed message
  if (parsedError && parsedError.message && parsedError.message !== 'An error occurred') {
    const errorInfo = ERROR_MESSAGES[parsedError.code || ''] || {};
    return {
      message: parsedError.message,
      action: errorInfo.action || parsedError.details?.suggestedAction,
      fieldErrors: parsedError.fieldErrors,
    };
  }

  // Check error code
  if (error?.code) {
    const errorInfo = ERROR_MESSAGES[error.code];
    if (errorInfo) {
      return errorInfo;
    }
  }

  // Check error message for known patterns
  const errorMessage = error?.message || String(error);
  
  if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
    return ERROR_MESSAGES['NETWORK_ERROR'];
  }
  if (errorMessage.includes('timeout')) {
    return ERROR_MESSAGES['TIMEOUT'];
  }
  if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
    return ERROR_MESSAGES['UNAUTHORIZED'];
  }
  if (errorMessage.includes('Forbidden') || errorMessage.includes('403')) {
    return ERROR_MESSAGES['FORBIDDEN'];
  }
  if (errorMessage.includes('stock') || errorMessage.includes('insufficient')) {
    return ERROR_MESSAGES['INSUFFICIENT_STOCK'];
  }
  if (errorMessage.includes('price')) {
    return ERROR_MESSAGES['INVALID_PRICE'];
  }
  if (errorMessage.includes('payment')) {
    return ERROR_MESSAGES['INVALID_PAYMENT'];
  }

  // Default
  return ERROR_MESSAGES['UNKNOWN_ERROR'];
};

/**
 * Handle error with user-friendly message and recovery options
 */
export const handleError = (
  error: any,
  context?: ErrorContext,
  recovery?: ErrorRecoveryOptions
): void => {
  const errorInfo = getErrorMessage(error, context);
  const severity = error instanceof AppError ? error.severity : 'medium';

  // Log error for audit (include field errors if available)
  auditLogger.log(
    AuditEventType.DATA_VALIDATION_FAILED,
    {
      error: error?.message || String(error),
      errorCode: error?.code || 'UNKNOWN_ERROR',
      context,
      stack: error?.stack,
      fieldErrors: errorInfo.fieldErrors,
    },
    severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : 'medium',
    context?.userId,
    context?.userName
  );

  // Build user-friendly error message
  let fullMessage = errorInfo.message;
  
  // Add field-specific errors if available
  if (errorInfo.fieldErrors && Object.keys(errorInfo.fieldErrors).length > 0) {
    const fieldMessages = Object.entries(errorInfo.fieldErrors)
      .map(([field, errors]) => {
        // Format field name nicely (e.g., "customerName" -> "Customer Name")
        const formattedField = field
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, (str) => str.toUpperCase())
          .trim();
        return `${formattedField}: ${errors.join(', ')}`;
      })
      .join('\n');
    
    fullMessage = `${fullMessage}\n\n${fieldMessages}`;
  }
  
  // Add suggested action if available
  if (errorInfo.action) {
    fullMessage = `${fullMessage}\n\n${errorInfo.action}`;
  }

  // Add retry button if operation is retryable
  const toastAction = recovery?.retryable && recovery?.fallbackAction
    ? {
        label: 'Retry',
        onClick: recovery.fallbackAction,
      }
    : undefined;

  // Show toast with longer duration if there are field errors (more info to read)
  const toastDuration = errorInfo.fieldErrors && Object.keys(errorInfo.fieldErrors).length > 0
    ? 10000 // 10 seconds for field errors
    : severity === 'critical' ? 8000 : 5000;

  showToast(fullMessage, 'error', toastDuration, toastAction);

  // Log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.error('[Error Handler]', {
      error,
      context,
      errorInfo,
      recovery,
      parsedError: error?.response?.data ? parseNestJSError(error.response.data) : null,
    });
  }
};

/**
 * Retry operation with exponential backoff and rate limiting
 */
export const retryOperation = async <T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    onRetry?: (attempt: number) => void;
    shouldRetry?: (error: any) => boolean;
    endpoint?: string; // For rate limiting
  } = {}
): Promise<T> => {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    onRetry,
    shouldRetry = () => true,
    endpoint,
  } = options;

  // Import rate limiter (dynamic import to avoid circular dependencies)
  let rateLimiter: any = null;
  try {
    const rateLimiterModule = await import('../../shared/rate-limiter');
    rateLimiter = rateLimiterModule.apiRateLimiter;
  } catch {
    // Rate limiter not available, continue without it
  }

  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Apply rate limiting before operation
      if (rateLimiter && endpoint) {
        await rateLimiter.waitIfNeeded(endpoint);
        rateLimiter.recordRequest(endpoint);
      }

      return await operation();
    } catch (error: any) {
      lastError = error;

      // Don't retry if we've exceeded max retries
      if (attempt >= maxRetries) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetry(error)) {
        break;
      }

      // Calculate delay with exponential backoff
      // Base delay increases exponentially: 1s, 2s, 4s, 8s...
      const delay = retryDelay * Math.pow(2, attempt);
      
      if (onRetry) {
        onRetry(attempt + 1);
      }

      // Wait before retry (with rate limiting consideration)
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

/**
 * Handle network errors with automatic retry
 */
export const handleNetworkOperation = async <T>(
  operation: () => Promise<T>,
  context?: ErrorContext,
  options: {
    maxRetries?: number;
    showRetryToast?: boolean;
  } = {}
): Promise<T> => {
  const { maxRetries = 3, showRetryToast = true } = options;

  try {
    return await retryOperation(
      operation,
      {
        maxRetries,
        shouldRetry: (error) => {
          // Retry on network errors
          const errorMessage = error?.message || String(error);
          return (
            errorMessage.includes('network') ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('ECONNREFUSED') ||
            errorMessage.includes('fetch')
          );
        },
        onRetry: (attempt) => {
          if (showRetryToast) {
            showToast(`Retrying... (Attempt ${attempt}/${maxRetries})`, 'info', 2000);
          }
        },
      }
    );
  } catch (error) {
    handleError(error, context, {
      retryable: true,
      maxRetries,
    });
    throw error;
  }
};

/**
 * Safe async operation wrapper with error handling
 */
export const safeAsync = async <T>(
  operation: () => Promise<T>,
  context?: ErrorContext,
  fallback?: (error: any) => T | void
): Promise<T | void> => {
  try {
    return await operation();
  } catch (error) {
    handleError(error, context);
    
    if (fallback) {
      return fallback(error);
    }
    
    return undefined;
  }
};

/**
 * Error recovery strategies
 */
export const ErrorRecovery = {
  /**
   * Retry with exponential backoff
   */
  retry: async <T>(
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> => {
    return retryOperation(operation, { maxRetries });
  },

  /**
   * Fallback to cached data
   */
  useCache: <T>(cacheKey: string, fallback: T): T => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Ignore cache errors
    }
    return fallback;
  },

  /**
   * Redirect to login on auth errors
   */
  redirectToLogin: () => {
    showToast('Your session has expired. Redirecting to login...', 'warning', 3000);
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  },

  /**
   * Reload products on product errors
   */
  reloadProducts: (callback: () => void) => {
    showToast('Reloading products...', 'info', 2000);
    setTimeout(callback, 1000);
  },
};

