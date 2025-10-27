import React, { useState } from 'react';
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

  return (
    <div className="receipt-page">
      <div className="receipt-container">
        {/* Success Header */}
        <div className="receipt-success">
          <div className="success-icon">✅</div>
          <h2>Sale Completed!</h2>
        </div>

        {/* Receipt Details */}
        <div className="receipt-card">
          <div className="receipt-header">
            <h3>🏪 {receipt.businessInfo?.name || 'Business Name'}</h3>
            <p>🆔 Sale #{receipt.saleId}</p>
            <p>📅 {new Date(receipt.date).toLocaleString()}</p>
            {receipt.branch && (
              <div className="receipt-branch">
                <p>🏢 Branch: {receipt.branch.name}</p>
                {receipt.branch.address && <p>📍 {receipt.branch.address}</p>}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="receipt-items">
            {receipt.items?.map((item: any, index: number) => (
              <div key={index} className="receipt-item">
                <div className="item-info">
                  <span className="item-name">{item.name}</span>
                  <span className="item-qty">x{item.quantity}</span>
                </div>
                <span className="item-price">${((item.price || 0) * (item.quantity || 0)).toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="receipt-totals">
            <div className="total-row">
              <span>Subtotal:</span>
              <span>${receipt.subtotal?.toFixed(2)}</span>
            </div>
            <div className="total-row">
              <span>VAT (16%):</span>
              <span>${receipt.vatAmount?.toFixed(2)}</span>
            </div>
            <div className="total-row grand-total">
              <span>Total:</span>
              <span className="total-amount">${receipt.total?.toFixed(2)}</span>
            </div>
            <div className="total-row">
              <span>Payment:</span>
              <span>{receipt.paymentMethod?.toUpperCase()}</span>
            </div>
            {receipt.amountReceived && (
              <div className="total-row">
                <span>Received:</span>
                <span>${receipt.amountReceived.toFixed(2)}</span>
              </div>
            )}
            {receipt.change !== undefined && receipt.change > 0 && (
              <div className="total-row">
                <span>Change:</span>
                <span className="change-amount">${receipt.change.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Thank You */}
          <div className="receipt-footer">
            <p>Thank you for your business!</p>
          </div>
        </div>

        {/* Actions */}
        <div className="receipt-actions">
          <button onClick={onNewSale} className="new-sale-btn">
            <span>🛒</span> New Sale
          </button>
          <button onClick={onPrint} disabled={printing} className="print-btn">
            {printing ? (
              <>
                <div className="loading-spinner"></div>
                Printing...
              </>
            ) : (
              <>
                <span>🖨️</span> Print
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Receipt;
