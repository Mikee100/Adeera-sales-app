import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { showToast } from './Toast';

interface DiningTable {
  id: string;
  number: string;
  status: string;
  capacity?: number;
}

interface RestaurantOrder {
  id: string;
  status: string;
  total: number;
  table?: { number?: string };
  customerName?: string;
  createdAt: string;
}

const RestaurantPOS: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);

  const loadRestaurantData = useCallback(async () => {
    setLoading(true);
    try {
      const [tablesRes, ordersRes] = await Promise.all([
        window.electronAPI.getDiningTables(),
        window.electronAPI.getRestaurantOrders(),
      ]);

      if (tablesRes.success) {
        setTables(tablesRes.tables || []);
      } else {
        showToast(tablesRes.error || 'Failed to load dining tables', 'error');
      }

      if (ordersRes.success) {
        setOrders(ordersRes.orders || []);
      } else {
        showToast(ordersRes.error || 'Failed to load restaurant orders', 'error');
      }
    } catch (error) {
      showToast('Failed to load restaurant workspace', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRestaurantData();
  }, [loadRestaurantData]);

  const occupiedCount = useMemo(
    () => tables.filter((table) => table.status === 'occupied').length,
    [tables],
  );

  const sendOrderToKitchen = async (orderId: string) => {
    const target = orders.find((order) => order.id === orderId);
    if (!target) {
      return;
    }

    const ticket = {
      orderId: target.id,
      ticketVersion: 1,
      tableNumber: target.table?.number,
      items: [{ name: 'Order Items', quantity: 1 }],
      type: 'NEW',
    };

    const printResult = await window.electronAPI.printKitchenTicket(ticket);
    if (!printResult.success) {
      showToast(printResult.error || 'Failed to queue kitchen ticket', 'error');
      return;
    }

    const statusResult = await window.electronAPI.updateRestaurantOrderStatus(orderId, 'SentToKitchen');
    if (!statusResult.success) {
      showToast(statusResult.error || 'Order queued but status update failed', 'warning');
      return;
    }

    showToast('Order sent to kitchen', 'success');
    await loadRestaurantData();
  };

  return (
    <div className="app" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Restaurant Workspace</h2>
          <small>
            {occupiedCount}/{tables.length} tables occupied
          </small>
        </div>
        <button onClick={loadRestaurantData} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <section style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '10px' }}>
          <h3 style={{ marginTop: 0 }}>Tables</h3>
          {tables.length === 0 ? (
            <p>No tables configured.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {tables.map((table) => (
                <li key={table.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>{table.number}</span>
                  <span>{table.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '10px' }}>
          <h3 style={{ marginTop: 0 }}>Active Orders</h3>
          {orders.length === 0 ? (
            <p>No active orders.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {orders.map((order) => (
                <li key={order.id} style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{order.table?.number || 'Takeaway'}</strong>
                    <span>{order.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                    <small>{order.customerName || 'Walk-in'}</small>
                    <small>KES {Number(order.total || 0).toFixed(2)}</small>
                  </div>
                  {order.status === 'Open' && (
                    <div style={{ marginTop: '6px' }}>
                      <button onClick={() => sendOrderToKitchen(order.id)}>Send to Kitchen</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default RestaurantPOS;
