import React, { useEffect, useState } from 'react';
import '../modals.css';

interface OfflineSaleRecord {
  id: string;
  timestamp?: string;
  status?: string;
  saleData?: {
    paymentMethod?: string;
    items?: Array<{
      quantity?: number;
      price?: number;
    }>;
  };
}

interface OfflineSalesQueueModalProps {
  onClose: () => void;
}

const formatDate = (value?: string) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};

const formatCurrency = (amount: number) => `KES ${amount.toFixed(2)}`;

const getItemCount = (sale: OfflineSaleRecord) =>
  Array.isArray(sale.saleData?.items)
    ? sale.saleData!.items!.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    : 0;

const getTotalAmount = (sale: OfflineSaleRecord) =>
  Array.isArray(sale.saleData?.items)
    ? sale.saleData!.items!.reduce(
        (sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0),
        0,
      )
    : 0;

const OfflineSalesQueueModal: React.FC<OfflineSalesQueueModalProps> = ({ onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sales, setSales] = useState<OfflineSaleRecord[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadQueue = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await window.electronAPI.getOfflineSales();
        if (cancelled) return;

        if (result.success && Array.isArray(result.sales)) {
          setSales(result.sales as OfflineSaleRecord[]);
        } else {
          setSales([]);
          setError(result.error || 'Failed to load offline sales queue.');
        }
      } catch {
        if (!cancelled) {
          setSales([]);
          setError('Failed to load offline sales queue.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadQueue();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content offline-sales-queue-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Offline Sales Queue</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {loading && <p className="offline-sales-loading">Loading queued offline sales...</p>}
          {error && <p className="offline-sales-error">{error}</p>}

          {!loading && !error && sales.length === 0 && (
            <p className="offline-sales-empty">No offline sales in queue.</p>
          )}

          {!loading && !error && sales.length > 0 && (
            <div className="offline-sales-table-wrap">
              <table className="offline-sales-table">
                <thead>
                  <tr>
                    <th>Queued At</th>
                    <th>Queue ID</th>
                    <th>Payment</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>{formatDate(sale.timestamp)}</td>
                      <td className="offline-sales-id">{sale.id}</td>
                      <td>{sale.saleData?.paymentMethod || 'Unknown'}</td>
                      <td>{getItemCount(sale)}</td>
                      <td>{formatCurrency(getTotalAmount(sale))}</td>
                      <td>{String(sale.status || 'pending')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="cancel-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default OfflineSalesQueueModal;
