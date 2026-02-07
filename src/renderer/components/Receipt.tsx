import React from 'react';
import '../receipt.css';

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
                <span>Print</span>
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
                src={receipt.businessInfo.receiptLogo.startsWith('http') ? receipt.businessInfo.receiptLogo : `http://127.0.0.1:9000${receipt.businessInfo.receiptLogo.startsWith('/') ? '' : '/'}${receipt.businessInfo.receiptLogo}`}
                alt="Business Logo"
                className="receipt-logo"
                style={{ maxHeight: '48px', width: 'auto', marginBottom: '8px', display: 'block' }}
              />
            )}
            <div className="business-name">
              {receipt.businessInfo?.name || 'Business Name'}
            </div>
            {receipt.businessInfo?.address && (
              <div className="business-address">{receipt.businessInfo.address}</div>
            )}
            {receipt.businessInfo?.phone && (
              <div className="business-contact">Tel: {receipt.businessInfo.phone}</div>
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

        {/* Right Column - Summary & Payment */}
        <div className="receipt-right-column">
          {/* Totals Card */}
          <div className="totals-card">
            <div className="section-title">Summary</div>
            <div className="totals-list">
              <div className="total-item">
                <span className="total-label">Subtotal</span>
                <span className="total-value">{formatCurrency(receipt.subtotal || 0)}</span>
              </div>
              <div className="total-item">
                <span className="total-label">VAT (16%)</span>
                <span className="total-value">{formatCurrency(receipt.vatAmount || 0)}</span>
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
