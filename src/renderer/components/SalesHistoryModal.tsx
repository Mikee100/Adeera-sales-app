import React, { useState, useEffect } from 'react';
import '../modals.css';
import { showToast } from './Toast';

declare const window: {
  electronAPI: {
    getRecentSales: () => Promise<{ success: boolean; sales?: any[]; error?: string }>;
    getReceipt: (saleId: string) => Promise<{ success: boolean; receipt?: any; error?: string }>;
  };
};

interface SaleSummary {
  id: string;
  total: number;
  paymentMethod?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  date: string;
  items?: any[];
}

interface SalesHistoryModalProps {
  onClose: () => void;
  onReceiptFound: (receipt: any) => void;
}

const formatDate = (d: string) => {
  try {
    return new Date(d).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
};

const formatCurrency = (n: number) => `Ksh ${(n ?? 0).toFixed(2)}`;

const SalesHistoryModal: React.FC<SalesHistoryModalProps> = ({ onClose, onReceiptFound }) => {
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingReceiptId, setLoadingReceiptId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.electronAPI.getRecentSales();
        if (cancelled) return;
        if (result.success && Array.isArray(result.sales)) {
          setSales(result.sales);
        } else {
          setError(result.error || 'Failed to load sales');
          setSales([]);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load sales');
          setSales([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const openReceipt = async (saleId: string) => {
    setLoadingReceiptId(saleId);
    try {
      const result = await window.electronAPI.getReceipt(saleId);
      if (result.success && result.receipt) {
        onReceiptFound(result.receipt);
        onClose();
      } else {
        showToast(result.error || 'Receipt not found', 'error');
      }
    } catch (e) {
      showToast('Failed to fetch receipt', 'error');
    } finally {
      setLoadingReceiptId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content sales-history-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Sales History</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {loading && <p className="sales-history-loading">Loading recent sales...</p>}
          {error && <p className="sales-history-error">{error}</p>}
          {!loading && !error && sales.length === 0 && (
            <p className="sales-history-empty">No recent sales.</p>
          )}
          {!loading && sales.length > 0 && (
            <div className="sales-history-table-wrap">
              <table className="sales-history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Receipt ID</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{formatDate(sale.date)}</td>
                      <td>{sale.id}</td>
                      <td>{(sale.customerName || sale.customerPhone || '—')}</td>
                      <td>{formatCurrency(sale.total)}</td>
                      <td>
                        <button
                          type="button"
                          className="sales-history-view-btn"
                          onClick={() => openReceipt(sale.id)}
                          disabled={loadingReceiptId !== null}
                        >
                          {loadingReceiptId === sale.id ? 'Opening...' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="cancel-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default SalesHistoryModal;
