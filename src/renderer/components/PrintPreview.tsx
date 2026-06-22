import React, { useState, useEffect } from 'react';
import '../receipt.css';
import './PrintPreview.css';

interface PrintPreviewProps {
  receipt: any;
  onPrint: () => void;
  onBack: () => void;
  onPrintViaBrowser: () => void;
  printing: boolean;
}

const PrintPreview: React.FC<PrintPreviewProps> = ({
  receipt,
  onPrint,
  onBack,
  onPrintViaBrowser,
  printing
}) => {
  const [businessInfo, setBusinessInfo] = useState<any>(receipt.businessInfo);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');

  // Get API base URL from Electron main process
  useEffect(() => {
    const fetchApiUrl = async () => {
      try {
        const url = await (window as any).electronAPI.getApiBaseUrl();
        setApiBaseUrl(url);
      } catch (error) {
        console.error('Failed to get API base URL:', error);
        // Fallback to default
        setApiBaseUrl('https://saas-business.duckdns.org');
      }
    };
    fetchApiUrl();
  }, []);

  useEffect(() => {
    // Try to get business info from user data if not in receipt
    if (!businessInfo || !businessInfo.name || businessInfo.name === 'Business Name') {
      const fetchBusinessInfo = async () => {
        try {
          const userData = await (window as any).electronAPI.getUserData();
          if (userData) {
            const businessName = userData.tenantName || userData.businessName || userData.companyName;
            if (businessName) {
              setBusinessInfo({
                ...businessInfo,
                name: businessName,
                address: businessInfo?.address || userData.address,
                phone: businessInfo?.phone || userData.phone,
                email: businessInfo?.email || userData.email,
              });
            }
          }
        } catch (error) {
          console.error('Failed to fetch business info:', error);
        }
      };
      fetchBusinessInfo();
    }
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

  return (
    <div className="print-preview-page">
      {/* Print Controls Bar */}
      <div className="print-controls-bar">
        <div className="print-controls-left">
          <button onClick={onBack} className="control-btn back-btn">
            <span className="btn-icon">←</span>
            <span>Back</span>
          </button>
        </div>
        <div className="print-controls-right">
          <button 
            onClick={onPrintViaBrowser} 
            className="control-btn browser-print-btn"
            disabled={printing}
          >
            <span className="btn-icon">🖨️</span>
            <span>Print via Browser</span>
          </button>
          <button 
            onClick={onPrint} 
            className="control-btn electron-print-btn"
            disabled={printing}
          >
            {printing ? (
              <>
                <div className="loading-spinner"></div>
                <span>Printing...</span>
              </>
            ) : (
              <>
                <span className="btn-icon">🖨️</span>
                <span>Print Receipt</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Print Preview Content */}
      <div className="print-preview-content">
        <div className="print-receipt">
          {/* Business Header */}
          <div className="print-header">
            {receipt.businessInfo?.receiptLogo && (
              <img
                src={
                  receipt.businessInfo.receiptLogo.startsWith('http')
                    ? receipt.businessInfo.receiptLogo
                    : `${apiBaseUrl}${receipt.businessInfo.receiptLogo.startsWith('/') ? '' : '/'}${receipt.businessInfo.receiptLogo}`
                }
                alt="Business Logo"
                className="print-logo"
              />
            )}
            <div className="print-business-name">
              {businessInfo?.name || receipt.businessInfo?.name || receipt.tenantName || receipt.businessName || 'BUSINESS NAME'}
            </div>
            {(businessInfo?.address || receipt.businessInfo?.address) && (
              <div className="print-business-address">
                {businessInfo?.address || receipt.businessInfo?.address}
              </div>
            )}
            {(businessInfo?.phone || receipt.businessInfo?.phone) && (
              <div className="print-business-contact">
                Tel: {businessInfo?.phone || receipt.businessInfo?.phone}
              </div>
            )}
            {(businessInfo?.email || receipt.businessInfo?.email) && (
              <div className="print-business-email">
                {businessInfo?.email || receipt.businessInfo?.email}
              </div>
            )}
            {/* KRA (only when enabled for this tenant) */}
            {(receipt.businessInfo?.kraEnabled || receipt.businessInfo?.kraPin) && receipt.businessInfo?.kraPin && (
              <div className="print-kra" style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #ccc', fontSize: '10px' }}>
                {receipt.businessInfo?.kraPin && <div><strong>KRA PIN:</strong> {receipt.businessInfo.kraPin}</div>}
              </div>
            )}
            {(receipt.businessInfo?.kraEnabled || receipt.businessInfo?.etimsQrUrl) && receipt.businessInfo?.etimsQrUrl && (
              <div className="print-etims" style={{ marginTop: '4px' }}>
                <img
                  src={receipt.businessInfo.etimsQrUrl.startsWith('http') ? receipt.businessInfo.etimsQrUrl : `${apiBaseUrl}${receipt.businessInfo.etimsQrUrl.startsWith('/') ? '' : '/'}${receipt.businessInfo.etimsQrUrl}`}
                  alt="KRA eTIMS QR"
                  style={{ height: '40px', width: 'auto', display: 'block' }}
                />
              </div>
            )}
          </div>

          {/* Receipt Info */}
          <div className="print-receipt-info">
            <div className="print-info-row">
              <span className="print-info-label">Receipt #:</span>
              <span className="print-info-value">{receipt.saleId}</span>
            </div>
            <div className="print-info-row">
              <span className="print-info-label">Date:</span>
              <span className="print-info-value">{formatDate(receipt.date)}</span>
            </div>
            {receipt.branch && (
              <div className="print-info-row">
                <span className="print-info-label">Branch:</span>
                <span className="print-info-value">{receipt.branch.name}</span>
              </div>
            )}
            {receipt.customerName && (
              <div className="print-info-row">
                <span className="print-info-label">Customer:</span>
                <span className="print-info-value">{receipt.customerName}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="print-divider"></div>

          {/* Items */}
          <div className="print-items">
            <div className="print-items-header">
              <div className="print-col-item">Item</div>
              <div className="print-col-qty">Qty</div>
              <div className="print-col-price">Price</div>
              <div className="print-col-total">Total</div>
            </div>
            <div className="print-items-body">
              {receipt.items?.map((item: any, index: number) => (
                <div key={index} className="print-item-row">
                  <div className="print-col-item">
                    <span className="print-item-name">{item.name}</span>
                  </div>
                  <div className="print-col-qty">{item.quantity}</div>
                  <div className="print-col-price">{formatCurrency(item.price || 0)}</div>
                  <div className="print-col-total">{formatCurrency((item.price || 0) * (item.quantity || 0))}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="print-divider"></div>

          {/* Totals */}
          <div className="print-totals">
            <div className="print-total-row">
              <span className="print-total-label">Subtotal:</span>
              <span className="print-total-value">{formatCurrency(receipt.subtotal || 0)}</span>
            </div>
            <div className="print-total-row print-grand-total">
              <span className="print-total-label">Total:</span>
              <span className="print-grand-total-value">{formatCurrency(receipt.total || 0)}</span>
            </div>
          </div>

          {/* Payment Info */}
          <div className="print-payment">
            <div className="print-payment-method">
              <span className="print-payment-label">Payment Method:</span>
              <span className="print-payment-value">{receipt.paymentMethod?.toUpperCase() || 'CASH'}</span>
            </div>

            {isCreditSale && (
              <div className="print-credit-info">
                {receipt.creditDueDate && (
                  <div className="print-credit-row">
                    <span className="print-credit-label">Due Date:</span>
                    <span className="print-credit-value">{new Date(receipt.creditDueDate).toLocaleDateString('en-US', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}</span>
                  </div>
                )}
                {receipt.creditNotes && (
                  <div className="print-credit-notes">
                    <span className="print-credit-label">Notes:</span>
                    <span className="print-credit-value">{receipt.creditNotes}</span>
                  </div>
                )}
              </div>
            )}

            {receipt.amountReceived && receipt.paymentMethod !== 'credit' && (
              <div className="print-payment-details">
                <div className="print-payment-row">
                  <span className="print-payment-label">Amount Received:</span>
                  <span className="print-payment-value">{formatCurrency(receipt.amountReceived)}</span>
                </div>
                {receipt.change !== undefined && receipt.change > 0 && (
                  <div className="print-payment-row">
                    <span className="print-payment-label">Change:</span>
                    <span className="print-change-value">{formatCurrency(receipt.change)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="print-footer">
            <div className="print-thank-you">Thank you for your business!</div>
            <div className="print-footer-note">Please keep this receipt for your records</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintPreview;
