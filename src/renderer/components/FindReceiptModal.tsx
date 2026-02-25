import React, { useState } from 'react';
import '../modals.css';
import { showToast } from './Toast';

declare const window: {
  electronAPI: {
    getReceipt: (saleId: string) => Promise<{ success: boolean; receipt?: any; error?: string }>;
  };
};

interface FindReceiptModalProps {
  onClose: () => void;
  onReceiptFound: (receipt: any) => void;
}

const FindReceiptModal: React.FC<FindReceiptModalProps> = ({ onClose, onReceiptFound }) => {
  const [saleId, setSaleId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLookup = async () => {
    const id = saleId.trim();
    if (!id) {
      showToast('Enter a receipt or sale ID', 'error');
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.getReceipt(id);
      if (result.success && result.receipt) {
        onReceiptFound(result.receipt);
        onClose();
      } else {
        showToast(result.error || 'Receipt not found', 'error');
      }
    } catch (e) {
      showToast('Failed to fetch receipt', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content find-receipt-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Find Receipt</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <p className="find-receipt-hint">Enter the receipt or sale ID to view the receipt and process returns.</p>
          <input
            type="text"
            className="find-receipt-input"
            placeholder="e.g. REC-001 or sale ID"
            value={saleId}
            onChange={e => setSaleId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="cancel-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="complete-btn" onClick={handleLookup} disabled={loading}>
            {loading ? 'Looking up...' : 'Look up'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FindReceiptModal;
