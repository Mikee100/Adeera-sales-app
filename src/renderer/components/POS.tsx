import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock3, LogOut, Power, ReceiptText, ShoppingCart, WalletCards, Printer, History } from 'lucide-react';
import ProductSelection from './ProductSelection';
import Checkout from './Checkout';
import Receipt from './Receipt';
import PrintPreview from './PrintPreview';
import Settings from './Settings';
import FindReceiptModal from './FindReceiptModal';
import SalesHistoryModal from './SalesHistoryModal';
import OfflineSalesQueueModal from './OfflineSalesQueueModal';
import SyncStatus from './SyncStatus';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from './Toast';
import { usePendingTransactions } from '../hooks/usePendingTransactions';
import { validateStock, validatePrice, validateSaleData, validateReceiptNumber } from '../utils/validation';
import { auditLogger, AuditEventType } from '../utils/audit-logger';
import { handleError, handleNetworkOperation, ErrorRecovery, AppError } from '../utils/error-handler';
import { sanitizeCustomerName, sanitizePhoneNumber, sanitizeNotes } from '../utils/sanitization';
import { saleMutex } from '../utils/sale-mutex';
import { detectStockConflict } from '../../shared/stock-conflict-handler';
import { retrySaleWithRefresh } from '../utils/stock-conflict-handler';
import '../pos-premium-theme.css';

interface Product {
  id: string;
  name: string;
  price: number;
  sku: string;
  stock: number;
  description?: string;
  cost?: number;
  supplier?: string;
  images?: string[];
  branchId?: string;
  tenantId?: string;
  hasVariations?: boolean;
  variations?: Array<{
    id: string;
    sku: string;
    price?: number | null;
    stock: number;
    attributes?: Record<string, string>;
  }>;
}

interface CartItem {
  product: Product;
  quantity: number;
  reservedAt?: number; // Timestamp when item was added to cart (for stock reservation)
}

interface SplitPayment {
  method: 'cash' | 'mpesa' | 'credit';
  amount: number;
  amountReceived?: number;
  mpesaTransactionId?: string;
  mpesaReceipt?: string;
  creditDueDate?: string;
  creditNotes?: string;
}

interface PaymentData {
  paymentMethod: 'cash' | 'mpesa' | 'credit' | 'split';
  amountReceived?: number;
  customerName?: string;
  customerPhone?: string;
  creditAmount?: number;
  creditDueDate?: string;
  creditNotes?: string;
  discountAmount?: number;
  isSplitPayment?: boolean;
  splitPayments?: SplitPayment[];
  managerOverride?: {
    approvedByUserId: string;
    approvedByName?: string;
    approvalReason: string;
    approvalPin: string;
  };
}

interface ProductsResponse {
  success: boolean;
  products?: Product[];
  error?: string;
}

type POSStep = 'products' | 'checkout' | 'receipt' | 'print-preview';

interface Branch {
  id: string;
  name: string;
  [key: string]: any;
}

interface StaffUser {
  id: string;
  name?: string;
  email?: string;
  roles?: string[];
  userRoles?: Array<{ role?: { name?: string } }>;
}

interface ActiveCashierSession {
  id: string;
  name?: string;
  email?: string;
  roles?: string[];
}

type InlineStatusLevel = 'neutral' | 'info' | 'success' | 'warning' | 'error';
type ShiftPromptMode = 'open' | 'close' | null;

const ACTIVE_CASHIER_STORAGE_KEY = 'retail-active-cashier-session';

const POS: React.FC = () => {
  const { user, logout } = useAuth();
  const { pendingTransactions, holdTransaction, resumeTransaction, deleteTransaction } = usePendingTransactions();
  const [currentStep, setCurrentStep] = useState<POSStep>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentReceipt, setCurrentReceipt] = useState<any>(null);
  const [processingSale, setProcessingSale] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [saleProcessingQueueCount, setSaleProcessingQueueCount] = useState(0);
  const [offlineQueuedSalesCount, setOfflineQueuedSalesCount] = useState(0);
  const [showFindReceiptModal, setShowFindReceiptModal] = useState(false);
  const [showSalesHistoryModal, setShowSalesHistoryModal] = useState(false);
  const [showOfflineQueueModal, setShowOfflineQueueModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showQuickMenu, setShowQuickMenu] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [inlineStatus, setInlineStatus] = useState<{ message: string; level: InlineStatusLevel }>({
    message: 'Ready to sell',
    level: 'neutral',
  });
  const [currentShift, setCurrentShift] = useState<any | null>(null);
  const [shiftPromptMode, setShiftPromptMode] = useState<ShiftPromptMode>(null);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState('0');
  const [closingCashInput, setClosingCashInput] = useState('0');
  const [shiftNotes, setShiftNotes] = useState('');
  const [shiftError, setShiftError] = useState('');
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [activeCashier, setActiveCashier] = useState<ActiveCashierSession | null>(null);
  const [cashierSwitchOpen, setCashierSwitchOpen] = useState(false);
  const [cashierCandidateId, setCashierCandidateId] = useState('');
  const [cashierPinInput, setCashierPinInput] = useState('');
  const [cashierSwitchError, setCashierSwitchError] = useState('');
  const [cashierSwitchBusy, setCashierSwitchBusy] = useState(false);
  const branchMenuRef = useRef<HTMLDivElement | null>(null);
  const quickMenuRef = useRef<HTMLDivElement | null>(null);
  const liveCatalogRefreshLockRef = useRef(false);
  const [isUltraCompact, setIsUltraCompact] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pos.ultraCompact') === '1';
    } catch {
      return false;
    }
  });

  const normalizedRoles: string[] = Array.isArray(user?.roles)
    ? user.roles.map((role: string) => String(role).toLowerCase())
    : [];
  const normalizedPermissionKeys = (() => {
    const keys = new Set<string>();
    const addKeys = (values: unknown) => {
      if (!Array.isArray(values)) return;
      values.forEach((value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized) keys.add(normalized);
      });
    };

    addKeys((user as any)?.permissions);
    addKeys((user as any)?.effectivePermissions);
    addKeys((user as any)?.inheritedPermissions);

    return keys;
  })();
  const assignedBranchId =
    typeof user?.branchId === 'string' && user.branchId.trim().length > 0
      ? user.branchId.trim()
      : '';
  const isManagerUser =
    normalizedRoles.includes('manager') ||
    String((user as any)?.role || '').toLowerCase() === 'manager';
  const hasPosBranchLockPermission = normalizedPermissionKeys.has('pos.branch.locked');
  const isBranchLockedUser =
    !!assignedBranchId &&
    (normalizedRoles.includes('cashier') ||
      normalizedRoles.includes('staff') ||
      (isManagerUser && hasPosBranchLockPermission) ||
      String((user as any)?.role || '').toLowerCase() === 'cashier' ||
      String((user as any)?.role || '').toLowerCase() === 'staff');
  const visibleBranches =
    isBranchLockedUser && assignedBranchId
      ? (() => {
          const lockedFromList = branches.filter((branch) => branch.id === assignedBranchId);
          if (lockedFromList.length > 0) {
            return lockedFromList;
          }
          return [{ id: assignedBranchId, name: user?.branchName || 'Assigned Branch' }];
        })()
      : branches;
  const canViewReceipts =
    !!user &&
    (user.isSuperadmin ||
      user.roles?.includes('owner') ||
      user.roles?.includes('admin') ||
      user.permissions?.includes('view_sales'));
  const isPrivilegedUser =
    !!user &&
    (user.isSuperadmin ||
      normalizedRoles.includes('owner') ||
      normalizedRoles.includes('admin') ||
      String((user as any)?.role || '').toLowerCase() === 'owner' ||
      String((user as any)?.role || '').toLowerCase() === 'admin');
  const canControlMainSession =
    !!user &&
    (user.isSuperadmin ||
      normalizedRoles.includes('owner') ||
      normalizedRoles.includes('admin') ||
      normalizedRoles.includes('manager') ||
      String((user as any)?.role || '').toLowerCase() === 'owner' ||
      String((user as any)?.role || '').toLowerCase() === 'admin' ||
      String((user as any)?.role || '').toLowerCase() === 'manager');
  const requiresShiftSession = !!user && !isPrivilegedUser;
  const hasPosAccessPermission = normalizedPermissionKeys.has('pos.access');
  const canAccessPos = isPrivilegedUser || hasPosAccessPermission;
  const staffRoleName = useCallback((member: StaffUser) => {
    const fromUserRoles = Array.isArray(member.userRoles)
      ? member.userRoles[0]?.role?.name
      : undefined;
    if (fromUserRoles) return String(fromUserRoles).toLowerCase();

    const fromRoles = Array.isArray(member.roles) && member.roles.length > 0
      ? member.roles[0]
      : undefined;
    return fromRoles ? String(fromRoles).toLowerCase() : 'staff';
  }, []);

  const cashierCandidates = staffUsers.filter((member) => {
    const role = staffRoleName(member);
    return ['cashier', 'staff', 'owner', 'admin', 'manager'].includes(role);
  });
  const effectiveCashierCandidates = cashierCandidates.length > 0 ? cashierCandidates : staffUsers;
  const requiresCashierSession = isPrivilegedUser && effectiveCashierCandidates.length > 0;
  const hasActiveCashierSession = !!activeCashier?.id;
  const normalizedActiveCashierRoles = Array.isArray(activeCashier?.roles)
    ? activeCashier.roles.map((role) => String(role || '').toLowerCase())
    : [];
  const activeCashierIsManagerLike =
    normalizedActiveCashierRoles.includes('owner') ||
    normalizedActiveCashierRoles.includes('admin') ||
    normalizedActiveCashierRoles.includes('manager') ||
    normalizedActiveCashierRoles.includes('superadmin');
  const canUseLogoutControl =
    canControlMainSession && (!hasActiveCashierSession || activeCashierIsManagerLike);
  const canUseExitControl = canControlMainSession;
  const canUseSettings =
    canControlMainSession && (!hasActiveCashierSession || activeCashierIsManagerLike);
  const activeCashierLabel = activeCashier?.name || activeCashier?.email || (activeCashier?.id ? activeCashier.id.slice(0, 8) : 'None');

  const updateInlineStatus = useCallback((message: string, level: InlineStatusLevel = 'info') => {
    setInlineStatus((prev) => {
      if (prev.message === message && prev.level === level) {
        return prev;
      }

      return { message, level };
    });
  }, []);

  const lockCashierSession = useCallback((message?: string) => {
    setActiveCashier(null);
    setCashierCandidateId('');
    setCashierPinInput('');
    setCashierSwitchError('');
    setCashierSwitchOpen(true);
    if (message) {
      updateInlineStatus(message, 'warning');
    }
  }, [updateInlineStatus]);

  const requireCashierSession = useCallback((actionLabel: string) => {
    if (!requiresCashierSession) return true;
    if (activeCashier?.id) return true;

    setCashierSwitchError(`Switch to a cashier PIN session before ${actionLabel}.`);
    setCashierSwitchOpen(true);
    updateInlineStatus('Cashier session required', 'warning');
    return false;
  }, [activeCashier?.id, requiresCashierSession, updateInlineStatus]);

  const verifyAndActivateCashier = useCallback(async () => {
    const targetUserId = cashierCandidateId.trim();
    const pin = cashierPinInput.trim();

    if (!targetUserId || !pin) {
      setCashierSwitchError('Select cashier and enter PIN.');
      return;
    }

    if (typeof window.electronAPI.verifyUserPosPin !== 'function') {
      setCashierSwitchError('POS PIN verification is unavailable in this build.');
      return;
    }

    setCashierSwitchBusy(true);
    setCashierSwitchError('');
    try {
      const result = await window.electronAPI.verifyUserPosPin(targetUserId, pin);
      if (!result?.success || !result?.waiter) {
        setCashierSwitchError(result?.reason || result?.error || 'Invalid cashier PIN.');
        return;
      }

      setActiveCashier({
        id: result.waiter.id,
        name: result.waiter.name,
        email: result.waiter.email,
        roles: Array.isArray(result.waiter.roles)
          ? result.waiter.roles.map((role: string) => String(role || '').toLowerCase())
          : [],
      });
      setCashierSwitchOpen(false);
      setCashierCandidateId('');
      setCashierPinInput('');
      updateInlineStatus(`Cashier active: ${result.waiter.name || result.waiter.email || result.waiter.id}`, 'success');
      showToast('Cashier session activated.', 'success', 1800);
    } catch (error: any) {
      setCashierSwitchError(error?.message || 'Failed to verify cashier PIN.');
    } finally {
      setCashierSwitchBusy(false);
    }
  }, [cashierCandidateId, cashierPinInput, updateInlineStatus]);

  const refreshShiftStatus = useCallback(async () => {
    if (!user || typeof window.electronAPI?.getShiftStatus !== 'function') {
      return;
    }

    try {
      const result = await window.electronAPI.getShiftStatus();
      if (!result?.success) {
        return;
      }

      const openShift = result.currentShift || null;
      setCurrentShift(openShift);

      if (openShift) {
        updateInlineStatus(
          `Shift open${typeof openShift.openingCash === 'number' ? ` (float KES ${openShift.openingCash.toFixed(2)})` : ''}`,
          'success'
        );
      } else if (requiresShiftSession) {
        updateInlineStatus('Shift closed. Start shift before selling.', 'warning');
        setShiftPromptMode('open');
      }
    } catch {
      // Non-blocking: keep existing state if shift status fetch fails.
    }
  }, [user, requiresShiftSession, updateInlineStatus]);

  const handleOpenShift = useCallback(async () => {
    if (!requireCashierSession('starting shift')) {
      return;
    }

    const openingCash = Number(openingCashInput);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      setShiftError('Opening cash must be a valid non-negative number.');
      return;
    }

    setShiftBusy(true);
    setShiftError('');
    try {
      const openedByUserId = activeCashier?.id || user?.id;
      const result = await window.electronAPI.openShift({ openingCash, openedBy: openedByUserId });
      if (!result?.success) {
        setShiftError(result?.error || 'Failed to start shift.');
        return;
      }

      setCurrentShift(result.shift || { status: 'open', openingCash, openedBy: openedByUserId, openedAt: new Date().toISOString() });
      setShiftPromptMode(null);
      updateInlineStatus(`Shift started with float KES ${openingCash.toFixed(2)}`, 'success');
      showToast('Shift started successfully.', 'success', 1800);
    } catch (error: any) {
      setShiftError(error?.message || 'Failed to start shift.');
    } finally {
      setShiftBusy(false);
    }
  }, [openingCashInput, updateInlineStatus, user?.id, activeCashier?.id, requireCashierSession]);

  const handleCloseShift = useCallback(async () => {
    if (!requireCashierSession('closing shift')) {
      return;
    }

    const closingCash = Number(closingCashInput);
    if (!Number.isFinite(closingCash) || closingCash < 0) {
      setShiftError('Closing cash must be a valid non-negative number.');
      return;
    }

    setShiftBusy(true);
    setShiftError('');
    try {
      const result = await window.electronAPI.closeShift({
        closingCash,
        notes: shiftNotes.trim() || undefined,
      });

      if (!result?.success) {
        setShiftError(result?.error || 'Failed to close shift.');
        return;
      }

      setCurrentShift(null);
      setShiftPromptMode(requiresShiftSession ? 'open' : null);
      setClosingCashInput('0');
      setShiftNotes('');

      if (result.summary) {
        const variance = Number(result.summary.variance || 0);
        showToast(
          `Shift closed. Sales: ${result.summary.salesCount}, Variance: KES ${variance.toFixed(2)}`,
          variance === 0 ? 'success' : 'warning',
          5000
        );
      } else {
        showToast('Shift closed successfully.', 'success', 2000);
      }

      updateInlineStatus('Shift closed. Start next shift to continue selling.', 'warning');

      if (activeCashier?.id) {
        lockCashierSession('Shift closed. Cashier session locked for handover.');
      }
    } catch (error: any) {
      setShiftError(error?.message || 'Failed to close shift.');
    } finally {
      setShiftBusy(false);
    }
  }, [closingCashInput, shiftNotes, requiresShiftSession, updateInlineStatus, requireCashierSession, activeCashier?.id, lockCashierSession]);

  // Update in-flight sale processing queue (mutex) count.
  useEffect(() => {
    const updateQueueCount = () => {
      const status = saleMutex.getStatus();
      setSaleProcessingQueueCount(status.queueSize);
    };

    // Update immediately
    updateQueueCount();

    // Update periodically if processing or queue exists
    const interval = setInterval(updateQueueCount, 500); // Update every 500ms
    return () => clearInterval(interval);
  }, [processingSale]);

  // Update offline sales queue count from backend sync status.
  useEffect(() => {
    let mounted = true;

    const refreshOfflineQueueCount = async () => {
      try {
        const status = await window.electronAPI.getSyncStatus();
        if (!mounted || !status) return;

        const pendingSales = typeof status.pendingSalesSyncs === 'number'
          ? status.pendingSalesSyncs
          : status.pendingSyncs;
        setOfflineQueuedSalesCount(Math.max(0, pendingSales || 0));

        if (!status.online) {
          updateInlineStatus('Offline mode: sales are queued locally', 'warning');
        } else if ((pendingSales || 0) > 0) {
          updateInlineStatus(`${Math.max(0, pendingSales || 0)} sales waiting to sync`, 'info');
        }
      } catch {
        // Keep previous value when status fetch fails.
      }
    };

    void refreshOfflineQueueCount();
    const interval = setInterval(() => {
      void refreshOfflineQueueCount();
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [updateInlineStatus]);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadStaffUsers = async () => {
      if (typeof window.electronAPI.getUsers !== 'function') {
        return;
      }

      try {
        const res = await window.electronAPI.getUsers();
        if (res?.success && Array.isArray(res.users)) {
          setStaffUsers(res.users);
        }
      } catch {
        // Non-blocking: keep existing user list.
      }
    };

    void loadStaffUsers();
    const interval = window.setInterval(() => {
      void loadStaffUsers();
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ACTIVE_CASHIER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.id && typeof parsed.id === 'string') {
        setActiveCashier({
          id: parsed.id,
          name: parsed.name,
          email: parsed.email,
          roles: Array.isArray(parsed.roles)
            ? parsed.roles.map((role: string) => String(role || '').toLowerCase())
            : [],
        });
      }
    } catch {
      // Ignore malformed cache.
    }
  }, []);

  useEffect(() => {
    if (activeCashier) {
      window.localStorage.setItem(ACTIVE_CASHIER_STORAGE_KEY, JSON.stringify(activeCashier));
    } else {
      window.localStorage.removeItem(ACTIVE_CASHIER_STORAGE_KEY);
    }
  }, [activeCashier]);

  useEffect(() => {
    if (requiresCashierSession && !activeCashier?.id) {
      setCashierSwitchOpen(true);
      updateInlineStatus('Cashier PIN check-in required', 'warning');
    }
  }, [requiresCashierSession, activeCashier?.id, updateInlineStatus]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(event.target as Node)) {
        setShowBranchMenu(false);
      }
      if (quickMenuRef.current && !quickMenuRef.current.contains(event.target as Node)) {
        setShowQuickMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('pos.ultraCompact', isUltraCompact ? '1' : '0');
    } catch {
      // Ignore persistence issues in restricted environments.
    }
  }, [isUltraCompact]);

  // Load branches on mount and when user changes
  useEffect(() => {
    const loadBranches = async () => {
      const fallbackLockedBranch =
        isBranchLockedUser && assignedBranchId
          ? [{ id: assignedBranchId, name: user?.branchName || 'Assigned Branch' }]
          : [];

      try {
        const response = await window.electronAPI.getBranches();
        if (response.success && response.branches) {
          const normalizedBranches = response.branches.map((branch) => ({
            ...branch,
            name:
              (typeof branch?.name === 'string' && branch.name.trim()) ||
              (branch?.id === assignedBranchId && user?.branchName) ||
              'Assigned Branch',
          }));

          const availableBranches = isBranchLockedUser && assignedBranchId
            ? normalizedBranches.filter((branch) => branch.id === assignedBranchId)
            : normalizedBranches;

          const effectiveBranches =
            isBranchLockedUser && assignedBranchId && availableBranches.length === 0
              ? [{ id: assignedBranchId, name: user?.branchName || 'Assigned Branch' }]
              : availableBranches;

          setBranches(effectiveBranches);
          
          // Set default branch: user's branchId or first available branch
          if (!selectedBranch && effectiveBranches.length > 0) {
            const defaultBranchId = assignedBranchId || effectiveBranches[0]?.id;
            if (defaultBranchId) {
              setSelectedBranch(defaultBranchId);
            }
          }

          if (isBranchLockedUser && assignedBranchId && selectedBranch !== assignedBranchId) {
            setSelectedBranch(assignedBranchId);
          }
        } else if (fallbackLockedBranch.length > 0) {
          setBranches(fallbackLockedBranch);
          if (selectedBranch !== assignedBranchId) {
            setSelectedBranch(assignedBranchId);
          }
        }
      } catch (error) {
        console.error('Failed to load branches:', error);
        if (fallbackLockedBranch.length > 0) {
          setBranches(fallbackLockedBranch);
          if (selectedBranch !== assignedBranchId) {
            setSelectedBranch(assignedBranchId);
          }
        }
      }
    };

    if (user) {
      loadBranches();
    }
  }, [user, isBranchLockedUser, assignedBranchId, selectedBranch]);

  useEffect(() => {
    if (isBranchLockedUser && assignedBranchId && selectedBranch !== assignedBranchId) {
      setSelectedBranch(assignedBranchId);
    }
  }, [isBranchLockedUser, assignedBranchId, selectedBranch]);

  useEffect(() => {
    if (isBranchLockedUser && showBranchMenu) {
      setShowBranchMenu(false);
    }
  }, [isBranchLockedUser, showBranchMenu]);

  useEffect(() => {
    void refreshShiftStatus();
  }, [refreshShiftStatus]);

  useEffect(() => {
    loadProducts(0);
  }, [selectedBranch]);

  // Check catalog sync status periodically and show warning if stale
  useEffect(() => {
    const checkCatalogStatus = async () => {
      try {
        const status = await (window as any).electronAPI.getCatalogSyncStatus();
        if (status.success && status.isStale && status.hasCatalog) {
          updateInlineStatus(`Catalog is ${status.ageHours?.toFixed(1)}h old. Sync recommended.`, 'warning');
        }
      } catch (error) {
        // Silently fail - not critical
      }
    };

    // Check immediately and then every 5 minutes
    checkCatalogStatus();
    const interval = setInterval(checkCatalogStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [updateInlineStatus]);

  // Keyboard shortcuts (only when not typing in an input)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;

      if (e.key === 'F2') {
        e.preventDefault();
        if (currentStep === 'products' && cart.length > 0) handleProceedToCheckout();
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (currentStep === 'receipt') handleNewSale();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (currentStep === 'checkout') handleBackToProducts();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, cart.length]);

  const loadProducts = async (retryCount: number = 0) => {
    try {
      setLoading(true);

      // Check if user is authenticated before loading products
      const token = await window.electronAPI.getAuthToken();
      if (!token) {
        handleError(
          new AppError('Authentication token not found', 'TOKEN_EXPIRED', {
            operation: 'loadProducts',
            component: 'POS',
            userId: user?.id,
            userName: user?.name,
          }),
          {
            operation: 'loadProducts',
            component: 'POS',
            userId: user?.id,
            userName: user?.name,
          },
          {
            fallbackAction: ErrorRecovery.redirectToLogin,
          }
        );
        return;
      }

      const response = await handleNetworkOperation(
        () => window.electronAPI.getProducts(selectedBranch || undefined) as Promise<ProductsResponse>,
        {
          operation: 'loadProducts',
          component: 'POS',
          userId: user?.id,
          userName: user?.name,
        },
        {
          maxRetries: 2,
          showRetryToast: true,
        }
      );

      if (response.success) {
        setProducts(response.products || []);
        updateInlineStatus(`Catalog ready: ${(response.products || []).length} products loaded`, 'success');
      } else {
        // Handle specific error cases
        if (response.error === 'Unauthorized' || response.error?.includes('token') || response.error?.includes('auth')) {
          handleError(
            new AppError('Session expired', 'UNAUTHORIZED', {
              operation: 'loadProducts',
              component: 'POS',
              userId: user?.id,
              userName: user?.name,
            }),
            {
              operation: 'loadProducts',
              component: 'POS',
            },
            {
              fallbackAction: ErrorRecovery.redirectToLogin,
            }
          );
        } else {
          // Try to use cached products as fallback
          const cachedProducts = ErrorRecovery.useCache('cachedProducts', []);
          if (cachedProducts.length > 0) {
            setProducts(cachedProducts);
            updateInlineStatus('Using cached catalog. Data may be outdated.', 'warning');
          } else {
            handleError(
              new AppError(response.error || 'Failed to load products', 'PRODUCTS_LOAD_FAILED', {
                operation: 'loadProducts',
                component: 'POS',
                userId: user?.id,
                userName: user?.name,
              }),
              {
                operation: 'loadProducts',
                component: 'POS',
              },
              {
                retryable: true,
                maxRetries: 2,
                fallbackAction: () => {
                  if (retryCount < 2) {
                    setTimeout(() => loadProducts(retryCount + 1), 3000);
                  }
                },
              }
            );
            setProducts([]);
          }
        }
      }
    } catch (error) {
      // Try to use cached products as fallback
      const cachedProducts = ErrorRecovery.useCache('cachedProducts', []);
      if (cachedProducts.length > 0) {
        setProducts(cachedProducts);
        updateInlineStatus('Connection issue: using cached catalog.', 'warning');
      } else {
        handleError(error, {
          operation: 'loadProducts',
          component: 'POS',
          userId: user?.id,
          userName: user?.name,
        }, {
          retryable: true,
          maxRetries: 2,
          fallbackAction: () => {
            if (retryCount < 2) {
              setTimeout(() => loadProducts(retryCount + 1), 3000);
            }
          },
        });
        setProducts([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const runLiveCatalogRefresh = useCallback(async (source: 'manual' | 'auto' = 'auto') => {
    const hasBlockingUiState =
      processingSale ||
      showFindReceiptModal ||
      showSalesHistoryModal ||
      currentStep !== 'products';

    if (source === 'auto' && hasBlockingUiState) {
      return;
    }

    if (liveCatalogRefreshLockRef.current) {
      return;
    }

    liveCatalogRefreshLockRef.current = true;

    try {
      const syncStatus = await window.electronAPI.getSyncStatus();
      if (!syncStatus?.online) {
        return;
      }

      const syncResult = await window.electronAPI.syncProducts();
      if (syncResult?.success && Array.isArray(syncResult.products)) {
        setProducts(syncResult.products);
        updateInlineStatus(`Catalog synced: ${syncResult.products.length} products`, 'success');
      } else if (source === 'manual') {
        showToast(syncResult?.error || 'Unable to refresh catalog right now.', 'error', 0, {
          label: 'Retry',
          onClick: () => {
            void loadProducts(0);
          },
        });
      }
    } catch {
      if (source === 'manual') {
        showToast('Unable to refresh catalog right now.', 'error', 0, {
          label: 'Retry',
          onClick: () => {
            void loadProducts(0);
          },
        });
      }
    } finally {
      liveCatalogRefreshLockRef.current = false;
    }
  }, [processingSale, showFindReceiptModal, showSalesHistoryModal, currentStep, updateInlineStatus]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void runLiveCatalogRefresh('auto');
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [runLiveCatalogRefresh]);

  useEffect(() => {
    const handleFocusRefresh = () => {
      void runLiveCatalogRefresh('auto');
    };

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        void runLiveCatalogRefresh('auto');
      }
    };

    const handleOnlineRefresh = () => {
      void runLiveCatalogRefresh('auto');
    };

    window.addEventListener('focus', handleFocusRefresh);
    window.addEventListener('online', handleOnlineRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);

    return () => {
      window.removeEventListener('focus', handleFocusRefresh);
      window.removeEventListener('online', handleOnlineRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
    };
  }, [runLiveCatalogRefresh]);

  const addToCart = (product: Product) => {
    // Validate price first
    const priceValidation = validatePrice(product.price);
    if (!priceValidation.isValid) {
      showToast(`Cannot add ${product.name}: ${priceValidation.error}`, 'error');
      auditLogger.log(
        AuditEventType.DATA_VALIDATION_FAILED,
        { productId: product.id, productName: product.name, reason: priceValidation.error },
        'medium',
        user?.id,
        user?.name
      );
      return;
    }

    // Validate stock
    setCart(prevCart => {
      const existing = prevCart.find(item => item.product.id === product.id);
      const currentCartQuantity = existing ? existing.quantity : 0;
      const requestedQuantity = currentCartQuantity + 1;

      const stockValidation = validateStock(product, 1, currentCartQuantity);
      if (!stockValidation.isValid) {
        showToast(stockValidation.error || 'Insufficient stock', 'error');
        auditLogger.log(
          AuditEventType.DATA_VALIDATION_FAILED,
          { productId: product.id, productName: product.name, reason: stockValidation.error },
          'medium',
          user?.id,
          user?.name
        );
        return prevCart; // Don't modify cart
      }

      if (existing) {
        return prevCart.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1, reservedAt: item.reservedAt || Date.now() }
            : item
        );
      }
      return [...prevCart, { product, quantity: 1, reservedAt: Date.now() }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prevCart => prevCart.filter(item => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    setCart(prevCart => {
      const item = prevCart.find(cartItem => cartItem.product.id === productId);
      if (!item) return prevCart;

      // Validate stock for the new quantity
      const stockValidation = validateStock(item.product, quantity, 0);
      if (!stockValidation.isValid) {
        showToast(stockValidation.error || 'Insufficient stock', 'error');
        auditLogger.log(
          AuditEventType.DATA_VALIDATION_FAILED,
          { productId, productName: item.product.name, requestedQuantity: quantity, reason: stockValidation.error },
          'medium',
          user?.id,
          user?.name
        );
        return prevCart; // Don't modify cart
      }

      return prevCart.map(cartItem =>
        cartItem.product.id === productId
          ? { ...cartItem, quantity, reservedAt: cartItem.reservedAt || Date.now() }
          : cartItem
      );
    });
  };

  const getTotal = () => {
    return cart.reduce((total, item) => total + (item.product.price * item.quantity), 0);
  };

  const getVAT = () => {
    return 0;
  };

  const getGrandTotal = () => {
    return getTotal();
  };

  const handleProceedToCheckout = () => {
    if (!requireCashierSession('proceeding to checkout')) {
      return;
    }

    if (requiresShiftSession && !currentShift) {
      setShiftPromptMode('open');
      updateInlineStatus('Start shift before checkout.', 'warning');
      showToast('Start shift before proceeding to checkout.', 'warning', 3000);
      return;
    }

    setCurrentStep('checkout');
  };

  const handleBackToProducts = () => {
    setCurrentStep('products');
  };

  const handleCompleteSale = async (paymentData: PaymentData) => {
    if (!requireCashierSession('completing sale')) {
      return;
    }

    if (requiresShiftSession && !currentShift) {
      setShiftPromptMode('open');
      updateInlineStatus('Shift required before sale completion.', 'warning');
      showToast('Shift is not open. Start shift to continue.', 'warning', 3500);
      return;
    }

    // Use mutex to prevent concurrent sale processing
    try {
      await saleMutex.acquire(paymentData, async (queuedPaymentData) => {
        setProcessingSale(true);
        setSaleProcessingQueueCount(saleMutex.getQueueSize());

        try {
          // Check if user is authenticated and has token
          const token = await window.electronAPI.getAuthToken();
          if (!token) {
            handleError(
              new AppError('Authentication token not found', 'TOKEN_EXPIRED', {
                operation: 'completeSale',
                component: 'POS',
                userId: user?.id,
                userName: user?.name,
              }),
              {
                operation: 'completeSale',
                component: 'POS',
                userId: user?.id,
                userName: user?.name,
              },
              {
                fallbackAction: ErrorRecovery.redirectToLogin,
              }
            );
            return;
          }

          // Debug logging for branch information
          console.log('🔍 Branch Debug Info:');
          console.log('  - User branchId:', user?.branchId);
          console.log('  - User branchName:', user?.branchName);
          console.log('  - Selected branch:', selectedBranch);
          console.log('  - Available branches:', branches.length);
          console.log('  - User object:', user);

          // Prioritize selectedBranch over user.branchId (user explicitly selected a branch)
          // Fallback to user.branchId if no branch is selected
          const branchId = isBranchLockedUser
            ? assignedBranchId
            : selectedBranch || user?.branchId;
          console.log('  - Final branchId to use:', branchId);

          // If there are branches, require a selection; if there are no branches at all,
          // allow the sale to proceed without a branchId (backend treats branch as optional).
          if (!branchId && branches.length > 0) {
            const errorMessage = 'Please select a branch before completing the sale.';

            handleError(
              new AppError(errorMessage, 'VALIDATION_ERROR', {
                operation: 'completeSale',
                component: 'POS',
                userId: user?.id,
                userName: user?.name,
                metadata: { branchId, userBranchId: user?.branchId, selectedBranch, branchesCount: branches.length },
              }),
              {
                operation: 'completeSale',
                component: 'POS',
                userId: user?.id,
                userName: user?.name,
              }
            );
            return;
          }

          // Validate all cart items before proceeding
          for (const item of cart) {
            // Check if this is a variation product and get correct stock
            const isVariation = !!(item.product as any).baseProductId || !!(item.product as any).variationId;
            let availableStock = item.product.stock || 0;
            
            if (isVariation) {
              // For variations, find the base product and then the variation
              const baseProductId = (item.product as any).baseProductId;
              const variationId = (item.product as any).variationId || item.product.id;
              const baseProduct = products.find(p => p.id === baseProductId);
              
              if (baseProduct) {
                const variation = baseProduct.variations?.find((v: any) => v.id === variationId);
                if (variation) {
                  availableStock = variation.stock || 0;
                } else {
                  handleError(
                    new AppError(`${item.product.name} (variation) is no longer available`, 'INSUFFICIENT_STOCK', {
                      operation: 'completeSale',
                      component: 'POS',
                      userId: user?.id,
                      userName: user?.name,
                      metadata: {
                        productId: item.product.id,
                        baseProductId,
                        variationId,
                        productName: item.product.name,
                      },
                    }),
                    {
                      operation: 'completeSale',
                      component: 'POS',
                      userId: user?.id,
                      userName: user?.name,
                    }
                  );
                  return;
                }
              } else {
                handleError(
                  new AppError(`${item.product.name} (base product) is no longer available`, 'INSUFFICIENT_STOCK', {
                    operation: 'completeSale',
                    component: 'POS',
                    userId: user?.id,
                    userName: user?.name,
                    metadata: {
                      productId: item.product.id,
                      baseProductId,
                      productName: item.product.name,
                    },
                  }),
                  {
                    operation: 'completeSale',
                    component: 'POS',
                    userId: user?.id,
                    userName: user?.name,
                  }
                );
                return;
              }
            } else {
              // For regular products, verify it still exists
              const currentProduct = products.find(p => p.id === item.product.id);
              if (!currentProduct) {
                handleError(
                  new AppError(`${item.product.name} is no longer available`, 'INSUFFICIENT_STOCK', {
                    operation: 'completeSale',
                    component: 'POS',
                    userId: user?.id,
                    userName: user?.name,
                    metadata: {
                      productId: item.product.id,
                      productName: item.product.name,
                    },
                  }),
                  {
                    operation: 'completeSale',
                    component: 'POS',
                    userId: user?.id,
                    userName: user?.name,
                  }
                );
                return;
              }
              availableStock = currentProduct.stock || 0;
            }
            
            // Validate stock using the correct available stock
            if (availableStock < item.quantity) {
              handleError(
                new AppError(`${item.product.name}: Only ${availableStock} available, but ${item.quantity} requested`, 'INSUFFICIENT_STOCK', {
                  operation: 'completeSale',
                  component: 'POS',
                  userId: user?.id,
                  userName: user?.name,
                  metadata: {
                    productId: item.product.id,
                    productName: item.product.name,
                    requestedQuantity: item.quantity,
                    availableStock,
                  },
                }),
                {
                  operation: 'completeSale',
                  component: 'POS',
                  userId: user?.id,
                  userName: user?.name,
                }
              );
              return;
            }

            const priceValidation = validatePrice(item.product.price);
            if (!priceValidation.isValid) {
              handleError(
                new AppError(`${item.product.name}: ${priceValidation.error}`, 'INVALID_PRICE', {
                  operation: 'completeSale',
                  component: 'POS',
                  userId: user?.id,
                  userName: user?.name,
                  metadata: {
                    productId: item.product.id,
                    productName: item.product.name,
                    price: item.product.price,
                  },
                }),
                {
                  operation: 'completeSale',
                  component: 'POS',
                  userId: user?.id,
                  userName: user?.name,
                }
              );
              return;
            }
          }

          // Prepare sale data (discount is sent as a separate field)
          // For variation items: productId = base product, variationId = variation
          // Ensure all numeric fields are numbers for backend validation
          const saleData = {
        items: cart.map(item => {
          const productPrice = item.product.price;
          const priceValue = (productPrice != null && !isNaN(Number(productPrice)))
            ? Number(productPrice)
            : 0; // fallback to 0 if price is missing or invalid

          const base: { productId: string; quantity: number; price: number; variationId?: string } = {
            productId: (item.product as any).baseProductId || item.product.id,
            quantity: Number(item.quantity) || 1,
            price: priceValue,
          };

          if ((item.product as any).variationId) {
            base.variationId = (item.product as any).variationId;
          }
          return base;
        }),
        paymentMethod: String(paymentData.paymentMethod || 'cash'),
        amountReceived: paymentData.amountReceived != null ? Number(paymentData.amountReceived) : undefined,
        customerName: paymentData.customerName || undefined,
        customerPhone: paymentData.customerPhone || undefined,
        branchId: branchId || undefined,
        idempotencyKey: `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...(paymentData.discountAmount != null && paymentData.discountAmount > 0 && {
          discountAmount: Number(paymentData.discountAmount),
        }),
      };
      
          // Remove undefined values to avoid sending them (backend ValidationPipe forbids non-whitelisted)
          // Also ensure all types match backend DTO expectations
          const cleanSaleData: any = {};
          
          // Required fields
          cleanSaleData.items = saleData.items;
          cleanSaleData.paymentMethod = String(saleData.paymentMethod);
          cleanSaleData.idempotencyKey = String(saleData.idempotencyKey);
          
          // Optional fields - only include if they have values
          // SECURITY: Sanitize all user inputs before sending to backend
          if (saleData.branchId) cleanSaleData.branchId = String(saleData.branchId);
          if (saleData.customerName) cleanSaleData.customerName = sanitizeCustomerName(saleData.customerName);
          if (saleData.customerPhone) cleanSaleData.customerPhone = sanitizePhoneNumber(saleData.customerPhone);
          if (saleData.amountReceived != null) cleanSaleData.amountReceived = Number(saleData.amountReceived);
          if (saleData.discountAmount != null && saleData.discountAmount > 0) {
            cleanSaleData.discountAmount = Number(saleData.discountAmount);
          }
          if (activeCashier?.id) {
            cleanSaleData.cashierId = String(activeCashier.id);
          }

          if (paymentData.managerOverride) {
            cleanSaleData.managerOverride = {
              approvedByUserId: String(paymentData.managerOverride.approvedByUserId || ''),
              approvedByName: paymentData.managerOverride.approvedByName
                ? String(paymentData.managerOverride.approvedByName)
                : undefined,
              approvalReason: String(paymentData.managerOverride.approvalReason || ''),
              approvalPin: String(paymentData.managerOverride.approvalPin || ''),
            };
          }
          
          // Split payment fields
          if (paymentData.isSplitPayment && paymentData.splitPayments && paymentData.splitPayments.length > 0) {
            cleanSaleData.isSplitPayment = true;
            cleanSaleData.splitPayments = paymentData.splitPayments.map(payment => {
              const splitPayment: any = {
                method: payment.method,
                amount: Number(payment.amount),
              };
              
              if (payment.method === 'cash' && payment.amountReceived != null) {
                splitPayment.amountReceived = Number(payment.amountReceived);
              }
              
              if (payment.method === 'mpesa') {
                if (payment.mpesaTransactionId) {
                  splitPayment.mpesaTransactionId = String(payment.mpesaTransactionId);
                }
                if (payment.mpesaReceipt) {
                  splitPayment.mpesaReceipt = String(payment.mpesaReceipt);
                }
              }
              
              if (payment.method === 'credit') {
                if (payment.creditDueDate) {
                  const dateStr = String(payment.creditDueDate);
                  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    splitPayment.creditDueDate = dateStr;
                  } else {
                    try {
                      const date = new Date(dateStr);
                      if (!isNaN(date.getTime())) {
                        splitPayment.creditDueDate = date.toISOString().split('T')[0];
                      } else {
                        splitPayment.creditDueDate = dateStr;
                      }
                    } catch {
                      splitPayment.creditDueDate = dateStr;
                    }
                  }
                }
                if (payment.creditNotes) {
                  splitPayment.creditNotes = String(payment.creditNotes);
                }
              }
              
              return splitPayment;
            });
          } else {
            // Credit-specific fields - only include if payment method is credit
            if (paymentData.paymentMethod === 'credit') {
              const creditAmount = paymentData.creditAmount ?? getGrandTotal();
              if (creditAmount != null) {
                cleanSaleData.creditAmount = Number(creditAmount);
              }
              if (paymentData.creditDueDate) {
                // Ensure date is in ISO format (YYYY-MM-DD) for backend validation
                const dateStr = String(paymentData.creditDueDate);
                // If it's already in YYYY-MM-DD format, use it; otherwise try to parse and format
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                  cleanSaleData.creditDueDate = dateStr;
                } else {
                  // Try to parse and format as ISO date string
                  try {
                    const date = new Date(dateStr);
                    if (!isNaN(date.getTime())) {
                      cleanSaleData.creditDueDate = date.toISOString().split('T')[0]; // YYYY-MM-DD format
                    } else {
                      cleanSaleData.creditDueDate = dateStr; // Fallback to original string
                    }
                  } catch {
                    cleanSaleData.creditDueDate = dateStr; // Fallback to original string
                  }
                }
              }
              if (paymentData.creditNotes) {
                cleanSaleData.creditNotes = sanitizeNotes(paymentData.creditNotes);
              }
            }
          }

          // Validate sale data integrity
          const saleValidation = validateSaleData(cleanSaleData);
          if (!saleValidation.isValid) {
            handleError(
              new AppError(saleValidation.error || 'Sale data validation failed', 'VALIDATION_ERROR', {
                operation: 'completeSale',
                component: 'POS',
                userId: user?.id,
                userName: user?.name,
                metadata: { saleData: cleanSaleData },
              }),
              {
                operation: 'completeSale',
                component: 'POS',
                userId: user?.id,
                userName: user?.name,
              }
            );
            return;
          }

          // Log sale creation attempt
          auditLogger.log(
            AuditEventType.SALE_CREATED,
            {
              itemCount: cart.length,
              totalAmount: getGrandTotal(),
              paymentMethod: paymentData.paymentMethod,
              branchId,
            },
            'medium',
            user?.id,
            user?.name
          );

          console.log('Creating sale:', {
            items: cleanSaleData.items.map((item: any) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
              variationId: item.variationId,
            })),
            paymentMethod: cleanSaleData.paymentMethod,
            branchId: cleanSaleData.branchId,
            idempotencyKey: cleanSaleData.idempotencyKey,
            amountReceived: cleanSaleData.amountReceived,
            discountAmount: cleanSaleData.discountAmount,
            customerName: cleanSaleData.customerName,
            customerPhone: cleanSaleData.customerPhone,
            creditAmount: cleanSaleData.creditAmount,
            creditDueDate: cleanSaleData.creditDueDate,
            creditNotes: cleanSaleData.creditNotes,
          });

          // CRITICAL: Re-validate stock before completing sale to prevent race conditions
          // Stock may have changed since items were added to cart (pessimistic locking)
          const stockValidationErrors: string[] = [];
          const lowStockItems: string[] = [];
          
          for (const cartItem of cart) {
            // Check if this is a variation product
            const isVariation = !!(cartItem.product as any).baseProductId || !!(cartItem.product as any).variationId;
            const variationId = (cartItem.product as any).variationId || cartItem.product.id;
            const baseProductId = (cartItem.product as any).baseProductId || cartItem.product.id;
            
            let currentProduct: Product | undefined;
            let availableStock = 0;
            
            if (isVariation) {
              // For variations, find the base product first
              const baseProduct = products.find(p => p.id === baseProductId);
              if (!baseProduct) {
                stockValidationErrors.push(`${cartItem.product.name} (base product) is no longer available`);
                continue;
              }
              
              // Find the specific variation within the base product
              const variation = baseProduct.variations?.find((v: any) => v.id === variationId);
              if (!variation) {
                stockValidationErrors.push(`${cartItem.product.name} (variation) is no longer available`);
                continue;
              }
              
              // Use variation's stock
              availableStock = variation.stock || 0;
              currentProduct = {
                ...baseProduct,
                id: variationId,
                stock: availableStock,
                price: variation.price ?? baseProduct.price,
              };
            } else {
              // For regular products, find by product ID
              currentProduct = products.find(p => p.id === cartItem.product.id);
              if (!currentProduct) {
                stockValidationErrors.push(`${cartItem.product.name} is no longer available`);
                continue;
              }
              availableStock = currentProduct.stock || 0;
            }
            
            // Check if stock is still sufficient (considering items already in cart)
            if (availableStock < cartItem.quantity) {
              stockValidationErrors.push(
                `${cartItem.product.name}: Only ${availableStock} available, but ${cartItem.quantity} requested`
              );
            }
            
            // Pessimistic locking: For low-stock items (≤5 units), be more strict
            // Refresh stock from backend if item is low-stock to prevent overselling
            if (availableStock <= 5 && cartItem.quantity > 0) {
              lowStockItems.push(cartItem.product.name);
            }
            
            // Check if item reservation is still valid (expires after 5 minutes)
            // For low-stock items, reservations expire faster (2 minutes)
            if (cartItem.reservedAt) {
              const reservationAge = Date.now() - cartItem.reservedAt;
              const reservationExpiry = availableStock <= 5 
                ? 2 * 60 * 1000  // 2 minutes for low-stock items
                : 5 * 60 * 1000; // 5 minutes for normal items
              if (reservationAge > reservationExpiry) {
                stockValidationErrors.push(
                  `${cartItem.product.name}: Reservation expired. Please refresh and try again.`
                );
              }
            }
          }
          
          // For low-stock items, refresh products from backend before completing sale
          // This implements pessimistic locking by ensuring we have the latest stock
          if (lowStockItems.length > 0) {
            console.log(`Refreshing products for low-stock items: ${lowStockItems.join(', ')}`);
            try {
              // Refresh products and wait for state update
              const refreshResponse = await window.electronAPI.getProducts(selectedBranch || undefined);
              if (refreshResponse.success && refreshResponse.products) {
                setProducts(refreshResponse.products);
                // Re-check stock after refresh using refreshed products
                for (const cartItem of cart) {
                  const isVariation = !!(cartItem.product as any).baseProductId || !!(cartItem.product as any).variationId;
                  const variationId = (cartItem.product as any).variationId || cartItem.product.id;
                  const baseProductId = (cartItem.product as any).baseProductId || cartItem.product.id;
                  
                  if (isVariation) {
                    // For variations, find base product and then the variation
                    const baseProduct = refreshResponse.products.find((p: Product) => p.id === baseProductId);
                    if (baseProduct) {
                      const variation = baseProduct.variations?.find((v: any) => v.id === variationId);
                      if (variation && (variation.stock || 0) < cartItem.quantity) {
                        stockValidationErrors.push(
                          `${cartItem.product.name}: Stock changed during checkout. Only ${variation.stock} available now.`
                        );
                      }
                    }
                  } else {
                    // For regular products
                    const refreshedProduct = refreshResponse.products.find((p: Product) => p.id === cartItem.product.id);
                    if (refreshedProduct && (refreshedProduct.stock || 0) < cartItem.quantity) {
                      stockValidationErrors.push(
                        `${cartItem.product.name}: Stock changed during checkout. Only ${refreshedProduct.stock} available now.`
                      );
                    }
                  }
                }
              }
            } catch (refreshError) {
              console.warn('Failed to refresh products before sale (non-critical)', refreshError);
              // Continue with sale - backend will validate stock
            }
          }
          
          if (stockValidationErrors.length > 0) {
            showToast(
              `Stock validation failed: ${stockValidationErrors.join('; ')}. Please refresh products and try again.`,
              'error',
              8000
            );
            // Refresh products to get latest stock
            await loadProducts(0);
            return;
          }

          // Use network operation handler with retry logic
          const response = await handleNetworkOperation(
        () => (window as any).electronAPI.createSale(cleanSaleData),
        {
          operation: 'createSale',
          component: 'POS',
          userId: user?.id,
          userName: user?.name,
          metadata: {
            itemCount: cart.length,
            totalAmount: getGrandTotal(),
            paymentMethod: paymentData.paymentMethod,
          },
        },
        {
          maxRetries: 2,
          showRetryToast: true,
            }
          );

          // Assert the type of response
          const saleResponse = response as {
            success: boolean;
            sale?: any;
            receipt?: any;
            error?: string;
            queueSize?: number;
            maxQueueSize?: number;
            isCritical?: boolean;
            isWarning?: boolean;
          };

          if (saleResponse.success) {
            console.log('Sale completed successfully:', saleResponse.sale);
            
            // Check for queue warnings if sale was queued offline
            if (saleResponse.queueSize !== undefined) {
              setOfflineQueuedSalesCount(Math.max(0, saleResponse.queueSize));
              if (saleResponse.isCritical) {
                showToast(
                  `Offline queue is full (${saleResponse.queueSize}/${saleResponse.maxQueueSize}).`,
                  'error',
                  0,
                  {
                    label: 'View queue',
                    onClick: () => {
                      setShowOfflineQueueModal(true);
                    },
                  }
                );
                updateInlineStatus(`Offline queue full (${saleResponse.queueSize}/${saleResponse.maxQueueSize})`, 'error');
              } else if (saleResponse.isWarning) {
                updateInlineStatus(`Large offline queue: ${saleResponse.queueSize} sales pending`, 'warning');
              }
            }
            
            // CRITICAL: Refresh products from backend after successful sale to get accurate stock
            // The backend has already updated stock, so we need fresh data to prevent race conditions
            try {
              console.log('Refreshing products after successful sale');
              await loadProducts(0);
              updateInlineStatus('Stock refreshed after sale', 'success');
            } catch (error) {
              console.warn('Failed to refresh products after sale (non-critical)', error);
              // Don't fail the sale if refresh fails - will sync on next periodic sync
            }

            // Validate receipt number and transaction integrity
            const typedResponse = response as {
              receipt?: { saleId?: string; [key: string]: any };
              [key: string]: any;
            };
            if (typedResponse.receipt?.saleId) {
              const receiptNumberValidation = validateReceiptNumber(typedResponse.receipt.saleId);
              if (!receiptNumberValidation.isValid) {
                showToast('Warning: Receipt number validation issue detected', 'warning');
                auditLogger.log(
                  AuditEventType.SECURITY_VIOLATION,
                  { receiptId: typedResponse.receipt.saleId, reason: receiptNumberValidation.error },
                  'high',
                  user?.id,
                  user?.name
                );
              }

              // Re-validate sale data for integrity check
              const integrityCheck = validateSaleData(saleData);
              if (!integrityCheck.isValid) {
                showToast('Warning: Transaction integrity check failed', 'warning');
                auditLogger.log(
                  AuditEventType.SECURITY_VIOLATION,
                  { receiptId: typedResponse.receipt.saleId, reason: integrityCheck.error },
                  'high',
                  user?.id,
                  user?.name
                );
              }
            }

            // Log successful sale completion
            auditLogger.log(
              AuditEventType.SALE_COMPLETED,
              {
                saleId: (response as any).sale?.saleId || (response as any).receipt?.saleId,
                itemCount: cart.length,
                totalAmount: getGrandTotal(),
                paymentMethod: paymentData.paymentMethod,
                branchId,
              },
              'medium',
              user?.id,
              user?.name
            );

            // Clear cart
            setCart([]);

            const branchFromList = branchId ? branches.find((b) => b.id === branchId) : undefined;
            const saleId = response.receipt?.saleId || response.sale?.saleId;

            // Prefer full receipt from GET /sales/:id/receipt so we always get businessInfo (name, KRA, etc.)
            let receiptToShow = response.receipt;
            try {
              const getReceiptResult = await (window as any).electronAPI?.getReceipt?.(saleId);
              if (getReceiptResult?.success && getReceiptResult?.receipt) {
                receiptToShow = getReceiptResult.receipt;
                console.log('✅ Got full receipt from getReceipt:', { branch: receiptToShow?.branch, saleId });
              } else {
                console.warn('⚠️ getReceipt returned no data, using createSale response. Branch from createSale:', response.receipt?.branch);
              }
            } catch (_) {
              // Keep create-sale receipt if fetch fails
              console.warn('⚠️ getReceipt call failed, using createSale response. Branch from createSale:', response.receipt?.branch);
            }

            const backendBiz = receiptToShow?.businessInfo;
            const receiptWithBranch = {
              ...receiptToShow,
              amountReceived: response.receipt?.amountReceived ?? receiptToShow?.amountReceived,
              change: response.receipt?.change ?? receiptToShow?.change,
              businessInfo: {
                name: user?.tenantName || 'Business',
                address: user?.branchAddress,
                phone: user?.phone,
                email: user?.email,
                ...backendBiz,
                name: backendBiz?.name || user?.tenantName || 'Business',
                address: backendBiz?.address ?? user?.branchAddress,
                phone: backendBiz?.phone ?? user?.phone,
                email: backendBiz?.email ?? user?.email,
              },
              branch: receiptToShow?.branch || (branchId ? {
                id: branchId,
                name: branchFromList?.name || user?.branchName || `Branch ${branchId}`,
                address: branchFromList?.address || user?.branchAddress,
              } : undefined),
            };
            setCurrentReceipt(receiptWithBranch);
            setCurrentStep('receipt');

            // Reload products to update stock
            loadProducts(0);
          } else {
            const errorMsg = (typeof response === 'object' && response !== null && 'error' in response)
              ? (response as { error?: string }).error
              : undefined;
            console.error('Sale failed:', errorMsg);

            // Check if this is a stock conflict error
            const stockConflict = detectStockConflict({ message: errorMsg, data: response });
            
            if (stockConflict.isStockConflict) {
              console.warn('Stock conflict detected:', stockConflict);
              
              // Refresh products to get latest stock
              showToast(
                stockConflict.conflictingProducts && stockConflict.conflictingProducts.length > 0
                  ? `Stock conflict: ${stockConflict.conflictingProducts.join(', ')}. Refreshing products...`
                  : 'Stock conflict detected. Refreshing products...',
                'warning',
                5000
              );

              // Refresh products and retry if user wants
              try {
                await loadProducts(0);
                updateInlineStatus('Stock refreshed. Review quantities and retry sale.', 'warning');
              } catch (refreshError) {
                console.error('Failed to refresh products after stock conflict:', refreshError);
                showToast('Failed to refresh products.', 'error', 0, {
                  label: 'Retry',
                  onClick: () => {
                    void loadProducts(0);
                  },
                });
              }

              // Don't proceed with error handling - let user retry manually
              return;
            }

            // Auto-sync products if error is related to invalid/missing product
            const errorLower = (response.error || '').toLowerCase();
            if (errorLower.includes('invalid product') || 
                errorLower.includes('product') && errorLower.includes('not found') ||
                errorLower.includes('product') && errorLower.includes('deleted')) {
              updateInlineStatus('Catalog mismatch detected. Syncing products...', 'warning');
              // Trigger product sync in background
              setTimeout(async () => {
                try {
                  const syncResult = await (window as any).electronAPI.syncProducts();
                  if (syncResult.success) {
                    updateInlineStatus(`Catalog synced: ${syncResult.products?.length || 0} products loaded`, 'success');
                    // Reload products in UI
                    loadProducts(0);
                  } else {
                    showToast('Failed to sync products.', 'error', 0, {
                      label: 'Sync now',
                      onClick: () => {
                        void runLiveCatalogRefresh('manual');
                      },
                    });
                  }
                } catch (syncError) {
                  console.error('Auto-sync failed:', syncError);
                }
              }, 500);
            }

            // Handle sale failure with recovery options
            if (response.error === 'Unauthorized' || 
                response.error?.includes('Unauthorized') || 
                response.error?.includes('token') || 
                response.error?.includes('auth') ||
                response.error?.includes('log in')) {
              handleError(
                new AppError('Session expired. Please log in again to complete the sale.', 'UNAUTHORIZED', {
                  operation: 'createSale',
                  component: 'POS',
                  userId: user?.id,
                  userName: user?.name,
                }),
                {
                  operation: 'createSale',
                  component: 'POS',
                },
                {
                  fallbackAction: ErrorRecovery.redirectToLogin,
                }
              );
            } else {
              handleError(
                new AppError(response.error || 'Sale failed', 'SALE_FAILED', {
                  operation: 'createSale',
                  component: 'POS',
                  userId: user?.id,
                  userName: user?.name,
                  metadata: { saleData },
                }),
                {
                  operation: 'createSale',
                  component: 'POS',
                  userId: user?.id,
                  userName: user?.name,
                },
                {
                  retryable: true,
                  maxRetries: 2,
                  fallbackAction: () => {
                    // Hold transaction for later retry
                    handleHoldTransaction();
                    updateInlineStatus('Sale held. Retry when ready.', 'warning');
                  },
                }
              );
            }
          }
        } finally {
          setProcessingSale(false);
          setSaleProcessingQueueCount(saleMutex.getQueueSize());
        }
      });
    } catch (mutexError) {
      // Handle mutex-specific errors (e.g., queue full)
      if (mutexError instanceof Error && mutexError.message.includes('queue is full')) {
        showToast(mutexError.message, 'error', 0, {
          label: 'View queue',
          onClick: () => {
            setShowOfflineQueueModal(true);
          },
        });
        updateInlineStatus('Sale queue full. Review offline queue.', 'error');
      } else {
        console.error('Mutex error:', mutexError);
        
        // Check for stock conflict errors
        const stockConflict = detectStockConflict(mutexError);
        if (stockConflict.isStockConflict) {
          console.warn('Stock conflict detected during sale:', stockConflict);
          
          // Refresh products to get latest stock
          showToast(
            stockConflict.conflictingProducts && stockConflict.conflictingProducts.length > 0
              ? `Stock conflict: ${stockConflict.conflictingProducts.join(', ')}. Refreshing products...`
              : 'Stock conflict detected. Refreshing products...',
            'warning',
            5000
          );

          // Refresh products
          try {
            await loadProducts(0);
            updateInlineStatus('Stock refreshed. Review quantities and retry sale.', 'warning');
          } catch (refreshError) {
            console.error('Failed to refresh products after stock conflict:', refreshError);
          }

          // Don't proceed with other error handling - let user retry manually
          setProcessingSale(false);
          return;
        }

        // Handle error with recovery options
        if (mutexError instanceof Error && (mutexError.message.includes('Unauthorized') || mutexError.message.includes('token'))) {
          handleError(
            new AppError('Session expired during sale', 'UNAUTHORIZED', {
              operation: 'createSale',
              component: 'POS',
              userId: user?.id,
              userName: user?.name,
            }),
            {
              operation: 'createSale',
              component: 'POS',
            },
            {
              fallbackAction: ErrorRecovery.redirectToLogin,
            }
          );
        } else {
          handleError(mutexError, {
            operation: 'createSale',
            component: 'POS',
            userId: user?.id,
            userName: user?.name,
          }, {
            retryable: true,
            maxRetries: 2,
            fallbackAction: () => {
              // Hold transaction for later retry
              handleHoldTransaction();
              updateInlineStatus('Sale held due to error. Retry when ready.', 'warning');
            },
          });
        }
      }
      setProcessingSale(false);
    }
  };

  const handleShowPrintPreview = () => {
    setCurrentStep('print-preview');
  };

  const handlePrintReceipt = async () => {
    if (!currentReceipt) return;

    // Validate receipt number and transaction integrity before printing
    if (currentReceipt.saleId) {
      const receiptNumberValidation = validateReceiptNumber(currentReceipt.saleId);
      if (!receiptNumberValidation.isValid) {
        showToast(`Receipt validation failed: ${receiptNumberValidation.error}`, 'error');
        auditLogger.log(
          AuditEventType.SECURITY_VIOLATION,
          { receiptId: currentReceipt.saleId, reason: receiptNumberValidation.error },
          'high',
          user?.id,
          user?.name
        );
        return;
      }

      // Validate receipt data integrity
      const receiptDataValidation = validateSaleData({
        items: currentReceipt.items || [],
        paymentMethod: currentReceipt.paymentMethod || 'cash',
        branchId: currentReceipt.branch?.id || '',
        idempotencyKey: currentReceipt.saleId,
      });

      if (!receiptDataValidation.isValid) {
        showToast(`Receipt data validation failed: ${receiptDataValidation.error}`, 'error');
        auditLogger.log(
          AuditEventType.SECURITY_VIOLATION,
          { receiptId: currentReceipt.saleId, reason: receiptDataValidation.error },
          'high',
          user?.id,
          user?.name
        );
        return;
      }
    }

    setPrinting(true);
    try {
      const response = await (window as any).electronAPI.printReceipt(currentReceipt);
      if (response.success) {
        console.log('Receipt printed successfully');
        
        // Log receipt printing
        auditLogger.log(
          AuditEventType.RECEIPT_PRINTED,
          {
            receiptId: currentReceipt.saleId,
            totalAmount: currentReceipt.total,
          },
          'low',
          user?.id,
          user?.name
        );

        showToast('Receipt printed successfully!', 'success');
        // Return to receipt view after successful print
        setCurrentStep('receipt');
      } else {
        console.error('Print failed:', response.error);
        showToast(`Print failed: ${response.error}`, 'error');
      }
    } catch (error) {
      console.error('Error printing receipt:', error);
      showToast('An error occurred while printing the receipt.', 'error');
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintViaBrowser = () => {
    window.print();
  };

  const handleBackFromPrintPreview = () => {
    setCurrentStep('receipt');
  };

  const handleNewSale = () => {
    setCurrentStep('products');
    setCurrentReceipt(null);
    setCart([]);
  };

  const handleHoldTransaction = () => {
    if (!requireCashierSession('holding a transaction')) {
      return;
    }

    if (cart.length === 0) {
      showToast('Cart is empty. Nothing to hold.', 'warning');
      return;
    }

    const transactionId = holdTransaction(cart);
    
    // Log transaction hold
    auditLogger.log(
      AuditEventType.TRANSACTION_HELD,
      {
        transactionId,
        itemCount: cart.length,
        totalAmount: getGrandTotal(),
      },
      'low',
      user?.id,
      user?.name
    );

    showToast('Transaction held successfully. You can start a new sale.', 'success');
    setCart([]);
  };

  const handleResumeTransaction = (transactionId: string) => {
    if (!requireCashierSession('resuming a transaction')) {
      return;
    }

    const transaction = resumeTransaction(transactionId);
    if (transaction) {
      if (cart.length > 0) {
        // If there's already items in cart, automatically hold current first
        holdTransaction(cart);
        showToast('Current cart held. Resuming transaction...', 'info');
      }
      
      // Log transaction resume
      auditLogger.log(
        AuditEventType.TRANSACTION_RESUMED,
        {
          transactionId,
          itemCount: transaction.cart.length,
        },
        'low',
        user?.id,
        user?.name
      );
      
      // Restore the transaction's cart
      setCart(transaction.cart);
      setCurrentStep('products');
      showToast('Transaction resumed successfully.', 'success');
    } else {
      showToast('Transaction not found.', 'error');
      auditLogger.log(
        AuditEventType.SECURITY_VIOLATION,
        { transactionId, reason: 'Attempted to resume non-existent transaction' },
        'medium',
        user?.id,
        user?.name
      );
    }
  };

  const handleDeletePendingTransaction = (transactionId: string) => {
    // Log transaction deletion
    auditLogger.log(
      AuditEventType.TRANSACTION_DELETED,
      { transactionId },
      'low',
      user?.id,
      user?.name
    );

    deleteTransaction(transactionId);
    showToast('Pending transaction deleted.', 'info');
  };

  const handleReceiptFromLookup = (receipt: any) => {
    setCurrentReceipt(receipt);
    setCurrentStep('receipt');
    setShowFindReceiptModal(false);
    setShowSalesHistoryModal(false);
  };

  const handleLogout = async () => {
    if (!canControlMainSession) {
      showToast('Only manager/owner/admin can sign out the main account.', 'warning', 3500);
      return;
    }

    if (cart.length > 0 && !window.confirm('Logout now? Current cart will be lost.')) {
      return;
    }
    await logout();
  };

  const handleExit = async () => {
    if (!canControlMainSession) {
      showToast('Only manager/owner/admin can exit the POS app.', 'warning', 3500);
      return;
    }

    const message = cart.length > 0
      ? 'Exit POS now? Current cart will be lost.'
      : 'Exit POS application now?';
    if (!window.confirm(message)) {
      return;
    }
    await window.electronAPI.quitApp();
  };

  const steps: Array<{ id: POSStep; label: string; icon: React.ReactNode }> = [
    { id: 'products', label: 'Products', icon: <ShoppingCart size={15} /> },
    { id: 'checkout', label: 'Checkout', icon: <WalletCards size={15} /> },
    { id: 'receipt', label: 'Receipt', icon: <ReceiptText size={15} /> },
    { id: 'print-preview', label: 'Print', icon: <Printer size={15} /> },
  ];
  const selectedBranchName =
    visibleBranches.find((branch) => branch.id === selectedBranch)?.name ||
    branches.find((branch) => branch.id === selectedBranch)?.name ||
    user?.branchName ||
    'Branch';

  if (!canAccessPos) {
    return (
      <div className={`pos-app ${isUltraCompact ? 'pos-density-ultra' : ''}`}>
        <section className="pos-shell-main pos-shell-main--full">
          <header className="pos-shell-header pos-shell-header--shared">
            <div className="pos-shell-header-left">
              <div>
                <h2>{user?.tenantName || 'Sales Desk'}</h2>
                <p>{user?.name || 'User'}</p>
              </div>
            </div>
          </header>

          <div className="pos-shell-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ maxWidth: 520, border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, background: '#fff' }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>POS Access Required</h3>
              <p style={{ marginTop: 8, marginBottom: 14, color: '#475569' }}>
                This account does not have POS access. Ask an admin to grant the pos.access permission.
              </p>
              <button
                type="button"
                className="shell-action-btn"
                onClick={() => {
                  void logout();
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`pos-app ${isUltraCompact ? 'pos-density-ultra' : ''}`}>
      <section className="pos-shell-main pos-shell-main--full">
        <header className="pos-shell-header pos-shell-header--shared">
          <div className="pos-shell-header-left">
            <div>
              <h2>{user?.tenantName || 'Sales Desk'}</h2>
              <p>{user?.name || 'Cashier'}</p>
            </div>
          </div>

          <nav className="pos-shell-step-nav pos-shell-step-nav--inline">
            {steps.map((step) => {
              const active = currentStep === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`step-chip ${active ? 'is-active' : ''}`}
                  disabled={!active}
                >
                  {step.icon}
                  <span>{step.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="pos-shell-header-right pos-shell-header-right--minimal">
            {isBranchLockedUser ? (
              <div className="receipts-menu">
                <span className="shell-action-btn" title="Managed branch is fixed for your account" aria-label="Managed branch">
                  {selectedBranchName}
                </span>
              </div>
            ) : (
              <div className="receipts-menu" ref={branchMenuRef}>
                <button
                  type="button"
                  className="shell-action-btn"
                  onClick={() => {
                    setShowQuickMenu(false);
                    setShowBranchMenu((prev) => !prev);
                  }}
                  aria-label="Branch menu"
                >
                  {selectedBranchName}
                  <span className="receipts-menu-caret">▾</span>
                </button>
                {showBranchMenu && (
                  <div className="receipts-menu-dropdown pos-menu-panel">
                    <div className="pos-menu-label">Select Branch</div>
                    <select
                      value={selectedBranch}
                      onChange={(e) => {
                        setSelectedBranch(e.target.value);
                        setShowBranchMenu(false);
                      }}
                      className="branch-select improved-branch-select pos-shell-branch-select"
                      title="Select branch"
                    >
                      <option value="">Select Branch</option>
                      {visibleBranches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name || user?.branchName || 'Assigned Branch'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            <div className="receipts-menu" ref={quickMenuRef}>
              <button
                type="button"
                className="shell-action-btn"
                onClick={() => {
                  setShowBranchMenu(false);
                  setShowQuickMenu((prev) => !prev);
                }}
                aria-label="Quick actions menu"
              >
                Menu
                <span className="receipts-menu-caret">▾</span>
              </button>
              {showQuickMenu && (
                <div className="receipts-menu-dropdown pos-menu-panel">
                  {canViewReceipts && (
                    <>
                      <button
                        type="button"
                        className="receipts-menu-item"
                        onClick={() => {
                          setShowQuickMenu(false);
                          setShowFindReceiptModal(true);
                        }}
                      >
                        Find Receipt
                      </button>
                      <button
                        type="button"
                        className="receipts-menu-item"
                        onClick={() => {
                          setShowQuickMenu(false);
                          setShowSalesHistoryModal(true);
                        }}
                      >
                        History
                      </button>
                    </>
                  )}

                  {canUseSettings && (
                    <button
                      type="button"
                      className="receipts-menu-item"
                      onClick={() => {
                        setShowQuickMenu(false);
                        setShowSettings(true);
                      }}
                    >
                      Settings
                    </button>
                  )}

                  <button
                    type="button"
                    className="receipts-menu-item"
                    onClick={() => {
                      setShowQuickMenu(false);
                      setIsUltraCompact((prev) => !prev);
                    }}
                  >
                    {isUltraCompact ? 'Disable Compact' : 'Compact'}
                  </button>

                  <button
                    type="button"
                    className="receipts-menu-item"
                    onClick={() => {
                      setShowQuickMenu(false);
                      setShiftError('');
                      if (currentShift) {
                        setShiftPromptMode('close');
                        setClosingCashInput('0');
                      } else {
                        setShiftPromptMode('open');
                        setOpeningCashInput('0');
                      }
                    }}
                  >
                    {currentShift ? 'End Shift' : 'Start Shift'}
                  </button>

                  <button
                    type="button"
                    className="receipts-menu-item"
                    onClick={() => {
                      setShowQuickMenu(false);
                      setShowOfflineQueueModal(true);
                    }}
                  >
                    Offline Queue ({offlineQueuedSalesCount})
                  </button>

                  <button
                    type="button"
                    className="receipts-menu-item"
                    onClick={() => {
                      setShowQuickMenu(false);
                      if (activeCashier?.id) {
                        lockCashierSession('Cashier session locked. Enter PIN to continue.');
                      } else {
                        setCashierSwitchError('');
                        setCashierSwitchOpen(true);
                      }
                    }}
                  >
                    {activeCashier?.id ? 'Lock Cashier' : 'Cashier PIN Login'}
                  </button>

                  <div className="pos-menu-status">
                    <SyncStatus
                      onStatusMessage={updateInlineStatus}
                      onCriticalToast={(message, action) => {
                        if (action === 'retry') {
                          showToast(message, 'error', 0, {
                            label: 'Retry',
                            onClick: () => {
                              void loadProducts(0);
                            },
                          });
                          return;
                        }

                        if (action === 'sync') {
                          showToast(message, 'error', 0, {
                            label: 'Sync now',
                            onClick: () => {
                              void runLiveCatalogRefresh('manual');
                            },
                          });
                          return;
                        }

                        showToast(message, 'error', 0, {
                          label: 'View queue',
                          onClick: () => {
                            setShowOfflineQueueModal(true);
                          },
                        });
                      }}
                    />
                    <div className="pos-menu-meta">
                      <span>{clock.toLocaleDateString()} · {clock.toLocaleTimeString()}</span>
                      <span>Items {cart.length} · Total KES {getGrandTotal().toFixed(2)}</span>
                    </div>
                  </div>

                  {(canUseLogoutControl || canUseExitControl) ? (
                    <>
                      {canUseLogoutControl && (
                      <button
                        type="button"
                        className="receipts-menu-item"
                        onClick={() => {
                          setShowQuickMenu(false);
                          void handleLogout();
                        }}
                      >
                        Logout
                      </button>
                      )}
                      {canUseExitControl && (
                      <button
                        type="button"
                        className="receipts-menu-item danger"
                        onClick={() => {
                          setShowQuickMenu(false);
                          void handleExit();
                        }}
                      >
                        Exit
                      </button>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </div>

            <div className="pos-shell-stats pos-shell-stats--inline">
              <div className="stat-row"><span>Cashier</span><strong>{activeCashierLabel}</strong></div>
              <div className="stat-row"><span>Total</span><strong>KES {getGrandTotal().toFixed(2)}</strong></div>

              <details className="pos-header-more">
                <summary>More</summary>
                <div className="pos-header-more-panel">
                  <div className="stat-row"><span>Shift</span><strong>{currentShift ? 'Open' : 'Closed'}</strong></div>
                  <div className="stat-row"><span>Items</span><strong>{cart.length}</strong></div>
                  <div className="stat-row">
                    <button
                      type="button"
                      className="offline-queue-trigger"
                      onClick={() => setShowOfflineQueueModal(true)}
                      title="View offline sales queue"
                    >
                      <span>Offline Q</span>
                      <strong>{offlineQueuedSalesCount}</strong>
                    </button>
                  </div>
                  <div className={`pos-operational-status pos-operational-status--${inlineStatus.level}`} title={inlineStatus.message}>
                    <span className="pos-operational-dot" aria-hidden="true"></span>
                    <span className="pos-operational-text">{inlineStatus.message}</span>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </header>

        <div className="pos-shell-body">
          {cashierSwitchOpen && (
            <div className="shift-modal-overlay" role="dialog" aria-modal="true">
              <div className="shift-modal-card cashier-switch-card">
                <h3>Cashier PIN Check-In</h3>
                <p className="shift-modal-copy">
                  Switch cashier instantly without signing out of admin email login.
                </p>

                <label className="shift-modal-label" htmlFor="cashier-candidate">Cashier</label>
                <select
                  id="cashier-candidate"
                  className="shift-modal-input"
                  value={cashierCandidateId}
                  onChange={(e) => setCashierCandidateId(e.target.value)}
                  disabled={cashierSwitchBusy}
                >
                  <option value="">Select cashier</option>
                  {effectiveCashierCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name || candidate.email || candidate.id}
                    </option>
                  ))}
                </select>

                <label className="shift-modal-label" htmlFor="cashier-pin">PIN</label>
                <input
                  id="cashier-pin"
                  type="password"
                  className="shift-modal-input"
                  value={cashierPinInput}
                  onChange={(e) => setCashierPinInput(e.target.value)}
                  disabled={cashierSwitchBusy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void verifyAndActivateCashier();
                    }
                  }}
                />

                {cashierSwitchError && <div className="shift-modal-error">{cashierSwitchError}</div>}

                <div className="shift-modal-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      if (requiresCashierSession && !activeCashier?.id) {
                        return;
                      }

                      setCashierSwitchOpen(false);
                      setCashierSwitchError('');
                    }}
                    disabled={cashierSwitchBusy || (requiresCashierSession && !activeCashier?.id)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      void verifyAndActivateCashier();
                    }}
                    disabled={cashierSwitchBusy}
                  >
                    {cashierSwitchBusy ? 'Checking...' : 'Unlock POS'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {shiftPromptMode && (
            <div className="shift-modal-overlay" role="dialog" aria-modal="true">
              <div className="shift-modal-card">
                <h3>{shiftPromptMode === 'open' ? 'Start Shift' : 'Close Shift'}</h3>
                <p className="shift-modal-copy">
                  {shiftPromptMode === 'open'
                    ? 'Enter opening cash float before sales begin.'
                    : 'Enter closing cash to complete handover.'}
                </p>

                {shiftPromptMode === 'open' ? (
                  <>
                    <label className="shift-modal-label" htmlFor="opening-cash-input">Opening cash (KES)</label>
                    <input
                      id="opening-cash-input"
                      type="number"
                      min="0"
                      step="0.01"
                      className="shift-modal-input"
                      value={openingCashInput}
                      onChange={(e) => setOpeningCashInput(e.target.value)}
                      disabled={shiftBusy}
                    />
                  </>
                ) : (
                  <>
                    <label className="shift-modal-label" htmlFor="closing-cash-input">Closing cash (KES)</label>
                    <input
                      id="closing-cash-input"
                      type="number"
                      min="0"
                      step="0.01"
                      className="shift-modal-input"
                      value={closingCashInput}
                      onChange={(e) => setClosingCashInput(e.target.value)}
                      disabled={shiftBusy}
                    />

                    <label className="shift-modal-label" htmlFor="shift-notes-input">Notes (optional)</label>
                    <textarea
                      id="shift-notes-input"
                      className="shift-modal-textarea"
                      rows={3}
                      value={shiftNotes}
                      onChange={(e) => setShiftNotes(e.target.value)}
                      disabled={shiftBusy}
                    />
                  </>
                )}

                {shiftError && <div className="shift-modal-error">{shiftError}</div>}

                <div className="shift-modal-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      if (requiresShiftSession && !currentShift && shiftPromptMode === 'open') {
                        return;
                      }

                      setShiftPromptMode(null);
                      setShiftError('');
                    }}
                    disabled={shiftBusy || (requiresShiftSession && !currentShift && shiftPromptMode === 'open')}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      if (shiftPromptMode === 'open') {
                        void handleOpenShift();
                        return;
                      }

                      void handleCloseShift();
                    }}
                    disabled={shiftBusy}
                  >
                    {shiftBusy
                      ? (shiftPromptMode === 'open' ? 'Starting...' : 'Closing...')
                      : (shiftPromptMode === 'open' ? 'Start Shift' : 'Close Shift')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showFindReceiptModal && (
            <FindReceiptModal
              onClose={() => setShowFindReceiptModal(false)}
              onReceiptFound={handleReceiptFromLookup}
            />
          )}
          {showSalesHistoryModal && (
            <SalesHistoryModal
              onClose={() => setShowSalesHistoryModal(false)}
              onReceiptFound={handleReceiptFromLookup}
            />
          )}
          {showOfflineQueueModal && (
            <OfflineSalesQueueModal onClose={() => setShowOfflineQueueModal(false)} />
          )}

          <AnimatePresence mode="wait">
            {showSettings && (
              <motion.div key="settings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                <Settings
                  onClose={() => setShowSettings(false)}
                  onUnauthorized={() => {
                    void logout();
                  }}
                />
              </motion.div>
            )}

            {!showSettings && currentStep === 'products' && (
              <motion.div key="products" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                <ProductSelection
                  cart={cart}
                  onAddToCart={addToCart}
                  onUpdateQuantity={updateQuantity}
                  onRemoveFromCart={removeFromCart}
                  onProceedToCheckout={handleProceedToCheckout}
                  onHoldTransaction={handleHoldTransaction}
                  onResumeTransaction={handleResumeTransaction}
                  onDeletePendingTransaction={handleDeletePendingTransaction}
                  pendingTransactions={pendingTransactions}
                  getTotal={getTotal}
                  getGrandTotal={getGrandTotal}
                  selectedBranch={selectedBranch}
                />
              </motion.div>
            )}

            {!showSettings && currentStep === 'checkout' && (
              <motion.div key="checkout" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                <Checkout
                  cart={cart}
                  subtotal={getTotal()}
                  total={getGrandTotal()}
                  onCompleteSale={handleCompleteSale}
                  onBackToProducts={handleBackToProducts}
                  loading={processingSale}
                  queuedSalesCount={saleProcessingQueueCount}
                />
              </motion.div>
            )}

            {!showSettings && currentStep === 'receipt' && (
              <motion.div key="receipt" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                <Receipt
                  receipt={currentReceipt}
                  onPrint={handleShowPrintPreview}
                  onNewSale={handleNewSale}
                  printing={printing}
                />
              </motion.div>
            )}

            {!showSettings && currentStep === 'print-preview' && (
              <motion.div key="print-preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                <PrintPreview
                  receipt={currentReceipt}
                  onPrint={handlePrintReceipt}
                  onBack={handleBackFromPrintPreview}
                  onPrintViaBrowser={handlePrintViaBrowser}
                  printing={printing}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </div>
  );
};

export default POS;
