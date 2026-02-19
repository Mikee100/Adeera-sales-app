import React, { useState, useEffect } from 'react';
import ProductSelection from './ProductSelection';
import Checkout from './Checkout';
import Receipt from './Receipt';
import PrintPreview from './PrintPreview';
import SyncStatus from './SyncStatus';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from './Toast';
import { usePendingTransactions } from '../hooks/usePendingTransactions';
import { validateStock, validatePrice, validateSaleData, validateReceiptNumber } from '../utils/validation';
import { auditLogger, AuditEventType } from '../utils/audit-logger';
import { handleError, handleNetworkOperation, ErrorRecovery, AppError } from '../utils/error-handler';

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

const POS: React.FC = () => {
  const { user } = useAuth();
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

  // Load branches on mount and when user changes
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const response = await window.electronAPI.getBranches();
        if (response.success && response.branches) {
          setBranches(response.branches);
          
          // Set default branch: user's branchId or first available branch
          if (!selectedBranch && response.branches.length > 0) {
            const defaultBranchId = user?.branchId || response.branches[0]?.id;
            if (defaultBranchId) {
              setSelectedBranch(defaultBranchId);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load branches:', error);
      }
    };

    if (user) {
      loadBranches();
    }
  }, [user]);

  useEffect(() => {
    loadProducts(0);
  }, [selectedBranch]);

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
        () => window.electronAPI.getProducts() as Promise<ProductsResponse>,
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
        showToast('Products loaded successfully', 'success', 2000);
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
            showToast('Using cached products. Some data may be outdated.', 'warning', 4000);
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
        showToast('Connection error. Using cached products.', 'warning', 4000);
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
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prevCart, { product, quantity: 1 }];
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
          ? { ...cartItem, quantity }
          : cartItem
      );
    });
  };

  const getTotal = () => {
    return cart.reduce((total, item) => total + (item.product.price * item.quantity), 0);
  };

  const getVAT = () => {
    return getTotal() * 0.16; // 16% VAT
  };

  const getGrandTotal = () => {
    return getTotal() + getVAT();
  };

  const handleProceedToCheckout = () => {
    setCurrentStep('checkout');
  };

  const handleBackToProducts = () => {
    setCurrentStep('products');
  };

  const handleCompleteSale = async (paymentData: PaymentData) => {
    setProcessingSale(true);

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
      const branchId = selectedBranch || user?.branchId;
      console.log('  - Final branchId to use:', branchId);

      if (!branchId) {
        const errorMessage = branches.length === 0 
          ? 'No branches available. Please contact your administrator.'
          : 'Please select a branch before completing the sale.';
        
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
        const stockValidation = validateStock(item.product, item.quantity, 0);
        if (!stockValidation.isValid) {
          handleError(
            new AppError(stockValidation.error || 'Insufficient stock', 'INSUFFICIENT_STOCK', {
              operation: 'completeSale',
              component: 'POS',
              userId: user?.id,
              userName: user?.name,
              metadata: {
                productId: item.product.id,
                productName: item.product.name,
                requestedQuantity: item.quantity,
                availableStock: item.product.stock,
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

      // Prepare sale data (include discount so backend applies it before VAT)
      // For variation items: productId = base product, variationId = variation
      // Ensure all numeric fields are numbers for backend validation
      const saleData = {
        items: cart.map(item => {
          const productPrice = item.product.price;
          const priceValue = (productPrice != null && !isNaN(Number(productPrice))) 
            ? Number(productPrice) 
            : undefined;
          
          const base: { productId: string; quantity: number; price?: number; variationId?: string } = {
            productId: (item.product as any).baseProductId || item.product.id,
            quantity: Number(item.quantity) || 1,
          };
          
          // Only include price if it's a valid number (price is optional in DTO)
          if (priceValue != null && priceValue >= 0) {
            base.price = priceValue;
          }
          
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
      if (saleData.branchId) cleanSaleData.branchId = String(saleData.branchId);
      if (saleData.customerName) cleanSaleData.customerName = String(saleData.customerName);
      if (saleData.customerPhone) cleanSaleData.customerPhone = String(saleData.customerPhone);
      if (saleData.amountReceived != null) cleanSaleData.amountReceived = Number(saleData.amountReceived);
      if (saleData.discountAmount != null && saleData.discountAmount > 0) {
        cleanSaleData.discountAmount = Number(saleData.discountAmount);
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
            cleanSaleData.creditNotes = String(paymentData.creditNotes);
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

      if (response.success) {
        console.log('Sale completed successfully:', response.sale);

        // Validate receipt number and transaction integrity
        if (response.receipt?.saleId) {
          const receiptNumberValidation = validateReceiptNumber(response.receipt.saleId);
          if (!receiptNumberValidation.isValid) {
            showToast('Warning: Receipt number validation issue detected', 'warning');
            auditLogger.log(
              AuditEventType.SECURITY_VIOLATION,
              { receiptId: response.receipt.saleId, reason: receiptNumberValidation.error },
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
              { receiptId: response.receipt.saleId, reason: integrityCheck.error },
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
            saleId: response.sale?.saleId || response.receipt?.saleId,
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

        // Set receipt data with branch information
        const receiptWithBranch = {
          ...response.receipt,
          branch: user?.branchId ? {
            id: user.branchId,
            name: user.branchName || `Branch ${user.branchId}`,
            address: user.branchAddress
          } : selectedBranch ? {
            id: selectedBranch,
            name: `Branch ${selectedBranch}`,
            address: undefined
          } : undefined
        };
        setCurrentReceipt(receiptWithBranch);
        setCurrentStep('receipt');

        // Reload products to update stock
        loadProducts(0);
      } else {
        console.error('Sale failed:', response.error);

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
                showToast('Sale held. You can retry later.', 'info', 4000);
              },
            }
          );
        }
      }
    } catch (error) {
      console.error('Error completing sale:', error);

      // Handle error with recovery options
      if (error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('token'))) {
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
        handleError(error, {
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
            showToast('Sale held due to error. You can retry later.', 'info', 4000);
          },
        });
      }
    } finally {
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

  return (
    <div className="pos-app">

      {currentStep === 'products' && (
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
          getVAT={getVAT}
          getGrandTotal={getGrandTotal}
          branches={branches}
          selectedBranch={selectedBranch}
          onBranchChange={setSelectedBranch}
        />
      )}

      {currentStep === 'checkout' && (
        <Checkout
          cart={cart}
          subtotal={getTotal()}
          vat={getVAT()}
          total={getGrandTotal()}
          onCompleteSale={handleCompleteSale}
          onBackToProducts={handleBackToProducts}
          loading={processingSale}
        />
      )}

      {currentStep === 'receipt' && (
        <Receipt
          receipt={currentReceipt}
          onPrint={handleShowPrintPreview}
          onNewSale={handleNewSale}
          printing={printing}
        />
      )}

      {currentStep === 'print-preview' && (
        <PrintPreview
          receipt={currentReceipt}
          onPrint={handlePrintReceipt}
          onBack={handleBackFromPrintPreview}
          onPrintViaBrowser={handlePrintViaBrowser}
          printing={printing}
        />
      )}
    </div>
  );
};

export default POS;
