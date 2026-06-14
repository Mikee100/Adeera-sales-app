import React, { useState, useEffect } from 'react';
import '../receipt.css';
import { showToast } from './Toast';
import { API_BASE_URL } from '../../shared/config';

interface ReceiptProps {
  receipt: any;
  onPrint: () => void;
  onNewSale: () => void;
  printing: boolean;
}

const Receipt: React.FC<ReceiptProps> = ({
  receipt,
  onPrint,
  onNewSale,
  printing
}) => {
  const [businessInfo, setBusinessInfo] = useState<any>(receipt?.businessInfo);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [isReturnMode, setIsReturnMode] = useState(false);
  const [returnQuantities, setReturnQuantities] = useState<number[]>([]);
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  const [returnReason, setReturnReason] = useState<string>('');
  const [returnRefundMethod, setReturnRefundMethod] = useState<string>('cash');
  const [returnIsResalable, setReturnIsResalable] = useState<boolean>(true);

  // Get API base URL from Electron main process
  useEffect(() => {
    const fetchApiUrl = async () => {
      try {
        const url = await (window as any).electronAPI.getApiBaseUrl();
        setApiBaseUrl(url);
      } catch (error) {
        console.error('Failed to get API base URL:', error);
        // Fallback to default
        setApiBaseUrl(API_BASE_URL);
      }
    };
    fetchApiUrl();
  }, []);

  useEffect(() => {
    setBusinessInfo(receipt?.businessInfo);
    // When receipt has no/empty business name, try to fill from user data (keep KRA and other backend fields)
    if (!receipt?.businessInfo?.name || receipt.businessInfo.name === 'Business Name' || receipt.businessInfo.name === 'Business') {
      const fetchBusinessInfo = async () => {
        try {
          const userData = await (window as any).electronAPI.getUserData();
          if (userData) {
            const businessName = userData.tenantName || userData.businessName || userData.companyName;
            setBusinessInfo((prev: any) => ({
              ...prev,
              name: businessName || prev?.name || 'Business',
              address: prev?.address || userData.address,
              phone: prev?.phone || userData.phone,
              email: prev?.email || userData.email,
            }));
          }
        } catch (error) {
          console.error('Failed to fetch business info:', error);
        }
      };
      fetchBusinessInfo();
    }

    // Reset return state whenever we load a new receipt
    if (receipt?.items && Array.isArray(receipt.items)) {
      setReturnQuantities(receipt.items.map((item: any) => item.quantity || 0));
    } else {
      setReturnQuantities([]);
    }
    setIsReturnMode(false);
    setReturnSubmitting(false);
    setReturnReason('');
    setReturnRefundMethod('cash');
    setReturnIsResalable(true);
  }, [receipt]);

  if (!receipt) return null;

  const formatCurrency = (amount: number) => {
    return `Ksh ${amount?.toFixed(2) || '0.00'}`;
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isCreditSale = receipt.paymentMethod === 'credit';
  const isSplitPayment = receipt.isSplitPayment || (receipt.splitPayments && receipt.splitPayments.length > 0);

  const returnSubtotal =
    isReturnMode && receipt.items && Array.isArray(receipt.items)
      ? receipt.items.reduce((sum: number, item: any, index: number) => {
          const qty = returnQuantities[index] || 0;
          const price = item.price || 0;
          const max = item.quantity || 0;
          const safeQty = Math.max(0, Math.min(qty, max));
          return sum + price * safeQty;
        }, 0)
      : 0;

  const handleToggleReturnMode = () => {
    if (!receipt.items || !receipt.items.length) {
      showToast('This receipt has no items to return.', 'warning', 3000);
      return;
    }
    if (!isReturnMode) {
      setReturnQuantities(
        receipt.items.map((item: any) => item.quantity || 0)
      );
      setIsReturnMode(true);
    } else {
      setIsReturnMode(false);
    }
  };

  const handleChangeReturnQty = (index: number, value: number) => {
    if (!receipt.items || !receipt.items[index]) return;
    const max = receipt.items[index].quantity || 0;
    const safe = Math.max(0, Math.min(max, isNaN(value) ? 0 : value));
    setReturnQuantities(prev => {
      const next = [...prev];
      next[index] = safe;
      return next;
    });
  };

  const handleSubmitReturn = async () => {
    if (!receipt?.saleId || !receipt.items || !receipt.items.length) {
      showToast('Cannot process return: missing receipt details.', 'error', 5000);
      return;
    }

    const itemsToReturn =
      receipt.items
        .map((item: any, index: number) => {
          const qty = returnQuantities[index] || 0;
          if (!qty) return null;
          return {
            productId: item.productId || item.id,
            variationId: item.variationId,
            quantity: qty,
            unitPrice: item.price || 0,
            isResalable: returnIsResalable,
          };
        })
        .filter(Boolean) as { productId: string; quantity: number; unitPrice: number; variationId?: string; isResalable?: boolean }[];

    if (!itemsToReturn.length) {
      showToast('Set at least one item quantity to return.', 'warning', 4000);
      return;
    }

    setReturnSubmitting(true);
    try {
      const payload = {
        saleId: receipt.saleId,
        items: itemsToReturn,
        reason: returnReason,
        refundMethod: returnRefundMethod,
      };
      const response = await (window as any).electronAPI.createReturn(payload);
      if (response?.success) {
        showToast('Return recorded successfully.', 'success', 4000);
        setIsReturnMode(false);
      } else {
        showToast(
          response?.error || 'Failed to record return. Please check backend API.',
          'error',
          6000
        );
      }
    } catch (error) {
      console.error('Return error', error);
      showToast('Error while sending return to backend.', 'error', 6000);
    } finally {
      setReturnSubmitting(false);
    }
  };

  return (
    <div className="receipt-page">
      {/* Top Bar */}
      <div className="receipt-top-bar">
        <div className="success-indicator">
          <div className="success-icon-wrapper">
            <div className="success-icon">✓</div>
          </div>
          <div className="success-text">
            <h2>Sale Completed</h2>
            <p className="success-subtitle">Receipt #{receipt.saleId?.substring(0, 8).toUpperCase()}</p>
          </div>
        </div>
        <div className="receipt-actions-top">
          <button onClick={onNewSale} className="action-btn-top primary-btn" title="New Sale (F3)">
            <span className="btn-icon">🛒</span>
            <span>New Sale</span>
          </button>
          <button
            onClick={handleToggleReturnMode}
            className="action-btn-top"
            title="Start a return from this receipt"
          >
            <span className="btn-icon">↩️</span>
            <span>{isReturnMode ? 'Cancel Return' : 'Return Items'}</span>
          </button>
          <button 
            onClick={async () => {
              try {
                await (window as any).electronAPI.openCashDrawer();
              } catch (error) {
                console.error('Failed to open cash drawer:', error);
              }
            }} 
            className="action-btn-top secondary-btn"
            title="Open Cash Drawer"
          >
            <span className="btn-icon">💰</span>
            <span>Open Drawer</span>
          </button>
          <button onClick={onPrint} disabled={printing} className="action-btn-top print-btn">
            {printing ? (
              <>
                <div className="loading-spinner"></div>
                <span>Printing...</span>
              </>
            ) : (
              <>
                <span className="btn-icon">🖨️</span>
                <span>Print Preview</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="receipt-main-content">
        {/* Left Column - Receipt Details */}
        <div className="receipt-left-column">
          {/* Business Header */}
          <div className="receipt-header-card">
            {receipt.businessInfo?.receiptLogo && (
              <img
                src={
                  receipt.businessInfo.receiptLogo.startsWith('http')
                    ? receipt.businessInfo.receiptLogo
                    : `${apiBaseUrl}${receipt.businessInfo.receiptLogo.startsWith('/') ? '' : '/'}${receipt.businessInfo.receiptLogo}`
                }
                alt="Business Logo"
                className="receipt-logo"
                style={{ maxHeight: '48px', width: 'auto', marginBottom: '8px', display: 'block' }}
              />
            )}
            <div className="business-name">
              {businessInfo?.name || receipt.businessInfo?.name || receipt.tenantName || receipt.businessName || 'BUSINESS NAME'}
            </div>
            {(businessInfo?.address || receipt.businessInfo?.address) && (
              <div className="business-address">
                {businessInfo?.address || receipt.businessInfo?.address}
              </div>
            )}
            {(businessInfo?.phone || receipt.businessInfo?.phone) && (
              <div className="business-contact">
                Tel: {businessInfo?.phone || receipt.businessInfo?.phone}
              </div>
            )}
            {(businessInfo?.email || receipt.businessInfo?.email) && (
              <div className="business-email">
                {businessInfo?.email || receipt.businessInfo?.email}
              </div>
            )}
            {/* KRA – show when enabled or when any KRA data is present (defensive for POS) */}
            {(receipt.businessInfo?.kraEnabled || receipt.businessInfo?.kraPin || receipt.businessInfo?.vatNumber) && (receipt.businessInfo?.kraPin || receipt.businessInfo?.vatNumber) && (
              <div className="business-kra" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(0,0,0,0.1)', fontSize: '12px', color: '#374151' }}>
                {receipt.businessInfo?.kraPin && <div><strong>KRA PIN:</strong> {receipt.businessInfo.kraPin}</div>}
                {receipt.businessInfo?.vatNumber && <div><strong>VAT No:</strong> {receipt.businessInfo.vatNumber}</div>}
              </div>
            )}
            {(receipt.businessInfo?.kraEnabled || receipt.businessInfo?.etimsQrUrl) && receipt.businessInfo?.etimsQrUrl && (
              <div className="business-etims" style={{ marginTop: '6px' }}>
                <img
                  src={receipt.businessInfo.etimsQrUrl.startsWith('http') ? receipt.businessInfo.etimsQrUrl : `${apiBaseUrl}${receipt.businessInfo.etimsQrUrl.startsWith('/') ? '' : '/'}${receipt.businessInfo.etimsQrUrl}`}
                  alt="KRA eTIMS QR"
                  style={{ height: '48px', width: 'auto', display: 'block' }}
                />
              </div>
            )}
          </div>

          {/* Receipt Info Grid */}
          <div className="receipt-info-grid">
            <div className="info-card">
              <div className="info-label">Sale ID</div>
              <div className="info-value">{receipt.saleId}</div>
            </div>
            <div className="info-card">
              <div className="info-label">Date & Time</div>
              <div className="info-value">{formatDate(receipt.date)}</div>
            </div>
            {receipt.branch && (
              <div className="info-card">
                <div className="info-label">Branch</div>
                <div className="info-value">{receipt.branch.name}</div>
              </div>
            )}
            {receipt.customerName && (
              <div className="info-card">
                <div className="info-label">Customer</div>
                <div className="info-value">{receipt.customerName}</div>
              </div>
            )}
          </div>

          {/* Items Section */}
          <div className="receipt-items-section">
            <div className="section-title">Items Purchased</div>
            <div className="items-table">
              <div className="items-header">
                <div className="header-col-item">Item</div>
                <div className="header-col-qty">Qty</div>
                <div className="header-col-price">Price</div>
                <div className="header-col-total">Total</div>
              </div>
              <div className="items-body">
                {receipt.items?.map((item: any, index: number) => (
                  <div key={index} className="item-row">
                    <div className="col-item">
                      <span className="item-name">{item.name}</span>
                      {isReturnMode && (
                        <div className="return-qty-row">
                          <span className="return-qty-label">Return</span>
                          <input
                            type="number"
                            min={0}
                            max={item.quantity || 0}
                            value={returnQuantities[index] ?? item.quantity ?? 0}
                            onChange={(e) =>
                              handleChangeReturnQty(index, Number(e.target.value))
                            }
                            className="return-qty-input"
                          />
                          <span className="return-qty-max">
                            of {item.quantity || 0}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="col-qty">{item.quantity}</div>
                    <div className="col-price">{formatCurrency(item.price || 0)}</div>
                    <div className="col-total">{formatCurrency((item.price || 0) * (item.quantity || 0))}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Summary, Returns & Payment */}
        <div className="receipt-right-column">
          {isReturnMode && (
            <div className="totals-card return-summary-card">
              <div className="section-title">Return Summary</div>
              <div className="totals-list" style={{ marginBottom: '16px' }}>
                <div className="total-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>Refund Method</label>
                  <select 
                    value={returnRefundMethod} 
                    onChange={e => setReturnRefundMethod(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                  >
                    <option value="cash">Cash Refund</option>
                    <option value="mpesa">M-Pesa Reversal</option>
                    <option value="credit">Credit Adjustment</option>
                  </select>
                </div>
                <div className="total-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: 600 }}>Return Reason</label>
                  <select 
                    value={returnReason} 
                    onChange={e => setReturnReason(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
                  >
                    <option value="">Select a reason...</option>
                    <option value="defective">Defective / Damaged</option>
                    <option value="wrong_item">Wrong Item</option>
                    <option value="changed_mind">Changed Mind</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="total-item" style={{ justifyContent: 'flex-start', gap: '8px' }}>
                  <input 
                    type="checkbox" 
                    id="isResalable" 
                    checked={returnIsResalable} 
                    onChange={e => setReturnIsResalable(e.target.checked)}
                    style={{ width: '16px', height: '16px' }}
                  />
                  <label htmlFor="isResalable" style={{ fontSize: '13px', cursor: 'pointer' }}>Item is resalable (Restock)</label>
                </div>
                <div className="total-item" style={{ borderTop: '1px solid #e5e7eb', paddingTop: '12px', marginTop: '12px' }}>
                  <span className="total-label">Return Subtotal</span>
                  <span className="total-value">
                    {formatCurrency(returnSubtotal || 0)}
                  </span>
                </div>
              </div>
              <div className="return-actions-row">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleToggleReturnMode}
                  disabled={returnSubmitting}
                >
                  <span className="btn-icon">✖</span>
                  <span>Cancel</span>
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleSubmitReturn}
                  disabled={returnSubmitting || !returnSubtotal}
                >
                  {returnSubmitting ? (
                    <>
                      <div className="loading-spinner" />
                      <span>Processing Return...</span>
                    </>
                  ) : (
                    <>
                      <span className="btn-icon">✅</span>
                      <span>Confirm Return</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
          {/* Totals Card */}
          <div className="totals-card">
            <div className="section-title">Summary</div>
            <div className="totals-list">
              <div className="total-item">
                <span className="total-label">Subtotal</span>
                <span className="total-value">{formatCurrency(receipt.subtotal || 0)}</span>
              </div>
              <div className="total-item grand-total">
                <span className="total-label">Total Amount</span>
                <span className="total-amount">{formatCurrency(receipt.total || 0)}</span>
              </div>
            </div>
          </div>

          {/* Payment Card */}
          <div className="payment-card">
            <div className="section-title">Payment Information</div>
            
            {isSplitPayment && receipt.splitPayments ? (
              <div className="split-payment-display">
                <div className="split-payment-header-badge">
                  <span className="payment-icon">💳</span>
                  <span className="payment-text">SPLIT PAYMENT</span>
                </div>
                <div className="split-payments-list-receipt">
                  {receipt.splitPayments.map((payment: any, index: number) => (
                    <div key={index} className="split-payment-item-receipt">
                      <div className="split-payment-method-receipt">
                        <span className="split-payment-icon">
                          {payment.method === 'cash' ? '💵' : 
                           payment.method === 'mpesa' ? '📱' : 
                           payment.method === 'credit' ? '💳' : '💰'}
                        </span>
                        <span className="split-payment-method-name">{payment.method.toUpperCase()}</span>
                      </div>
                      <div className="split-payment-amount-receipt">
                        {formatCurrency(payment.amount)}
                      </div>
                      {payment.method === 'cash' && payment.amountReceived && payment.amountReceived > payment.amount && (
                        <div className="split-payment-change">
                          Change: {formatCurrency(payment.amountReceived - payment.amount)}
                        </div>
                      )}
                      {payment.method === 'mpesa' && payment.mpesaTransactionId && (
                        <div className="split-payment-mpesa-id">
                          Transaction: {payment.mpesaTransactionId}
                        </div>
                      )}
                      {payment.method === 'credit' && payment.creditDueDate && (
                        <div className="split-payment-credit-due">
                          Due: {new Date(payment.creditDueDate).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="split-payment-total-receipt">
                  <span>Total Paid:</span>
                  <span className="split-total-amount">{formatCurrency(receipt.total || 0)}</span>
                </div>
                {receipt.change !== undefined && receipt.change > 0 && (
                  <div className="split-payment-change-total">
                    <span>Total Change:</span>
                    <span className="change-amount">{formatCurrency(receipt.change)}</span>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="payment-method-badge" data-method={receipt.paymentMethod?.toLowerCase()}>
                  <span className="payment-icon">
                    {receipt.paymentMethod === 'cash' ? '💵' : 
                     receipt.paymentMethod === 'mpesa' ? '📱' : 
                     receipt.paymentMethod === 'credit' ? '💳' : '💰'}
                  </span>
                  <span className="payment-text">{receipt.paymentMethod?.toUpperCase() || 'PAYMENT'}</span>
                </div>

                {isCreditSale && (
                  <div className="credit-details">
                    <div className="credit-badge">
                      <span className="credit-icon">💳</span>
                      <span>Credit Sale</span>
                    </div>
                    {receipt.creditDueDate && (
                      <div className="credit-info-row">
                        <span className="credit-label">Due Date:</span>
                        <span className="credit-value">{new Date(receipt.creditDueDate).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}</span>
                      </div>
                    )}
                    {receipt.creditNotes && (
                      <div className="credit-notes-section">
                        <span className="credit-label">Notes:</span>
                        <p className="credit-notes-text">{receipt.creditNotes}</p>
                      </div>
                    )}
                  </div>
                )}

                {receipt.amountReceived && receipt.paymentMethod !== 'credit' && (
                  <div className="payment-details">
                    <div className="payment-row">
                      <span>Amount Received:</span>
                      <span>{formatCurrency(receipt.amountReceived)}</span>
                    </div>
                    {receipt.change !== undefined && receipt.change > 0 && (
                      <div className="payment-row change-row">
                        <span>Change:</span>
                        <span className="change-amount">{formatCurrency(receipt.change)}</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer Message */}
          <div className="receipt-footer-card">
            <p className="thank-you">Thank you for your business!</p>
            <p className="footer-note">Please keep this receipt for your records</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Receipt;
