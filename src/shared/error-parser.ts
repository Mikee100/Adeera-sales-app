/**
 * Error parsing utility to extract detailed error messages from backend responses
 * Handles NestJS validation errors and other common error formats
 */

export interface ParsedError {
  message: string;
  fieldErrors?: Record<string, string[]>; // Field-specific errors
  code?: string;
  statusCode?: number;
  details?: any; // Additional error details
}

/**
 * Parse NestJS validation error response
 * NestJS returns errors in format:
 * {
 *   statusCode: 400,
 *   message: ['field1 should not be empty', 'field2 must be a number'],
 *   error: 'Bad Request'
 * }
 * OR
 * {
 *   statusCode: 400,
 *   message: [
 *     {
 *       property: 'field1',
 *       constraints: { isNotEmpty: 'field1 should not be empty' }
 *     }
 *   ]
 * }
 */
export function parseNestJSError(errorData: any): ParsedError {
  const result: ParsedError = {
    message: 'An error occurred',
    fieldErrors: {},
  };

  if (!errorData) {
    return result;
  }

  // Extract status code
  if (errorData.statusCode) {
    result.statusCode = errorData.statusCode;
  }

  // Extract error code
  if (errorData.code) {
    result.code = errorData.code;
  }

  // Handle array of validation errors (NestJS format)
  if (Array.isArray(errorData)) {
    const messages: string[] = [];
    const fieldErrors: Record<string, string[]> = {};

    errorData.forEach((err: any) => {
      if (typeof err === 'string') {
        messages.push(err);
      } else if (err?.property && err?.constraints) {
        // Field-specific validation error
        const fieldName = err.property;
        const constraints = Object.values(err.constraints) as string[];
        fieldErrors[fieldName] = constraints;
        messages.push(`${fieldName}: ${constraints.join(', ')}`);
      } else if (err?.constraints) {
        // Constraints without property name
        const constraints = Object.values(err.constraints) as string[];
        messages.push(constraints.join(', '));
      } else if (err?.message) {
        messages.push(String(err.message));
      }
    });

    result.message = messages.length > 0 ? messages.join('; ') : 'Validation failed';
    if (Object.keys(fieldErrors).length > 0) {
      result.fieldErrors = fieldErrors;
    }
    return result;
  }

  // Handle message property (can be string or array)
  if (errorData.message) {
    if (Array.isArray(errorData.message)) {
      const messages: string[] = [];
      const fieldErrors: Record<string, string[]> = {};

      errorData.message.forEach((msg: any) => {
        if (typeof msg === 'string') {
          messages.push(msg);
        } else if (msg?.property && msg?.constraints) {
          // Field-specific validation error
          const fieldName = msg.property;
          const constraints = Object.values(msg.constraints) as string[];
          fieldErrors[fieldName] = constraints;
          messages.push(`${fieldName}: ${constraints.join(', ')}`);
        } else if (msg?.constraints) {
          const constraints = Object.values(msg.constraints) as string[];
          messages.push(constraints.join(', '));
        } else {
          messages.push(String(msg));
        }
      });

      result.message = messages.length > 0 ? messages.join('; ') : 'Validation failed';
      if (Object.keys(fieldErrors).length > 0) {
        result.fieldErrors = fieldErrors;
      }
    } else {
      result.message = String(errorData.message);
    }
  }

  // Handle error property (fallback)
  if (!result.message || result.message === 'Bad Request' || result.message === 'An error occurred') {
    if (errorData.error) {
      if (Array.isArray(errorData.error)) {
        result.message = errorData.error.join('; ');
      } else {
        result.message = String(errorData.error);
      }
    }
  }

  // Extract field errors from nested structure
  if (errorData.errors && typeof errorData.errors === 'object') {
    const fieldErrors: Record<string, string[]> = {};
    for (const [field, errors] of Object.entries(errorData.errors)) {
      if (Array.isArray(errors)) {
        fieldErrors[field] = errors.map((e: any) => String(e));
      } else {
        fieldErrors[field] = [String(errors)];
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      result.fieldErrors = fieldErrors;
    }
  }

  // Store additional details
  if (errorData.details) {
    result.details = errorData.details;
  }

  return result;
}

/**
 * Parse axios error response
 */
export function parseAxiosError(error: any): ParsedError {
  const errorResponse = error?.response;
  const errorData = errorResponse?.data;

  if (errorData) {
    return parseNestJSError(errorData);
  }

  // Fallback to error message
  return {
    message: error?.message || 'Network error occurred',
    code: error?.code,
    statusCode: errorResponse?.status,
  };
}

/**
 * Get user-friendly error message from parsed error
 */
export function getUserFriendlyMessage(parsedError: ParsedError): string {
  // If we have field errors, format them nicely
  if (parsedError.fieldErrors && Object.keys(parsedError.fieldErrors).length > 0) {
    const fieldMessages = Object.entries(parsedError.fieldErrors)
      .map(([field, errors]) => {
        const fieldName = field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1');
        return `${fieldName}: ${errors.join(', ')}`;
      })
      .join('\n');
    
    return `${parsedError.message}\n\n${fieldMessages}`;
  }

  return parsedError.message;
}

/**
 * Map common error codes to user-friendly messages
 */
const ERROR_CODE_MAP: Record<string, { message: string; action?: string }> = {
  'PRODUCT_NOT_FOUND': {
    message: 'Product not found. Please sync your product catalog.',
    action: 'Go to Settings → System → Sync Products',
  },
  'INSUFFICIENT_STOCK': {
    message: 'Insufficient stock for one or more items.',
    action: 'Please reduce quantities or remove items from cart',
  },
  'INVALID_PAYMENT_METHOD': {
    message: 'Invalid payment method selected.',
    action: 'Please select a valid payment method',
  },
  'BRANCH_NOT_FOUND': {
    message: 'Branch not found. Please select a valid branch.',
    action: 'Please select a branch from the dropdown',
  },
  'VALIDATION_FAILED': {
    message: 'Please check your input and try again.',
    action: 'Review the highlighted fields',
  },
  'UNAUTHORIZED': {
    message: 'Your session has expired.',
    action: 'Please log in again',
  },
  'FORBIDDEN': {
    message: 'You do not have permission to perform this action.',
    action: 'Contact your administrator',
  },
};

/**
 * Enhance error message with code mapping
 */
export function enhanceErrorMessage(parsedError: ParsedError): ParsedError {
  if (parsedError.code && ERROR_CODE_MAP[parsedError.code]) {
    const mapped = ERROR_CODE_MAP[parsedError.code];
    return {
      ...parsedError,
      message: mapped.message,
      details: {
        ...parsedError.details,
        suggestedAction: mapped.action,
      },
    };
  }

  return parsedError;
}
