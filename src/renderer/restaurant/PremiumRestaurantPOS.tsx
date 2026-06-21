import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  History,
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
import MpesaPayment from '../components/MpesaPayment';
import { useRestaurantUiStore, type RestaurantScreen } from './useRestaurantUiStore';
import { useAuth } from '../contexts/AuthContext';

type OrderStatus = 'Open' | 'SentToKitchen' | 'Served' | 'Closed' | 'Voided';

type PaymentMethod = 'cash' | 'card' | 'mpesa' | 'split';
type ReservationStatus = 'Booked' | 'Arrived' | 'Seated' | 'NoShow' | 'Cancelled';
type UpdateChannel = 'stable' | 'beta';

interface UpdateSettings {
  success: boolean;
  channel: UpdateChannel;
  feedUrl: string;
  currentVersion: string;
  isPackaged: boolean;
}

interface UpdateEventStatus {
  status: string;
  channel?: UpdateChannel;
  feedUrl?: string;
  currentVersion?: string;
  availableVersion?: string;
  progressPercent?: number | null;
  message?: string;
  checkedAt?: string;
}

interface DiningTable {
  id: string;
  number: string;
  status: string;
  capacity?: number;
}

interface Reservation {
  id: string;
  tableId: string;
  customerName: string;
  phone?: string;
  pax: number;
  reservedAt: string;
  notes?: string;
  status: ReservationStatus;
  createdAt: string;
}

interface BomRecipeLine {
  id?: string;
  ingredientProductId: string;
  quantity: number;
  unit: string;
  wastePercent?: number;
  ingredientProduct?: Product;
}

interface BomRecipe {
  id: string;
  productId: string;
  yieldQty: number;
  yieldUnit: string;
  version: number;
  isActive: boolean;
  product?: Product;
  lines: BomRecipeLine[];
}

interface BomLineDraft {
  localId: string;
  ingredientProductId: string;
  quantity: string;
  unit: string;
  wastePercent: string;
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
  waiterId?: string;
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

interface StaffUser {
  id: string;
  name?: string;
  email?: string;
  branchId?: string;
  hasPosPin?: boolean;
  userRoles?: Array<{ role?: { name?: string } }>;
  roles?: string[];
}

interface ActiveWaiterSession {
  id: string;
  name?: string;
  email?: string;
}

interface RestaurantActivityEvent {
  id: string;
  tenantId: string;
  branchId: string;
  orderId?: string | null;
  actorUserId?: string | null;
  actionType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  details?: Record<string, unknown>;
  createdAt: string;
  actor?: {
    id: string;
    name?: string;
    email?: string;
  } | null;
  order?: {
    id: string;
    status?: string;
    tableId?: string | null;
    total?: number;
  } | null;
}

const ALL_CATEGORY = 'All';
const RESERVATION_STORAGE_KEY = 'restaurant-pos-reservations';
const ACTIVE_WAITER_STORAGE_KEY = 'restaurant-active-waiter-session';

const SIDEBAR_ITEMS: Array<{ id: RestaurantScreen; label: string; icon: React.ReactNode }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'pos', label: 'POS', icon: <ShoppingCart size={18} /> },
  { id: 'orders', label: 'Orders', icon: <ClipboardList size={18} /> },
  { id: 'activity', label: 'Activity', icon: <History size={18} /> },
  { id: 'kitchen', label: 'Kitchen', icon: <CookingPot size={18} /> },
  { id: 'tables', label: 'Tables', icon: <Table2 size={18} /> },
  { id: 'reservations', label: 'Reservations', icon: <CalendarDays size={18} /> },
  { id: 'inventory', label: 'Inventory', icon: <Package size={18} /> },
  { id: 'customers', label: 'Customers', icon: <Users size={18} /> },
  { id: 'employees', label: 'Employees', icon: <UserRoundCog size={18} /> },
  { id: 'reports', label: 'Reports', icon: <PieChart size={18} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

const HIDDEN_SIDEBAR_SCREENS: RestaurantScreen[] = ['dashboard', 'customers', 'reports'];

const currency = (value: number) => `KES ${Number(value || 0).toFixed(2)}`;

const toLocalDateTimeValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const screenVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

const PremiumRestaurantPOS: React.FC = () => {
  const queryClient = useQueryClient();
  const { logout, user } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [receivedAmount, setReceivedAmount] = useState('');
  const [paymentCustomerName, setPaymentCustomerName] = useState('');
  const [paymentCustomerPhone, setPaymentCustomerPhone] = useState('');
  const [mpesaTransactionId, setMpesaTransactionId] = useState('');
  const [mpesaReceipt, setMpesaReceipt] = useState('');
  const [showMpesaPaymentModal, setShowMpesaPaymentModal] = useState(false);
  const [discountValue, setDiscountValue] = useState('0');
  const [clock, setClock] = useState(new Date());
  const [tableSearch, setTableSearch] = useState('');
  const [tableStatusFilter, setTableStatusFilter] = useState<'all' | 'Available' | 'Occupied' | 'Reserved'>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | OrderStatus>('all');
  const [orderTypeFilter, setOrderTypeFilter] = useState<'all' | 'table' | 'takeaway'>('all');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [orderWaiterFilter, setOrderWaiterFilter] = useState('');
  const [activityFrom, setActivityFrom] = useState('');
  const [activityTo, setActivityTo] = useState('');
  const [activityActorFilter, setActivityActorFilter] = useState('');
  const [activityOrderFilter, setActivityOrderFilter] = useState('');
  const [activityActionFilter, setActivityActionFilter] = useState('');
  const [useHistoryView, setUseHistoryView] = useState(true);
  const [staffForm, setStaffForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'waiter',
  });
  const [staffPinModalOpen, setStaffPinModalOpen] = useState(false);
  const [staffPinTarget, setStaffPinTarget] = useState<StaffUser | null>(null);
  const [staffPinValue, setStaffPinValue] = useState('');
  const [staffPinError, setStaffPinError] = useState('');
  const [activeWaiter, setActiveWaiter] = useState<ActiveWaiterSession | null>(null);
  const [waiterCheckinOpen, setWaiterCheckinOpen] = useState(false);
  const [waiterCandidateId, setWaiterCandidateId] = useState('');
  const [waiterPinInput, setWaiterPinInput] = useState('');
  const [waiterCheckinError, setWaiterCheckinError] = useState('');
  const [managerSignoutOpen, setManagerSignoutOpen] = useState(false);
  const [managerCandidateId, setManagerCandidateId] = useState('');
  const [managerPinInput, setManagerPinInput] = useState('');
  const [managerSignoutError, setManagerSignoutError] = useState('');
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings | null>(null);
  const [selectedUpdateChannel, setSelectedUpdateChannel] = useState<UpdateChannel>('stable');
  const [updateStatus, setUpdateStatus] = useState<UpdateEventStatus | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [waiterLastActivityAt, setWaiterLastActivityAt] = useState<number>(Date.now());
  const waiterActivityThrottleRef = useRef(0);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [newTableCapacity, setNewTableCapacity] = useState('4');
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editTableCapacity, setEditTableCapacity] = useState('4');
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    try {
      const raw = window.localStorage.getItem(RESERVATION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [reservationForm, setReservationForm] = useState({
    tableId: '',
    customerName: '',
    phone: '',
    pax: '2',
    reservedAt: toLocalDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)),
    notes: '',
  });
  const [reservationSearch, setReservationSearch] = useState('');
  const [reservationStatusFilter, setReservationStatusFilter] = useState<'all' | ReservationStatus>('all');
  const [bomSearch, setBomSearch] = useState('');
  const [bomSaving, setBomSaving] = useState(false);
  const [bomForm, setBomForm] = useState({
    productId: '',
    yieldQty: '1',
    yieldUnit: 'portion',
  });
  const [bomLines, setBomLines] = useState<BomLineDraft[]>([
    { localId: `bom-line-${Date.now()}`, ingredientProductId: '', quantity: '1', unit: 'unit', wastePercent: '0' },
  ]);
  const receivedAmountInputRef = useRef<HTMLInputElement | null>(null);
  const paymentCustomerNameInputRef = useRef<HTMLInputElement | null>(null);

  const {
    activeScreen,
    sidebarCollapsed,
    paymentModalOpen,
    setActiveScreen,
    setSidebarCollapsed,
    setPaymentModalOpen,
  } = useRestaurantUiStore();

  const normalizedRoles: string[] = Array.isArray(user?.roles)
    ? user.roles.map((role: string) => String(role).toLowerCase())
    : [];
  const rawIsSuperadmin = (user as { isSuperadmin?: unknown } | null | undefined)?.isSuperadmin;
  const isSuperadmin =
    rawIsSuperadmin === true ||
    rawIsSuperadmin === 1 ||
    rawIsSuperadmin === '1' ||
    (typeof rawIsSuperadmin === 'string' && rawIsSuperadmin.trim().toLowerCase() === 'true');
  const isOwnerLike =
    isSuperadmin ||
    normalizedRoles.includes('owner') ||
    normalizedRoles.includes('admin') ||
    normalizedRoles.includes('manager');

  const grantedPermissions = useMemo(() => {
    const rawPermissions = [
      ...(Array.isArray(user?.permissions) ? user.permissions : []),
      ...(Array.isArray((user as any)?.effectivePermissions)
        ? (user as any).effectivePermissions
        : []),
    ];

    return new Set(
      rawPermissions
        .map((permission: unknown) => String(permission || '').trim().toLowerCase())
        .filter(Boolean),
    );
  }, [user]);

  const hasRestaurantPermission = useCallback(
    (permission: string) => isSuperadmin || grantedPermissions.has(permission),
    [grantedPermissions, isSuperadmin],
  );
  const hasPermissionKey = useCallback(
    (permission: string) => isSuperadmin || grantedPermissions.has(permission),
    [grantedPermissions, isSuperadmin],
  );
  const isKitchenOnly =
    !isOwnerLike &&
    (normalizedRoles.includes('kitchen') || normalizedRoles.includes('chef'));
  const isWaiterLike =
    isOwnerLike ||
    normalizedRoles.includes('waiter') ||
    normalizedRoles.includes('cashier');
  const needsWaiterSession =
    !isOwnerLike &&
    (normalizedRoles.includes('waiter') || normalizedRoles.includes('cashier'));

  const canAccessPos =
    isWaiterLike &&
    (hasRestaurantPermission('restaurant_view') ||
      hasRestaurantPermission('restaurant_orders_manage') ||
      hasRestaurantPermission('restaurant_checkout'));
  const canAccessOrders =
    isWaiterLike &&
    (hasRestaurantPermission('restaurant_orders_manage') ||
      hasRestaurantPermission('restaurant_checkout'));
  const canAccessKitchen =
    (isOwnerLike || isKitchenOnly) && hasRestaurantPermission('restaurant_kitchen_manage');
  const canAccessTables = hasRestaurantPermission('restaurant_tables_manage');
  const canAccessReservations = hasRestaurantPermission('restaurant_tables_manage');
  const canAccessInventory = hasRestaurantPermission('restaurant_bom_manage');
  const canAccessEmployees = hasPermissionKey('view_users') || hasPermissionKey('edit_users');
  const canAccessSettings = hasPermissionKey('view_settings') || hasPermissionKey('edit_settings');
  const canSendOrdersToKitchen = isWaiterLike && hasRestaurantPermission('restaurant_orders_manage');
  const canCheckoutOrders = isWaiterLike && hasRestaurantPermission('restaurant_checkout');
  const canMarkOrdersServed =
    (isOwnerLike || isKitchenOnly) && hasRestaurantPermission('restaurant_kitchen_manage');
  const canVoidOrders = isOwnerLike;
  const canCloseKitchenTickets = isOwnerLike;
  const canViewRestaurantActivity = hasRestaurantPermission('restaurant_activity_view');

  const allowedScreens = useMemo<RestaurantScreen[]>(() => {
    const screens: RestaurantScreen[] = [];

    if (canAccessPos) screens.push('pos');
    if (canAccessOrders) screens.push('orders');
    if (canAccessKitchen) screens.push('kitchen');
    if (canAccessTables) screens.push('tables');
    if (canAccessReservations) screens.push('reservations');
    if (canAccessInventory) screens.push('inventory');

    if (canAccessEmployees) screens.push('employees');
    if (canAccessSettings) screens.push('settings');

    if (canViewRestaurantActivity) {
      screens.push('activity');
    }

    const unique = Array.from(new Set(screens));
    return unique.length > 0 ? unique : ['settings'];
  }, [
    canAccessInventory,
    canAccessKitchen,
    canAccessSettings,
    canAccessEmployees,
    canAccessOrders,
    canAccessPos,
    canAccessReservations,
    canAccessTables,
    canViewRestaurantActivity,
  ]);

  const visibleSidebarItems = useMemo(
    () =>
      SIDEBAR_ITEMS.filter(
        (item) =>
          allowedScreens.includes(item.id) &&
          !HIDDEN_SIDEBAR_SCREENS.includes(item.id) &&
          (item.id !== 'activity' || canViewRestaurantActivity),
      ),
    [allowedScreens, canViewRestaurantActivity],
  );

  const canManageTables =
    isSuperadmin || normalizedRoles.includes('owner') || normalizedRoles.includes('admin');
  const canManageStaff = canManageTables;

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (HIDDEN_SIDEBAR_SCREENS.includes(activeScreen)) {
      setActiveScreen('pos');
    }
  }, [activeScreen, setActiveScreen]);

  useEffect(() => {
    if (allowedScreens.includes(activeScreen)) return;
    setActiveScreen(allowedScreens[0] || 'settings');
  }, [activeScreen, allowedScreens, setActiveScreen]);

  useEffect(() => {
    const loadUpdateSettings = async () => {
      try {
        if (typeof window.electronAPI.getUpdateSettings !== 'function') return;
        const settings = await window.electronAPI.getUpdateSettings();
        if (settings?.success) {
          setUpdateSettings(settings);
          setSelectedUpdateChannel(settings.channel);
        }
      } catch {
        // No-op for unsupported builds.
      }
    };

    loadUpdateSettings();

    const unsubscribe =
      typeof window.electronAPI.onAppUpdateStatus === 'function'
        ? window.electronAPI.onAppUpdateStatus((status) => {
            setUpdateStatus(status);
            if (status.channel) setSelectedUpdateChannel(status.channel);

            if (status.currentVersion || status.feedUrl || status.channel) {
              setUpdateSettings((prev) => {
                if (!prev) {
                  return {
                    success: true,
                    channel: status.channel || 'stable',
                    feedUrl: status.feedUrl || '',
                    currentVersion: status.currentVersion || 'unknown',
                    isPackaged: true,
                  };
                }
                return {
                  ...prev,
                  channel: status.channel || prev.channel,
                  feedUrl: status.feedUrl || prev.feedUrl,
                  currentVersion: status.currentVersion || prev.currentVersion,
                };
              });
            }

            if (status.status === 'checking') {
              setCheckingUpdates(true);
            } else if (
              status.status === 'up-to-date' ||
              status.status === 'update-available' ||
              status.status === 'downloaded' ||
              status.status === 'error'
            ) {
              setCheckingUpdates(false);
            }
          })
        : () => {};

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(RESERVATION_STORAGE_KEY, JSON.stringify(reservations));
  }, [reservations]);

  const fetchTables = useCallback(async (): Promise<DiningTable[]> => {
    const res = await window.electronAPI.getDiningTables();
    return res.success ? res.tables || [] : [];
  }, []);

  const fetchOrders = useCallback(async (): Promise<RestaurantOrder[]> => {
    const res = await window.electronAPI.getRestaurantOrders();
    return res.success ? res.orders || [] : [];
  }, []);

  const fetchProducts = useCallback(async (): Promise<Product[]> => {
    // Try to refresh local cache so category/customFields are available in POS.
    if (typeof window.electronAPI.syncProducts === 'function') {
      try {
        await window.electronAPI.syncProducts();
      } catch {
        // Non-blocking: fallback to existing cached products.
      }
    }
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
    refetchInterval: 5000,
  });

  const { data: orderHistory = [] } = useQuery({
    queryKey: ['restaurant', 'orders', 'history', historyFrom, historyTo, orderWaiterFilter],
    queryFn: async () => {
      const res = await window.electronAPI.getRestaurantOrderHistory({
        from: historyFrom || undefined,
        to: historyTo || undefined,
        waiterId: orderWaiterFilter.trim() || undefined,
      });
      return res.success ? res.orders || [] : [];
    },
    enabled: activeScreen === 'orders',
    refetchInterval: 5000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['restaurant', 'products'],
    queryFn: fetchProducts,
  });

  const { data: bomRecipes = [] } = useQuery({
    queryKey: ['restaurant', 'bom-recipes'],
    queryFn: async (): Promise<BomRecipe[]> => {
      if (typeof window.electronAPI.getBomRecipes !== 'function') return [];
      const res = await window.electronAPI.getBomRecipes();
      return res.success ? (res.recipes || []) : [];
    },
    enabled: activeScreen === 'inventory',
  });

  const { data: staffUsers = [] } = useQuery({
    queryKey: ['restaurant', 'staff-users'],
    queryFn: async (): Promise<StaffUser[]> => {
      const res = await window.electronAPI.getUsers();
      return res.success ? (res.users || []) : [];
    },
    enabled:
      activeScreen === 'orders' ||
      activeScreen === 'employees' ||
      waiterCheckinOpen ||
      managerSignoutOpen,
    refetchInterval: 10000,
  });

  const { data: restaurantActivity = [] } = useQuery({
    queryKey: [
      'restaurant',
      'activity',
      activityFrom,
      activityTo,
      activityActorFilter,
      activityOrderFilter,
      activityActionFilter,
    ],
    queryFn: async (): Promise<RestaurantActivityEvent[]> => {
      if (typeof window.electronAPI.getRestaurantActivity !== 'function') return [];
      const res = await window.electronAPI.getRestaurantActivity({
        from: activityFrom || undefined,
        to: activityTo || undefined,
        actorUserId: activityActorFilter.trim() || undefined,
        orderId: activityOrderFilter.trim() || undefined,
        actionType: activityActionFilter.trim() || undefined,
        limit: 200,
      });
      return res.success ? (res.events || []) : [];
    },
    enabled: activeScreen === 'activity' && canViewRestaurantActivity,
    refetchInterval: 7000,
  });

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of staffUsers) {
      if (member?.id) {
        map.set(member.id, member.name || member.email || member.id.slice(0, 8));
      }
    }
    return map;
  }, [staffUsers]);

  const staffRoleName = (member: StaffUser) => {
    const fromUserRoles = member.userRoles?.[0]?.role?.name;
    if (fromUserRoles) return String(fromUserRoles).toLowerCase();
    const fromRoles = Array.isArray(member.roles) && member.roles.length > 0 ? member.roles[0] : undefined;
    return fromRoles ? String(fromRoles).toLowerCase() : 'staff';
  };

  const selectableWaiters = useMemo(() => {
    const filtered = staffUsers.filter((member) => {
      const role = staffRoleName(member);
      return ['waiter', 'owner', 'admin', 'cashier', 'manager'].includes(role);
    });

    // Fallback: if role metadata is missing, still allow selection from loaded staff users.
    return filtered.length > 0 ? filtered : staffUsers;
  }, [staffUsers]);

  const managerApprovers = useMemo(() => {
    return staffUsers.filter((member) => {
      const role = staffRoleName(member);
      return ['owner', 'admin', 'manager'].includes(role);
    });
  }, [staffUsers]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ACTIVE_WAITER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.id && typeof parsed.id === 'string') {
        setActiveWaiter({ id: parsed.id, name: parsed.name, email: parsed.email });
      }
    } catch {
      // Ignore malformed local waiter session cache.
    }
  }, []);

  useEffect(() => {
    if (activeWaiter) {
      window.localStorage.setItem(ACTIVE_WAITER_STORAGE_KEY, JSON.stringify(activeWaiter));
    } else {
      window.localStorage.removeItem(ACTIVE_WAITER_STORAGE_KEY);
    }
  }, [activeWaiter]);

  const lockWaiterSession = (message?: string) => {
    setActiveWaiter(null);
    setWaiterCandidateId('');
    setWaiterPinInput('');
    setWaiterCheckinError('');
    setWaiterCheckinOpen(true);
    if (message) {
      window.alert(message);
    }
  };

  const requireWaiterSession = (actionLabel: string) => {
    if (!needsWaiterSession) return true;
    if (activeWaiter?.id) return true;
    setWaiterCheckinError(`Check in a waiter before ${actionLabel}.`);
    setWaiterCheckinOpen(true);
    return false;
  };

  const markWaiterActivity = useCallback(() => {
    const now = Date.now();
    if (now - waiterActivityThrottleRef.current < 1000) return;
    waiterActivityThrottleRef.current = now;
    setWaiterLastActivityAt(now);
  }, []);

  useEffect(() => {
    if (!activeWaiter?.id) return;

    const handleActivity = () => {
      markWaiterActivity();
    };

    const events: Array<keyof WindowEventMap> = [
      'mousedown',
      'mousemove',
      'keydown',
      'touchstart',
      'click',
      'wheel',
    ];

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [activeWaiter?.id, markWaiterActivity]);

  const verifyAndActivateWaiter = async () => {
    const targetUserId = waiterCandidateId.trim();
    const pin = waiterPinInput.trim();

    if (!targetUserId || !pin) {
      setWaiterCheckinError('Select waiter and enter PIN.');
      return;
    }

    if (typeof window.electronAPI.verifyUserPosPin !== 'function') {
      setWaiterCheckinError('POS update not fully loaded. Restart the POS app and try again.');
      return;
    }

    const result = await window.electronAPI.verifyUserPosPin(targetUserId, pin);
    if (!result?.success || !result?.waiter) {
      setWaiterCheckinError(result?.reason || result?.error || 'Invalid waiter PIN.');
      return;
    }

    setActiveWaiter({
      id: result.waiter.id,
      name: result.waiter.name,
      email: result.waiter.email,
    });
    setWaiterCheckinOpen(false);
    setWaiterCheckinError('');
    setWaiterPinInput('');
    markWaiterActivity();
  };

  useEffect(() => {
    if (!activeWaiter) return;

    const idleTimeoutMs = 5 * 60 * 1000;
    const timer = window.setInterval(() => {
      if (Date.now() - waiterLastActivityAt > idleTimeoutMs) {
        lockWaiterSession('Waiter session locked due to inactivity. Please check in again.');
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [activeWaiter, waiterLastActivityAt]);

  useEffect(() => {
    if (activeWaiter) return;
    if (needsWaiterSession && (activeScreen === 'pos' || activeScreen === 'orders')) {
      setWaiterCheckinOpen(true);
    }
  }, [activeScreen, activeWaiter, needsWaiterSession]);

  const productNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of products) {
      map.set(product.id, product.name);
    }
    return map;
  }, [products]);

  const productCostById = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products) {
      const cost = Number(product.cost || 0);
      const fallbackPrice = Number(product.price || 0);
      map.set(product.id, cost > 0 ? cost : fallbackPrice);
    }
    return map;
  }, [products]);

  const isIngredientProduct = useCallback((product: Product) => {
    const custom = (product.customFields || {}) as Record<string, unknown>;
    const category = resolvedCategory(product).toLowerCase();
    const sku = String(product.sku || '').toUpperCase();
    const hasIngredientFlag = custom.isIngredient === true || custom.ingredient === true;
    const looksLikeIngredientCategory = category === 'ingredients' || category === 'ingredient';
    const isIngredientSku = sku.startsWith('ING-');
    return hasIngredientFlag || looksLikeIngredientCategory || isIngredientSku;
  }, []);

  const menuProductsForBom = useMemo(
    () => products.filter((product) => !isIngredientProduct(product)),
    [products, isIngredientProduct],
  );

  const ingredientProductsForBom = useMemo(
    () => products.filter((product) => isIngredientProduct(product)),
    [products, isIngredientProduct],
  );

  const recipeCost = useCallback(
    (recipeLines: Array<{ ingredientProductId: string; quantity: number; wastePercent?: number }>) => {
      return recipeLines.reduce((sum, line) => {
        const cost = Number(productCostById.get(line.ingredientProductId) || 0);
        const wasteMultiplier = 1 + Math.max(0, Number(line.wastePercent || 0)) / 100;
        return sum + cost * Number(line.quantity || 0) * wasteMultiplier;
      }, 0);
    },
    [productCostById],
  );

  const currentBomIngredientOptions = useMemo(
    () => ingredientProductsForBom.filter((product) => product.id !== bomForm.productId),
    [ingredientProductsForBom, bomForm.productId],
  );

  const filteredBomRecipes = useMemo(() => {
    const term = bomSearch.trim().toLowerCase();
    return bomRecipes
      .filter((recipe) => {
        if (!term) return true;
        const name = recipe.product?.name || productNameById.get(recipe.productId) || '';
        return name.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        const nameA = (a.product?.name || productNameById.get(a.productId) || '').toLowerCase();
        const nameB = (b.product?.name || productNameById.get(b.productId) || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [bomRecipes, bomSearch, productNameById]);

  useEffect(() => {
    if (!bomForm.productId) return;

    const existing = bomRecipes.find((recipe) => recipe.productId === bomForm.productId);
    if (!existing) {
      setBomForm((prev) => ({ ...prev, yieldQty: '1', yieldUnit: prev.yieldUnit || 'portion' }));
      setBomLines([{ localId: `bom-line-${Date.now()}`, ingredientProductId: '', quantity: '1', unit: 'unit', wastePercent: '0' }]);
      return;
    }

    setBomForm((prev) => ({
      ...prev,
      yieldQty: String(existing.yieldQty || 1),
      yieldUnit: existing.yieldUnit || 'portion',
    }));
    setBomLines(
      (existing.lines || []).map((line, index) => ({
        localId: `${existing.id}-${index}`,
        ingredientProductId: line.ingredientProductId,
        quantity: String(line.quantity || 1),
        unit: line.unit || 'unit',
        wastePercent: String(line.wastePercent || 0),
      })),
    );
  }, [bomForm.productId, bomRecipes]);

  const updateBomLine = (localId: string, patch: Partial<BomLineDraft>) => {
    setBomLines((prev) => prev.map((line) => (line.localId === localId ? { ...line, ...patch } : line)));
  };

  const addBomLine = () => {
    setBomLines((prev) => [
      ...prev,
      { localId: `bom-line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ingredientProductId: '', quantity: '1', unit: 'unit', wastePercent: '0' },
    ]);
  };

  const removeBomLine = (localId: string) => {
    setBomLines((prev) => {
      const next = prev.filter((line) => line.localId !== localId);
      return next.length > 0
        ? next
        : [{ localId: `bom-line-${Date.now()}`, ingredientProductId: '', quantity: '1', unit: 'unit', wastePercent: '0' }];
    });
  };

  const bomDraftCost = useMemo(
    () =>
      recipeCost(
        bomLines.map((line) => ({
          ingredientProductId: line.ingredientProductId,
          quantity: Number(line.quantity || 0),
          wastePercent: Number(line.wastePercent || 0),
        })),
      ),
    [bomLines, recipeCost],
  );

  const saveBomRecipe = async () => {
    if (!bomForm.productId) {
      window.alert('Select the menu item/product to create BOM for.');
      return;
    }

    const validLines = bomLines
      .map((line) => ({
        ingredientProductId: line.ingredientProductId,
        quantity: Number(line.quantity || 0),
        unit: (line.unit || 'unit').trim() || 'unit',
        wastePercent: Number(line.wastePercent || 0),
      }))
      .filter((line) => line.ingredientProductId && line.quantity > 0);

    if (validLines.length === 0) {
      window.alert('Add at least one valid ingredient line.');
      return;
    }

    if (validLines.some((line) => line.ingredientProductId === bomForm.productId)) {
      window.alert('A menu item cannot be its own ingredient.');
      return;
    }

    if (new Set(validLines.map((line) => line.ingredientProductId)).size !== validLines.length) {
      window.alert('Duplicate ingredients are not allowed in a recipe.');
      return;
    }

    if (typeof window.electronAPI.saveBomRecipe !== 'function') {
      window.alert('POS update not fully loaded. Restart the app and try again.');
      return;
    }

    setBomSaving(true);
    try {
      const result = await window.electronAPI.saveBomRecipe({
        productId: bomForm.productId,
        yieldQty: Math.max(0.0001, Number(bomForm.yieldQty || 1)),
        yieldUnit: (bomForm.yieldUnit || 'portion').trim() || 'portion',
        lines: validLines,
      });

      if (!result?.success) {
        window.alert(result?.error || 'Failed to save BOM recipe.');
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['restaurant', 'bom-recipes'] });
      window.alert('BOM recipe saved.');
    } finally {
      setBomSaving(false);
    }
  };

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

  const activeOrdersByTable = useMemo(() => {
    const map = new Map<string, RestaurantOrder>();
    orders
      .filter((order) => order.status !== 'Closed' && order.status !== 'Voided' && order.tableId)
      .forEach((order) => {
        if (order.tableId) {
          map.set(order.tableId, order);
        }
      });
    return map;
  }, [orders]);

  const activeReservationsByTable = useMemo(() => {
    const map = new Map<string, Reservation>();
    reservations
      .filter((r) => r.status === 'Booked' || r.status === 'Arrived')
      .forEach((r) => map.set(r.tableId, r));
    return map;
  }, [reservations]);

  const draftTotal = useMemo(
    () => draftItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [draftItems],
  );

  const discountAmount = useMemo(
    () => Math.max(0, Math.min(Number(discountValue || 0), draftTotal)),
    [discountValue, draftTotal],
  );

  const subtotalAfterDiscount = Math.max(0, draftTotal - discountAmount);
  const grandTotal = subtotalAfterDiscount;
  const canSendOrder = Boolean(selectedTableId) && draftItems.length > 0;

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

  function resolvedCategory(product: Product) {
    const categoryFromObject =
      typeof product.category === 'object' && product.category
        ? product.category.name
        : undefined;
    const categoryFromString = typeof product.category === 'string' ? product.category : undefined;
    const categoryFromCustom = product.customFields?.category;

    const raw = categoryFromObject || categoryFromString || categoryFromCustom;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();

    return 'Meals';
  }

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

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) {
      const key = resolvedCategory(product);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [products]);

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
    if (!requireWaiterSession('sending orders')) return;

    const payload = {
      tableId: selectedTableId,
      waiterId: activeWaiter?.id,
      total: grandTotal,
      items: draftItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        notes: item.notes || undefined,
      })),
    };

    await window.electronAPI.createRestaurantOrder(payload);
  markWaiterActivity();
    setDraftItems([]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['restaurant', 'orders'] }),
      queryClient.invalidateQueries({ queryKey: ['restaurant', 'tables'] }),
    ]);
  };

  const completePayment = async () => {
    if (!activeOrder) return;
    if (!requireWaiterSession('completing payment')) return;

    if (paymentMethod === 'mpesa' && !mpesaTransactionId.trim()) {
      window.alert('M-Pesa transaction ID is required.');
      return;
    }

    await window.electronAPI.checkoutRestaurantOrder(activeOrder.id, {
      paymentMethod,
      amountReceived: paymentMethod === 'cash' ? Number(receivedAmount || 0) : undefined,
      mpesaTransactionId: paymentMethod === 'mpesa' ? mpesaTransactionId.trim() : undefined,
      mpesaReceipt: paymentMethod === 'mpesa' ? mpesaReceipt.trim() || undefined : undefined,
      customerName: paymentCustomerName.trim() || activeOrder.customerName || undefined,
      customerPhone: paymentCustomerPhone.trim() || activeOrder.customerPhone || undefined,
      idempotencyKey: `checkout:${activeOrder.id}:${Date.now()}`,
    });

    setPaymentModalOpen(false);
    markWaiterActivity();
    await queryClient.invalidateQueries({ queryKey: ['restaurant', 'orders'] });
  };

  const openPaymentModal = () => {
    if (!requireWaiterSession('opening payment modal')) return;
    setPaymentCustomerName(activeOrder?.customerName || '');
    setPaymentCustomerPhone(activeOrder?.customerPhone || '');
    setPaymentModalOpen(true);
    markWaiterActivity();
  };

  const openMpesaPrompt = () => {
    if (!activeOrder) return;
    if (!paymentCustomerName.trim()) {
      window.alert('Enter customer name before sending M-Pesa prompt.');
      return;
    }
    // Keep only one modal active at a time to avoid focus/input conflicts.
    setPaymentModalOpen(false);
    setShowMpesaPaymentModal(true);
  };

  const handleMpesaSuccess = (transactionId: string, receipt?: string) => {
    setShowMpesaPaymentModal(false);
    setPaymentModalOpen(true);
    setMpesaTransactionId(transactionId);
    setMpesaReceipt(receipt || '');
    markWaiterActivity();
  };

  const handleMpesaCancel = () => {
    setShowMpesaPaymentModal(false);
    setPaymentModalOpen(true);
  };

  useEffect(() => {
    if (!paymentModalOpen) return;

    // Keep keyboard focus inside the active field so typing is not hijacked by background handlers.
    const targetInput = paymentMethod === 'mpesa' ? paymentCustomerNameInputRef.current : receivedAmountInputRef.current;
    targetInput?.focus();
  }, [paymentModalOpen, paymentMethod]);

  const upsertReservationStatus = (id: string, status: ReservationStatus) => {
    setReservations((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
  };

  const seatTableToPos = (tableId: string, reservationId?: string, orderId?: string) => {
    const orderForTable = orderId
      ? orders.find((order) => order.id === orderId)
      : orders.find(
          (order) =>
            order.tableId === tableId &&
            order.status !== 'Closed' &&
            order.status !== 'Voided',
        );

    if (orderForTable) {
      const hydratedDraftItems: DraftItem[] = orderForTable.items.map((item, index) => ({
        localId: `order-${orderForTable.id}-${item.id || item.productId}-${index}`,
        id: item.id,
        productId: item.productId,
        productName: productNameById.get(item.productId) || `Item ${index + 1}`,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
        notes: item.notes || '',
        modifierSelections: Array.isArray(item.modifierSelections) ? item.modifierSelections : [],
      }));

      setDraftItems(hydratedDraftItems);
    } else {
      // No linked order: start with a clean draft for this table.
      setDraftItems([]);
    }

    setSelectedTableId(tableId);
    if (reservationId) {
      upsertReservationStatus(reservationId, 'Seated');
    }
    setActiveScreen('pos');
  };

  const closeTableOrder = async (orderId: string) => {
    const confirmed = window.confirm('Close this table order now? This will mark it as closed.');
    if (!confirmed) return;
    if (!requireWaiterSession('closing table orders')) return;

    await window.electronAPI.updateRestaurantOrderStatus(orderId, 'Closed');
    markWaiterActivity();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['restaurant', 'orders'] }),
      queryClient.invalidateQueries({ queryKey: ['restaurant', 'tables'] }),
    ]);
  };

  const updateKitchenOrderStatus = async (orderId: string, status: OrderStatus, voidReason?: string) => {
    if (!requireWaiterSession('updating order status')) return;
    await window.electronAPI.updateRestaurantOrderStatus(orderId, status, voidReason);
    markWaiterActivity();
    await queryClient.invalidateQueries({ queryKey: ['restaurant', 'orders'] });
    await queryClient.invalidateQueries({ queryKey: ['restaurant', 'orders', 'history'] });
  };

  const handleCreateTable = async () => {
    if (!canManageTables) return;

    const number = newTableNumber.trim();
    const capacity = Math.max(1, Number(newTableCapacity || 1));
    if (!number) {
      window.alert('Table number is required.');
      return;
    }

    const result = await window.electronAPI.createDiningTable({
      number,
      capacity,
    });

    if (!result?.success) {
      window.alert(result?.error || 'Failed to create table.');
      return;
    }

    setNewTableNumber('');
    setNewTableCapacity('4');
    await queryClient.invalidateQueries({ queryKey: ['restaurant', 'tables'] });
  };

  const beginEditTable = (table: DiningTable) => {
    if (!canManageTables) return;
    setEditingTableId(table.id);
    setEditTableCapacity(String(Math.max(1, Number(table.capacity || 1))));
  };

  const saveTableCapacity = async (tableId: string) => {
    if (!canManageTables) return;

    const capacity = Math.max(1, Number(editTableCapacity || 1));
    const result = await window.electronAPI.updateDiningTable(tableId, { capacity });

    if (!result?.success) {
      window.alert(result?.error || 'Failed to update table seats.');
      return;
    }

    setEditingTableId(null);
    await queryClient.invalidateQueries({ queryKey: ['restaurant', 'tables'] });
  };

  const cancelReservation = (id: string) => {
    upsertReservationStatus(id, 'Cancelled');
  };

  const hasReservationConflict = (tableId: string, reservedAtIsoLike: string) => {
    const candidateTime = new Date(reservedAtIsoLike).getTime();
    if (Number.isNaN(candidateTime)) return true;

    const overlapWindowMs = 2 * 60 * 60 * 1000;
    return reservations.some((reservation) => {
      if (reservation.tableId !== tableId) return false;
      if (!(reservation.status === 'Booked' || reservation.status === 'Arrived')) return false;
      const existingTime = new Date(reservation.reservedAt).getTime();
      return Math.abs(existingTime - candidateTime) < overlapWindowMs;
    });
  };

  const createReservation = () => {
    const customerName = reservationForm.customerName.trim();
    if (!reservationForm.tableId || !customerName || !reservationForm.reservedAt) {
      window.alert('Table, customer name, and reservation time are required.');
      return;
    }

    const reservationTime = new Date(reservationForm.reservedAt);
    if (Number.isNaN(reservationTime.getTime())) {
      window.alert('Please select a valid reservation date/time.');
      return;
    }

    if (reservationTime.getTime() < Date.now() - 60 * 1000) {
      window.alert('Reservation time cannot be in the past.');
      return;
    }

    if (hasReservationConflict(reservationForm.tableId, reservationForm.reservedAt)) {
      window.alert('This table already has a nearby active reservation. Choose another table or time.');
      return;
    }

    const payload: Reservation = {
      id: `res-${Date.now()}`,
      tableId: reservationForm.tableId,
      customerName,
      phone: reservationForm.phone.trim() || undefined,
      pax: Math.max(1, Number(reservationForm.pax || 1)),
      reservedAt: reservationForm.reservedAt,
      notes: reservationForm.notes.trim() || undefined,
      status: 'Booked',
      createdAt: new Date().toISOString(),
    };

    setReservations((prev) => [payload, ...prev]);
    setReservationForm({
      tableId: '',
      customerName: '',
      phone: '',
      pax: '2',
      reservedAt: toLocalDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)),
      notes: '',
    });
  };

  const availableReservationTables = useMemo(() => {
    return tables
      .filter((table) => !hasReservationConflict(table.id, reservationForm.reservedAt))
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  }, [tables, reservationForm.reservedAt, reservations]);

  const filteredReservations = useMemo(() => {
    const term = reservationSearch.trim().toLowerCase();
    const now = Date.now();

    const urgencyRank = (reservation: Reservation) => {
      const isActive = reservation.status === 'Booked' || reservation.status === 'Arrived';
      if (!isActive) return 2;

      const reservationTimeMs = new Date(reservation.reservedAt).getTime();
      if (reservationTimeMs < now) return 0;
      if (reservationTimeMs <= now + 30 * 60 * 1000) return 1;
      return 2;
    };

    return reservations
      .filter((reservation) =>
        reservationStatusFilter === 'all' ? true : reservation.status === reservationStatusFilter,
      )
      .filter((reservation) => {
        if (!term) return true;
        const table = tables.find((t) => t.id === reservation.tableId);
        const haystack = [
          reservation.customerName,
          reservation.phone || '',
          reservation.notes || '',
          table?.number || '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => {
        const rankDiff = urgencyRank(a) - urgencyRank(b);
        if (rankDiff !== 0) return rankDiff;
        return new Date(a.reservedAt).getTime() - new Date(b.reservedAt).getTime();
      });
  }, [reservations, reservationStatusFilter, reservationSearch, tables]);

  const reservationStats = useMemo(() => {
    return {
      total: reservations.length,
      booked: reservations.filter((r) => r.status === 'Booked').length,
      arrived: reservations.filter((r) => r.status === 'Arrived').length,
      seated: reservations.filter((r) => r.status === 'Seated').length,
      noShow: reservations.filter((r) => r.status === 'NoShow').length,
    };
  }, [reservations]);

  const tableBoard = useMemo(() => {
    const term = tableSearch.trim().toLowerCase();

    return tables
      .map((table) => {
        const activeOrderForTable = activeOrdersByTable.get(table.id);
        const reservationForTable = activeReservationsByTable.get(table.id);

        const derivedStatus = activeOrderForTable
          ? 'Occupied'
          : reservationForTable
          ? 'Reserved'
          : table.status || 'Available';

        return {
          ...table,
          derivedStatus,
          activeOrder: activeOrderForTable,
          reservation: reservationForTable,
        };
      })
      .filter((table) => {
        const matchesStatus = tableStatusFilter === 'all' || table.derivedStatus === tableStatusFilter;
        const matchesSearch =
          !term ||
          table.number.toLowerCase().includes(term) ||
          table.derivedStatus.toLowerCase().includes(term);
        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  }, [tables, activeOrdersByTable, activeReservationsByTable, tableSearch, tableStatusFilter]);

  const handleLogout = () => {
    setManagerSignoutError('');
    setManagerPinInput('');
    setManagerCandidateId('');
    setManagerSignoutOpen(true);
  };

  const confirmManagerSignOut = async () => {
    const managerId = managerCandidateId.trim();
    const pin = managerPinInput.trim();

    if (!managerId || !pin) {
      setManagerSignoutError('Select manager/admin and enter PIN.');
      return;
    }

    const selectedManager = managerApprovers.find((member) => member.id === managerId);
    if (!selectedManager) {
      setManagerSignoutError('Selected user is not authorized for terminal sign-out.');
      return;
    }

    if (typeof window.electronAPI.verifyUserPosPin !== 'function') {
      setManagerSignoutError('POS update not fully loaded. Restart the POS app and try again.');
      return;
    }

    const pinResult = await window.electronAPI.verifyUserPosPin(managerId, pin);
    if (!pinResult?.success) {
      setManagerSignoutError(pinResult?.reason || pinResult?.error || 'Invalid manager/admin PIN.');
      return;
    }

    const hasDraft = draftItems.length > 0;
    if (hasDraft && !window.confirm('Sign out terminal now? Current draft order will be lost.')) {
      return;
    }

    setManagerSignoutOpen(false);
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

  const handleSidebarItemClick = (screen: RestaurantScreen) => {
    setActiveScreen(screen);
    setSidebarCollapsed(true);
  };

  const createStaffAccount = async () => {
    if (!canManageStaff) {
      window.alert('Only owner/admin can create staff accounts.');
      return;
    }

    const payload = {
      name: staffForm.name.trim(),
      email: staffForm.email.trim(),
      password: staffForm.password,
      role: staffForm.role,
      branchId: user?.branchId || undefined,
    };

    if (!payload.name || !payload.email || !payload.password) {
      window.alert('Name, email, and password are required.');
      return;
    }

    const result = await window.electronAPI.createUser(payload);
    if (!result?.success) {
      window.alert(result?.error || 'Failed to create staff account.');
      return;
    }

    setStaffForm({ name: '', email: '', password: '', role: 'waiter' });
    await queryClient.invalidateQueries({ queryKey: ['restaurant', 'staff-users'] });
  };

  const setStaffPosPin = async (member: StaffUser) => {
    if (!canManageStaff) {
      window.alert('Only owner/admin can set POS PIN.');
      return;
    }

    if (typeof window.electronAPI.setUserPosPin !== 'function') {
      window.alert('POS update not fully loaded. Please restart the POS app and try again.');
      return;
    }

    setStaffPinTarget(member);
    setStaffPinValue('');
    setStaffPinError('');
    setStaffPinModalOpen(true);
  };

  const confirmSetStaffPosPin = async () => {
    if (!staffPinTarget) {
      setStaffPinModalOpen(false);
      return;
    }

    const trimmedPin = staffPinValue.trim();

    if (!/^\d{4,8}$/.test(trimmedPin)) {
      setStaffPinError('PIN must be 4 to 8 digits.');
      return;
    }

    const result = await window.electronAPI.setUserPosPin(staffPinTarget.id, trimmedPin);
    if (!result?.success) {
      setStaffPinError(result?.error || 'Failed to set POS PIN.');
      return;
    }

    setStaffPinModalOpen(false);
    setStaffPinTarget(null);
    setStaffPinValue('');
    setStaffPinError('');
    await queryClient.invalidateQueries({ queryKey: ['restaurant', 'staff-users'] });
    window.alert('POS PIN updated.');
  };

  const statusColor = (status: string) => {
    if (status === 'Open' || status === 'Occupied') return 'bg-red-100 text-red-700';
    if (status === 'SentToKitchen') return 'bg-amber-100 text-amber-700';
    if (status === 'Served' || status === 'Closed' || status === 'Available') return 'bg-emerald-100 text-emerald-700';
    if (status === 'Reserved') return 'bg-yellow-100 text-yellow-700';
    return 'bg-slate-100 text-slate-700';
  };

  const openOrderInOrdersView = (order: RestaurantOrder) => {
    setUseHistoryView(true);
    setOrderStatusFilter(order.status);
    setOrderSearch(order.id.slice(0, 8));
    setActiveScreen('orders');
  };

  const handleChangeUpdateChannel = async (channel: UpdateChannel) => {
    setSelectedUpdateChannel(channel);
    try {
      if (typeof window.electronAPI.setUpdateChannel !== 'function') {
        window.alert('Update channel control is not available in this build.');
        return;
      }

      const response = await window.electronAPI.setUpdateChannel(channel);
      if (response?.success) {
        setUpdateSettings((prev) => {
          if (!prev) {
            return {
              success: true,
              channel: response.channel,
              feedUrl: response.feedUrl,
              currentVersion: response.currentVersion,
              isPackaged: true,
            };
          }
          return {
            ...prev,
            channel: response.channel,
            feedUrl: response.feedUrl,
            currentVersion: response.currentVersion,
          };
        });
      }
    } catch (error: any) {
      window.alert(error?.message || 'Failed to set update channel.');
      setSelectedUpdateChannel(updateSettings?.channel || 'stable');
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdates(true);
    try {
      if (typeof window.electronAPI.checkForAppUpdates !== 'function') {
        throw new Error('Update check is not available in this build.');
      }

      const response = await window.electronAPI.checkForAppUpdates();
      if (!response?.success) {
        setCheckingUpdates(false);
        window.alert(response?.error || 'Failed to check for updates.');
      }
    } catch (error: any) {
      setCheckingUpdates(false);
      window.alert(error?.message || 'Failed to check for updates.');
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    try {
      if (typeof window.electronAPI.installUpdate !== 'function') {
        throw new Error('Install update is not available in this build.');
      }
      await window.electronAPI.installUpdate();
    } catch (error: any) {
      setInstallingUpdate(false);
      window.alert(error?.message || 'Failed to install update.');
    }
  };

  const screenContent = () => {
    const isPackagedBuild = !!updateSettings?.isPackaged;

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
                      {item} ({item === ALL_CATEGORY ? products.length : categoryCounts.get(item) || 0})
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
                {products.length === 0 && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    No products loaded yet. Ensure branch catalog is synced and has category data.
                  </div>
                )}
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
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Current Order</CardTitle>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                    {draftItems.length} item{draftItems.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                  <div className="col-span-2">
                    <label className="mb-1 block">Table</label>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2"
                      value={selectedTableId}
                      onChange={(e) => setSelectedTableId(e.target.value)}
                    >
                      <option value="">Select table</option>
                      {tables.map((table) => (
                        <option key={table.id} value={table.id}>
                          Table {table.number}
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
                    <div key={item.localId} className="rounded-lg border border-slate-100 p-1.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{item.productName}</p>
                          <p className="text-[11px] text-slate-500">{currency(item.price)}</p>
                        </div>
                        <Button variant="danger" size="sm" onClick={() => removeDraftItem(item.localId)}>
                          Remove
                        </Button>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Button variant="secondary" size="sm" onClick={() => updateDraftQty(item.localId, -1)}>-</Button>
                          <span className="min-w-4 text-center text-xs font-semibold">{item.quantity}</span>
                          <Button variant="secondary" size="sm" onClick={() => updateDraftQty(item.localId, 1)}>+</Button>
                        </div>
                        <p className="text-xs font-semibold text-slate-800">{currency(item.quantity * item.price)}</p>
                      </div>
                    </div>
                  ))}
                  {draftItems.length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                      No items in order.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] md:grid-cols-4">
                  <div className="rounded border border-slate-200 bg-white px-2 py-1">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Subtotal</p>
                    <p className="font-semibold text-slate-800">{currency(draftTotal)}</p>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-2 py-1">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Discount</p>
                    <p className="font-semibold text-slate-800">-{currency(discountAmount)}</p>
                  </div>
                  <div className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1">
                    <p className="text-[10px] uppercase tracking-wide text-indigo-600">Total</p>
                    <p className="font-semibold text-indigo-700">{currency(grandTotal)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button className="w-full" onClick={createOrder} disabled={!canSendOrder}>Send Order</Button>
                  <Button variant="success" onClick={openPaymentModal} disabled={!activeOrder}>Complete Payment</Button>
                </div>

                <details className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <summary className="cursor-pointer text-xs font-medium text-slate-700">More actions</summary>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button variant="secondary" onClick={holdOrder} disabled={draftItems.length === 0}>Hold</Button>
                    <Button variant="secondary" onClick={saveDraft} disabled={draftItems.length === 0}>Save Draft</Button>
                    <Button
                      variant="warning"
                      onClick={() => {
                        setPaymentMethod('split');
                        openPaymentModal();
                      }}
                      disabled={!activeOrder}
                    >
                      Split Bill
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => window.electronAPI.printReceipt?.({ source: 'pos-draft' } as any)}
                      disabled={draftItems.length === 0 && !activeOrder}
                    >
                      Print Receipt
                    </Button>
                  </div>
                </details>
              </CardContent>
            </Card>
          </section>
        </motion.div>
      );
    }

    if (activeScreen === 'orders') {
      const sourceOrders = useHistoryView ? orderHistory : orders;

      const filteredOrders = sourceOrders
        .filter((order) => {
          if (orderStatusFilter === 'all') return true;
          return order.status === orderStatusFilter;
        })
        .filter((order) => {
          if (orderTypeFilter === 'all') return true;
          if (orderTypeFilter === 'table') return Boolean(order.tableId || order.table?.number);
          return !order.tableId && !order.table?.number;
        })
        .filter((order) => {
          const term = orderSearch.trim().toLowerCase();
          if (!term) return true;

          const tableLabel = `table ${order.table?.number || order.tableId || ''}`.toLowerCase();
          const customerLabel = `${order.customerName || ''} ${order.customerPhone || ''}`.toLowerCase();
          const itemNames = order.items
            .map((item) => productNameById.get(item.productId) || item.productId)
            .join(' ')
            .toLowerCase();

          return (
            order.id.toLowerCase().includes(term) ||
            tableLabel.includes(term) ||
            customerLabel.includes(term) ||
            itemNames.includes(term)
          );
        })
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const counts = {
        all: sourceOrders.length,
        Open: sourceOrders.filter((o) => o.status === 'Open').length,
        SentToKitchen: sourceOrders.filter((o) => o.status === 'SentToKitchen').length,
        Served: sourceOrders.filter((o) => o.status === 'Served').length,
        Closed: sourceOrders.filter((o) => o.status === 'Closed').length,
        Voided: sourceOrders.filter((o) => o.status === 'Voided').length,
      };

      const voidOrderWithReason = async (order: RestaurantOrder) => {
        if (!canVoidOrders) {
          window.alert('Only owner/admin/manager can void orders.');
          return;
        }
        const reason = window.prompt(`Void reason for order #${order.id.slice(0, 8)} (required):`, '');
        if (reason === null) return;

        const trimmed = reason.trim();
        if (!trimmed) {
          window.alert('Void reason is required.');
          return;
        }

        const confirmed = window.confirm(`Void order #${order.id.slice(0, 8)} now?`);
        if (!confirmed) return;

        await updateKitchenOrderStatus(order.id, 'Voided', trimmed);
      };

      const quickCheckoutOrder = async (order: RestaurantOrder) => {
        if (!canCheckoutOrders) {
          window.alert('You are not allowed to checkout orders.');
          return;
        }

        if (!requireWaiterSession('checking out orders')) return;

        if (order.status !== 'Served') {
          window.alert('Only served orders can be checked out.');
          return;
        }

        const confirmed = window.confirm(`Checkout order #${order.id.slice(0, 8)} with cash now?`);
        if (!confirmed) return;

        await window.electronAPI.checkoutRestaurantOrder(order.id, {
          paymentMethod: 'cash',
          amountReceived: Number(order.total || 0),
          customerName: order.customerName || undefined,
          customerPhone: order.customerPhone || undefined,
          idempotencyKey: `orders:checkout:${order.id}:${Date.now()}`,
        });

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['restaurant', 'orders'] }),
          queryClient.invalidateQueries({ queryKey: ['restaurant', 'tables'] }),
        ]);
      };

      return (
        <motion.div key="orders" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Orders Board</CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(['all', 'Open', 'SentToKitchen', 'Served', 'Closed', 'Voided'] as const).map((item) => (
                  <button
                    key={item}
                    className={`touch-btn px-3 py-1.5 text-xs ${orderStatusFilter === item ? 'bg-brand-indigo text-white' : 'bg-slate-100 text-slate-700'}`}
                    onClick={() => setOrderStatusFilter(item)}
                  >
                    {item === 'all' ? `All (${counts.all})` : `${item} (${counts[item]})`}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    className={`touch-btn px-3 py-1.5 text-xs ${useHistoryView ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                    onClick={() => setUseHistoryView((prev) => !prev)}
                  >
                    {useHistoryView ? 'History View: ON' : 'History View: OFF'}
                  </button>
                  {(['all', 'table', 'takeaway'] as const).map((item) => (
                    <button
                      key={item}
                      className={`touch-btn px-3 py-1.5 text-xs ${orderTypeFilter === item ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                      onClick={() => setOrderTypeFilter(item)}
                    >
                      {item === 'all' ? 'All Types' : item === 'table' ? 'Table' : 'Takeaway'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  type="datetime-local"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  value={historyFrom}
                  onChange={(e) => setHistoryFrom(e.target.value)}
                  placeholder="From"
                />
                <input
                  type="datetime-local"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  value={historyTo}
                  onChange={(e) => setHistoryTo(e.target.value)}
                  placeholder="To"
                />
                <div className="flex gap-2">
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                    value={orderWaiterFilter}
                    onChange={(e) => setOrderWaiterFilter(e.target.value)}
                  >
                    <option value="">All waiters</option>
                    {selectableWaiters.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name || member.email || member.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setOrderWaiterFilter(String(activeWaiter?.id || user?.id || user?.userId || ''))}
                    disabled={!activeWaiter?.id && !user?.id && !user?.userId}
                  >
                    My Orders
                  </Button>
                </div>
              </div>
              <div className="relative mt-2">
                <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
                  placeholder="Search by order id, table, customer, or item"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-slate-500">
                Live active tickets only. Oldest appears first to reduce missed orders.
              </p>

              <div className="rounded-lg border border-slate-200">
                <div className="hidden grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 md:grid">
                  <span className="col-span-2">Order</span>
                  <span className="col-span-2">Table / Type</span>
                  <span className="col-span-2">Customer</span>
                  <span className="col-span-2">Elapsed</span>
                  <span className="col-span-1 text-right">Items</span>
                  <span className="col-span-1 text-right">Total</span>
                  <span className="col-span-1">Status</span>
                  <span className="col-span-1 text-right">Actions</span>
                </div>

                {filteredOrders.length === 0 && (
                  <div className="px-3 py-5 text-sm text-slate-500">No orders match your filters.</div>
                )}

                {filteredOrders.map((order) => {
                  const elapsedMinutes = Math.max(
                    0,
                    Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000),
                  );

                  const ageTone =
                    elapsedMinutes >= 20
                      ? 'bg-red-100 text-red-700'
                      : elapsedMinutes >= 10
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700';

                  return (
                    <div key={order.id} className="grid grid-cols-1 gap-2 border-b border-slate-100 px-3 py-2 text-xs md:grid-cols-12 md:items-center md:gap-2 md:text-sm">
                      <div className="md:col-span-2">
                        <p className="font-semibold text-slate-900">#{order.id.slice(0, 8)}</p>
                        <p className="text-[11px] text-slate-500">{new Date(order.createdAt).toLocaleTimeString()}</p>
                      </div>

                      <div className="md:col-span-2">
                        <p className="font-medium">{order.table?.number || order.tableId || 'Takeaway'}</p>
                        <p className="text-[11px] text-slate-500">{order.tableId ? 'Table Service' : 'Takeaway'}</p>
                      </div>

                      <div className="md:col-span-2">
                        <p className="truncate">{order.customerName || '-'}</p>
                        <p className="text-[11px] text-slate-500">
                          {order.customerPhone || '-'} · Waiter {order.waiterId ? (staffNameById.get(order.waiterId) || order.waiterId.slice(0, 8)) : '-'}
                        </p>
                      </div>

                      <div className="md:col-span-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ageTone}`}>
                          {elapsedMinutes}m
                        </span>
                      </div>

                      <div className="text-left font-semibold md:col-span-1 md:text-right">{order.items.length}</div>
                      <div className="text-left font-semibold md:col-span-1 md:text-right">{currency(order.total)}</div>

                      <div className="md:col-span-1">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusColor(order.status)}`}>{order.status}</span>
                      </div>

                      <div className="flex flex-wrap justify-start gap-1 md:col-span-1 md:justify-end">
                        {order.tableId && (
                          <Button size="sm" variant="secondary" onClick={() => seatTableToPos(order.tableId!, undefined, order.id)}>
                            Open
                          </Button>
                        )}
                        {order.status === 'Open' && canSendOrdersToKitchen && (
                          <Button size="sm" variant="warning" onClick={() => updateKitchenOrderStatus(order.id, 'SentToKitchen')}>
                            Cook
                          </Button>
                        )}
                        {order.status === 'SentToKitchen' && canMarkOrdersServed && (
                          <Button size="sm" variant="success" onClick={() => updateKitchenOrderStatus(order.id, 'Served')}>
                            Serve
                          </Button>
                        )}
                        {order.status === 'Served' && canCheckoutOrders && (
                          <Button size="sm" variant="success" onClick={() => quickCheckoutOrder(order)}>
                            Checkout
                          </Button>
                        )}
                        {canVoidOrders && (order.status === 'Open' || order.status === 'SentToKitchen' || order.status === 'Served') && (
                          <Button size="sm" variant="danger" onClick={() => voidOrderWithReason(order)}>
                            Void
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      );
    }

    if (activeScreen === 'activity') {
      if (!canViewRestaurantActivity) {
        return (
          <motion.div key="activity-denied" variants={screenVariants} initial="initial" animate="animate" exit="exit">
            <Card>
              <CardHeader><CardTitle>Restaurant Activity</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600">Only owner/admin/manager roles can view the restaurant activity log.</p>
              </CardContent>
            </Card>
          </motion.div>
        );
      }

      return (
        <motion.div key="activity" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Restaurant Activity Log</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                <input
                  type="datetime-local"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={activityFrom}
                  onChange={(e) => setActivityFrom(e.target.value)}
                />
                <input
                  type="datetime-local"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={activityTo}
                  onChange={(e) => setActivityTo(e.target.value)}
                />
                <input
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Actor user ID"
                  value={activityActorFilter}
                  onChange={(e) => setActivityActorFilter(e.target.value)}
                />
                <input
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Order ID"
                  value={activityOrderFilter}
                  onChange={(e) => setActivityOrderFilter(e.target.value)}
                />
                <input
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Action (e.g. order_status_changed)"
                  value={activityActionFilter}
                  onChange={(e) => setActivityActionFilter(e.target.value)}
                />
              </div>

              <div className="overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Actor</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {restaurantActivity.length === 0 && (
                      <tr>
                        <td className="px-3 py-4 text-slate-500" colSpan={6}>No activity found for selected filters.</td>
                      </tr>
                    )}
                    {restaurantActivity.map((event) => {
                      const details = event.details || {};
                      const actorName =
                        event.actor?.name ||
                        event.actor?.email ||
                        (typeof details.actorName === 'string' ? details.actorName : '') ||
                        event.actorUserId ||
                        'System';
                      const detailsSummary =
                        (typeof details.voidReason === 'string' && details.voidReason.trim())
                          ? `Reason: ${details.voidReason}`
                          : (typeof details.paymentMethod === 'string' ? `Payment: ${details.paymentMethod}` : '-');

                      return (
                        <tr key={event.id} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 text-xs text-slate-600">{new Date(event.createdAt).toLocaleString()}</td>
                          <td className="px-3 py-2 text-xs">{actorName}</td>
                          <td className="px-3 py-2 text-xs font-medium">{event.actionType.replace(/_/g, ' ')}</td>
                          <td className="px-3 py-2 text-xs">{event.orderId ? event.orderId.slice(0, 8) : '-'}</td>
                          <td className="px-3 py-2 text-xs">
                            {event.fromStatus || '-'}
                            <span className="mx-1 text-slate-400">→</span>
                            {event.toStatus || '-'}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">{detailsSummary}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      );
    }

    if (activeScreen === 'tables') {
      return (
        <motion.div key="tables" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Floor Plan</CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="w-44 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  placeholder="Search table/status"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                />
                {(['all', 'Available', 'Occupied', 'Reserved'] as const).map((item) => (
                  <button
                    key={item}
                    className={`touch-btn px-3 py-1.5 text-xs ${tableStatusFilter === item ? 'bg-brand-indigo text-white' : 'bg-slate-100 text-slate-700'}`}
                    onClick={() => setTableStatusFilter(item)}
                  >
                    {item}
                  </button>
                ))}
                {canManageTables && (
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <input
                      className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                      placeholder="Table #"
                      value={newTableNumber}
                      onChange={(e) => setNewTableNumber(e.target.value)}
                    />
                    <input
                      type="number"
                      min={1}
                      className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                      placeholder="Seats"
                      value={newTableCapacity}
                      onChange={(e) => setNewTableCapacity(e.target.value)}
                    />
                    <Button size="sm" onClick={handleCreateTable}>Add Table</Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {tableBoard.map((table) => {
                  const linked = table.activeOrder;
                  const tone = linked
                    ? 'bg-red-100 text-red-700'
                    : table.derivedStatus === 'Reserved'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-emerald-100 text-emerald-700';
                  return (
                    <div key={table.id} className={`rounded-2xl p-4 ${tone}`}>
                      <p className="text-sm font-semibold">Table {table.number}</p>
                      <p className="text-xs">{table.derivedStatus}</p>
                      <div className="mt-1 text-[11px]">
                        {editingTableId === table.id ? (
                          <div className="flex items-center gap-1">
                            <span>Seats:</span>
                            <input
                              type="number"
                              min={1}
                              className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-900"
                              value={editTableCapacity}
                              onChange={(e) => setEditTableCapacity(e.target.value)}
                            />
                            <button className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white" onClick={() => saveTableCapacity(table.id)}>
                              Save
                            </button>
                            <button className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700" onClick={() => setEditingTableId(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <span>Capacity: {table.capacity || '-'}</span>
                        )}
                      </div>
                      {linked && (
                        <p className="mt-1 text-[11px]">
                          {linked.items.length} items · {currency(linked.total)}
                        </p>
                      )}
                      {table.reservation && (
                        <p className="mt-1 text-[11px]">
                          Reserved: {table.reservation.customerName}
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant={linked ? 'warning' : 'secondary'}
                          onClick={() => seatTableToPos(table.id, table.reservation?.id)}
                        >
                          {linked ? 'Open Order' : 'Seat Table'}
                        </Button>
                        {linked && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => closeTableOrder(linked.id)}
                          >
                            Close Table
                          </Button>
                        )}
                        {!linked && table.reservation && table.reservation.status !== 'Cancelled' && table.reservation.status !== 'NoShow' && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => cancelReservation(table.reservation!.id)}
                          >
                            Cancel Reservation
                          </Button>
                        )}
                        {canManageTables && editingTableId !== table.id && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => beginEditTable(table)}
                          >
                            Edit Seats
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      );
    }

    if (activeScreen === 'reservations') {
      return (
        <motion.div key="reservations" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><span className="text-slate-500">Total</span><p className="text-base font-semibold">{reservationStats.total}</p></div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs"><span className="text-blue-700">Booked</span><p className="text-base font-semibold text-blue-800">{reservationStats.booked}</p></div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs"><span className="text-amber-700">Arrived</span><p className="text-base font-semibold text-amber-800">{reservationStats.arrived}</p></div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs"><span className="text-emerald-700">Seated</span><p className="text-base font-semibold text-emerald-800">{reservationStats.seated}</p></div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs"><span className="text-rose-700">No-show</span><p className="text-base font-semibold text-rose-800">{reservationStats.noShow}</p></div>
          </div>

          <Card>
            <CardHeader><CardTitle>Create Reservation</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <select
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={reservationForm.tableId}
                onChange={(e) => setReservationForm((prev) => ({ ...prev, tableId: e.target.value }))}
              >
                <option value="">Select table</option>
                {availableReservationTables.map((table) => (
                  <option key={table.id} value={table.id}>Table {table.number}</option>
                ))}
              </select>
              <input
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                placeholder="Customer name"
                value={reservationForm.customerName}
                onChange={(e) => setReservationForm((prev) => ({ ...prev, customerName: e.target.value }))}
              />
              <input
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                placeholder="Phone"
                value={reservationForm.phone}
                onChange={(e) => setReservationForm((prev) => ({ ...prev, phone: e.target.value }))}
              />
              <input
                type="number"
                min={1}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                placeholder="Pax"
                value={reservationForm.pax}
                onChange={(e) => setReservationForm((prev) => ({ ...prev, pax: e.target.value }))}
              />
              <input
                type="datetime-local"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={reservationForm.reservedAt}
                onChange={(e) => setReservationForm((prev) => ({ ...prev, reservedAt: e.target.value }))}
              />
              <input
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                placeholder="Notes (optional)"
                value={reservationForm.notes}
                onChange={(e) => setReservationForm((prev) => ({ ...prev, notes: e.target.value }))}
              />
              <div className="md:col-span-2 xl:col-span-3">
                <Button onClick={createReservation}>Save Reservation</Button>
              </div>
              {availableReservationTables.length === 0 && (
                <div className="md:col-span-2 xl:col-span-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  No tables available for the selected time. Adjust the reservation time or clear conflicting bookings.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Upcoming Reservations</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  placeholder="Search name/phone/table"
                  value={reservationSearch}
                  onChange={(e) => setReservationSearch(e.target.value)}
                />
                {(['all', 'Booked', 'Arrived', 'Seated', 'NoShow', 'Cancelled'] as const).map((item) => (
                  <button
                    key={item}
                    className={`touch-btn px-3 py-1.5 text-xs ${reservationStatusFilter === item ? 'bg-brand-indigo text-white' : 'bg-slate-100 text-slate-700'}`}
                    onClick={() => setReservationStatusFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>

              {filteredReservations.length === 0 && <p className="text-sm text-slate-500">No reservations match current filter.</p>}
              {filteredReservations.map((reservation) => {
                const table = tables.find((t) => t.id === reservation.tableId);
                const reservationTimeMs = new Date(reservation.reservedAt).getTime();
                const nowMs = Date.now();
                const timeToReservationMs = reservationTimeMs - nowMs;
                const isActiveReservation = reservation.status === 'Booked' || reservation.status === 'Arrived';
                const isOverdue = isActiveReservation && timeToReservationMs < 0;
                const isDueSoon = isActiveReservation && timeToReservationMs >= 0 && timeToReservationMs <= 30 * 60 * 1000;

                const urgencyClass = isOverdue
                  ? 'border-rose-300 bg-rose-50'
                  : isDueSoon
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-slate-100 bg-white';

                return (
                  <div key={reservation.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${urgencyClass}`}>
                    <div className="text-sm">
                      <p className="font-semibold">{reservation.customerName}</p>
                      <p className="text-xs text-slate-500">
                        Table {table?.number || '-'} · {reservation.pax} pax · {new Date(reservation.reservedAt).toLocaleString()}
                      </p>
                      <p className="text-xs text-slate-500">Status: {reservation.status}</p>
                      {(isDueSoon || isOverdue) && (
                        <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${isOverdue ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                          {isOverdue ? 'Overdue' : 'Due in 30 min'}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {(reservation.status === 'Booked' || reservation.status === 'Arrived') && (
                        <Button size="sm" variant="success" onClick={() => seatTableToPos(reservation.tableId, reservation.id)}>
                          Seat
                        </Button>
                      )}
                      {reservation.status === 'Booked' && (
                        <Button size="sm" variant="warning" onClick={() => upsertReservationStatus(reservation.id, 'Arrived')}>
                          Arrived
                        </Button>
                      )}
                      {(reservation.status === 'Booked' || reservation.status === 'Arrived') && (
                        <Button size="sm" variant="danger" onClick={() => upsertReservationStatus(reservation.id, 'NoShow')}>
                          No-show
                        </Button>
                      )}
                      {(reservation.status === 'Booked' || reservation.status === 'Arrived') && (
                        <Button size="sm" variant="danger" onClick={() => cancelReservation(reservation.id)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </motion.div>
      );
    }

    if (activeScreen === 'kitchen') {
      const lanes: OrderStatus[] = isKitchenOnly
        ? ['SentToKitchen']
        : ['Open', 'SentToKitchen', 'Served', 'Closed'];
      return (
        <motion.div key="kitchen" variants={screenVariants} initial="initial" animate="animate" exit="exit">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            {lanes.map((lane) => (
              <Card key={lane}>
                <CardHeader><CardTitle>{lane}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {orders.filter((o) => o.status === lane).length === 0 && (
                    <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                      No tickets in this lane.
                    </p>
                  )}
                  {orders
                    .filter((o) => o.status === lane)
                    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                    .map((order) => {
                    const elapsedMinutes = Math.max(
                      0,
                      Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000),
                    );

                    const urgencyTone =
                      elapsedMinutes >= 20
                        ? 'border-red-300 bg-red-50'
                        : elapsedMinutes >= 10
                        ? 'border-amber-300 bg-amber-50'
                        : 'border-slate-100 bg-white';

                    const urgencyBadge =
                      elapsedMinutes >= 20
                        ? 'Urgent'
                        : elapsedMinutes >= 10
                        ? 'Attention'
                        : 'On Time';

                    const urgencyBadgeTone =
                      elapsedMinutes >= 20
                        ? 'bg-red-100 text-red-700'
                        : elapsedMinutes >= 10
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700';

                    const isClosedLane = lane === 'Closed';

                    return (
                      <div
                        key={order.id}
                        className={`rounded-lg border p-3 ${urgencyTone} ${isClosedLane ? 'cursor-pointer hover:border-slate-300' : ''}`}
                        onClick={isClosedLane ? () => openOrderInOrdersView(order) : undefined}
                        role={isClosedLane ? 'button' : undefined}
                        tabIndex={isClosedLane ? 0 : undefined}
                        onKeyDown={
                          isClosedLane
                            ? (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openOrderInOrdersView(order);
                                }
                              }
                            : undefined
                        }
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">#{order.id.slice(0, 8)}</p>
                            <p className="text-xs text-slate-500">
                              Table {order.table?.number || order.tableId || 'Takeaway'}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${urgencyBadgeTone} ${elapsedMinutes >= 20 ? 'animate-pulse' : ''}`}>
                              {urgencyBadge}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                              {elapsedMinutes}m ago
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1 rounded-md bg-slate-50 p-2">
                          {order.items.slice(0, 4).map((item, idx) => (
                            <div key={`${order.id}-${item.productId}-${idx}`} className="flex items-center justify-between text-xs">
                              <span className="truncate pr-2">
                                {productNameById.get(item.productId) || item.productId}
                              </span>
                              <span className="font-semibold">x{item.quantity}</span>
                            </div>
                          ))}
                          {order.items.length > 4 && (
                            <p className="text-[11px] text-slate-500">+{order.items.length - 4} more items</p>
                          )}
                        </div>

                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-slate-500">{order.items.length} items</span>
                          <span className="font-semibold text-slate-800">{currency(order.total)}</span>
                        </div>

                        <div className="mt-2 flex gap-2">
                          {lane === 'Open' && canSendOrdersToKitchen && (
                            <Button size="sm" variant="warning" onClick={() => updateKitchenOrderStatus(order.id, 'SentToKitchen')}>
                              Start Cooking
                            </Button>
                          )}
                          {lane === 'SentToKitchen' && canMarkOrdersServed && (
                            <Button size="sm" variant="success" onClick={() => updateKitchenOrderStatus(order.id, 'Served')}>
                              Mark Served
                            </Button>
                          )}
                          {lane === 'Served' && canCloseKitchenTickets && (
                            <Button size="sm" variant="secondary" onClick={() => updateKitchenOrderStatus(order.id, 'Closed')}>
                              Close Ticket
                            </Button>
                          )}
                          {lane === 'Closed' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                openOrderInOrdersView(order);
                              }}
                            >
                              View Ticket
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>
      );
    }

    if (activeScreen === 'employees') {
      const staffList = staffUsers
        .filter((member) => {
          const role = staffRoleName(member);
          return ['owner', 'admin', 'waiter', 'cashier', 'manager'].includes(role);
        })
        .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));

      return (
        <motion.div key="employees" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Staff Accounts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canManageStaff ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <input
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    placeholder="Full name"
                    value={staffForm.name}
                    onChange={(e) => setStaffForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <input
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    placeholder="Email"
                    value={staffForm.email}
                    onChange={(e) => setStaffForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                  <input
                    type="password"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    placeholder="Temporary password"
                    value={staffForm.password}
                    onChange={(e) => setStaffForm((prev) => ({ ...prev, password: e.target.value }))}
                  />
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={staffForm.role}
                    onChange={(e) => setStaffForm((prev) => ({ ...prev, role: e.target.value }))}
                  >
                    <option value="waiter">Waiter</option>
                    <option value="cashier">Cashier</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <Button onClick={createStaffAccount}>Create Account</Button>
                </div>
              ) : (
                <p className="text-sm text-slate-600">Only owner/admin can create staff accounts.</p>
              )}

              <div className="rounded-lg border border-slate-200">
                <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                  <span className="col-span-3">Name</span>
                  <span className="col-span-3">Email</span>
                  <span className="col-span-2">Role</span>
                  <span className="col-span-2">PIN</span>
                  <span className="col-span-2">Actions</span>
                </div>
                {staffList.length === 0 && <div className="px-3 py-3 text-sm text-slate-500">No staff accounts found.</div>}
                {staffList.map((member) => (
                  <div key={member.id} className="grid grid-cols-12 border-b border-slate-100 px-3 py-2 text-sm">
                    <span className="col-span-3 truncate">{member.name || '-'}</span>
                    <span className="col-span-3 truncate text-slate-600">{member.email || '-'}</span>
                    <span className="col-span-2 capitalize">{staffRoleName(member)}</span>
                    <span className="col-span-2 text-slate-600">{member.hasPosPin ? 'Set' : 'Not Set'}</span>
                    <span className="col-span-2">
                      {canManageStaff && (
                        <Button size="sm" variant="secondary" onClick={() => setStaffPosPin(member)}>
                          Set PIN
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      );
    }

    if (activeScreen === 'inventory') {
      return (
        <motion.div key="inventory" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>BOM Recipe Builder</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm lg:col-span-7"
                    value={bomForm.productId}
                    onChange={(e) => setBomForm((prev) => ({ ...prev, productId: e.target.value }))}
                  >
                    <option value="">Select menu item/product</option>
                    {menuProductsForBom
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((product) => (
                        <option key={product.id} value={product.id}>{product.name}</option>
                      ))}
                  </select>
                  <div className="grid min-w-0 grid-cols-2 gap-2 lg:col-span-5">
                    <input
                      type="number"
                      min={0.0001}
                      step="0.01"
                      className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                      placeholder="Yield"
                      value={bomForm.yieldQty}
                      onChange={(e) => setBomForm((prev) => ({ ...prev, yieldQty: e.target.value }))}
                    />
                    <input
                      className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                      placeholder="Yield unit"
                      value={bomForm.yieldUnit}
                      onChange={(e) => setBomForm((prev) => ({ ...prev, yieldUnit: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  {bomLines.map((line) => (
                    <div key={line.localId} className="grid grid-cols-12 gap-2 rounded-lg border border-slate-100 p-2">
                      <select
                        className="col-span-12 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs md:col-span-5"
                        value={line.ingredientProductId}
                        onChange={(e) => updateBomLine(line.localId, { ingredientProductId: e.target.value })}
                      >
                        <option value="">Ingredient product</option>
                        {currentBomIngredientOptions
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((product) => (
                            <option key={product.id} value={product.id}>{product.name}</option>
                          ))}
                      </select>
                      <input
                        type="number"
                        min={0.0001}
                        step="0.01"
                        className="col-span-4 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs md:col-span-2"
                        placeholder="Qty"
                        value={line.quantity}
                        onChange={(e) => updateBomLine(line.localId, { quantity: e.target.value })}
                      />
                      <input
                        className="col-span-4 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs md:col-span-2"
                        placeholder="Unit"
                        value={line.unit}
                        onChange={(e) => updateBomLine(line.localId, { unit: e.target.value })}
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        className="col-span-4 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs md:col-span-2"
                        placeholder="Waste %"
                        value={line.wastePercent}
                        onChange={(e) => updateBomLine(line.localId, { wastePercent: e.target.value })}
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        className="col-span-12 h-8 px-3 text-xs md:col-span-1 md:justify-self-end"
                        onClick={() => removeBomLine(line.localId)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={addBomLine}>Add Ingredient</Button>
                  <Button size="sm" onClick={saveBomRecipe} disabled={bomSaving}>{bomSaving ? 'Saving...' : 'Save BOM'}</Button>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                    Estimated recipe cost: {currency(bomDraftCost)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Saved BOM Recipes</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Search recipe by product"
                  value={bomSearch}
                  onChange={(e) => setBomSearch(e.target.value)}
                />
                {filteredBomRecipes.length === 0 && (
                  <p className="text-sm text-slate-500">No BOM recipes yet.</p>
                )}
                {filteredBomRecipes.slice(0, 30).map((recipe) => (
                  <button
                    key={recipe.id}
                    className="w-full rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50"
                    onClick={() => setBomForm((prev) => ({ ...prev, productId: recipe.productId }))}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{recipe.product?.name || productNameById.get(recipe.productId) || 'Unknown product'}</p>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">v{recipe.version}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {recipe.lines.length} ingredients · Yield {recipe.yieldQty} {recipe.yieldUnit}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">Estimated cost: {currency(recipeCost(recipe.lines || []))}</p>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Stock Snapshot</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {ingredientProductsForBom.slice(0, 20).map((product) => (
                <div key={product.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-sm">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-slate-500">Cost: {currency(Number(productCostById.get(product.id) || 0))}</p>
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

    if (activeScreen === 'settings') {
      return (
        <motion.div key="settings" variants={screenVariants} initial="initial" animate="animate" exit="exit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>App Updates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Update Channel</p>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={selectedUpdateChannel}
                    onChange={(e) => handleChangeUpdateChannel(e.target.value as UpdateChannel)}
                  >
                    <option value="stable">Stable (recommended for clients)</option>
                    <option value="beta">Beta (pilot rollout)</option>
                  </select>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-700">
                  <p><span className="font-semibold">Current Version:</span> {updateSettings?.currentVersion || 'Unknown'}</p>
                  <p><span className="font-semibold">Feed URL:</span> {updateSettings?.feedUrl || 'Not configured'}</p>
                  <p><span className="font-semibold">Runtime:</span> {updateSettings?.isPackaged ? 'Installed app' : 'Development mode'}</p>
                </div>
              </div>

              {updateStatus && (
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  <p><span className="font-semibold">Status:</span> {updateStatus.status}</p>
                  {updateStatus.availableVersion && (
                    <p><span className="font-semibold">Available Version:</span> {updateStatus.availableVersion}</p>
                  )}
                  {typeof updateStatus.progressPercent === 'number' && (
                    <p><span className="font-semibold">Download Progress:</span> {updateStatus.progressPercent}%</p>
                  )}
                  {updateStatus.message && (
                    <p><span className="font-semibold">Details:</span> {updateStatus.message}</p>
                  )}
                  {updateStatus.checkedAt && (
                    <p><span className="font-semibold">Last Check:</span> {new Date(updateStatus.checkedAt).toLocaleString()}</p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {!isPackagedBuild && (
                  <p className="w-full text-xs text-amber-700">
                    Update checks are disabled in development mode. Install and run the packaged EXE to test updates.
                  </p>
                )}

                <Button onClick={handleCheckForUpdates} disabled={checkingUpdates || !isPackagedBuild}>
                  {checkingUpdates ? 'Checking...' : 'Check for Updates'}
                </Button>
                <Button
                  variant="success"
                  onClick={handleInstallUpdate}
                  disabled={installingUpdate || updateStatus?.status !== 'downloaded' || !isPackagedBuild}
                >
                  {installingUpdate ? 'Installing...' : 'Install Downloaded Update'}
                </Button>
              </div>

              <p className="text-xs text-slate-500">
                Stable is safest for all stores. Use Beta only for pilot devices before promoting to Stable.
              </p>
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
        animate={{ width: sidebarCollapsed ? 72 : 208 }}
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
          {visibleSidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSidebarItemClick(item.id)}
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
              {activeWaiter ? (
                <>
                  <button
                    className="h-8 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-[11px] text-emerald-700"
                    onClick={() => setWaiterCheckinOpen(true)}
                    title="Waiter session"
                  >
                    Waiter: {activeWaiter.name || activeWaiter.email || activeWaiter.id.slice(0, 8)}
                  </button>
                  <Button
                    variant="secondary"
                    className="h-8 px-2 text-xs"
                    onClick={() => setWaiterCheckinOpen(true)}
                  >
                    Switch Waiter
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-8 px-2 text-xs"
                    onClick={() => lockWaiterSession()}
                  >
                    Lock Waiter
                  </Button>
                </>
              ) : (
                <Button
                  variant="warning"
                  className="h-8 px-2 text-xs"
                  onClick={() => setWaiterCheckinOpen(true)}
                >
                  Check In Waiter
                </Button>
              )}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] leading-none">
                {clock.toLocaleDateString()} · {clock.toLocaleTimeString()}
              </div>
              <Button variant="secondary" className="h-8 gap-1.5 px-2 text-xs">
                <UserCircle2 size={14} />
                Manager
              </Button>
              <Button variant="secondary" className="h-8 gap-1.5 px-2 text-xs" onClick={handleLogout}>
                <LogOut size={14} />
                Manager Sign-out
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

      {waiterCheckinOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 px-3">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Waiter Check-In</h3>
            <p className="mt-1 text-xs text-slate-500">
              Select waiter and enter PIN before processing restaurant orders.
            </p>

            <div className="mt-3 space-y-2">
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={waiterCandidateId}
                onChange={(e) => setWaiterCandidateId(e.target.value)}
              >
                <option value="">Select waiter</option>
                {selectableWaiters.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name || member.email || member.id.slice(0, 8)}
                  </option>
                ))}
              </select>

              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={waiterPinInput}
                onChange={(e) => setWaiterPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter waiter PIN (4-8 digits)"
                autoFocus
              />

              <p className="text-[11px] text-slate-500">Digits entered: {waiterPinInput.length}</p>

              {waiterCheckinError && (
                <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                  {waiterCheckinError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setWaiterCheckinOpen(false);
                    setWaiterCheckinError('');
                    setWaiterPinInput('');
                  }}
                >
                  Close
                </Button>
                <Button onClick={verifyAndActivateWaiter}>Check In</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {managerSignoutOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 px-3">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Manager Terminal Sign-out</h3>
            <p className="mt-1 text-xs text-slate-500">
              Only owner/admin/manager can sign out this kiosk terminal.
            </p>

            <div className="mt-3 space-y-2">
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={managerCandidateId}
                onChange={(e) => setManagerCandidateId(e.target.value)}
              >
                <option value="">Select manager/admin</option>
                {managerApprovers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name || member.email || member.id.slice(0, 8)}
                  </option>
                ))}
              </select>

              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={managerPinInput}
                onChange={(e) => setManagerPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter manager/admin PIN"
                autoFocus
              />

              <p className="text-[11px] text-slate-500">Digits entered: {managerPinInput.length}</p>

              {managerSignoutError && (
                <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                  {managerSignoutError}
                </p>
              )}

              {managerApprovers.length === 0 && (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  No manager/admin users found with POS access in this branch.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setManagerSignoutOpen(false);
                    setManagerSignoutError('');
                    setManagerPinInput('');
                    setManagerCandidateId('');
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={confirmManagerSignOut}>Sign Out Terminal</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {staffPinModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 px-3">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Set Staff POS PIN</h3>
            <p className="mt-1 text-xs text-slate-500">
              {staffPinTarget?.name || staffPinTarget?.email || 'Staff member'}: enter a 4-8 digit PIN.
            </p>

            <div className="mt-3 space-y-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                value={staffPinValue}
                onChange={(e) => {
                  setStaffPinValue(e.target.value.replace(/\D/g, ''));
                  if (staffPinError) setStaffPinError('');
                }}
                placeholder="Enter new PIN (4-8 digits)"
                autoFocus
              />

              <p className="text-[11px] text-slate-500">Digits entered: {staffPinValue.length}</p>

              {staffPinError && (
                <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                  {staffPinError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStaffPinModalOpen(false);
                    setStaffPinTarget(null);
                    setStaffPinValue('');
                    setStaffPinError('');
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={confirmSetStaffPosPin}>Save PIN</Button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
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
                  {(['cash', 'card', 'mpesa', 'split'] as PaymentMethod[]).map((method) => (
                    <button
                      key={method}
                      onClick={() => {
                        setPaymentMethod(method);
                        if (method !== 'mpesa') {
                          setMpesaTransactionId('');
                          setMpesaReceipt('');
                        }
                      }}
                      className={`touch-btn border ${paymentMethod === method ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white'}`}
                    >
                      {method === 'mpesa' ? 'M-Pesa' : method}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input
                    ref={paymentCustomerNameInputRef}
                    className="rounded-xl border border-slate-200 px-3 py-3 text-sm"
                    placeholder="Customer name"
                    value={paymentCustomerName}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => setPaymentCustomerName(e.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-3 text-sm"
                    placeholder="Customer phone (optional)"
                    value={paymentCustomerPhone}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => setPaymentCustomerPhone(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <input
                    ref={receivedAmountInputRef}
                    className="rounded-xl border border-slate-200 px-3 py-3 text-sm"
                    placeholder="Amount received"
                    value={receivedAmount}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setReceivedAmount(e.target.value);
                      markWaiterActivity();
                    }}
                  />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                    Change: {currency(Math.max(0, Number(receivedAmount || 0) - grandTotal))}
                  </div>
                </div>

                {paymentMethod === 'mpesa' && (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">M-Pesa STK Prompt</p>
                        <p className="text-xs text-slate-600">Send payment prompt to customer phone, then confirm payment.</p>
                      </div>
                      <Button size="sm" onClick={openMpesaPrompt}>Send Prompt</Button>
                    </div>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold text-slate-900">Transaction ID</p>
                        <p className="mt-1 break-all">{mpesaTransactionId || 'Not received yet'}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold text-slate-900">Receipt</p>
                        <p className="mt-1 break-all">{mpesaReceipt || 'Waiting for callback'}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 p-3 text-sm">
                  <p className="mb-1 font-semibold">Receipt Preview</p>
                  <p className="text-slate-500">Items: {draftItems.length}</p>
                  <p className="text-slate-500">Method: {paymentMethod === 'mpesa' ? 'M-Pesa' : paymentMethod}</p>
                  <p className="text-slate-500">Customer: {paymentCustomerName || activeOrder?.customerName || '-'}</p>
                  <p className="text-slate-500">Total: {currency(grandTotal)}</p>
                </div>

                <Button className="w-full" size="lg" onClick={completePayment}>Confirm Payment</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showMpesaPaymentModal && paymentMethod === 'mpesa' && (
        <MpesaPayment
          amount={grandTotal}
          saleData={{
            orderId: activeOrder?.id,
            customerName: paymentCustomerName,
            customerPhone: paymentCustomerPhone,
            tableId: activeOrder?.tableId,
            total: grandTotal,
            source: 'restaurant-pos',
          }}
          onSuccess={handleMpesaSuccess}
          onCancel={handleMpesaCancel}
        />
      )}

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
