/**
 * Stock conflict detection utility (shared between main and renderer)
 * Handles race conditions when multiple users try to sell the same product simultaneously
 */

export interface StockConflictError {
  isStockConflict: boolean;
  conflictingProducts?: string[];
  message: string;
}

/**
 * Detect if an error is a stock conflict error
 */
export function detectStockConflict(error: any): StockConflictError {
  const errorMessage = String(error?.message || error?.error || '').toLowerCase();
  const errorData = error?.response?.data || error?.data || {};
  const errorDataString = JSON.stringify(errorData).toLowerCase();

  // Check for common stock conflict indicators
  const stockConflictKeywords = [
    'insufficient stock',
    'stock conflict',
    'concurrent modification',
    'optimistic locking',
    'version conflict',
    'stock has changed',
    'stock was modified',
    'out of stock',
    'not enough stock',
    'stock unavailable',
    'negative stock',
    'stock quantity',
  ];

  const hasStockConflictKeyword = stockConflictKeywords.some(keyword =>
    errorMessage.includes(keyword) || errorDataString.includes(keyword)
  );

  // Check HTTP status codes that might indicate conflicts
  const conflictStatusCodes = [409, 422]; // 409 Conflict, 422 Unprocessable Entity
  const hasConflictStatus = error?.response?.status && conflictStatusCodes.includes(error.response.status);

  // Extract conflicting product IDs/names if available
  const conflictingProducts: string[] = [];
  if (errorData?.conflictingProducts && Array.isArray(errorData.conflictingProducts)) {
    conflictingProducts.push(...errorData.conflictingProducts);
  }
  if (errorData?.products && Array.isArray(errorData.products)) {
    conflictingProducts.push(...errorData.products);
  }

  const isStockConflict = hasStockConflictKeyword || hasConflictStatus;

  return {
    isStockConflict,
    conflictingProducts: conflictingProducts.length > 0 ? conflictingProducts : undefined,
    message: error?.message || error?.error || 'Stock conflict detected',
  };
}
