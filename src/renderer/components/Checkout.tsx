import React, { useState, useEffect } from 'react';
import { Banknote, CreditCard, HandCoins, Smartphone, UserRound } from 'lucide-react';
import '../checkout.css';
import { validatePaymentAmount, validatePhoneNumber, validateCustomerName } from '../utils/validation';
import { auditLogger, AuditEventType } from '../utils/audit-logger';
import { sanitizeCustomerName, sanitizePhoneNumber, sanitizeNotes } from '../utils/sanitization';
import MpesaPayment from './MpesaPayment';

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
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface CheckoutProps {
  cart: CartItem[];
  subtotal: number;
  total: number;
  onCompleteSale: (paymentData: PaymentData) => void;
  onBackToProducts: () => void;
  loading: boolean;
  queuedSalesCount?: number;
}

interface SplitPayment {
  method: 'cash' | 'mpesa' | 'credit';
  amount: number;
  amountReceived?: number; // For cash payments
  mpesaTransactionId?: string; // For M-Pesa payments
  mpesaReceipt?: string; // For M-Pesa payments
  creditDueDate?: string; // For credit payments
  creditNotes?: string; // For credit payments
  status?: 'pending' | 'completed' | 'processing'; // Payment status
}

interface PaymentData {
  paymentMethod: 'cash' | 'mpesa' | 'credit';
  amountReceived?: number;
  customerName?: string;
  customerPhone?: string;
  creditAmount?: number;
  creditDueDate?: string;
  creditNotes?: string;
  /** Fixed discount amount applied to subtotal. */
  discountAmount?: number;
  /** Split payments - multiple payment methods */
  splitPayments?: SplitPayment[];
  /** Whether this is a split payment */
  isSplitPayment?: boolean;
  /** Manager approval for discount overrides */
  managerOverride?: {
    approvedByUserId: string;
    approvedByName?: string;
    approvalReason: string;
    approvalPin: string;
  };
}

type DiscountMode = 'amount' | 'percent';

interface ManagerApprover {
  id: string;
  name?: string;
  email?: string;
  roles?: string[];
  userRoles?: Array<{ role?: { name?: string } }>;
}

const Checkout: React.FC<CheckoutProps> = ({
  cart,
  subtotal,
  total,
  onCompleteSale,
  onBackToProducts,
  loading,
  queuedSalesCount = 0
}) => {
  // Get user info for audit logging (if available)
  const getUserInfo = async () => {
    try {
      const userData = await (window as any).electronAPI?.getUserData?.();
      return userData || null;
    } catch {
      return null;
    }
  };

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mpesa' | 'credit'>('cash');
  const [amountReceived, setAmountReceived] = useState<string>('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [creditDueDate, setCreditDueDate] = useState('');
  const [creditNotes, setCreditNotes] = useState('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('amount');
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [success, setSuccess] = useState(false);
  
  // Split payment state
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  
  // M-Pesa payment modal state
  const [showMpesaModal, setShowMpesaModal] = useState(false);
  const [mpesaTransactionId, setMpesaTransactionId] = useState<string | null>(null);
  const [mpesaReceipt, setMpesaReceipt] = useState<string | null>(null);
  const [currentMpesaPaymentIndex, setCurrentMpesaPaymentIndex] = useState<number | null>(null);
  const [showManagerOverrideModal, setShowManagerOverrideModal] = useState(false);
  const [managerApprovers, setManagerApprovers] = useState<ManagerApprover[]>([]);
  const [managerApproverId, setManagerApproverId] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [managerReason, setManagerReason] = useState('');
  const [managerOverrideError, setManagerOverrideError] = useState('');
  const [managerOverrideApproval, setManagerOverrideApproval] = useState<{
    approvedByUserId: string;
    approvedByName?: string;
    approvalReason: string;
    approvalPin: string;
  } | null>(null);

  // Computed totals after discount
  const effectiveDiscountAmount = Math.min(
    subtotal,
    Math.max(
      0,
      discountMode === 'percent' ? (subtotal * discountPercent) / 100 : discountAmount,
    ),
  );
  const subtotalAfterDiscount = Math.max(0, subtotal - effectiveDiscountAmount);
  const totalAfterDiscount = subtotalAfterDiscount;
  const formatCurrency = (amount: number) => `KES ${(Number(amount) || 0).toFixed(2)}`;

  const getSkuColorLabel = (sku: string): string => {
    const parts = String(sku || '').split('-').filter(Boolean);
    if (parts.length < 2) return '';
    return parts[1] || '';
  };

  const getSwatchStyleForLabel = (label: string): React.CSSProperties | undefined => {
    const normalized = label.trim().toLowerCase();
    if (!normalized) return undefined;

    const named: Record<string, string> = {
      black: '#111827',
      white: '#f8fafc',
      navy: '#1e3a8a',
      blue: '#2563eb',
      red: '#b91c1c',
      green: '#166534',
      brown: '#6b4226',
      tan: '#d2b48c',
      beige: '#e5d3b3',
      grey: '#9ca3af',
      gray: '#9ca3af',
      burgundy: '#7f1d1d',
      maroon: '#7f1d1d',
      pink: '#db2777',
      purple: '#6d28d9',
      orange: '#ea580c',
      yellow: '#ca8a04',
    };

    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
      return { backgroundColor: normalized };
    }

    if (named[normalized]) {
      return { backgroundColor: named[normalized] };
    }

    return undefined;
  };

  const isManagerLike = (user: ManagerApprover): boolean => {
    const roleNames = new Set<string>();
    if (Array.isArray(user.roles)) {
      for (const role of user.roles) {
        roleNames.add(String(role || '').toLowerCase());
      }
    }
    if (Array.isArray(user.userRoles)) {
      for (const userRole of user.userRoles) {
        const roleName = String(userRole?.role?.name || '').toLowerCase();
        if (roleName) roleNames.add(roleName);
      }
    }
    return roleNames.has('owner') || roleNames.has('admin') || roleNames.has('manager') || roleNames.has('superadmin');
  };

  useEffect(() => {
    const loadManagerApprovers = async () => {
      try {
        const response = await (window as any).electronAPI?.getUsers?.();
        const users = Array.isArray(response?.users) ? response.users : [];
        setManagerApprovers(users.filter((u: ManagerApprover) => isManagerLike(u)));
      } catch {
        setManagerApprovers([]);
      }
    };
    loadManagerApprovers();
  }, []);

  useEffect(() => {
    setManagerOverrideApproval(null);
    setManagerApproverId('');
    setManagerPin('');
    setManagerReason('');
    setManagerOverrideError('');
  }, [effectiveDiscountAmount, discountMode, discountAmount, discountPercent]);

  // Progress steps
  const steps = ['Cart Review', 'Payment', 'Confirmation'];
  const currentStep = 1; // Assuming we're on payment step

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Quick preset helpers for common split scenarios
  const applySplitPreset = (preset: 'cash-mpesa' | 'cash-credit') => {
    const half = Math.round((totalAfterDiscount / 2) * 100) / 100;
    const rest = Math.round((totalAfterDiscount - half) * 100) / 100;

    if (preset === 'cash-mpesa') {
      setSplitPayments([
        {
          method: 'cash',
          amount: half,
          amountReceived: half,
          status: 'pending',
        },
        {
          method: 'mpesa',
          amount: rest,
          status: 'pending',
        },
      ]);
    } else {
      setSplitPayments([
        {
          method: 'cash',
          amount: half,
          amountReceived: half,
          status: 'pending',
        },
        {
          method: 'credit',
          amount: rest,
          status: 'pending',
        },
      ]);
    }

    // Clear any previous split errors when applying a preset
    setErrors(prev => {
      const { splitPayments, ...restErrors } = prev;
      return restErrors;
    });
  };

  // Keyboard shortcut: Ctrl/Cmd + D cycles a quick discount on the current sale
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't interfere while user is typing in a field
      if (target.closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        // Cycle between 0%, 5%, and 10% discount
        const next =
          discountMode !== 'percent' || discountPercent === 0
            ? 5
            : Math.abs(discountPercent - 5) < 0.01
            ? 10
            : 0;
        setDiscountMode('percent');
        setDiscountPercent(next);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [discountMode, discountPercent]);

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    // Validate discount
    if (discountMode === 'amount' && (discountAmount < 0 || discountAmount > subtotal)) {
      newErrors.discountAmount = `Discount must be between 0 and ${formatCurrency(subtotal)}`;
    }
    if (discountMode === 'percent' && (discountPercent < 0 || discountPercent > 100)) {
      newErrors.discountAmount = 'Discount percentage must be between 0 and 100';
    }

    // Validate split payments
    if (isSplitPayment) {
      if (splitPayments.length === 0) {
        newErrors.splitPayments = 'Please add at least one payment method';
      } else {
        const totalSplitAmount = splitPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const difference = Math.abs(totalSplitAmount - totalAfterDiscount);
        
        if (difference > 0.01) { // Allow small rounding differences
          newErrors.splitPayments = `Split payments total (${formatCurrency(totalSplitAmount)}) must equal total (${formatCurrency(totalAfterDiscount)})`;
        }

        // Validate each split payment
        splitPayments.forEach((payment, index) => {
          if (payment.amount <= 0) {
            newErrors[`splitPayment_${index}_amount`] = 'Payment amount must be greater than 0';
          }
          
          if (payment.method === 'cash' && (!payment.amountReceived || payment.amountReceived < payment.amount)) {
            newErrors[`splitPayment_${index}_cash`] = `Cash received must be at least ${formatCurrency(payment.amount)}`;
          }
          
          if (payment.method === 'credit' && !customerName?.trim()) {
            newErrors.customerName = 'Customer name is required for credit payments';
          }
        });
      }
    } else {
      // Validate single payment method
      // Validate payment amount (against total after discount)
      if (paymentMethod === 'cash') {
        const received = parseFloat(amountReceived);
        if (!amountReceived || isNaN(received)) {
          newErrors.amountReceived = 'Please enter a valid amount';
        } else {
          const paymentValidation = validatePaymentAmount(received, totalAfterDiscount, paymentMethod);
          if (!paymentValidation.isValid) {
            newErrors.amountReceived = paymentValidation.error || `Amount must be at least ${formatCurrency(totalAfterDiscount)}`;
          }
        }
      }

      // Validate credit payment - customer name is required
      if (paymentMethod === 'credit') {
        if (!customerName || customerName.trim().length === 0) {
          newErrors.customerName = 'Customer name is required for credit sales';
        }
      }
    }

    // Validate phone number
    if (customerPhone) {
      const phoneValidation = validatePhoneNumber(customerPhone);
      if (!phoneValidation.isValid) {
        newErrors.customerPhone = phoneValidation.error || 'Please enter a valid phone number';
      }
    }

    // Validate customer name
    if (customerName) {
      const nameValidation = validateCustomerName(customerName);
      if (!nameValidation.isValid) {
        newErrors.customerName = nameValidation.error || 'Please enter a valid customer name';
      }
    }

    // Log validation failures for audit (async)
    if (Object.keys(newErrors).length > 0) {
      getUserInfo().then(userInfo => {
        auditLogger.log(
          AuditEventType.DATA_VALIDATION_FAILED,
          {
            errors: newErrors,
            paymentMethod,
            isSplitPayment,
            totalAmount: totalAfterDiscount,
          },
          'medium',
          userInfo?.id,
          userInfo?.name
        );
      });
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // If M-Pesa is selected and not in split payment mode, show M-Pesa modal
    if (paymentMethod === 'mpesa' && !isSplitPayment) {
      setShowMpesaModal(true);
      return;
    }

    if (isSplitPayment) {
      // Validate split payments
      if (!areAllPaymentsCompleted()) {
        setErrors({
          ...errors,
          splitPayments: 'Please complete all payments before closing the bill. M-Pesa payments must be processed, and cash payments must have received amount entered.',
        });
        return;
      }

      // Check if total matches
      const totalSplit = splitPayments.reduce((sum, p) => sum + p.amount, 0);
      if (Math.abs(totalSplit - totalAfterDiscount) > 0.01) {
        setErrors({
          ...errors,
          splitPayments: `Total split payments (${formatCurrency(totalSplit)}) must equal total amount (${formatCurrency(totalAfterDiscount)})`,
        });
        return;
      }
    }

    if (!validateForm()) {
      return;
    }

    if (effectiveDiscountAmount > 0 && !managerOverrideApproval) {
      setManagerOverrideError('Manager approval is required for discounted sales.');
      setShowManagerOverrideModal(true);
      return;
    }

    // SECURITY: Sanitize all user inputs before creating payment data
    const paymentData: PaymentData = {
      paymentMethod: isSplitPayment ? 'split' : paymentMethod,
      customerName: customerName ? sanitizeCustomerName(customerName) : undefined,
      customerPhone: customerPhone ? sanitizePhoneNumber(customerPhone) : undefined,
      ...(effectiveDiscountAmount > 0 && { discountAmount: Math.round(effectiveDiscountAmount * 100) / 100 }),
      isSplitPayment,
      ...(managerOverrideApproval && { managerOverride: managerOverrideApproval }),
    };

    if (isSplitPayment) {
      // For split payments, use the split payments array
      paymentData.splitPayments = splitPayments;
      // Set primary payment method to the first split payment method for backward compatibility
      paymentData.paymentMethod = splitPayments[0]?.method || 'cash';
    } else {
      // Single payment method
      if (paymentMethod === 'cash') {
        paymentData.amountReceived = parseFloat(amountReceived);
      }

      if (paymentMethod === 'credit') {
        paymentData.creditAmount = totalAfterDiscount;
        if (creditDueDate) {
          paymentData.creditDueDate = creditDueDate;
        }
        if (creditNotes) {
          paymentData.creditNotes = creditNotes.trim();
        }
      }

      // Add M-Pesa transaction details if available
      if (paymentMethod === 'mpesa' && mpesaTransactionId) {
        // M-Pesa payment is handled via the modal, transaction details are set in handleMpesaSuccess
      }
    }

    onCompleteSale(paymentData);
    setSuccess(true);
  };

  const handleManagerOverrideApprove = async () => {
    setManagerOverrideError('');
    const approverId = managerApproverId.trim();
    const pin = managerPin.trim();
    const reason = managerReason.trim();

    if (!approverId || !pin || !reason) {
      setManagerOverrideError('Select approver, enter PIN, and provide an approval reason.');
      return;
    }

    if (reason.length < 5) {
      setManagerOverrideError('Approval reason must be at least 5 characters.');
      return;
    }

    const selectedApprover = managerApprovers.find((u) => u.id === approverId);
    if (!selectedApprover || !isManagerLike(selectedApprover)) {
      setManagerOverrideError('Selected user is not authorized for manager override.');
      return;
    }

    try {
      const verify = await (window as any).electronAPI.verifyUserPosPin(approverId, pin);
      if (!verify?.success) {
        setManagerOverrideError(verify?.reason || verify?.error || 'Invalid manager PIN.');
        return;
      }

      const approval = {
        approvedByUserId: approverId,
        approvedByName: selectedApprover.name || selectedApprover.email,
        approvalReason: sanitizeNotes(reason),
        approvalPin: pin,
      };

      setManagerOverrideApproval(approval);
      setShowManagerOverrideModal(false);
      setManagerPin('');
      setManagerOverrideError('');

      const actor = await getUserInfo();
      auditLogger.log(
        AuditEventType.PRICE_OVERRIDE,
        {
          subtotal,
          discountAmount: Math.round(effectiveDiscountAmount * 100) / 100,
          discountMode,
          discountPercent,
          approvalReason: approval.approvalReason,
          approvedByUserId: approval.approvedByUserId,
          approvedByName: approval.approvedByName,
        },
        'high',
        actor?.id,
        actor?.name,
      );
    } catch (error: any) {
      setManagerOverrideError(error?.message || 'Failed to verify manager approval.');
    }
  };

  const handleMpesaSuccess = (transactionId: string, receipt?: string) => {
    setShowMpesaModal(false);

    if (currentMpesaPaymentIndex !== null && isSplitPayment) {
      // Update the specific split payment with M-Pesa details
      const updatedPayments = [...splitPayments];
      updatedPayments[currentMpesaPaymentIndex] = {
        ...updatedPayments[currentMpesaPaymentIndex],
        mpesaTransactionId: transactionId,
        mpesaReceipt: receipt,
        status: 'completed',
      };
      setSplitPayments(updatedPayments);
      setCurrentMpesaPaymentIndex(null);
    } else {
      // Single M-Pesa payment (non-split)
      setMpesaTransactionId(transactionId);
      setMpesaReceipt(receipt || null);

      // Complete the sale with M-Pesa payment details
      // SECURITY: Sanitize all user inputs
      const paymentData: PaymentData = {
        paymentMethod: 'mpesa',
        customerName: customerName ? sanitizeCustomerName(customerName) : undefined,
        customerPhone: customerPhone ? sanitizePhoneNumber(customerPhone) : undefined,
        ...(effectiveDiscountAmount > 0 && { discountAmount: Math.round(effectiveDiscountAmount * 100) / 100 }),
      };

      // Add M-Pesa transaction details to split payments format for consistency
      paymentData.splitPayments = [{
        method: 'mpesa',
        amount: totalAfterDiscount,
        mpesaTransactionId: transactionId,
        mpesaReceipt: receipt,
        status: 'completed',
      }];
      paymentData.isSplitPayment = false;

      onCompleteSale(paymentData);
      setSuccess(true);
    }
  };

  const handleMpesaCancel = () => {
    setShowMpesaModal(false);
    if (currentMpesaPaymentIndex !== null && isSplitPayment) {
      // Reset the processing status for the split payment
      const updatedPayments = [...splitPayments];
      updatedPayments[currentMpesaPaymentIndex] = {
        ...updatedPayments[currentMpesaPaymentIndex],
        status: 'pending',
      };
      setSplitPayments(updatedPayments);
      setCurrentMpesaPaymentIndex(null);
    } else {
      setMpesaTransactionId(null);
      setMpesaReceipt(null);
    }
  };

  // Check if all split payments are completed
  const areAllPaymentsCompleted = (): boolean => {
    if (!isSplitPayment || splitPayments.length === 0) {
      return false;
    }

    return splitPayments.every(payment => {
      if (payment.method === 'cash') {
        // Cash payment is complete if amountReceived >= amount
        return payment.amountReceived !== undefined && payment.amountReceived >= payment.amount;
      } else if (payment.method === 'mpesa') {
        // M-Pesa payment is complete if status is 'completed' and has transaction ID
        return payment.status === 'completed' && !!payment.mpesaTransactionId;
      } else if (payment.method === 'credit') {
        // Credit payment is always considered complete (no payment needed)
        return true;
      }
      return false;
    });
  };

  // Split payment handlers
  const handleToggleSplitPayment = () => {
    const next = !isSplitPayment;
    setIsSplitPayment(next);
    if (next) {
      // Default to a simple Cash + M-Pesa split preset
      applySplitPreset('cash-mpesa');
    } else {
      // Clear split payments when disabling
      setSplitPayments([]);
    }
  };

  const handleAddSplitPayment = () => {
    const remaining = totalAfterDiscount - splitPayments.reduce((sum, p) => sum + p.amount, 0);
    setSplitPayments([...splitPayments, {
      method: 'cash',
      amount: Math.max(0, remaining),
      amountReceived: Math.max(0, remaining),
      status: 'pending',
    }]);
  };

  const handleRemoveSplitPayment = (index: number) => {
    setSplitPayments(splitPayments.filter((_, i) => i !== index));
  };

  const handleUpdateSplitPayment = (index: number, updates: Partial<SplitPayment>) => {
    const updated = [...splitPayments];
    const currentPayment = updated[index];
    updated[index] = { ...currentPayment, ...updates };
    
    // Auto-update status for cash payments
    if (updates.method === 'cash' || (currentPayment.method === 'cash' && updates.amountReceived !== undefined)) {
      const payment = updated[index];
      if (payment.amountReceived !== undefined && payment.amountReceived >= payment.amount) {
        updated[index].status = 'completed';
      } else {
        updated[index].status = 'pending';
      }
    }
    
    // Reset status when changing method
    if (updates.method && updates.method !== currentPayment.method) {
      updated[index].status = 'pending';
      if (updates.method === 'cash') {
        updated[index].amountReceived = updated[index].amount;
      } else {
        updated[index].amountReceived = undefined;
      }
    }
    
    setSplitPayments(updated);
    
    // Clear errors when updating
    if (errors.splitPayments) {
      const newErrors = { ...errors };
      delete newErrors.splitPayments;
      setErrors(newErrors);
    }
  };

  const getRemainingAmount = () => {
    const totalSplit = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    return totalAfterDiscount - totalSplit;
  };

  const change = paymentMethod === 'cash' && amountReceived
    ? parseFloat(amountReceived) - totalAfterDiscount
    : 0;

  return (
    <div className="checkout-page">
   
      {/* Success Message */}
      {success && (
        <div className="success-message">
          <span className="success-icon">✅</span>
          <span>Sale completed!</span>
        </div>
      )}

      {/* Processing Sale Indicator */}
      {loading && (
        <div className="processing-sale-indicator">
          <div className="processing-spinner"></div>
          <span>Processing sale...</span>
          {queuedSalesCount > 0 && (
            <span className="queue-info">({queuedSalesCount} sale{queuedSalesCount !== 1 ? 's' : ''} waiting in queue)</span>
          )}
        </div>
      )}

    

      <div className="checkout-main">
        <div className="checkout-left">
          {/* Order Summary Card */}
          <div className="checkout-card order-summary-card">
            <div className="card-header">
              <h2>Order Summary</h2>
              <span className="item-count">{cart.length} item{cart.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="order-items">
              {cart.map(item => {
                const colorLabel = getSkuColorLabel(item.product.sku || '');
                const swatchStyle = getSwatchStyleForLabel(colorLabel);
                return (
                <div key={`${item.product.id}-${item.product.sku || 'base'}`} className="order-item">
                  <div className="item-main">
                    <span
                      className="item-color-swatch"
                      style={swatchStyle}
                      aria-label={colorLabel ? `Color ${colorLabel}` : 'Variant'}
                      title={colorLabel || 'Variant'}
                    />
                    <div className="item-details">
                      <h4 className="item-name">{item.product.name}</h4>
                      <span className="item-sku">SKU: {item.product.sku}</span>
                    </div>
                  </div>
                  <div className="item-meta">
                    <span className="item-quantity">Qty: {item.quantity}</span>
                    <span className="item-price">{formatCurrency(item.product.price * item.quantity)}</span>
                  </div>
                </div>
                );
              })}
            </div>

            <div className="order-totals">
              <div className="total-row">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {effectiveDiscountAmount > 0 && (
                <div className="total-row discount-row">
                  <span>Discount</span>
                  <span className="discount-amount">−{formatCurrency(effectiveDiscountAmount)}</span>
                </div>
              )}
              <div className="total-row grand-total">
                <span>Total Amount</span>
                <span className="total-amount">{formatCurrency(totalAfterDiscount)}</span>
              </div>
            </div>

            <div className="discount-input-section">
              <label className="input-label">
                <span className="label-icon">🏷️</span>
                Discount (optional)
              </label>
              <div className="split-preset-row" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className={`split-preset-btn ${discountMode === 'amount' ? 'active selected-control' : ''}`}
                  onClick={() => setDiscountMode('amount')}
                >
                  Fixed Amount
                </button>
                <button
                  type="button"
                  className={`split-preset-btn ${discountMode === 'percent' ? 'active selected-control' : ''}`}
                  onClick={() => setDiscountMode('percent')}
                >
                  Percentage
                </button>
                {discountMode === 'percent' && (
                  <>
                    <button
                      type="button"
                      className={`split-preset-btn ${Math.abs(discountPercent - 5) < 0.01 ? 'active selected-control' : ''}`}
                      onClick={() => setDiscountPercent(5)}
                    >
                      5%
                    </button>
                    <button
                      type="button"
                      className={`split-preset-btn ${Math.abs(discountPercent - 10) < 0.01 ? 'active selected-control' : ''}`}
                      onClick={() => setDiscountPercent(10)}
                    >
                      10%
                    </button>
                    <button
                      type="button"
                      className={`split-preset-btn ${Math.abs(discountPercent - 15) < 0.01 ? 'active selected-control' : ''}`}
                      onClick={() => setDiscountPercent(15)}
                    >
                      15%
                    </button>
                  </>
                )}
              </div>
              <div className="input-wrapper">
                <span className="currency-symbol">{discountMode === 'percent' ? '%' : 'KES'}</span>
                {discountMode === 'amount' ? (
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={subtotal}
                    value={discountAmount === 0 ? '' : discountAmount}
                    onChange={(e) => setDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0.00"
                    className={`currency-input ${errors.discountAmount ? 'error' : ''}`}
                    aria-describedby="discount-error"
                  />
                ) : (
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={discountPercent === 0 ? '' : discountPercent}
                    onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                    placeholder="0"
                    className={`currency-input ${errors.discountAmount ? 'error' : ''}`}
                    aria-describedby="discount-error"
                  />
                )}
              </div>
              {discountMode === 'percent' && effectiveDiscountAmount > 0 && (
                <span className="input-hint">Applies {formatCurrency(effectiveDiscountAmount)} discount</span>
              )}
              {errors.discountAmount && (
                <span id="discount-error" className="error-text">{errors.discountAmount}</span>
              )}
              {effectiveDiscountAmount > 0 && (
                <div className="input-hint" style={{ marginTop: 6 }}>
                  {managerOverrideApproval
                    ? `Approved by ${managerOverrideApproval.approvedByName || managerOverrideApproval.approvedByUserId}`
                    : 'Manager approval required before completing discounted sale.'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="checkout-right">
          {/* Payment Method Card */}
          <div className="checkout-card payment-card">
            <div className="card-header">
              <h2>Payment Method</h2>
              <label className="split-payment-toggle">
                <input
                  type="checkbox"
                  checked={isSplitPayment}
                  onChange={handleToggleSplitPayment}
                />
                <span>Split Payment</span>
              </label>
            </div>

            {!isSplitPayment ? (
              <div className="payment-options">
              <label className={`payment-option ${paymentMethod === 'cash' ? 'selected selected-control' : ''}`}>
                <input
                  type="radio"
                  value="cash"
                  checked={paymentMethod === 'cash'}
                  onChange={(e) => setPaymentMethod(e.target.value as 'cash')}
                />
                <div className="payment-content">
                  <div className="payment-icon cash-icon"><Banknote size={18} /></div>
                  <div className="payment-info">
                    <span className="payment-name">Cash Payment</span>
                    <span className="payment-desc">Pay with physical cash</span>
                  </div>
                  <div className="payment-check">
                    {paymentMethod === 'cash' && <span className="check-icon">✓</span>}
                  </div>
                </div>
              </label>

              <label className={`payment-option ${paymentMethod === 'mpesa' ? 'selected selected-control' : ''}`}>
                <input
                  type="radio"
                  value="mpesa"
                  checked={paymentMethod === 'mpesa'}
                  onChange={(e) => setPaymentMethod(e.target.value as 'mpesa')}
                />
                <div className="payment-content">
                  <div className="payment-icon mpesa-icon"><Smartphone size={18} /></div>
                  <div className="payment-info">
                    <span className="payment-name">M-Pesa</span>
                    <span className="payment-desc">Mobile money payment</span>
                  </div>
                  <div className="payment-check">
                    {paymentMethod === 'mpesa' && <span className="check-icon">✓</span>}
                  </div>
                </div>
              </label>

              <label className={`payment-option ${paymentMethod === 'credit' ? 'selected selected-control' : ''}`}>
                <input
                  type="radio"
                  value="credit"
                  checked={paymentMethod === 'credit'}
                  onChange={(e) => setPaymentMethod(e.target.value as 'credit')}
                />
                <div className="payment-content">
                  <div className="payment-icon credit-icon"><CreditCard size={18} /></div>
                  <div className="payment-info">
                    <span className="payment-name">Credit</span>
                    <span className="payment-desc">Pay later / On account</span>
                  </div>
                  <div className="payment-check">
                    {paymentMethod === 'credit' && <span className="check-icon">✓</span>}
                  </div>
                </div>
              </label>
            </div>
            ) : (
              <div className="split-payment-section">
                <div className="split-payment-header">
                  <p className="split-payment-info">
                    Split the payment across multiple methods. Total must equal <strong>{formatCurrency(totalAfterDiscount)}</strong>
                  </p>
                  <div className="split-preset-row">
                    <span className="split-preset-label">Quick layouts:</span>
                    <button
                      type="button"
                      className="split-preset-btn"
                      onClick={() => applySplitPreset('cash-mpesa')}
                    >
                      Cash + M-Pesa
                    </button>
                    <button
                      type="button"
                      className="split-preset-btn"
                      onClick={() => applySplitPreset('cash-credit')}
                    >
                      Cash + Credit
                    </button>
                  </div>
                  {errors.splitPayments && (
                    <span className="error-message">{errors.splitPayments}</span>
                  )}
                  <div className="remaining-amount">
                    Remaining: <strong className={getRemainingAmount() < 0 ? 'error' : getRemainingAmount() > 0.01 ? 'warning' : 'success'}>
                      {formatCurrency(getRemainingAmount())}
                    </strong>
                  </div>
                </div>

                <div className="split-payments-list">
                  {splitPayments.map((payment, index) => (
                    <div key={index} className="split-payment-item">
                      <div className="split-payment-row">
                        <div className="split-payment-method">
                          <select
                            value={payment.method}
                            onChange={(e) => handleUpdateSplitPayment(index, { 
                              method: e.target.value as 'cash' | 'mpesa' | 'credit',
                              amountReceived: e.target.value === 'cash' ? payment.amount : undefined,
                            })}
                            className="split-method-select"
                          >
                            <option value="cash">Cash</option>
                            <option value="mpesa">M-Pesa</option>
                            <option value="credit">Credit</option>
                          </select>
                        </div>
                        <div className="split-payment-amount">
                          <label>Amount</label>
                          <div className="input-wrapper">
                            <span className="currency-symbol">KES</span>
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              max={totalAfterDiscount}
                              value={payment.amount || ''}
                              onChange={(e) => {
                                const amount = parseFloat(e.target.value) || 0;
                                handleUpdateSplitPayment(index, { 
                                  amount,
                                  amountReceived: payment.method === 'cash' ? amount : payment.amountReceived,
                                });
                              }}
                              className={`currency-input ${errors[`splitPayment_${index}_amount`] ? 'error' : ''}`}
                              placeholder="0.00"
                            />
                          </div>
                          {errors[`splitPayment_${index}_amount`] && (
                            <span className="error-text">{errors[`splitPayment_${index}_amount`]}</span>
                          )}
                        </div>
                        {splitPayments.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSplitPayment(index)}
                            className="remove-split-btn"
                            title="Remove payment method"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Cash-specific fields */}
                      {payment.method === 'cash' && (
                        <div className="split-payment-details">
                          <label>Cash Received</label>
                          <div className="input-wrapper">
                            <span className="currency-symbol">KES</span>
                            <input
                              type="number"
                              step="0.01"
                              min={payment.amount}
                              value={payment.amountReceived || ''}
                              onChange={(e) => handleUpdateSplitPayment(index, { 
                                amountReceived: parseFloat(e.target.value) || payment.amount 
                              })}
                              className={`currency-input ${errors[`splitPayment_${index}_cash`] ? 'error' : ''}`}
                              placeholder={payment.amount.toFixed(2)}
                            />
                          </div>
                          {errors[`splitPayment_${index}_cash`] && (
                            <span className="error-text">{errors[`splitPayment_${index}_cash`]}</span>
                          )}
                          {payment.amountReceived && payment.amountReceived > payment.amount && (
                            <div className="change-display-small">
                              Change: {formatCurrency(payment.amountReceived - payment.amount)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* M-Pesa-specific fields */}
                      {payment.method === 'mpesa' && (
                        <div className="split-payment-details">
                          {payment.status === 'completed' ? (
                            <div className="payment-status-completed">
                              <div className="status-badge success">
                                <span className="status-icon">✅</span>
                                <span>Payment Completed</span>
                              </div>
                              {payment.mpesaTransactionId && (
                                <div className="transaction-info">
                                  <strong>Transaction ID:</strong> {payment.mpesaTransactionId}
                                </div>
                              )}
                              {payment.mpesaReceipt && (
                                <div className="transaction-info">
                                  <strong>Receipt:</strong> {payment.mpesaReceipt}
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => handleUpdateSplitPayment(index, { status: 'pending', mpesaTransactionId: undefined, mpesaReceipt: undefined })}
                                className="retry-payment-btn"
                              >
                                Retry Payment
                              </button>
                            </div>
                          ) : payment.status === 'processing' ? (
                            <div className="payment-status-processing">
                              <div className="status-badge processing">
                                <div className="loading-spinner-small"></div>
                                <span>Processing Payment...</span>
                              </div>
                            </div>
                          ) : (
                            <div className="mpesa-payment-action">
                              <button
                                type="button"
                                onClick={() => {
                                  // Set status to processing
                                  handleUpdateSplitPayment(index, { status: 'processing' });
                                  setCurrentMpesaPaymentIndex(index);
                                  setShowMpesaModal(true);
                                }}
                                className="initiate-mpesa-btn"
                                disabled={payment.amount <= 0}
                              >
                                <span className="btn-icon"><Smartphone size={16} /></span>
                                Pay with M-Pesa
                              </button>
                              <span className="payment-hint">
                                Click to initiate M-Pesa payment for {formatCurrency(payment.amount)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Credit-specific fields */}
                      {payment.method === 'credit' && (
                        <div className="split-payment-details">
                          <label>Due Date (Optional)</label>
                          <input
                            type="date"
                            value={payment.creditDueDate || ''}
                            onChange={(e) => handleUpdateSplitPayment(index, { creditDueDate: e.target.value })}
                            className="text-input"
                            min={new Date().toISOString().split('T')[0]}
                          />
                          <label>Notes (Optional)</label>
                          <textarea
                            value={payment.creditNotes || ''}
                            onChange={(e) => handleUpdateSplitPayment(index, { creditNotes: e.target.value })}
                            className="text-input"
                            placeholder="Add notes about this credit payment..."
                            rows={2}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {getRemainingAmount() > 0.01 && (
                  <button
                    type="button"
                    onClick={handleAddSplitPayment}
                    className="add-split-payment-btn"
                  >
                    + Add Payment Method
                  </button>
                )}
              </div>
            )}

            {/* Cash Payment Details */}
            {paymentMethod === 'cash' && (
              <div className="cash-payment-section">
                <div className="input-group">
                  <label className="input-label">
                    <span className="label-icon"><HandCoins size={16} /></span>
                    Amount Received
                  </label>
                  <div className="input-wrapper">
                    <span className="currency-symbol">KES</span>
                    <input
                      type="number"
                      step="0.01"
                      min={totalAfterDiscount.toFixed(2)}
                      value={amountReceived}
                      onChange={(e) => setAmountReceived(e.target.value)}
                      placeholder={totalAfterDiscount.toFixed(2)}
                      required
                      className={`currency-input ${errors.amountReceived ? 'error' : ''}`}
                      aria-describedby="amount-error"
                    />
                  </div>
                  <span className="input-hint">Minimum: {formatCurrency(totalAfterDiscount)}</span>
                  {errors.amountReceived && (
                    <span id="amount-error" className="error-message">{errors.amountReceived}</span>
                  )}
                </div>

                {amountReceived && parseFloat(amountReceived) >= totalAfterDiscount && (
                  <div className="change-display prominent-change">
                    <div className="change-icon"><HandCoins size={18} /></div>
                    <div className="change-info">
                      <span className="change-label">Change to return:</span>
                      <span className="change-amount">{formatCurrency(change)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Credit Payment Details */}
            {paymentMethod === 'credit' && (
              <div className="credit-payment-section">
                <div className="credit-info-banner">
                  <div className="info-icon">ℹ️</div>
                  <div className="info-text">
                    <strong>Credit Sale</strong>
                    <p>Total amount: {formatCurrency(totalAfterDiscount)} will be added to customer's account</p>
                  </div>
                </div>

                <div className="input-group">
                  <label className="input-label">
                    <span className="label-icon">📅</span>
                    Due Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={creditDueDate}
                    onChange={(e) => setCreditDueDate(e.target.value)}
                    className="text-input"
                    min={new Date().toISOString().split('T')[0]}
                  />
                  <span className="input-hint">When payment is expected</span>
                </div>

                <div className="input-group">
                  <label className="input-label">
                    <span className="label-icon">📝</span>
                    Notes (Optional)
                  </label>
                  <textarea
                    value={creditNotes}
                    onChange={(e) => setCreditNotes(e.target.value)}
                    placeholder="Add any notes about this credit sale..."
                    className="text-input"
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Customer Information Card */}
          <div className="checkout-card customer-card">
            <div className="card-header">
              <h2><UserRound size={16} /> Customer Details</h2>
              <span className={`optional-badge ${paymentMethod === 'credit' ? 'required-badge' : ''}`}>
                {paymentMethod === 'credit' ? 'Required' : 'Optional'}
              </span>
            </div>

            <div className="customer-form">
              <div className="input-group">
                <label className="input-label">
                  <span className="label-icon">👤</span>
                  Customer Name
                  {paymentMethod === 'credit' && <span className="required-indicator">*</span>}
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                  className={`text-input ${errors.customerName ? 'error' : ''}`}
                  required={paymentMethod === 'credit'}
                  aria-describedby="name-error"
                />
                {errors.customerName && (
                  <span id="name-error" className="error-message">{errors.customerName}</span>
                )}
              </div>

              <div className="input-group">
                <label className="input-label">
                  <span className="label-icon">📞</span>
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Enter phone number"
                  className={`text-input ${errors.customerPhone ? 'error' : ''}`}
                  aria-describedby="phone-error"
                />
                {errors.customerPhone && (
                  <span id="phone-error" className="error-message">{errors.customerPhone}</span>
                )}
              </div>
            </div>
          </div>

          {/* Complete Sale Button */}
          <div className="checkout-actions">
            <button
              type="button"
              onClick={onBackToProducts}
              className="secondary-btn"
              disabled={loading}
            >
              <span className="btn-icon">❌</span>
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || (isSplitPayment && !areAllPaymentsCompleted())}
              className="primary-btn complete-sale-btn"
              title={isSplitPayment && !areAllPaymentsCompleted() ? 'Please complete all payments before closing the bill' : ''}
            >
              {loading ? (
                <>
                  <div className="loading-spinner"></div>
                  <span>Processing Sale...</span>
                  {queuedSalesCount > 0 && (
                    <span className="queue-indicator">({queuedSalesCount} in queue)</span>
                  )}
                </>
              ) : (
                <>
                  <span className="btn-icon">
                    {paymentMethod === 'mpesa' && !isSplitPayment ? <Smartphone size={16} /> : '✅'}
                  </span>
                  <span>
                    {isSplitPayment && !areAllPaymentsCompleted()
                      ? `Complete All Payments - ${formatCurrency(totalAfterDiscount)}`
                      : paymentMethod === 'mpesa' && !isSplitPayment
                      ? `Pay with M-Pesa - ${formatCurrency(totalAfterDiscount)}`
                      : `Complete Sale - ${formatCurrency(totalAfterDiscount)}`
                    }
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* M-Pesa Payment Modal */}
      {showMpesaModal && (
        <MpesaPayment
          amount={
            currentMpesaPaymentIndex !== null && isSplitPayment
              ? splitPayments[currentMpesaPaymentIndex]?.amount || 0
              : totalAfterDiscount
          }
          saleData={{
            items: cart.map(item => ({
              productId: item.product.id,
              quantity: item.quantity,
              price: item.product.price,
            })),
            subtotal: subtotalAfterDiscount,
            vat: 0,
            total: currentMpesaPaymentIndex !== null && isSplitPayment
              ? splitPayments[currentMpesaPaymentIndex]?.amount || 0
              : totalAfterDiscount,
            discountAmount,
            customerName: customerName ? sanitizeCustomerName(customerName) : undefined,
            customerPhone: customerPhone ? sanitizePhoneNumber(customerPhone) : undefined,
            isSplitPayment: isSplitPayment && currentMpesaPaymentIndex !== null,
            splitPaymentIndex: currentMpesaPaymentIndex,
          }}
          onSuccess={handleMpesaSuccess}
          onCancel={handleMpesaCancel}
        />
      )}

      {showManagerOverrideModal && (
        <div className="mpesa-payment-modal">
          <div className="mpesa-payment-content" onKeyDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <div className="mpesa-payment-header">
              <h2>Manager Override Approval</h2>
              <button className="close-btn" onClick={() => setShowManagerOverrideModal(false)}>
                ✕
              </button>
            </div>

            <div className="mpesa-payment-body">
              <div className="payment-amount-display">
                <div className="amount-label">Discount Requiring Approval</div>
                <div className="amount-value">KES {effectiveDiscountAmount.toFixed(2)}</div>
              </div>

              <div className="phone-input-section">
                <label className="input-label">Approving Manager</label>
                <select
                  value={managerApproverId}
                  onChange={(e) => setManagerApproverId(e.target.value)}
                  className="phone-input"
                >
                  <option value="">Select manager/admin</option>
                  {managerApprovers.map((approver) => (
                    <option key={approver.id} value={approver.id}>
                      {approver.name || approver.email || approver.id}
                    </option>
                  ))}
                </select>

                <label className="input-label" style={{ marginTop: 8 }}>Manager PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="phone-input"
                  placeholder="Enter manager PIN"
                />

                <label className="input-label" style={{ marginTop: 8 }}>Approval Reason</label>
                <textarea
                  value={managerReason}
                  onChange={(e) => setManagerReason(e.target.value)}
                  className="phone-input"
                  placeholder="Reason for price/discount override"
                  rows={3}
                />

                {managerOverrideError && (
                  <div className="error-message" style={{ marginTop: 8 }}>{managerOverrideError}</div>
                )}

                <div className="mpesa-actions" style={{ marginTop: 12 }}>
                  <button type="button" className="secondary-btn" onClick={() => setShowManagerOverrideModal(false)}>
                    Cancel
                  </button>
                  <button type="button" className="primary-btn" onClick={handleManagerOverrideApprove}>
                    Verify & Approve
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Checkout;
