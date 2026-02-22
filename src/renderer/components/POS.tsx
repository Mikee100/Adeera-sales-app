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
import { sanitizeCustomerName, sanitizePhoneNumber, sanitizeNotes } from '../utils/sanitization';
import { saleMutex } from '../utils/sale-mutex';
import { detectStockConflict } from '../../shared/stock-conflict-handler';
import { retrySaleWithRefresh } from '../utils/stock-conflict-handler';

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
  const [queuedSalesCount, setQueuedSalesCount] = useState(0);

  // Update queue count periodically when processing or when queue exists
  useEffect(() => {
    const updateQueueCount = () => {
      const status = saleMutex.getStatus();
      setQueuedSalesCount(status.queueSize);
    };

    // Update immediately
    updateQueueCount();

    // Update periodically if processing or queue exists
    const interval = setInterval(updateQueueCount, 500); // Update every 500ms
    return () => clearInterval(interval);
  }, [processingSale]);

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

  // Check catalog sync status periodically and show warning if stale
  useEffect(() => {
    const checkCatalogStatus = async () => {
      try {
        const status = await (window as any).electronAPI.getCatalogSyncStatus();
        if (status.success && status.isStale && status.hasCatalog) {
          showToast(
            `Product catalog is outdated (${status.ageHours?.toFixed(1)} hours old). Please sync products from Settings.`,
            'warning',
            8000
          );
        }
      } catch (error) {
        // Silently fail - not critical
      }
    };

    // Check immediately and then every 5 minutes
    checkCatalogStatus();
    const interval = setInterval(checkCatalogStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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
    // Use mutex to prevent concurrent sale processing
    try {
      await saleMutex.acquire(paymentData, async (queuedPaymentData) => {
        setProcessingSale(true);
        setQueuedSalesCount(saleMutex.getQueueSize());

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
          // SECURITY: Sanitize all user inputs before sending to backend
          if (saleData.branchId) cleanSaleData.branchId = String(saleData.branchId);
          if (saleData.customerName) cleanSaleData.customerName = sanitizeCustomerName(saleData.customerName);
          if (saleData.customerPhone) cleanSaleData.customerPhone = sanitizePhoneNumber(saleData.customerPhone);
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
              const refreshResponse = await window.electronAPI.getProducts();
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

          if (response.success) {
            console.log('Sale completed successfully:', response.sale);
            
            // Check for queue warnings if sale was queued offline
            if (response.queueSize !== undefined) {
              if (response.isCritical) {
                showToast(
                  `⚠️ Offline sales queue is FULL (${response.queueSize}/${response.maxQueueSize}). Please sync immediately!`,
                  'error',
                  10000
                );
              } else if (response.isWarning) {
                showToast(
                  `⚠️ Large offline sales queue: ${response.queueSize} sales. Consider syncing soon.`,
                  'warning',
                  6000
                );
              }
            }
            
            // CRITICAL: Refresh products from backend after successful sale to get accurate stock
            // The backend has already updated stock, so we need fresh data to prevent race conditions
            try {
              console.log('Refreshing products after successful sale');
              await loadProducts(0);
              showToast('Products refreshed with latest stock levels', 'success', 3000);
            } catch (error) {
              console.warn('Failed to refresh products after sale (non-critical)', error);
              // Don't fail the sale if refresh fails - will sync on next periodic sync
            }

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

            const branchFromList = branchId ? branches.find((b) => b.id === branchId) : undefined;
            const saleId = response.receipt?.saleId || response.sale?.saleId;

            // Prefer full receipt from GET /sales/:id/receipt so we always get businessInfo (name, KRA, etc.)
            let receiptToShow = response.receipt;
            try {
              const getReceiptResult = await (window as any).electronAPI?.getReceipt?.(saleId);
              if (getReceiptResult?.success && getReceiptResult?.receipt) {
                receiptToShow = getReceiptResult.receipt;
              }
            } catch (_) {
              // Keep create-sale receipt if fetch fails
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
            console.error('Sale failed:', response.error);

            // Check if this is a stock conflict error
            const stockConflict = detectStockConflict({ message: response.error, data: response });
            
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
                showToast(
                  'Products refreshed. Please review stock levels and try the sale again.',
                  'info',
                  6000
                );
              } catch (refreshError) {
                console.error('Failed to refresh products after stock conflict:', refreshError);
                showToast('Failed to refresh products. Please try manually.', 'error', 5000);
              }

              // Don't proceed with error handling - let user retry manually
              return;
            }

            // Auto-sync products if error is related to invalid/missing product
            const errorLower = (response.error || '').toLowerCase();
            if (errorLower.includes('invalid product') || 
                errorLower.includes('product') && errorLower.includes('not found') ||
                errorLower.includes('product') && errorLower.includes('deleted')) {
              showToast('Product catalog may be outdated. Syncing products...', 'warning', 4000);
              // Trigger product sync in background
              setTimeout(async () => {
                try {
                  const syncResult = await (window as any).electronAPI.syncProducts();
                  if (syncResult.success) {
                    showToast(`Products synced! ${syncResult.products?.length || 0} products loaded.`, 'success', 5000);
                    // Reload products in UI
                    loadProducts(0);
                  } else {
                    showToast('Failed to sync products. Please try manually from Settings.', 'error', 5000);
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
                    showToast('Sale held. You can retry later.', 'info', 4000);
                  },
                }
              );
            }
          }
        } finally {
          setProcessingSale(false);
          setQueuedSalesCount(saleMutex.getQueueSize());
        }
      });
    } catch (mutexError) {
      // Handle mutex-specific errors (e.g., queue full)
      if (mutexError instanceof Error && mutexError.message.includes('queue is full')) {
        showToast(mutexError.message, 'error', 6000);
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
            showToast(
              'Products refreshed. Please review stock levels and try the sale again.',
              'info',
              6000
            );
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
              showToast('Sale held due to error. You can retry later.', 'info', 4000);
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
          queuedSalesCount={queuedSalesCount}
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
