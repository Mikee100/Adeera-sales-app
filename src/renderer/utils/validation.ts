/**
 * Validation utilities for POS system
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates stock availability before adding to cart
 */
export const validateStock = (
  product: { id: string; name: string; stock: number },
  requestedQuantity: number,
  currentCartQuantity: number = 0
): ValidationResult => {
  if (!product) {
    return { isValid: false, error: 'Product not found' };
  }

  if (typeof product.stock !== 'number' || product.stock < 0) {
    return { isValid: false, error: 'Invalid stock value' };
  }

  if (typeof requestedQuantity !== 'number' || requestedQuantity <= 0) {
    return { isValid: false, error: 'Invalid quantity' };
  }

  const totalRequested = currentCartQuantity + requestedQuantity;

  if (totalRequested > product.stock) {
    const available = product.stock - currentCartQuantity;
    return {
      isValid: false,
      error: `Insufficient stock. Only ${available} ${available === 1 ? 'item' : 'items'} available for ${product.name}`
    };
  }

  return { isValid: true };
};

/**
 * Validates product price
 */
export const validatePrice = (price: number): ValidationResult => {
  if (typeof price !== 'number') {
    return { isValid: false, error: 'Price must be a number' };
  }

  if (price < 0) {
    return { isValid: false, error: 'Price cannot be negative' };
  }

  if (price === 0) {
    return { isValid: false, error: 'Price cannot be zero' };
  }

  if (!isFinite(price)) {
    return { isValid: false, error: 'Price must be a finite number' };
  }

  // Check for reasonable maximum price (e.g., $1,000,000)
  if (price > 1000000) {
    return { isValid: false, error: 'Price exceeds maximum allowed value' };
  }

  return { isValid: true };
};

/**
 * Validates payment amount received
 */
export const validatePaymentAmount = (
  amountReceived: number,
  totalAmount: number,
  paymentMethod: 'cash' | 'mpesa' | 'credit' | string
): ValidationResult => {
  if (paymentMethod === 'cash') {
    if (typeof amountReceived !== 'number' || isNaN(amountReceived)) {
      return { isValid: false, error: 'Amount received must be a valid number' };
    }

    if (amountReceived < 0) {
      return { isValid: false, error: 'Amount received cannot be negative' };
    }

    if (amountReceived < totalAmount) {
      return {
        isValid: false,
        error: `Amount received ($${amountReceived.toFixed(2)}) is less than total ($${totalAmount.toFixed(2)})`
      };
    }

    // Check for unreasonably large amounts (e.g., > $100,000)
    if (amountReceived > 100000) {
      return { isValid: false, error: 'Amount received exceeds maximum allowed value' };
    }

    // Check for suspiciously large change amounts (e.g., > $10,000)
    const change = amountReceived - totalAmount;
    if (change > 10000) {
      return { isValid: false, error: 'Change amount is unusually large. Please verify the amount.' };
    }
  }

  return { isValid: true };
};

/**
 * Validates receipt number format
 */
export const validateReceiptNumber = (receiptNumber: string): ValidationResult => {
  if (!receiptNumber || typeof receiptNumber !== 'string') {
    return { isValid: false, error: 'Receipt number is required' };
  }

  if (receiptNumber.trim().length === 0) {
    return { isValid: false, error: 'Receipt number cannot be empty' };
  }

  // Receipt numbers should be alphanumeric and may contain hyphens
  if (!/^[A-Z0-9\-]+$/i.test(receiptNumber)) {
    return { isValid: false, error: 'Receipt number contains invalid characters' };
  }

  // Reasonable length check
  if (receiptNumber.length > 50) {
    return { isValid: false, error: 'Receipt number is too long' };
  }

  return { isValid: true };
};

/**
 * Validates sale data integrity before submission
 */
export const validateSaleData = (saleData: {
  items: Array<{ productId: string; quantity: number; price: number }>;
  paymentMethod: string;
  amountReceived?: number;
  branchId?: string;
  idempotencyKey?: string;
  creditAmount?: number;
  creditDueDate?: string;
  creditNotes?: string;
}): ValidationResult => {
  // Validate items array
  if (!saleData.items || !Array.isArray(saleData.items)) {
    return { isValid: false, error: 'Sale must contain items' };
  }

  if (saleData.items.length === 0) {
    return { isValid: false, error: 'Sale must contain at least one item' };
  }

  // Validate each item
  for (let i = 0; i < saleData.items.length; i++) {
    const item = saleData.items[i];

    if (!item.productId || typeof item.productId !== 'string') {
      return { isValid: false, error: `Item ${i + 1}: Invalid product ID` };
    }

    if (typeof item.quantity !== 'number' || item.quantity <= 0) {
      return { isValid: false, error: `Item ${i + 1}: Invalid quantity` };
    }

    if (!Number.isInteger(item.quantity)) {
      return { isValid: false, error: `Item ${i + 1}: Quantity must be a whole number` };
    }

    const priceValidation = validatePrice(item.price);
    if (!priceValidation.isValid) {
      return { isValid: false, error: `Item ${i + 1}: ${priceValidation.error}` };
    }
  }

  // Validate payment method
  if (!saleData.paymentMethod || typeof saleData.paymentMethod !== 'string') {
    return { isValid: false, error: 'Payment method is required' };
  }

  const validPaymentMethods = ['cash', 'mpesa', 'card', 'bank', 'credit'];
  if (!validPaymentMethods.includes(saleData.paymentMethod.toLowerCase())) {
    return { isValid: false, error: 'Invalid payment method' };
  }

  // Validate branch ID
  if (!saleData.branchId || typeof saleData.branchId !== 'string') {
    return { isValid: false, error: 'Branch ID is required' };
  }

  // Validate idempotency key
  if (!saleData.idempotencyKey || typeof saleData.idempotencyKey !== 'string') {
    return { isValid: false, error: 'Idempotency key is required' };
  }

  return { isValid: true };
};

/**
 * Validates phone number format
 */
export const validatePhoneNumber = (phone: string): ValidationResult => {
  if (!phone || phone.trim().length === 0) {
    return { isValid: true }; // Phone is optional
  }

  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Check if it's a valid phone number format
  // Allows: +1234567890, 1234567890, etc.
  if (!/^\+?[\d]{7,15}$/.test(cleaned)) {
    return { isValid: false, error: 'Please enter a valid phone number (7-15 digits)' };
  }

  return { isValid: true };
};

/**
 * Validates customer name
 */
export const validateCustomerName = (name: string): ValidationResult => {
  if (!name || name.trim().length === 0) {
    return { isValid: true }; // Name is optional
  }

  if (name.trim().length < 2) {
    return { isValid: false, error: 'Customer name must be at least 2 characters' };
  }

  if (name.length > 100) {
    return { isValid: false, error: 'Customer name is too long' };
  }

  // Check for suspicious patterns (e.g., SQL injection attempts)
  if (/[<>'"]/.test(name)) {
    return { isValid: false, error: 'Customer name contains invalid characters' };
  }

  return { isValid: true };
};

