import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChefHat,
  ClipboardList,
  CookingPot,
  DollarSign,
  LayoutDashboard,
  Package,
  PieChart,
  Search,
  Settings,
  ShoppingCart,
  Table2,
  LogOut,
  Power,
  UserCircle2,
  Users,
  UtensilsCrossed,
  UserRoundCog,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { useRestaurantUiStore, type RestaurantScreen } from './useRestaurantUiStore';
import { useAuth } from '../contexts/AuthContext';

type OrderStatus = 'Open' | 'SentToKitchen' | 'Served' | 'Closed' | 'Voided';

type PaymentMethod = 'cash' | 'card' | 'mobile-money' | 'split';

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
  images?: string[];
  customFields?: Record<string, unknown>;
  category?: { name?: string } | string;
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

interface DraftItem extends OrderItem {
  localId: string;
  productName: string;
}

const ALL_CATEGORY = 'All';

const SIDEBAR_ITEMS: Array<{ id: RestaurantScreen; label: string; icon: React.ReactNode }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'pos', label: 'POS', icon: <ShoppingCart size={18} /> },
  { id: 'orders', label: 'Orders', icon: <ClipboardList size={18} /> },
  { id: 'kitchen', label: 'Kitchen', icon: <CookingPot size={18} /> },
  { id: 'tables', label: 'Tables', icon: <Table2 size={18} /> },
  { id: 'reservations', label: 'Reservations', icon: <CalendarDays size={18} /> },
  { id: 'inventory', label: 'Inventory', icon: <Package size={18} /> },
  { id: 'customers', label: 'Customers', icon: <Users size={18} /> },
  { id: 'employees', label: 'Employees', icon: <UserRoundCog size={18} /> },
  { id: 'reports', label: 'Reports', icon: <PieChart size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

const currency = (value: number) => `KES ${Number(value || 0).toFixed(2)}`;

const screenVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

const PremiumRestaurantPOS: React.FC = () => {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [receivedAmount, setReceivedAmount] = useState('');
  const [discountValue, setDiscountValue] = useState('0');
  const [clock, setClock] = useState(new Date());

  const {
    activeScreen,
    sidebarCollapsed,
    paymentModalOpen,
    setActiveScreen,
    setSidebarCollapsed,
    setPaymentModalOpen,
  } = useRestaurantUiStore();

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchTables = useCallback(async (): Promise<DiningTable[]> => {
    const res = await window.electronAPI.getDiningTables();
    return res.success ? res.tables || [] : [];
  }, []);

  const fetchOrders = useCallback(async (): Promise<RestaurantOrder[]> => {
    const res = await window.electronAPI.getRestaurantOrders();
    return res.success ? res.orders || [] : [];
  }, []);

  const fetchProducts = useCallback(async (): Promise<Product[]> => {
    const res = await window.electronAPI.getProducts();
    return res.success ? res.products || [] : [];
  }, []);

  const { data: tables = [], isFetching: tablesFetching } = useQuery({
    queryKey: ['restaurant', 'tables'],
    queryFn: fetchTables,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['restaurant', 'orders'],
    queryFn: fetchOrders,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['restaurant', 'products'],
    queryFn: fetchProducts,
  });

  const activeOrder = useMemo(
    () =>
      orders.find(
        (order) =>
          order.tableId === selectedTableId &&
          order.status !== 'Closed' &&
          order.status !== 'Voided',
      ) || null,
    [orders, selectedTableId],
  );

  const draftTotal = useMemo(
    () => draftItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [draftItems],
  );

  const discountAmount = useMemo(
    () => Math.max(0, Math.min(Number(discountValue || 0), draftTotal)),
    [discountValue, draftTotal],
  );

  const subtotalAfterDiscount = Math.max(0, draftTotal - discountAmount);
  const tax = subtotalAfterDiscount * 0.16;
  const grandTotal = subtotalAfterDiscount + tax;

  const metrics = useMemo(() => {
    const openOrders = orders.filter((order) => order.status === 'Open').length;
    const activeTables = orders.filter((order) => order.status !== 'Closed').length;
    const todaysSales = orders
      .filter((order) => new Date(order.createdAt).toDateString() === new Date().toDateString())
      .reduce((sum, order) => sum + Number(order.total || 0), 0);

    return {
      todaysSales,
      openOrders,
      activeTables,
      avgOrderValue: orders.length ? orders.reduce((s, o) => s + o.total, 0) / orders.length : 0,
    };
  }, [orders]);

  const resolvedCategory = (product: Product) => {
    const categoryFromObject =
      typeof product.category === 'object' && product.category
        ? product.category.name
        : undefined;
    const categoryFromString = typeof product.category === 'string' ? product.category : undefined;
    const categoryFromCustom = product.customFields?.category;

    const raw = categoryFromObject || categoryFromString || categoryFromCustom;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();

    return 'Meals';
  };

  const posCategories = useMemo(() => {
    const unique = Array.from(
      new Set(products.map((product) => resolvedCategory(product)).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    return [ALL_CATEGORY, ...unique];
  }, [products]);

  useEffect(() => {
    if (!posCategories.includes(category)) {
      setCategory(ALL_CATEGORY);
    }
  }, [posCategories, category]);

  const filteredProducts = useMemo(() => {
    const term = search.toLowerCase().trim();
    return products.filter((product) => {
      const inCategory =
        category === ALL_CATEGORY ||
        resolvedCategory(product).toLowerCase() === category.toLowerCase();
      const inSearch = !term || product.name.toLowerCase().includes(term);
      return inCategory && inSearch;
    });
  }, [products, category, search]);

  const addDraftItem = (product: Product) => {
    setDraftItems((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      return [
        ...prev,
        {
          localId: `${product.id}-${Date.now()}`,
          productId: product.id,
          productName: product.name,
          quantity: 1,
          price: Number(product.price || 0),
          notes: '',
          modifierSelections: [],
        },
      ];
    });
  };

  const updateDraftQty = (localId: string, delta: number) => {
    setDraftItems((prev) =>
      prev
        .map((item) =>
          item.localId === localId ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item,
        )
        .filter(Boolean),
    );
  };

  const removeDraftItem = (localId: string) => {
    setDraftItems((prev) => prev.filter((item) => item.localId !== localId));
  };

  const holdOrder = () => {
    setDraftItems((prev) => prev.map((item) => ({ ...item, notes: item.notes || 'Held order' })));
  };

  const saveDraft = () => {
    window.localStorage.setItem('restaurant-pos-draft', JSON.stringify(draftItems));
  };

  const createOrder = async () => {
    if (!selectedTableId || draftItems.length === 0) return;

    const payload = {
      tableId: selectedTableId,
      total: grandTotal,
      items: draftItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        notes: item.notes || undefined,
      })),
    };

    await window.electronAPI.createRestaurantOrder(payload);
    setDraftItems([]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['restaurant', 'orders'] }),
      queryClient.invalidateQueries({ queryKey: ['restaurant', 'tables'] }),
    ]);
  };

  const completePayment = async () => {
    if (!activeOrder) return;

    await window.electronAPI.checkoutRestaurantOrder(activeOrder.id, {
      paymentMethod,
      amountReceived: paymentMethod === 'cash' ? Number(receivedAmount || 0) : undefined,
      customerName: activeOrder.customerName || undefined,
      customerPhone: activeOrder.customerPhone || undefined,
      idempotencyKey: `checkout:${activeOrder.id}:${Date.now()}`,
    });

    setPaymentModalOpen(false);
    await queryClient.invalidateQueries({ queryKey: ['restaurant', 'orders'] });
  };

  const handleLogout = async () => {
    const hasDraft = draftItems.length > 0;
    if (hasDraft && !window.confirm('Logout now? Current draft order will be lost.')) {
      return;
    }
    await logout();
  };

  const handleExit = async () => {
    const hasDraft = draftItems.length > 0;
    const message = hasDraft
      ? 'Exit POS now? Current draft order will be lost.'
      : 'Exit POS application now?';
    if (!window.confirm(message)) {
      return;
    }
    await window.electronAPI.quitApp();
  };

  const statusColor = (status: string) => {
    if (status === 'Open' || status === 'Occupied') return 'bg-red-100 text-red-700';
    if (status === 'SentToKitchen') return 'bg-amber-100 text-amber-700';
    if (status === 'Served' || status === 'Closed' || status === 'Available') return 'bg-emerald-100 text-emerald-700';
    if (status === 'Reserved') return 'bg-yellow-100 text-yellow-700';
    return 'bg-slate-100 text-slate-700';
  };

  const screenContent = () => {
    if (activeScreen === 'dashboard') {
      return (
        <motion.div key="dashboard" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <MetricCard title="Today's Sales" value={currency(metrics.todaysSales)} icon={<DollarSign size={18} />} />
            <MetricCard title="Orders Today" value={String(metrics.openOrders)} icon={<ClipboardList size={18} />} />
            <MetricCard title="Active Tables" value={String(metrics.activeTables)} icon={<Table2 size={18} />} />
            <MetricCard title="Avg Order Value" value={currency(metrics.avgOrderValue)} icon={<PieChart size={18} />} />
            <MetricCard title="Top Selling Item" value={products[0]?.name || 'Nyama Choma'} icon={<UtensilsCrossed size={18} />} />
            <MetricCard title="Inventory Alerts" value={String(products.filter((p) => Number(p.stock || 0) < 5).length)} icon={<Package size={18} />} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Sales Trend</CardTitle></CardHeader>
              <CardContent>
                <div className="flex h-56 items-end gap-2">
                  {[35, 42, 29, 56, 48, 60, 74].map((v, i) => (
                    <div key={i} className="flex-1 rounded-t-lg bg-indigo-500/80" style={{ height: `${v}%` }} />
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Recent Orders</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {orders.slice(0, 6).map((order) => (
                  <div key={order.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-sm">
                    <div>
                      <p className="font-medium">Order {order.id.slice(0, 8)}</p>
                      <p className="text-slate-500">{order.table?.number || 'Takeaway'}</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs ${statusColor(order.status)}`}>{order.status}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </motion.div>
      );
    }

    if (activeScreen === 'pos') {
      return (
        <motion.div key="pos" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="grid grid-cols-1 gap-4 xl:grid-cols-10">
          <section className="xl:col-span-7 space-y-4">
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {posCategories.map((item) => (
                    <button
                      key={item}
                      className={`touch-btn ${category === item ? 'bg-brand-indigo text-white' : 'bg-slate-100 text-slate-700'}`}
                      onClick={() => setCategory(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm"
                    placeholder="Search products"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredProducts.map((product) => (
                    <motion.button
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.98 }}
                      key={product.id}
                      onClick={() => addDraftItem(product)}
                      className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:shadow-md"
                    >
                      <div className="mb-3 flex h-24 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        {product.images?.[0] ? (
                          <img src={product.images[0]} alt={product.name} className="h-24 w-full rounded-lg object-cover" />
                        ) : (
                          <ChefHat size={22} />
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{product.name}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <p className="text-sm text-indigo-600">{currency(product.price)}</p>
                        <span className={`rounded-full px-2 py-1 text-[11px] ${Number(product.stock || 0) > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {Number(product.stock || 0) > 0 ? 'Available' : 'Out'}
                        </span>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="xl:col-span-3">
            <Card className="sticky top-3">
              <CardHeader>
                <CardTitle>Current Order</CardTitle>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    <label className="mb-1 block">Table</label>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2"
                      value={selectedTableId}
                      onChange={(e) => setSelectedTableId(e.target.value)}
                    >
                      <option value="">Select table</option>
                      {tables.map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block">Discount</label>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {draftItems.map((item) => (
                    <div key={item.localId} className="rounded-lg border border-slate-100 p-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{item.productName}</p>
                          <p className="text-xs text-slate-500">{currency(item.price)}</p>
                        </div>
                        <Button variant="danger" size="sm" onClick={() => removeDraftItem(item.localId)}>
                          Remove
                        </Button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={() => updateDraftQty(item.localId, -1)}>-</Button>
                          <span className="text-sm font-semibold">{item.quantity}</span>
                          <Button variant="secondary" size="sm" onClick={() => updateDraftQty(item.localId, 1)}>+</Button>
                        </div>
                        <p className="text-sm font-semibold">{currency(item.quantity * item.price)}</p>
                      </div>
                    </div>
                  ))}
                  {draftItems.length === 0 && <p className="text-sm text-slate-500">No items in order.</p>}
                </div>

                <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><span>{currency(draftTotal)}</span></div>
                  <div className="flex justify-between"><span>Discount</span><span>-{currency(discountAmount)}</span></div>
                  <div className="flex justify-between"><span>Tax (16%)</span><span>{currency(tax)}</span></div>
                  <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{currency(grandTotal)}</span></div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={holdOrder}>Hold Order</Button>
                  <Button variant="secondary" onClick={saveDraft}>Save Draft</Button>
                  <Button variant="warning" onClick={() => setPaymentMethod('split')}>Split Bill</Button>
                  <Button variant="secondary">Apply Discount</Button>
                  <Button variant="secondary" onClick={() => window.electronAPI.printReceipt?.({ source: 'pos-draft' } as any)}>Print Receipt</Button>
                  <Button variant="success" onClick={() => setPaymentModalOpen(true)}>Complete Payment</Button>
                </div>

                <Button className="w-full" onClick={createOrder}>Send Order</Button>
              </CardContent>
            </Card>
          </section>
        </motion.div>
      );
    }

    if (activeScreen === 'tables') {
      return (
        <motion.div key="tables" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Floor Plan</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {tables.map((table) => {
                  const linked = orders.find((o) => o.tableId === table.id && o.status !== 'Closed');
                  const tone = linked ? 'bg-red-100 text-red-700' : table.status === 'Reserved' ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700';
                  return (
                    <div key={table.id} className={`rounded-2xl p-5 ${tone}`}>
                      <p className="text-sm font-semibold">Table {table.number}</p>
                      <p className="text-xs">{linked ? 'Occupied' : table.status || 'Available'}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      );
    }

    if (activeScreen === 'kitchen') {
      const lanes: OrderStatus[] = ['Open', 'SentToKitchen', 'Served', 'Closed'];
      return (
        <motion.div key="kitchen" variants={screenVariants} initial="initial" animate="animate" exit="exit">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            {lanes.map((lane) => (
              <Card key={lane}>
                <CardHeader><CardTitle>{lane}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {orders.filter((o) => o.status === lane).map((order) => (
                    <div key={order.id} className="rounded-lg border border-slate-100 p-3">
                      <p className="text-sm font-semibold">#{order.id.slice(0, 8)}</p>
                      <p className="text-xs text-slate-500">{order.table?.number || 'Takeaway'}</p>
                      <p className="text-xs">{order.items.length} items</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>
      );
    }

    if (activeScreen === 'inventory') {
      return (
        <motion.div key="inventory" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Inventory Module</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {products.slice(0, 20).map((product) => (
                <div key={product.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-sm">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-slate-500">Supplier: Main Warehouse</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${Number(product.stock || 0) < 5 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    Stock {product.stock ?? 0}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      );
    }

    if (activeScreen === 'reports') {
      return (
        <motion.div key="reports" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Reports Center</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {['Daily Sales', 'Weekly Sales', 'Monthly Sales', 'Product Performance', 'Employee Performance', 'Profit Analysis'].map((name) => (
                <button key={name} className="touch-btn rounded-xl border border-slate-200 bg-slate-50 text-left hover:bg-slate-100">
                  <p className="font-semibold">{name}</p>
                  <p className="text-xs text-slate-500">Generate export and chart view</p>
                </button>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      );
    }

    return (
      <motion.div key={activeScreen} variants={screenVariants} initial="initial" animate="animate" exit="exit">
        <Card>
          <CardHeader><CardTitle>{SIDEBAR_ITEMS.find((s) => s.id === activeScreen)?.label}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              This module is scaffolded in the premium architecture and ready for detailed workflows, offline persistence, and sync.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="flex min-h-screen bg-brand-bg">
      <motion.aside
        animate={{ width: sidebarCollapsed ? 88 : 250 }}
        className="sticky top-0 h-screen border-r border-slate-800 bg-brand-sidebar px-3 py-4 text-slate-100"
      >
        <div className="mb-4 flex items-center justify-between">
          {!sidebarCollapsed && (
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Adeera POS</p>
              <p className="text-lg font-semibold">Restaurant Pro</p>
            </div>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="text-slate-200 hover:bg-slate-800 hover:text-white"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </div>

        <nav className="space-y-1">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveScreen(item.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                activeScreen === item.id ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {item.icon}
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
      </motion.aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold leading-tight text-slate-900">Damian Ltd Restaurant</h1>
              <p className="text-[11px] leading-tight text-slate-500">Current Shift: Afternoon</p>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative w-44">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input className="h-8 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-xs" placeholder="Search" />
              </div>
              <Button variant="secondary" size="icon" className="h-8 w-8"><Bell size={14} /></Button>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] leading-none">
                {clock.toLocaleDateString()} · {clock.toLocaleTimeString()}
              </div>
              <Button variant="secondary" className="h-8 gap-1.5 px-2 text-xs">
                <UserCircle2 size={14} />
                Manager
              </Button>
              <Button variant="secondary" className="h-8 gap-1.5 px-2 text-xs" onClick={handleLogout}>
                <LogOut size={14} />
                Logout
              </Button>
              <Button variant="danger" className="h-8 gap-1.5 px-2 text-xs" onClick={handleExit}>
                <Power size={14} />
                Exit
              </Button>
            </div>
          </div>
        </header>

        <main className="p-4">
          <AnimatePresence mode="wait">{screenContent()}</AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {paymentModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xl font-semibold">Complete Payment</h3>
                <Button variant="ghost" onClick={() => setPaymentModalOpen(false)}>Close</Button>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between"><span>Total Amount</span><strong>{currency(grandTotal)}</strong></div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'card', 'mobile-money', 'split'] as PaymentMethod[]).map((method) => (
                    <button
                      key={method}
                      onClick={() => setPaymentMethod(method)}
                      className={`touch-btn border ${paymentMethod === method ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white'}`}
                    >
                      {method}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-3 text-sm"
                    placeholder="Amount received"
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(e.target.value)}
                  />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                    Change: {currency(Math.max(0, Number(receivedAmount || 0) - grandTotal))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3 text-sm">
                  <p className="mb-1 font-semibold">Receipt Preview</p>
                  <p className="text-slate-500">Items: {draftItems.length}</p>
                  <p className="text-slate-500">Method: {paymentMethod}</p>
                  <p className="text-slate-500">Total: {currency(grandTotal)}</p>
                </div>

                <Button className="w-full" size="lg" onClick={completePayment}>Confirm Payment</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {tablesFetching && (
        <div className="fixed bottom-4 right-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          Syncing local restaurant data...
        </div>
      )}
    </div>
  );
};

const MetricCard: React.FC<{ title: string; value: string; icon: React.ReactNode }> = ({ title, value, icon }) => {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        </div>
        <div className="rounded-xl bg-indigo-50 p-3 text-indigo-600">{icon}</div>
      </CardContent>
    </Card>
  );
};

export default PremiumRestaurantPOS;
