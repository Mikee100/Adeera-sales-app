/**
 * Stock conflict detection and retry handler
 * Handles race conditions when multiple users try to sell the same product simultaneously
 * 
 * NOTE: This utility can be used in both renderer and main process
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

/**
 * Retry sale with refreshed stock data
 */
export async function retrySaleWithRefresh(
  saleData: any,
  refreshProducts: () => Promise<any>,
  retrySale: (updatedSaleData: any) => Promise<any>,
  maxRetries: number = 2
): Promise<any> {
  let lastError: any = null;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      // Refresh products to get latest stock
      if (retryCount > 0) {
        console.log(`Retrying sale (attempt ${retryCount + 1}/${maxRetries + 1}) - refreshing products...`);
        await refreshProducts();
        // Wait a bit to allow state to update
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Attempt the sale
      const result = await retrySale(saleData);
      return result;
    } catch (error: any) {
      lastError = error;
      const conflict = detectStockConflict(error);

      // If it's a stock conflict and we have retries left, try again
      if (conflict.isStockConflict && retryCount < maxRetries) {
        retryCount++;
        console.log(`Stock conflict detected, retrying... (${retryCount}/${maxRetries})`);
        continue;
      }

      // If not a stock conflict or out of retries, throw the error
      throw error;
    }
  }

  throw lastError;
}

/**
 * Update sale data with refreshed product stock information
 */
export function updateSaleDataWithFreshStock(
  saleData: any,
  freshProducts: any[]
): any {
  const updatedSaleData = { ...saleData };
  
  if (updatedSaleData.items && Array.isArray(updatedSaleData.items)) {
    updatedSaleData.items = updatedSaleData.items.map((item: any) => {
      // Find the fresh product data
      const freshProduct = freshProducts.find(
        (p: any) => p.id === item.productId || p.id === item.variationId
      );

      if (freshProduct) {
        // Update with fresh stock info (if backend provides version numbers, include them)
        return {
          ...item,
          // Include version number if available (for optimistic locking)
          version: freshProduct.version || item.version,
          // Include fresh stock for validation
          _freshStock: freshProduct.stock,
        };
      }

      return item;
    });
  }

  return updatedSaleData;
}
