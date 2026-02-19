import React, { useState, useEffect } from 'react';
import '../checkout.css';
import { validatePaymentAmount, validatePhoneNumber, validateCustomerName } from '../utils/validation';
import { auditLogger, AuditEventType } from '../utils/audit-logger';

interface Product {
  id: string;
  name: string;
  price: number;
  sku: string;
  stock: number;
  description?: string;
  cost?: number;
  supplier?: string;
  images?: string[];
  branchId?: string;
  tenantId?: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface CheckoutProps {
  cart: CartItem[];
  subtotal: number;
  vat: number;
  total: number;
  onCompleteSale: (paymentData: PaymentData) => void;
  onBackToProducts: () => void;
  loading: boolean;
}

interface SplitPayment {
  method: 'cash' | 'mpesa' | 'credit';
  amount: number;
  amountReceived?: number; // For cash payments
  mpesaTransactionId?: string; // For M-Pesa payments
  mpesaReceipt?: string; // For M-Pesa payments
  creditDueDate?: string; // For credit payments
  creditNotes?: string; // For credit payments
}

interface PaymentData {
  paymentMethod: 'cash' | 'mpesa' | 'credit';
  amountReceived?: number;
  customerName?: string;
  customerPhone?: string;
  creditAmount?: number;
  creditDueDate?: string;
  creditNotes?: string;
  /** Fixed discount amount applied to subtotal (before VAT). */
  discountAmount?: number;
  /** Split payments - multiple payment methods */
  splitPayments?: SplitPayment[];
  /** Whether this is a split payment */
  isSplitPayment?: boolean;
}

const Checkout: React.FC<CheckoutProps> = ({
  cart,
  subtotal,
  vat,
  total,
  onCompleteSale,
  onBackToProducts,
  loading
}) => {
  // Get user info for audit logging (if available)
  const getUserInfo = async () => {
    try {
      const userData = await (window as any).electronAPI?.getUserData?.();
      return userData || null;
    } catch {
      return null;
    }
  };

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mpesa' | 'credit'>('cash');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [creditDueDate, setCreditDueDate] = useState('');
  const [creditNotes, setCreditNotes] = useState('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [success, setSuccess] = useState(false);
  
  // Split payment state
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);

  // Computed totals after discount (discount applied to subtotal, then VAT on remainder)
  const subtotalAfterDiscount = Math.max(0, subtotal - discountAmount);
  const vatAfterDiscount = Math.round(subtotalAfterDiscount * 0.16 * 100) / 100;
  const totalAfterDiscount = subtotalAfterDiscount + vatAfterDiscount;

  // Progress steps
  const steps = ['Cart Review', 'Payment', 'Confirmation'];
  const currentStep = 1; // Assuming we're on payment step

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    // Validate discount
    if (discountAmount < 0 || discountAmount > subtotal) {
      newErrors.discountAmount = `Discount must be between 0 and ${subtotal.toFixed(2)}`;
    }

    // Validate split payments
    if (isSplitPayment) {
      if (splitPayments.length === 0) {
        newErrors.splitPayments = 'Please add at least one payment method';
      } else {
        const totalSplitAmount = splitPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const difference = Math.abs(totalSplitAmount - totalAfterDiscount);
        
        if (difference > 0.01) { // Allow small rounding differences
          newErrors.splitPayments = `Split payments total (Ksh ${totalSplitAmount.toFixed(2)}) must equal total (Ksh ${totalAfterDiscount.toFixed(2)})`;
        }

        // Validate each split payment
        splitPayments.forEach((payment, index) => {
          if (payment.amount <= 0) {
            newErrors[`splitPayment_${index}_amount`] = 'Payment amount must be greater than 0';
          }
          
          if (payment.method === 'cash' && (!payment.amountReceived || payment.amountReceived < payment.amount)) {
            newErrors[`splitPayment_${index}_cash`] = `Cash received must be at least Ksh ${payment.amount.toFixed(2)}`;
          }
          
          if (payment.method === 'credit' && !customerName?.trim()) {
            newErrors.customerName = 'Customer name is required for credit payments';
          }
        });
      }
    } else {
      // Validate single payment method
      // Validate payment amount (against total after discount)
      if (paymentMethod === 'cash') {
        const received = parseFloat(amountReceived);
        if (!amountReceived || isNaN(received)) {
          newErrors.amountReceived = 'Please enter a valid amount';
        } else {
          const paymentValidation = validatePaymentAmount(received, totalAfterDiscount, paymentMethod);
          if (!paymentValidation.isValid) {
            newErrors.amountReceived = paymentValidation.error || `Amount must be at least Ksh ${totalAfterDiscount.toFixed(2)}`;
          }
        }
      }

      // Validate credit payment - customer name is required
      if (paymentMethod === 'credit') {
        if (!customerName || customerName.trim().length === 0) {
          newErrors.customerName = 'Customer name is required for credit sales';
        }
      }
    }

    // Validate phone number
    if (customerPhone) {
      const phoneValidation = validatePhoneNumber(customerPhone);
      if (!phoneValidation.isValid) {
        newErrors.customerPhone = phoneValidation.error || 'Please enter a valid phone number';
      }
    }

    // Validate customer name
    if (customerName) {
      const nameValidation = validateCustomerName(customerName);
      if (!nameValidation.isValid) {
        newErrors.customerName = nameValidation.error || 'Please enter a valid customer name';
      }
    }

    // Log validation failures for audit (async)
    if (Object.keys(newErrors).length > 0) {
      getUserInfo().then(userInfo => {
        auditLogger.log(
          AuditEventType.DATA_VALIDATION_FAILED,
          {
            errors: newErrors,
            paymentMethod,
            isSplitPayment,
            totalAmount: totalAfterDiscount,
          },
          'medium',
          userInfo?.id,
          userInfo?.name
        );
      });
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const paymentData: PaymentData = {
      paymentMethod: isSplitPayment ? 'split' : paymentMethod,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      ...(discountAmount > 0 && { discountAmount }),
      isSplitPayment,
    };

    if (isSplitPayment) {
      // For split payments, use the split payments array
      paymentData.splitPayments = splitPayments;
      // Set primary payment method to the first split payment method for backward compatibility
      paymentData.paymentMethod = splitPayments[0]?.method || 'cash';
    } else {
      // Single payment method
      if (paymentMethod === 'cash') {
        paymentData.amountReceived = parseFloat(amountReceived);
      }

      if (paymentMethod === 'credit') {
        paymentData.creditAmount = totalAfterDiscount;
        if (creditDueDate) {
          paymentData.creditDueDate = creditDueDate;
        }
        if (creditNotes) {
          paymentData.creditNotes = creditNotes.trim();
        }
      }
    }

    onCompleteSale(paymentData);
    setSuccess(true);
  };

  // Split payment handlers
  const handleToggleSplitPayment = () => {
    setIsSplitPayment(!isSplitPayment);
    if (!isSplitPayment) {
      // Initialize with one payment method
      setSplitPayments([{
        method: 'cash',
        amount: totalAfterDiscount,
        amountReceived: totalAfterDiscount,
      }]);
    } else {
      // Clear split payments when disabling
      setSplitPayments([]);
    }
  };

  const handleAddSplitPayment = () => {
    const remaining = totalAfterDiscount - splitPayments.reduce((sum, p) => sum + p.amount, 0);
    setSplitPayments([...splitPayments, {
      method: 'cash',
      amount: Math.max(0, remaining),
      amountReceived: Math.max(0, remaining),
    }]);
  };

  const handleRemoveSplitPayment = (index: number) => {
    setSplitPayments(splitPayments.filter((_, i) => i !== index));
  };

  const handleUpdateSplitPayment = (index: number, updates: Partial<SplitPayment>) => {
    const updated = [...splitPayments];
    updated[index] = { ...updated[index], ...updates };
    setSplitPayments(updated);
  };

  const getRemainingAmount = () => {
    const totalSplit = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    return totalAfterDiscount - totalSplit;
  };

  const change = paymentMethod === 'cash' && amountReceived
    ? parseFloat(amountReceived) - totalAfterDiscount
    : 0;

  return (
    <div className="checkout-page">
   
      {/* Success Message */}
      {success && (
        <div className="success-message">
          <span className="success-icon">✅</span>
          <span>Sale completed!</span>
        </div>
      )}

    

      <div className="checkout-main">
        <div className="checkout-left">
          {/* Order Summary Card */}
          <div className="checkout-card order-summary-card">
            <div className="card-header">
              <h2>🛒 Order Summary</h2>
              <span className="item-count">{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="order-items">
              {cart.map(item => (
                <div key={item.product.id} className="order-item">
                  <div className="item-details">
                    <h4 className="item-name">{item.product.name}</h4>
                    <span className="item-sku">SKU: {item.product.sku}</span>
                  </div>
                  <div className="item-meta">
                    <span className="item-quantity">Qty: {item.quantity}</span>
                    <span className="item-price">${(item.product.price * item.quantity).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="order-totals">
              <div className="total-row">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="total-row discount-row">
                  <span>Discount</span>
                  <span className="discount-amount">−${discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="total-row">
                <span>VAT (16%)</span>
                <span>${vatAfterDiscount.toFixed(2)}</span>
              </div>
              <div className="total-row grand-total">
                <span>Total Amount</span>
                <span className="total-amount">${totalAfterDiscount.toFixed(2)}</span>
              </div>
            </div>

            <div className="discount-input-section">
              <label className="input-label">
                <span className="label-icon">🏷️</span>
                Discount (optional)
              </label>
              <div className="input-wrapper">
                <span className="currency-symbol">$</span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={subtotal}
                  value={discountAmount === 0 ? '' : discountAmount}
                  onChange={(e) => setDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0.00"
                  className={`currency-input ${errors.discountAmount ? 'error' : ''}`}
                  aria-describedby="discount-error"
                />
              </div>
              {errors.discountAmount && (
                <span id="discount-error" className="error-text">{errors.discountAmount}</span>
              )}
            </div>
          </div>
        </div>

        <div className="checkout-right">
          {/* Payment Method Card */}
          <div className="checkout-card payment-card">
            <div className="card-header">
              <h2>💰 Payment Method</h2>
              <label className="split-payment-toggle">
                <input
                  type="checkbox"
                  checked={isSplitPayment}
                  onChange={handleToggleSplitPayment}
                />
                <span>Split Payment</span>
              </label>
            </div>

            {!isSplitPayment ? (
              <div className="payment-options">
              <label className={`payment-option ${paymentMethod === 'cash' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  value="cash"
                  checked={paymentMethod === 'cash'}
                  onChange={(e) => setPaymentMethod(e.target.value as 'cash')}
                />
                <div className="payment-content">
                  <div className="payment-icon cash-icon">💵</div>
                  <div className="payment-info">
                    <span className="payment-name">Cash Payment</span>
                    <span className="payment-desc">Pay with physical cash</span>
                  </div>
                  <div className="payment-check">
                    {paymentMethod === 'cash' && <span className="check-icon">✓</span>}
                  </div>
                </div>
              </label>

              <label className={`payment-option ${paymentMethod === 'mpesa' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  value="mpesa"
                  checked={paymentMethod === 'mpesa'}
                  onChange={(e) => setPaymentMethod(e.target.value as 'mpesa')}
                />
                <div className="payment-content">
                  <div className="payment-icon mpesa-icon">📱</div>
                  <div className="payment-info">
                    <span className="payment-name">M-Pesa</span>
                    <span className="payment-desc">Mobile money payment</span>
                  </div>
                  <div className="payment-check">
                    {paymentMethod === 'mpesa' && <span className="check-icon">✓</span>}
                  </div>
                </div>
              </label>

              <label className={`payment-option ${paymentMethod === 'credit' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  value="credit"
                  checked={paymentMethod === 'credit'}
                  onChange={(e) => setPaymentMethod(e.target.value as 'credit')}
                />
                <div className="payment-content">
                  <div className="payment-icon credit-icon">💳</div>
                  <div className="payment-info">
                    <span className="payment-name">Credit</span>
                    <span className="payment-desc">Pay later / On account</span>
                  </div>
                  <div className="payment-check">
                    {paymentMethod === 'credit' && <span className="check-icon">✓</span>}
                  </div>
                </div>
              </label>
            </div>
            ) : (
              <div className="split-payment-section">
                <div className="split-payment-header">
                  <p className="split-payment-info">
                    Split the payment across multiple methods. Total must equal <strong>Ksh {totalAfterDiscount.toFixed(2)}</strong>
                  </p>
                  {errors.splitPayments && (
                    <span className="error-message">{errors.splitPayments}</span>
                  )}
                  <div className="remaining-amount">
                    Remaining: <strong className={getRemainingAmount() < 0 ? 'error' : getRemainingAmount() > 0.01 ? 'warning' : 'success'}>
                      Ksh {getRemainingAmount().toFixed(2)}
                    </strong>
                  </div>
                </div>

                <div className="split-payments-list">
                  {splitPayments.map((payment, index) => (
                    <div key={index} className="split-payment-item">
                      <div className="split-payment-row">
                        <div className="split-payment-method">
                          <select
                            value={payment.method}
                            onChange={(e) => handleUpdateSplitPayment(index, { 
                              method: e.target.value as 'cash' | 'mpesa' | 'credit',
                              amountReceived: e.target.value === 'cash' ? payment.amount : undefined,
                            })}
                            className="split-method-select"
                          >
                            <option value="cash">Cash</option>
                            <option value="mpesa">M-Pesa</option>
                            <option value="credit">Credit</option>
                          </select>
                        </div>
                        <div className="split-payment-amount">
                          <label>Amount</label>
                          <div className="input-wrapper">
                            <span className="currency-symbol">Ksh</span>
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              max={totalAfterDiscount}
                              value={payment.amount || ''}
                              onChange={(e) => {
                                const amount = parseFloat(e.target.value) || 0;
                                handleUpdateSplitPayment(index, { 
                                  amount,
                                  amountReceived: payment.method === 'cash' ? amount : payment.amountReceived,
                                });
                              }}
                              className={`currency-input ${errors[`splitPayment_${index}_amount`] ? 'error' : ''}`}
                              placeholder="0.00"
                            />
                          </div>
                          {errors[`splitPayment_${index}_amount`] && (
                            <span className="error-text">{errors[`splitPayment_${index}_amount`]}</span>
                          )}
                        </div>
                        {splitPayments.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSplitPayment(index)}
                            className="remove-split-btn"
                            title="Remove payment method"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Cash-specific fields */}
                      {payment.method === 'cash' && (
                        <div className="split-payment-details">
                          <label>Cash Received</label>
                          <div className="input-wrapper">
                            <span className="currency-symbol">Ksh</span>
                            <input
                              type="number"
                              step="0.01"
                              min={payment.amount}
                              value={payment.amountReceived || ''}
                              onChange={(e) => handleUpdateSplitPayment(index, { 
                                amountReceived: parseFloat(e.target.value) || payment.amount 
                              })}
                              className={`currency-input ${errors[`splitPayment_${index}_cash`] ? 'error' : ''}`}
                              placeholder={payment.amount.toFixed(2)}
                            />
                          </div>
                          {errors[`splitPayment_${index}_cash`] && (
                            <span className="error-text">{errors[`splitPayment_${index}_cash`]}</span>
                          )}
                          {payment.amountReceived && payment.amountReceived > payment.amount && (
                            <div className="change-display-small">
                              Change: Ksh {(payment.amountReceived - payment.amount).toFixed(2)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* M-Pesa-specific fields */}
                      {payment.method === 'mpesa' && (
                        <div className="split-payment-details">
                          <label>M-Pesa Transaction ID (Optional)</label>
                          <input
                            type="text"
                            value={payment.mpesaTransactionId || ''}
                            onChange={(e) => handleUpdateSplitPayment(index, { mpesaTransactionId: e.target.value })}
                            className="text-input"
                            placeholder="e.g., QHX123456789"
                          />
                        </div>
                      )}

                      {/* Credit-specific fields */}
                      {payment.method === 'credit' && (
                        <div className="split-payment-details">
                          <label>Due Date (Optional)</label>
                          <input
                            type="date"
                            value={payment.creditDueDate || ''}
                            onChange={(e) => handleUpdateSplitPayment(index, { creditDueDate: e.target.value })}
                            className="text-input"
                            min={new Date().toISOString().split('T')[0]}
                          />
                          <label>Notes (Optional)</label>
                          <textarea
                            value={payment.creditNotes || ''}
                            onChange={(e) => handleUpdateSplitPayment(index, { creditNotes: e.target.value })}
                            className="text-input"
                            placeholder="Add notes about this credit payment..."
                            rows={2}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {getRemainingAmount() > 0.01 && (
                  <button
                    type="button"
                    onClick={handleAddSplitPayment}
                    className="add-split-payment-btn"
                  >
                    + Add Payment Method
                  </button>
                )}
              </div>
            )}

            {/* Cash Payment Details */}
            {paymentMethod === 'cash' && (
              <div className="cash-payment-section">
                <div className="input-group">
                  <label className="input-label">
                    <span className="label-icon">💰</span>
                    Amount Received
                  </label>
                  <div className="input-wrapper">
                    <span className="currency-symbol">Ksh</span>
                    <input
                      type="number"
                      step="0.01"
                      min={totalAfterDiscount.toFixed(2)}
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(e.target.value)}
                      placeholder={totalAfterDiscount.toFixed(2)}
                      required
                      className={`currency-input ${errors.amountReceived ? 'error' : ''}`}
                      aria-describedby="amount-error"
                    />
                  </div>
                  <span className="input-hint">Minimum: ${total.toFixed(2)}</span>
                  {errors.amountReceived && (
                    <span id="amount-error" className="error-message">{errors.amountReceived}</span>
                  )}
                </div>

                {amountReceived && parseFloat(amountReceived) >= total && (
                  <div className="change-display">
                    <div className="change-icon">🔄</div>
                    <div className="change-info">
                      <span className="change-label">Change to return:</span>
                      <span className="change-amount">Ksh {change.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Credit Payment Details */}
            {paymentMethod === 'credit' && (
              <div className="credit-payment-section">
                <div className="credit-info-banner">
                  <div className="info-icon">ℹ️</div>
                  <div className="info-text">
                    <strong>Credit Sale</strong>
                    <p>Total amount: Ksh {total.toFixed(2)} will be added to customer's account</p>
                  </div>
                </div>

                <div className="input-group">
                  <label className="input-label">
                    <span className="label-icon">📅</span>
                    Due Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={creditDueDate}
                    onChange={(e) => setCreditDueDate(e.target.value)}
                    className="text-input"
                    min={new Date().toISOString().split('T')[0]}
                  />
                  <span className="input-hint">When payment is expected</span>
                </div>

                <div className="input-group">
                  <label className="input-label">
                    <span className="label-icon">📝</span>
                    Notes (Optional)
                  </label>
                  <textarea
                    value={creditNotes}
                    onChange={(e) => setCreditNotes(e.target.value)}
                    placeholder="Add any notes about this credit sale..."
                    className="text-input"
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Customer Information Card */}
          <div className="checkout-card customer-card">
            <div className="card-header">
              <h2>👤 Customer Details</h2>
              <span className={`optional-badge ${paymentMethod === 'credit' ? 'required-badge' : ''}`}>
                {paymentMethod === 'credit' ? 'Required' : 'Optional'}
              </span>
            </div>

            <div className="customer-form">
              <div className="input-group">
                <label className="input-label">
                  <span className="label-icon">👤</span>
                  Customer Name
                  {paymentMethod === 'credit' && <span className="required-indicator">*</span>}
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                  className={`text-input ${errors.customerName ? 'error' : ''}`}
                  required={paymentMethod === 'credit'}
                  aria-describedby="name-error"
                />
                {errors.customerName && (
                  <span id="name-error" className="error-message">{errors.customerName}</span>
                )}
              </div>

              <div className="input-group">
                <label className="input-label">
                  <span className="label-icon">📞</span>
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Enter phone number"
                  className={`text-input ${errors.customerPhone ? 'error' : ''}`}
                  aria-describedby="phone-error"
                />
                {errors.customerPhone && (
                  <span id="phone-error" className="error-message">{errors.customerPhone}</span>
                )}
              </div>
            </div>
          </div>

          {/* Complete Sale Button */}
          <div className="checkout-actions">
            <button
              type="button"
              onClick={onBackToProducts}
              className="secondary-btn"
              disabled={loading}
            >
              <span className="btn-icon">❌</span>
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="primary-btn complete-sale-btn"
            >
              {loading ? (
                <>
                  <div className="loading-spinner"></div>
                  <span>Processing Payment...</span>
                </>
              ) : (
                <>
                  <span className="btn-icon">✅</span>
                  <span>Complete Sale - ${total.toFixed(2)}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
