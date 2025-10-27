import React, { useState, useEffect } from 'react';
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

interface ProductsResponse {
  success: boolean;
  products?: Product[];
  error?: string;
}

interface ProductSelectionProps {
  cart: CartItem[];
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveFromCart: (productId: string) => void;
  onProceedToCheckout: () => void;
  getTotal: () => number;
  getVAT: () => number;
  getGrandTotal: () => number;
}

const ProductSelection: React.FC<ProductSelectionProps> = ({
  cart,
  onAddToCart,
  onUpdateQuantity,
  onRemoveFromCart,
  onProceedToCheckout,
  getTotal,
  getVAT,
  getGrandTotal
}) => {
  const { logout } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [selectedVariation, setSelectedVariation] = useState<{ [productId: string]: string }>({});

  useEffect(() => {
    loadProducts();
  }, [selectedBranch]);

  const loadProducts = async () => {
    try {
      setLoading(true);

      const response = await window.electronAPI.getProducts() as ProductsResponse;

      if (response.success) {
        setProducts(response.products || []);
      } else {
        console.error('Failed to load products:', response.error);
        setProducts([]);
      }
    } catch (error) {
      console.error('Failed to load products:', error);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  // Get unique categories
  const categories = ['all', ...Array.from(new Set(products.map(p => p.category?.name).filter(Boolean)))];

  // FIXED: Handle null/undefined product names and SKUs safely
  const filteredProducts = products.filter(product => {
    const nameMatch = product.name ? product.name.toLowerCase().includes(searchTerm.toLowerCase()) : false;
    const skuMatch = product.sku ? product.sku.toLowerCase().includes(searchTerm.toLowerCase()) : false;
    const categoryMatch = selectedCategory === 'all' || product.category?.name === selectedCategory;
    return (nameMatch || skuMatch) && categoryMatch;
  });

  const handleAddToCart = (product: Product) => {
    if (product.hasVariations && product.variations && product.variations.length > 0) {
      // If product has variations, show variation selector
      const selectedVariationId = selectedVariation[product.id];
      if (selectedVariationId) {
        const variation = product.variations.find(v => v.id === selectedVariationId);
        if (variation) {
          const variationProduct = {
            ...product,
            id: variation.id,
            sku: variation.sku,
            price: variation.price || product.price,
            stock: variation.stock,
            variationAttributes: variation.attributes
          };
          onAddToCart(variationProduct);
        }
      } else {
        // Show variation selector modal or alert
        alert('Please select a variation first');
      }
    } else {
      onAddToCart(product);
    }
  };

  return (
    <div className="pos-container">
      <div className="pos-header">
        <h1>🛍️ SaaS POS - Product Selection</h1>
        <div className="header-controls">
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="branch-select"
          >
            <option value="">All Branches</option>
            <option value="branch1">Main Branch</option>
            <option value="branch2">Downtown Branch</option>
          </select>
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
      </div>

      <div className="pos-content">
        <div className="products-section">
          <div className="search-bar">
            <input
              type="text"
              placeholder="🔍 Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="category-select"
            >
              {categories.map(category => (
                <option key={category} value={category}>
                  {category === 'all' ? 'All Categories' : category}
                </option>
              ))}
            </select>
          </div>

          <div className="products-grid">
            {loading ? (
              <div className="loading">Loading products...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="loading">No products found</div>
            ) : (
              filteredProducts.map(product => (
                <div key={product.id} className="product-card">
                  {product.category && (
                    <div className="product-category">
                      {product.category.name}
                    </div>
                  )}
                  {product.images && product.images.length > 0 && (
                    <div className="product-image">
                      <img
                        src={product.images[0]}
                        alt={product.name || 'Product'}
                        style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '4px' }}
                      />
                    </div>
                  )}
                  <div className="product-info">
                    <h3>{product.name || 'Unnamed Product'}</h3>
                    <p className="sku">SKU: {product.sku || 'N/A'}</p>
                    <p className="price">${product.price?.toFixed(2) || '0.00'}</p>
                    <p className="stock">Stock: {product.stock || 0}</p>
                    {product.hasVariations && product.variations && product.variations.length > 0 && (
                      <div className="variations-selector">
                        <select
                          value={selectedVariation[product.id] || ''}
                          onChange={(e) => setSelectedVariation(prev => ({ ...prev, [product.id]: e.target.value }))}
                          className="variation-select"
                        >
                          <option value="">Select Variation</option>
                          {product.variations.map(variation => (
                            <option key={variation.id} value={variation.id}>
                              {variation.sku} - ${variation.price?.toFixed(2) || product.price.toFixed(2)} (Stock: {variation.stock})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleAddToCart(product)}
                    className="add-to-cart-btn"
                    disabled={(product.stock || 0) <= 0}
                  >
                    Add to Cart
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="cart-section">
          <h2>🛒 Current Sale</h2>

          <div className="cart-items">
            {cart.length === 0 ? (
              <p className="empty-cart">No items in cart</p>
            ) : (
              cart.map(item => (
                <div key={item.product.id} className="cart-item">
                  <div className="item-info">
                    <h4>{item.product.name || 'Unnamed Product'}</h4>
                    <p className="sku">SKU: {item.product.sku || 'N/A'}</p>
                    {(item.product as any).variationAttributes && (
                      <p className="variation-info">
                        Variation: {Object.entries((item.product as any).variationAttributes).map(([key, value]) => `${key}: ${value}`).join(', ')}
                      </p>
                    )}
                    <p>${item.product.price?.toFixed(2) || '0.00'} each</p>
                  </div>
                  <div className="item-controls">
                    <button
                      onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
                      className="quantity-btn"
                    >
                      -
                    </button>
                    <span className="quantity">{item.quantity}</span>
                    <button
                      onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
                      className="quantity-btn"
                    >
                      +
                    </button>
                    <button
                      onClick={() => onRemoveFromCart(item.product.id)}
                      className="remove-btn"
                    >
                      ×
                    </button>
                  </div>
                  <div className="item-total">
                    ${((item.product.price || 0) * item.quantity).toFixed(2)}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="cart-summary">
            <div className="summary-row">
              <span>Subtotal:</span>
              <span>${getTotal().toFixed(2)}</span>
            </div>
            <div className="summary-row">
              <span>VAT (16%):</span>
              <span>${getVAT().toFixed(2)}</span>
            </div>
            <div className="summary-row total">
              <span>Total:</span>
              <span>${getGrandTotal().toFixed(2)}</span>
            </div>
          </div>

          <div className="checkout-section">
            <button
              onClick={onProceedToCheckout}
              className="checkout-btn proceed"
              disabled={cart.length === 0}
            >
              Proceed to Checkout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductSelection;
