import React, { useState, useEffect, useRef } from 'react';
import { validatePhoneNumber } from '../utils/validation';
import { sanitizeCustomerName, sanitizePhoneNumber, sanitizeNotes } from '../utils/sanitization';
import '../checkout.css';

interface MpesaPaymentProps {
  amount: number;
  saleData?: Record<string, unknown>;
  onSuccess: (transactionId: string, mpesaReceipt?: string) => void;
  onCancel: () => void;
}

interface MpesaTransaction {
  id: string;
  phoneNumber: string;
  amount: number;
  status: 'pending' | 'success' | 'failed' | 'cancelled' | 'timeout' | string;
  checkoutRequestId: string;
  mpesaReceipt?: string;
  message?: string;
  createdAt: string;
}

const MpesaPayment: React.FC<MpesaPaymentProps> = ({ amount, saleData, onSuccess, onCancel }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTransaction, setCurrentTransaction] = useState<MpesaTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const phoneInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!currentTransaction && !isProcessing) {
      phoneInputRef.current?.focus();
    }
  }, [currentTransaction, isProcessing]);

  // Status polling with exponential backoff
  useEffect(() => {
    let interval: NodeJS.Timeout;
    let attempt = 0;
    const maxAttempts = 15;
    const baseDelay = 3000;
    let isMounted = true;

    const checkPaymentStatus = async () => {
      if (!currentTransaction?.checkoutRequestId || !isMounted) {
        return;
      }

      try {
        const token = await (window as any).electronAPI.getAuthToken();
        if (!token) {
          throw new Error('Authentication token not found');
        }

        // Use centralized API URL from Electron main process
        const apiBaseUrl = await (window as any).electronAPI.getApiBaseUrl();
        const endpoint = `/mpesa/status/${currentTransaction.checkoutRequestId}`;
        
        // Apply rate limiting
        const { rateLimitedFetch, extractEndpoint: extractEndpointUtil } = await import('../../shared/rate-limiter');
        const fullEndpoint = extractEndpointUtil(`${apiBaseUrl}${endpoint}`);
        
        const response = await rateLimitedFetch(
          `${apiBaseUrl}${endpoint}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const resp = data as { success: boolean; data: MpesaTransaction; error?: string };

        if (resp.success && resp.data) {
          const updatedTransaction = resp.data;

          if (currentTransaction.status !== updatedTransaction.status) {
            setCurrentTransaction(updatedTransaction);
          }

          const normalizedStatus = String(updatedTransaction.status || '').toLowerCase();

          switch (normalizedStatus) {
            case 'success':
            case 'completed':
            case 'paid':
              setStatusMessage('Payment successful! Processing your order...');
              if (interval) clearTimeout(interval);
              setTimeout(() => {
                if (isMounted) {
                  updatedTransaction.status = 'success';
                  setStatusMessage('✅ Payment completed successfully!');
                  setTimeout(() => {
                    if (isMounted) {
                      onSuccess(updatedTransaction.id, updatedTransaction.mpesaReceipt);
                    }
                  }, 2000);
                }
              }, 1000);
              return;

            case 'failed':
            case 'error':
              setError(updatedTransaction.message || 'Payment was not completed');
              setIsProcessing(false);
              return;

            case 'cancelled':
              setError('Payment was cancelled');
              setIsProcessing(false);
              return;

            case 'timeout':
            case 'timed_out':
              setError('Payment request timed out. Please try again.');
              setIsProcessing(false);
              return;
          }

          // Continue polling if still pending
          if (normalizedStatus === 'pending' && attempt < maxAttempts) {
            attempt++;
            const delay = baseDelay * Math.pow(2, Math.min(attempt - 1, 4)); // Exponential backoff, max 48s
            interval = setTimeout(checkPaymentStatus, delay);
          } else if (attempt >= maxAttempts) {
            setError('Payment status check timed out. Please verify payment manually.');
            setIsProcessing(false);
          }
        }
      } catch (err: any) {
        console.error('Error checking payment status:', err);
        if (attempt < maxAttempts) {
          attempt++;
          const delay = baseDelay * Math.pow(2, Math.min(attempt - 1, 4));
          interval = setTimeout(checkPaymentStatus, delay);
        } else {
          setError('Failed to check payment status. Please verify payment manually.');
          setIsProcessing(false);
        }
      }
    };

    if (currentTransaction?.status === 'pending' && isMounted) {
      checkPaymentStatus();
    }

    return () => {
      isMounted = false;
      if (interval) clearTimeout(interval);
    };
  }, [currentTransaction, onSuccess]);

  const validateMpesaPhoneNumber = (phone: string): boolean => {
    // Accepts:
    // - 07XXXXXXXX (10 digits starting with 07)
    // - 7XXXXXXXX (9 digits starting with 7)
    // - 2547XXXXXXXX (12 digits starting with 254)
    // - +2547XXXXXXXX (13 digits starting with +254)
    const phoneRegex = /^(?:07\d{8}|7\d{8}|2547\d{8}|\+2547\d{8})$/;
    return phoneRegex.test(phone.replace(/\D/g, ''));
  };

  const formatPhoneNumber = (phone: string): string => {
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, '');

    // Handle different formats
    if (cleaned.startsWith('0')) {
      // Convert 07... to 2547...
      return '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('254')) {
      // Already in 254 format
      return cleaned;
    } else if (cleaned.startsWith('7') && cleaned.length === 9) {
      // Convert 7... to 2547...
      return '254' + cleaned;
    } else if (cleaned.startsWith('+254')) {
      // Convert +254... to 254...
      return cleaned.substring(1);
    }

    // If we get here, the format isn't recognized, but we'll try to use it as is
    return cleaned;
  };

  const handleInitiatePayment = async () => {
    if (!phoneNumber.trim()) {
      setError('Please enter a phone number');
      return;
    }

    if (!validateMpesaPhoneNumber(phoneNumber)) {
      setError('Please enter a valid phone number (07XXXXXXXX, 2547XXXXXXXX, or +2547XXXXXXXX)');
      return;
    }

    if (amount < 10) {
      setError('Minimum amount is 10 KES');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setStatusMessage('Initiating payment request...');

    try {
      const token = await (window as any).electronAPI.getAuthToken();
      if (!token) {
        throw new Error('Authentication token not found');
      }

      const formattedPhone = formatPhoneNumber(phoneNumber);
      const reference = `POS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Get tenantId from user data
      const userData = await (window as any).electronAPI.getUserData();
      const tenantId = userData?.tenantId || saleData?.tenantId;

      if (!tenantId) {
        throw new Error('Tenant ID not found');
      }

      // Use centralized API URL from Electron main process
      const apiBaseUrl = await (window as any).electronAPI.getApiBaseUrl();
      const endpoint = '/mpesa/initiate';
      
      // Apply rate limiting (via rate-limited fetch)
      const { rateLimitedFetch, extractEndpoint: extractEndpointUtil } = await import('../../shared/rate-limiter');
      const fullEndpoint = extractEndpointUtil(`${apiBaseUrl}${endpoint}`);
      
      const response = await rateLimitedFetch(
        `${apiBaseUrl}${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phoneNumber: formattedPhone, // Already sanitized by formatPhoneNumber
            amount: Math.ceil(amount),
            reference,
            tenantId,
            saleData: saleData ? {
              // Sanitize any string fields in saleData if present
              ...saleData,
              customerName: saleData.customerName ? sanitizeCustomerName(saleData.customerName as string) : undefined,
              customerPhone: saleData.customerPhone ? sanitizePhoneNumber(saleData.customerPhone as string) : undefined,
              creditNotes: saleData.creditNotes ? sanitizeNotes(saleData.creditNotes as string) : undefined,
              reference,
              timestamp: new Date().toISOString(),
            } : {
              reference,
              timestamp: new Date().toISOString(),
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const resp = data as {
        success: boolean;
        data?: { transactionId: string; checkoutRequestId: string };
        error?: string;
      };

      if (resp.success && resp.data) {
        setStatusMessage('Payment request sent! Please check your phone and enter your M-Pesa PIN.');
        setCurrentTransaction({
          id: resp.data.transactionId || resp.data.checkoutRequestId,
          phoneNumber: formattedPhone,
          amount: Math.ceil(amount),
          status: 'pending',
          checkoutRequestId: resp.data.checkoutRequestId,
          createdAt: new Date().toISOString(),
        });
      } else {
        throw new Error(resp.error || 'Failed to initiate payment');
      }
    } catch (err: any) {
      console.error('Error initiating payment:', err);
      setError(err.message || 'Failed to initiate payment. Please try again.');
      setIsProcessing(false);
      setStatusMessage('');
    }
  };

  return (
    <div className="mpesa-payment-modal">
      <div className="mpesa-payment-content" onKeyDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <div className="mpesa-payment-header">
          <h2>📱 M-Pesa Payment</h2>
          <button className="close-btn" onClick={onCancel} disabled={isProcessing}>
            ✕
          </button>
        </div>

        <div className="mpesa-payment-body">
          <div className="payment-amount-display">
            <div className="amount-label">Amount to Pay</div>
            <div className="amount-value">KES {amount.toFixed(2)}</div>
          </div>

          {!currentTransaction ? (
            <div className="phone-input-section">
              <label className="input-label">
                <span className="label-icon">📞</span>
                Phone Number
              </label>
              <input
                ref={phoneInputRef}
                type="tel"
                value={phoneNumber}
                onChange={(e) => {
                  setPhoneNumber(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="07XXXXXXXX or 2547XXXXXXXX"
                className={`text-input ${error ? 'error' : ''}`}
                disabled={isProcessing}
                autoFocus
              />
              <span className="input-hint">
                Enter the M-Pesa registered phone number
              </span>
              {error && <div className="error-message">{error}</div>}
            </div>
          ) : (
            <div className="payment-status-section">
              <div className={`status-icon ${currentTransaction.status}`}>
                {currentTransaction.status === 'pending' && '⏳'}
                {currentTransaction.status === 'success' && '✅'}
                {currentTransaction.status === 'failed' && '❌'}
              </div>
              <div className="status-message">{statusMessage || 'Processing payment...'}</div>
              {currentTransaction.status === 'pending' && (
                <div className="payment-instructions">
                  <p>1. Check your phone for the M-Pesa prompt</p>
                  <p>2. Enter your M-Pesa PIN</p>
                  <p>3. Confirm the payment</p>
                  <p className="waiting-text">Waiting for payment confirmation...</p>
                </div>
              )}
              {error && <div className="error-message">{error}</div>}
            </div>
          )}
        </div>

        <div className="mpesa-payment-footer">
          {!currentTransaction && (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="secondary-btn"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInitiatePayment}
                className="primary-btn"
                disabled={isProcessing || !phoneNumber.trim()}
              >
                {isProcessing ? (
                  <>
                    <div className="loading-spinner"></div>
                    Initiating...
                  </>
                ) : (
                  'Send Payment Request'
                )}
              </button>
            </>
          )}
          {currentTransaction && currentTransaction.status !== 'pending' && (
            <button
              type="button"
              onClick={() => {
                if (currentTransaction.status === 'success') {
                  onSuccess(currentTransaction.id, currentTransaction.mpesaReceipt);
                } else {
                  onCancel();
                }
              }}
              className="primary-btn"
            >
              {currentTransaction.status === 'success' ? 'Continue' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MpesaPayment;
