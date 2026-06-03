import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { showToast } from '../components/Toast';

type OrderStatus = 'Open' | 'SentToKitchen' | 'Served' | 'Closed' | 'Voided';

interface DiningTable {
  id: string;
  number: string;
  status: string;
  capacity?: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

interface OrderItem {
  id?: string;
  productId: string;
  quantity: number;
  price: number;
  notes?: string;
  modifierSelections?: string[];
}

interface RestaurantOrder {
  id: string;
  status: OrderStatus;
  total: number;
  tableId?: string;
  table?: { id?: string; number?: string };
  customerName?: string;
  customerPhone?: string;
  items: OrderItem[];
  createdAt: string;
}

interface SplitPaymentEntry {
  localId: string;
  method: 'cash' | 'mpesa' | 'credit';
  amount: string;
  amountReceived?: string;
  mpesaTransactionId?: string;
  creditDueDate?: string;
  creditNotes?: string;
}

interface DraftItem extends OrderItem {
  localId: string;
  productName: string;
  modifiersText: string;
}

const COMMON_MODIFIERS = [
  'No onions',
  'No salt',
  'No sugar',
  'Extra spicy',
  'Less spicy',
  'Extra cheese',
  'Gluten free',
  'Well done',
  'Medium',
  'Rare',
];

const MODIFIERS_BY_KEYWORD: Array<{ keywords: string[]; modifiers: string[] }> = [
  {
    keywords: ['pizza', 'burger', 'sandwich', 'wrap'],
    modifiers: ['Extra cheese', 'No cheese', 'No onions', 'No sauce', 'Extra sauce'],
  },
  {
    keywords: ['steak', 'beef', 'chicken', 'meat', 'nyama', 'fish'],
    modifiers: ['Rare', 'Medium', 'Well done', 'Extra spicy', 'Less spicy'],
  },
  {
    keywords: ['tea', 'coffee', 'latte', 'cappuccino', 'chai'],
    modifiers: ['No sugar', 'Less sugar', 'Extra sugar', 'Extra hot', 'No milk'],
  },
  {
    keywords: ['juice', 'soda', 'drink', 'cocktail', 'mocktail'],
    modifiers: ['No ice', 'Less ice', 'Extra ice', 'No sugar', 'Less sugar'],
  },
  {
    keywords: ['fries', 'chips', 'potato', 'snack'],
    modifiers: ['Extra crispy', 'Lightly salted', 'No salt', 'Extra sauce'],
  },
];

const getSuggestedModifiers = (productName: string) => {
  const normalizedName = (productName || '').toLowerCase();
  const dynamic = MODIFIERS_BY_KEYWORD.flatMap((group) =>
    group.keywords.some((keyword) => normalizedName.includes(keyword)) ? group.modifiers : [],
  );

  return Array.from(new Set([...dynamic, ...COMMON_MODIFIERS]));
};

const currency = (value: number) => `KES ${Number(value || 0).toFixed(2)}`;

const RestaurantRenderer: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mpesa' | 'credit' | 'split'>('cash');
  const [amountReceived, setAmountReceived] = useState('');
  const [splitPayments, setSplitPayments] = useState<SplitPaymentEntry[]>([
    {
      localId: `split-${Date.now()}-cash`,
      method: 'cash',
      amount: '',
      amountReceived: '',
    },
    {
      localId: `split-${Date.now()}-mpesa`,
      method: 'mpesa',
      amount: '',
      mpesaTransactionId: '',
    },
  ]);

  const activeOrder = useMemo(
    () => orders.find((order) => order.id === activeOrderId) || null,
    [orders, activeOrderId],
  );

  const tableActiveOrder = useMemo(() => {
    if (!selectedTableId) return null;
    return (
      orders.find(
        (order) =>
          order.tableId === selectedTableId &&
          order.status !== 'Closed' &&
          order.status !== 'Voided',
      ) || null
    );
  }, [orders, selectedTableId]);

  const draftTotal = useMemo(
    () => draftItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [draftItems],
  );

  const splitTotal = useMemo(
    () => splitPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [splitPayments],
  );

  const splitRemaining = useMemo(() => {
    if (!activeOrder) return 0;
    return Number((activeOrder.total - splitTotal).toFixed(2));
  }, [activeOrder, splitTotal]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tablesRes, ordersRes, productsRes] = await Promise.all([
        window.electronAPI.getDiningTables(),
        window.electronAPI.getRestaurantOrders(),
        window.electronAPI.getProducts(),
      ]);

      if (tablesRes.success) {
        setTables(tablesRes.tables || []);
      }
      if (ordersRes.success) {
        setOrders(ordersRes.orders || []);
      }
      if (productsRes.success) {
        setProducts(productsRes.products || []);
      }

      if (!tablesRes.success || !ordersRes.success || !productsRes.success) {
        showToast('Some restaurant data failed to load', 'warning');
      }
    } catch {
      showToast('Failed to load restaurant workspace', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedTableId) {
      setActiveOrderId(null);
      return;
    }

    if (tableActiveOrder) {
      setActiveOrderId(tableActiveOrder.id);
      setCustomerName(tableActiveOrder.customerName || '');
      setCustomerPhone(tableActiveOrder.customerPhone || '');
    } else {
      setActiveOrderId(null);
      setCustomerName('');
      setCustomerPhone('');
    }
  }, [selectedTableId, tableActiveOrder]);

  const addDraftProduct = (product: Product) => {
    const newItem: DraftItem = {
      localId: `${product.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId: product.id,
      productName: product.name,
      quantity: 1,
      price: product.price,
      notes: '',
      modifierSelections: [],
      modifiersText: '',
    };

    setDraftItems((prev) => [newItem, ...prev]);
  };

  const updateDraftItem = (localId: string, patch: Partial<DraftItem>) => {
    setDraftItems((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    );
  };

  const removeDraftItem = (localId: string) => {
    setDraftItems((prev) => prev.filter((item) => item.localId !== localId));
  };

  const toggleDraftModifier = (localId: string, modifier: string) => {
    setDraftItems((prev) =>
      prev.map((item) => {
        if (item.localId !== localId) return item;
        const current = Array.isArray(item.modifierSelections) ? item.modifierSelections : [];
        const exists = current.includes(modifier);
        return {
          ...item,
          modifierSelections: exists
            ? current.filter((m) => m !== modifier)
            : [...current, modifier],
        };
      }),
    );
  };

  const addSplitRow = () => {
    setSplitPayments((prev) => [
      ...prev,
      {
        localId: `split-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        method: 'cash',
        amount: '',
        amountReceived: '',
      },
    ]);
  };

  const removeSplitRow = (localId: string) => {
    setSplitPayments((prev) => prev.filter((row) => row.localId !== localId));
  };

  const updateSplitRow = (localId: string, patch: Partial<SplitPaymentEntry>) => {
    setSplitPayments((prev) =>
      prev.map((row) => (row.localId === localId ? { ...row, ...patch } : row)),
    );
  };

  const toPayloadItems = (items: DraftItem[]) =>
    items.map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
      notes: item.notes || undefined,
      modifierSelections: Array.from(
        new Set([
          ...(Array.isArray(item.modifierSelections) ? item.modifierSelections : []),
          ...((item.modifiersText || '')
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean)),
        ]),
      ),
    }));

  const createOrderForTable = async () => {
    if (!selectedTableId) {
      showToast('Select a table first', 'warning');
      return;
    }
    if (draftItems.length === 0) {
      showToast('Add at least one item', 'warning');
      return;
    }

    const payload = {
      tableId: selectedTableId,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      total: draftTotal,
      items: toPayloadItems(draftItems),
    };

    const result = await window.electronAPI.createRestaurantOrder(payload);
    if (!result.success) {
      showToast(result.error || 'Failed to create order', 'error');
      return;
    }

    showToast('Order created', 'success');
    setDraftItems([]);
    await loadData();
  };

  const addItemsToOrder = async () => {
    if (!activeOrder) {
      showToast('Open/select an active order first', 'warning');
      return;
    }
    if (activeOrder.status !== 'Open') {
      showToast('Can only add items while order is Open', 'warning');
      return;
    }
    if (draftItems.length === 0) {
      showToast('No draft items to add', 'warning');
      return;
    }

    const result = await window.electronAPI.addRestaurantOrderItems(activeOrder.id, toPayloadItems(draftItems));
    if (!result.success) {
      showToast(result.error || 'Failed to add order items', 'error');
      return;
    }

    showToast('Items added to order', 'success');
    setDraftItems([]);
    await loadData();
  };

  const updateStatus = async (status: OrderStatus) => {
    if (!activeOrder) return;
    const result = await window.electronAPI.updateRestaurantOrderStatus(activeOrder.id, status);
    if (!result.success) {
      showToast(result.error || `Failed to set status: ${status}`, 'error');
      return;
    }

    showToast(`Order moved to ${status}`, 'success');
    await loadData();
  };

  const sendToKitchen = async () => {
    if (!activeOrder) return;
    if (activeOrder.status !== 'Open') {
      showToast('Order must be Open before sending to kitchen', 'warning');
      return;
    }

    const ticket = {
      orderId: activeOrder.id,
      ticketVersion: 1,
      tableNumber: activeOrder.table?.number,
      items: activeOrder.items.map((item) => ({
        name: products.find((p) => p.id === item.productId)?.name || `Product ${item.productId}`,
        quantity: item.quantity,
        notes: item.notes,
        modifiers: Array.isArray(item.modifierSelections) ? item.modifierSelections : [],
      })),
      type: 'NEW',
    };

    const queueResult = await window.electronAPI.printKitchenTicket(ticket);
    if (!queueResult.success) {
      showToast(queueResult.error || 'Failed to queue kitchen ticket', 'error');
      return;
    }

    await updateStatus('SentToKitchen');
  };

  const checkoutOrder = async () => {
    if (!activeOrder) {
      showToast('No active order selected', 'warning');
      return;
    }
    if (activeOrder.status !== 'Served') {
      showToast('Order must be Served before checkout', 'warning');
      return;
    }

    if (paymentMethod === 'split') {
      const validRows = splitPayments.filter((row) => Number(row.amount || 0) > 0);
      if (validRows.length < 2) {
        showToast('Add at least two split payment rows with amounts', 'warning');
        return;
      }

      const diff = Math.abs((activeOrder.total || 0) - splitTotal);
      if (diff > 0.01) {
        showToast('Split amounts must equal order total before checkout', 'warning');
        return;
      }
    }

    const payload = {
      paymentMethod,
      amountReceived: paymentMethod === 'cash' ? Number(amountReceived || 0) : undefined,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      idempotencyKey: `restaurant-checkout:${activeOrder.id}`,
      splitPayments:
        paymentMethod === 'split'
          ? splitPayments
              .filter((row) => Number(row.amount || 0) > 0)
              .map((row) => ({
                method: row.method,
                amount: Number(row.amount || 0),
                amountReceived:
                  row.method === 'cash'
                    ? Number(row.amountReceived || row.amount || 0)
                    : undefined,
                mpesaTransactionId:
                  row.method === 'mpesa' ? (row.mpesaTransactionId || undefined) : undefined,
                creditDueDate:
                  row.method === 'credit' ? (row.creditDueDate || undefined) : undefined,
                creditNotes:
                  row.method === 'credit' ? (row.creditNotes || undefined) : undefined,
              }))
          : undefined,
    };

    const result = await window.electronAPI.checkoutRestaurantOrder(activeOrder.id, payload);
    if (!result.success) {
      showToast(result.error || 'Checkout failed', 'error');
      return;
    }

    showToast('Checkout completed and sale recorded', 'success');
    setAmountReceived('');
    await loadData();
  };

  return (
    <div className="app" style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Restaurant Renderer</h2>
          <small>Dedicated restaurant workspace inside POS</small>
        </div>
        <button onClick={loadData} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr 1fr', gap: 10 }}>
        <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>Tables</h3>
          {tables.map((table) => {
            const linkedOrder = orders.find(
              (order) => order.tableId === table.id && order.status !== 'Closed' && order.status !== 'Voided',
            );
            return (
              <button
                key={table.id}
                onClick={() => setSelectedTableId(table.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 6,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: selectedTableId === table.id ? '2px solid #0a84ff' : '1px solid #ddd',
                  background: linkedOrder ? '#fff8e6' : '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{table.number}</strong>
                  <span>{linkedOrder ? linkedOrder.status : table.status}</span>
                </div>
                {linkedOrder && <small>Order {linkedOrder.id.slice(0, 8)}</small>}
              </button>
            );
          })}
        </section>

        <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>Menu + Draft Items</h3>
          <div style={{ maxHeight: 220, overflowY: 'auto', borderBottom: '1px solid #eee', marginBottom: 10 }}>
            {products.map((product) => (
              <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <div>
                  <div>{product.name}</div>
                  <small>{currency(product.price)}</small>
                </div>
                <button onClick={() => addDraftProduct(product)}>Add</button>
              </div>
            ))}
          </div>

          <div>
            {draftItems.length === 0 ? (
              <small>No draft items yet.</small>
            ) : (
              draftItems.map((item) => (
                <div key={item.localId} style={{ border: '1px solid #eee', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{item.productName}</strong>
                    <button onClick={() => removeDraftItem(item.localId)}>Remove</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 6, marginTop: 6 }}>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateDraftItem(item.localId, { quantity: Number(e.target.value || 1) })}
                    />
                    <input
                      placeholder="Item notes (e.g. no onions)"
                      value={item.notes || ''}
                      onChange={(e) => updateDraftItem(item.localId, { notes: e.target.value })}
                    />
                    <input
                      style={{ gridColumn: '1 / span 2' }}
                      placeholder="Modifiers comma-separated (e.g. Rare, Extra Cheese)"
                      value={item.modifiersText}
                      onChange={(e) => updateDraftItem(item.localId, { modifiersText: e.target.value })}
                    />
                    <div style={{ gridColumn: '1 / span 2', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {getSuggestedModifiers(item.productName).map((modifier) => {
                        const selected = (item.modifierSelections || []).includes(modifier);
                        return (
                          <button
                            key={`${item.localId}-${modifier}`}
                            type="button"
                            onClick={() => toggleDraftModifier(item.localId, modifier)}
                            style={{
                              fontSize: 12,
                              borderRadius: 999,
                              border: selected ? '1px solid #0a84ff' : '1px solid #ddd',
                              background: selected ? '#e8f2ff' : '#fff',
                              padding: '4px 8px',
                            }}
                          >
                            {modifier}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
            <strong>Draft Total</strong>
            <strong>{currency(draftTotal)}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={createOrderForTable} disabled={!selectedTableId || draftItems.length === 0}>Create Order</button>
            <button onClick={addItemsToOrder} disabled={!activeOrder || draftItems.length === 0}>Add to Open Order</button>
          </div>
        </section>

        <section style={{ border: '1px solid #ccc', borderRadius: 8, padding: 10 }}>
          <h3 style={{ marginTop: 0 }}>Active Order + Checkout</h3>
          {!activeOrder ? (
            <small>Select a table to open/create an order.</small>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{activeOrder.table?.number || 'Takeaway'}</strong>
                <span>{activeOrder.status}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                <input
                  placeholder="Customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  style={{ width: '100%', marginBottom: 6 }}
                />
                <input
                  placeholder="Customer phone"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginTop: 10, maxHeight: 160, overflowY: 'auto' }}>
                {activeOrder.items.map((item, index) => {
                  const name = products.find((p) => p.id === item.productId)?.name || `Item ${index + 1}`;
                  return (
                    <div key={`${item.productId}-${index}`} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{name} x {item.quantity}</span>
                        <span>{currency(item.quantity * item.price)}</span>
                      </div>
                      {item.notes && <small>Note: {item.notes}</small>}
                      {Array.isArray(item.modifierSelections) && item.modifierSelections.length > 0 && (
                        <small>Modifiers: {item.modifierSelections.join(', ')}</small>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <strong>Total</strong>
                <strong>{currency(activeOrder.total)}</strong>
              </div>

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button onClick={sendToKitchen} disabled={activeOrder.status !== 'Open'}>Send to Kitchen</button>
                <button onClick={() => updateStatus('Served')} disabled={activeOrder.status !== 'SentToKitchen'}>Mark Served</button>
              </div>

              <div style={{ borderTop: '1px solid #eee', marginTop: 10, paddingTop: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'mpesa' | 'credit' | 'split')}>
                    <option value="cash">Cash</option>
                    <option value="mpesa">M-Pesa</option>
                    <option value="credit">Credit</option>
                    <option value="split">Split</option>
                  </select>
                  <input
                    placeholder="Amount received"
                    value={amountReceived}
                    onChange={(e) => setAmountReceived(e.target.value)}
                    disabled={paymentMethod !== 'cash'}
                  />
                </div>

                {paymentMethod === 'split' && (
                  <div style={{ marginTop: 8, border: '1px solid #eee', borderRadius: 6, padding: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <strong style={{ fontSize: 13 }}>Split Payments</strong>
                      <button type="button" onClick={addSplitRow}>+ Add Row</button>
                    </div>

                    {splitPayments.map((row) => (
                      <div key={row.localId} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 6, marginBottom: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
                          <select
                            value={row.method}
                            onChange={(e) =>
                              updateSplitRow(row.localId, {
                                method: e.target.value as 'cash' | 'mpesa' | 'credit',
                              })
                            }
                          >
                            <option value="cash">Cash</option>
                            <option value="mpesa">M-Pesa</option>
                            <option value="credit">Credit</option>
                          </select>
                          <input
                            placeholder="Amount"
                            value={row.amount}
                            onChange={(e) => updateSplitRow(row.localId, { amount: e.target.value })}
                          />
                          <button type="button" onClick={() => removeSplitRow(row.localId)}>Remove</button>
                        </div>

                        {row.method === 'cash' && (
                          <input
                            style={{ width: '100%', marginTop: 6 }}
                            placeholder="Cash received"
                            value={row.amountReceived || ''}
                            onChange={(e) =>
                              updateSplitRow(row.localId, { amountReceived: e.target.value })
                            }
                          />
                        )}

                        {row.method === 'mpesa' && (
                          <input
                            style={{ width: '100%', marginTop: 6 }}
                            placeholder="M-Pesa transaction ID"
                            value={row.mpesaTransactionId || ''}
                            onChange={(e) =>
                              updateSplitRow(row.localId, { mpesaTransactionId: e.target.value })
                            }
                          />
                        )}

                        {row.method === 'credit' && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                            <input
                              type="date"
                              value={row.creditDueDate || ''}
                              onChange={(e) =>
                                updateSplitRow(row.localId, { creditDueDate: e.target.value })
                              }
                            />
                            <input
                              placeholder="Credit notes"
                              value={row.creditNotes || ''}
                              onChange={(e) =>
                                updateSplitRow(row.localId, { creditNotes: e.target.value })
                              }
                            />
                          </div>
                        )}
                      </div>
                    ))}

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>Split Total: {currency(splitTotal)}</span>
                      <span style={{ color: Math.abs(splitRemaining) <= 0.01 ? '#0a7a2f' : '#b42318' }}>
                        Remaining: {currency(splitRemaining)}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={checkoutOrder}
                  style={{ width: '100%', marginTop: 8 }}
                  disabled={activeOrder.status !== 'Served'}
                >
                  Checkout to Sale
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default RestaurantRenderer;
