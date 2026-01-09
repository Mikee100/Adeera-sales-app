import React, { useState, useEffect } from 'react';
import ProductSelection from './ProductSelection';
import Checkout from './Checkout';
import Receipt from './Receipt';
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

interface PaymentData {
  paymentMethod: 'cash' | 'mpesa';
  amountReceived?: number;
  customerName?: string;
  customerPhone?: string;
}

interface ProductsResponse {
  success: boolean;
  products?: Product[];
  error?: string;
}

type POSStep = 'products' | 'checkout' | 'receipt';

const POS: React.FC = () => {
  const { user } = useAuth();
  const { pendingTransactions, holdTransaction, resumeTransaction, deleteTransaction } = usePendingTransactions();
  const [currentStep, setCurrentStep] = useState<POSStep>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [currentReceipt, setCurrentReceipt] = useState<any>(null);
  const [processingSale, setProcessingSale] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    loadProducts(0);
  }, [selectedBranch]);

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
      console.log('  - User object:', user);

      // Check if branch ID is available
      const branchId = user?.branchId || selectedBranch;
      console.log('  - Final branchId to use:', branchId);

      if (!branchId) {
        handleError(
          new AppError('Branch ID is required to complete sale', 'VALIDATION_ERROR', {
            operation: 'completeSale',
            component: 'POS',
            userId: user?.id,
            userName: user?.name,
            metadata: { branchId, userBranchId: user?.branchId, selectedBranch },
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

      // Prepare sale data
      const saleData = {
        items: cart.map(item => ({
          productId: item.product.id,
          quantity: item.quantity,
          price: item.product.price,
        })),
        paymentMethod: paymentData.paymentMethod,
        amountReceived: paymentData.amountReceived,
        customerName: paymentData.customerName,
        customerPhone: paymentData.customerPhone,
        branchId: branchId,
        idempotencyKey: `sale_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      };

      // Validate sale data integrity
      const saleValidation = validateSaleData(saleData);
      if (!saleValidation.isValid) {
        handleError(
          new AppError(saleValidation.error || 'Sale data validation failed', 'VALIDATION_ERROR', {
            operation: 'completeSale',
            component: 'POS',
            userId: user?.id,
            userName: user?.name,
            metadata: { saleData },
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

      console.log('Creating sale:', saleData);

      // Use network operation handler with retry logic
      const response = await handleNetworkOperation(
        () => (window as any).electronAPI.createSale(saleData),
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
        if (response.error === 'Unauthorized' || response.error?.includes('token') || response.error?.includes('auth')) {
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
      <SyncStatus />

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
          onPrint={handlePrintReceipt}
          onNewSale={handleNewSale}
          printing={printing}
        />
      )}
    </div>
  );
};

export default POS;
