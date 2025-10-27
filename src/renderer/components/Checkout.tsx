import React, { useState, useEffect } from 'react';
import '../checkout.css';

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

interface PaymentData {
  paymentMethod: 'cash' | 'mpesa';
  amountReceived?: number;
  customerName?: string;
  customerPhone?: string;
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
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mpesa'>('cash');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [success, setSuccess] = useState(false);

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

    if (paymentMethod === 'cash') {
      const received = parseFloat(amountReceived);
      if (!amountReceived || isNaN(received) || received < total) {
        newErrors.amountReceived = `Amount must be at least $${total.toFixed(2)}`;
      }
    }

    if (customerPhone && !/^\+?[\d\s\-\(\)]+$/.test(customerPhone)) {
      newErrors.customerPhone = 'Please enter a valid phone number';
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
      paymentMethod,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
    };

    if (paymentMethod === 'cash') {
      paymentData.amountReceived = parseFloat(amountReceived);
    }

    onCompleteSale(paymentData);
    setSuccess(true);
  };

  const change = paymentMethod === 'cash' && amountReceived
    ? parseFloat(amountReceived) - total
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
              <div className="total-row">
                <span>VAT (16%)</span>
                <span>${vat.toFixed(2)}</span>
              </div>
              <div className="total-row grand-total">
                <span>Total Amount</span>
                <span className="total-amount">${total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="checkout-right">
          {/* Payment Method Card */}
          <div className="checkout-card payment-card">
            <div className="card-header">
              <h2>💰 Payment Method</h2>
            </div>

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
            </div>

            {/* Cash Payment Details */}
            {paymentMethod === 'cash' && (
              <div className="cash-payment-section">
                <div className="input-group">
                  <label className="input-label">
                    <span className="label-icon">💰</span>
                    Amount Received
                  </label>
                  <div className="input-wrapper">
                    <span className="currency-symbol">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min={total.toFixed(2)}
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(e.target.value)}
                      placeholder={total.toFixed(2)}
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
                      <span className="change-amount">${change.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Customer Information Card */}
          <div className="checkout-card customer-card">
            <div className="card-header">
              <h2>👤 Customer Details</h2>
              <span className="optional-badge">Optional</span>
            </div>

            <div className="customer-form">
              <div className="input-group">
                <label className="input-label">
                  <span className="label-icon">👤</span>
                  Customer Name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                  className="text-input"
                />
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
