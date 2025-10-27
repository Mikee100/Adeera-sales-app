import React, { useState, useEffect } from 'react';
import ProductSelection from './ProductSelection';
import Checkout from './Checkout';
import Receipt from './Receipt';
import SyncStatus from './SyncStatus';
import { useAuth } from '../contexts/AuthContext';

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
  const [currentStep, setCurrentStep] = useState<POSStep>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [currentReceipt, setCurrentReceipt] = useState<any>(null);
  const [processingSale, setProcessingSale] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    loadProducts();
  }, [selectedBranch]);

  const loadProducts = async () => {
    try {
      setLoading(true);

      // Check if user is authenticated before loading products
      const token = await window.electronAPI.getAuthToken();
      if (!token) {
        console.error('❌ No authentication token found for loading products');
        alert('Your session has expired. Please log in again.');
        window.location.reload(); // Force logout and redirect to login
        return;
      }

      const response = await window.electronAPI.getProducts() as ProductsResponse;

      if (response.success) {
        setProducts(response.products || []);
      } else {
        console.error('Failed to load products:', response.error);

        // Check if the error is due to authentication
        if (response.error === 'Unauthorized' || response.error?.includes('token') || response.error?.includes('auth')) {
          alert('Your session has expired. Please log in again.');
          window.location.reload(); // Force logout and redirect to login
        } else {
          setProducts([]);
        }
      }
    } catch (error) {
      console.error('Failed to load products:', error);

      // Check if error is related to authentication
      if (error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('token'))) {
        alert('Your session has expired. Please log in again.');
        window.location.reload(); // Force logout and redirect to login
      } else {
        setProducts([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product: Product) => {
    setCart(prevCart => {
      const existing = prevCart.find(item => item.product.id === product.id);
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

    setCart(prevCart =>
      prevCart.map(item =>
        item.product.id === productId
          ? { ...item, quantity }
          : item
      )
    );
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
        console.error('❌ No authentication token found');
        alert('Your session has expired. Please log in again.');
        // Force logout and redirect to login
        window.location.reload(); // This will trigger the auth check and redirect to login
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
        console.error('❌ No branch ID available for sale');
        alert('Cannot complete sale: No branch selected. Please select a branch or ensure your user account has a branch assigned.');
        return;
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

      console.log('Creating sale:', saleData);

      const response = await (window as any).electronAPI.createSale(saleData);

      if (response.success) {
        console.log('Sale completed successfully:', response.sale);

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
        loadProducts();
      } else {
        console.error('Sale failed:', response.error);

        // Check if the error is due to authentication
        if (response.error === 'Unauthorized' || response.error?.includes('token') || response.error?.includes('auth')) {
          alert('Your session has expired. Please log in again.');
          window.location.reload(); // Force logout and redirect to login
        } else {
          alert(`Sale failed: ${response.error}`);
        }
      }
    } catch (error) {
      console.error('Error completing sale:', error);

      // Check if error is related to authentication
      if (error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('token'))) {
        alert('Your session has expired. Please log in again.');
        window.location.reload(); // Force logout and redirect to login
      } else {
        alert('An error occurred while processing the sale. Please try again.');
      }
    } finally {
      setProcessingSale(false);
    }
  };

  const handlePrintReceipt = async () => {
    if (!currentReceipt) return;

    setPrinting(true);
    try {
      const response = await (window as any).electronAPI.printReceipt(currentReceipt);
      if (response.success) {
        console.log('Receipt printed successfully');
      } else {
        console.error('Print failed:', response.error);
        alert(`Print failed: ${response.error}`);
      }
    } catch (error) {
      console.error('Error printing receipt:', error);
      alert('An error occurred while printing the receipt.');
    } finally {
      setPrinting(false);
    }
  };

  const handleNewSale = () => {
    setCurrentStep('products');
    setCurrentReceipt(null);
    setCart([]);
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
