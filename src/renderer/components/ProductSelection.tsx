import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, CircleOff, ImageIcon, ScanLine } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from './Toast';
import { PendingTransaction } from '../hooks/usePendingTransactions';
import { validateStock, validatePrice } from '../utils/validation';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import useDebounce from '../hooks/useDebounce';
import '../pending-transactions.css';
import '../barcode-scanner.css';

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
    images?: string[];
    attributes?: Record<string, string>;
  }>;
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

interface Branch {
  id: string;
  name: string;
  [key: string]: any;
}

interface ProductSelectionProps {
  cart: CartItem[];
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveFromCart: (productId: string) => void;
  onProceedToCheckout: () => void;
  onHoldTransaction?: () => void;
  onResumeTransaction?: (transactionId: string) => void;
  onDeletePendingTransaction?: (transactionId: string) => void;
  pendingTransactions?: PendingTransaction[];
  getTotal: () => number;
  getGrandTotal: () => number;
  selectedBranch?: string;
}

const ProductSelection: React.FC<ProductSelectionProps> = ({
  cart,
  onAddToCart,
  onUpdateQuantity,
  onRemoveFromCart,
  onProceedToCheckout,
  onHoldTransaction,
  onResumeTransaction,
  onDeletePendingTransaction,
  pendingTransactions = [],
  getTotal,
  getGrandTotal,
  selectedBranch: propSelectedBranch = ''
}) => {
  const { user, logout } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 400);
  const selectedBranch = propSelectedBranch;
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [selectedProductForVariation, setSelectedProductForVariation] = useState<Product | null>(null);
  const [modalVariations, setModalVariations] = useState<Array<{ id: string; sku: string; price?: number | null; stock: number; images?: string[]; attributes?: Record<string, string> }>>([]);
  const [loadingVariations, setLoadingVariations] = useState(false);
  const [variationSearchTerm, setVariationSearchTerm] = useState('');
  const [variationColorFilter, setVariationColorFilter] = useState<string>('all');
  const [variationSizeFilter, setVariationSizeFilter] = useState<string>('all');
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [showBarcodeHelp, setShowBarcodeHelp] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sessionExpiryHandledRef = useRef(false);

  const resolveImageSrc = useCallback((rawImage?: string | null): string => {
    const image = typeof rawImage === 'string' ? rawImage.trim() : '';
    if (!image) return '';

    if (/^(https?:|data:|blob:|file:)/i.test(image)) {
      return image;
    }

    const safeBase = (apiBaseUrl || '').trim();
    if (!safeBase) {
      return image;
    }

    const normalizedBase = safeBase.replace(/\/+$/, '');
    const mediaBase = normalizedBase.replace(/\/api$/i, '');
    const normalizedPath = image.startsWith('/') ? image : `/${image}`;
    const selectedBase = normalizedPath.startsWith('/uploads/') ? mediaBase : normalizedBase;

    try {
      return new URL(normalizedPath, `${selectedBase}/`).toString();
    } catch {
      return `${selectedBase}${normalizedPath}`;
    }
  }, [apiBaseUrl]);

  const formatCurrency = useCallback((amount: number) => {
    return `KES ${(Number(amount) || 0).toFixed(2)}`;
  }, []);

  const getVariationAttribute = useCallback((variation: { attributes?: Record<string, string> }, keyHint: 'color' | 'size') => {
    const attrs = variation.attributes || {};
    const matched = Object.entries(attrs).find(([key]) => key.toLowerCase().includes(keyHint));
    return matched?.[1] || '';
  }, []);

  const swatchStyleForColor = useCallback((colorValue: string) => {
    const normalized = colorValue.trim().toLowerCase();
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
  }, []);

  const handleSessionExpired = useCallback(async (message: string) => {
    if (sessionExpiryHandledRef.current) {
      return;
    }
    sessionExpiryHandledRef.current = true;
    showToast(message, 'warning', 2500);
    await logout();
  }, [logout]);

  useEffect(() => {
    const loadApiBaseUrl = async () => {
      try {
        const baseUrl = await window.electronAPI.getApiBaseUrl();
        if (typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
          setApiBaseUrl(baseUrl.trim());
        }
      } catch {
        // Keep empty API base URL and fall back to raw image paths
      }
    };

    loadApiBaseUrl();
  }, []);

  // Barcode scanner hook
  const { isScanning, clearScan } = useBarcodeScanner({
    onScan: (barcode) => {
      handleBarcodeScan(barcode);
    },
    minLength: 3,
    maxLength: 50,
    timeout: 100,
    enabled: true,
  });

  useEffect(() => {
    loadProducts();
  }, [selectedBranch]);

  useEffect(() => {
    if (!showVariationModal) return;

    const handleEscClose = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeVariationModal();
      }
    };

    window.addEventListener('keydown', handleEscClose);
    return () => window.removeEventListener('keydown', handleEscClose);
  }, [showVariationModal]);

  // Keyboard shortcut: Ctrl/Cmd + K focuses the search box for faster checkout
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't override when user is already typing in another input
      if (target.closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle barcode scan
  const handleBarcodeScan = (barcode: string) => {
    setScannedBarcode(barcode);
    // Auto-hide help when scanning
    setShowBarcodeHelp(false);
    
    // Search for product by barcode/SKU
    const foundProduct = products.find(
      (product) =>
        product.sku?.toLowerCase() === barcode.toLowerCase() ||
        product.id === barcode ||
        (product as any).barcode === barcode
    );

    if (foundProduct) {
      // Check stock before adding
      const existingCartItem = cart.find(item => item.product.id === foundProduct.id);
      const currentCartQuantity = existingCartItem ? existingCartItem.quantity : 0;
      
      const stockValidation = validateStock(foundProduct, 1, currentCartQuantity);
      if (stockValidation.isValid) {
        // Add to cart
        onAddToCart(foundProduct);
        showToast(`Scanned: ${foundProduct.name}`, 'success', 2000);
      } else {
        showToast(`Cannot add ${foundProduct.name}: ${stockValidation.error}`, 'error');
      }
    } else {
      // Product not found - update search term to help user find it
      setSearchTerm(barcode);
      showToast(`Barcode "${barcode}" not found. Showing search results.`, 'warning', 3000);
    }

    // Clear scanned barcode after a delay
    setTimeout(() => {
      setScannedBarcode(null);
      clearScan();
    }, 3000);
  };

  const loadProducts = async () => {
    try {
      setLoading(true);

      const response = await window.electronAPI.getProducts(selectedBranch || undefined) as ProductsResponse;

      if (response.success) {
        setProducts(response.products || []);
      } else {
        const authError =
          response.error?.includes('authentication') ||
          response.error?.includes('Unauthorized') ||
          response.error?.includes('token') ||
          response.error?.includes('auth');
        if (authError) {
          await handleSessionExpired('Session expired. Redirecting to login...');
          return;
        }
        console.error('Failed to load products:', response.error);
        setProducts([]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      const authError =
        message.includes('authentication') ||
        message.includes('Unauthorized') ||
        message.includes('token') ||
        message.includes('auth');
      if (authError) {
        await handleSessionExpired('Session expired. Redirecting to login...');
        return;
      }
      console.error('Failed to load products:', error);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  // Get unique categories
  const categories = useMemo(
    () => ['all', ...Array.from(new Set(products.map(p => p.category?.name).filter(Boolean)))],
    [products]
  );

  // Faster, more forgiving search:
  // - token-based (supports "blue large" etc.)
  // - searches name, SKU, barcode, and category
  // - still works with debounced input for performance
  const filteredProducts = useMemo(() => {
    const term = debouncedSearchTerm.trim().toLowerCase();
    const tokens = term.split(/\s+/).filter(Boolean);

    return products.filter(product => {
      const haystackParts = [
        product.name || '',
        product.sku || '',
        (product as any).barcode || '',
        product.category?.name || '',
      ];
      const haystack = haystackParts.join(' ').toLowerCase();

      const textMatch = tokens.length === 0
        ? true
        : tokens.every(token => haystack.includes(token));

      const categoryMatch =
        selectedCategory === 'all' || product.category?.name === selectedCategory;

      return textMatch && categoryMatch;
    });
  }, [products, debouncedSearchTerm, selectedCategory]);

  type Variation = { id: string; sku: string; price?: number | null; stock: number; attributes?: Record<string, string> };

  type VariationWithImage = Variation & { images?: string[] };

  const mapVariation = (v: any): VariationWithImage => ({
    id: v.id,
    sku: v.sku,
    price: v.price != null ? parseFloat(v.price) : null,
    stock: parseInt(v.stock) || 0,
    images: Array.isArray(v.images) ? v.images : [],
    attributes: v.attributes || {},
  });

  const closeVariationModal = () => {
    setShowVariationModal(false);
    setSelectedProductForVariation(null);
    setVariationSearchTerm('');
    setVariationColorFilter('all');
    setVariationSizeFilter('all');
  };

  const handleProductClick = async (product: Product) => {
    const hasAnyVariations =
      product.hasVariations || (product.variations && product.variations.length > 0);

    // Fast path: products without variations go straight to cart (no modal)
    if (!hasAnyVariations) {
      handleAddBaseProductToCart(product);
      return;
    }

    setSelectedProductForVariation(product);
    setShowVariationModal(true);
    setVariationSearchTerm('');
    setVariationColorFilter('all');
    setVariationSizeFilter('all');
    // Use product.variations immediately if available (from products list with includeVariations)
    const fromProduct = (product.variations || []).map(mapVariation);
    if (fromProduct.length > 0) {
      setModalVariations(fromProduct);
      setLoadingVariations(false);
      return;
    }
    setModalVariations([]);
    setLoadingVariations(true);
    try {
      const res = await window.electronAPI.getProductVariations(product.id);
      const vars = (res.variations || []).map(mapVariation);
      setModalVariations(vars.length > 0 ? vars : fromProduct);
      if (!res.success && (res as any).unauthorized) {
        await handleSessionExpired('Session expired. Redirecting to login...');
      }
    } catch {
      // API failed - fall back to product.variations if we have them
      setModalVariations(fromProduct);
    } finally {
      setLoadingVariations(false);
    }
  };

  const handleAddVariationToCart = (product: Product, variation: Variation) => {
    const variationProduct = {
      ...product,
      id: variation.id,
      sku: variation.sku,
      price: variation.price ?? product.price,
      stock: variation.stock,
      images: Array.isArray((variation as any).images) && (variation as any).images.length > 0
        ? (variation as any).images
        : (product.images || []),
      variationAttributes: variation.attributes,
      baseProductId: product.id,
      variationId: variation.id,
    };
    const variationPriceValidation = validatePrice(variationProduct.price);
    if (!variationPriceValidation.isValid) {
      showToast(`Cannot add: ${variationPriceValidation.error}`, 'error');
      return;
    }
    const existingCartItem = cart.find(item => item.product.id === variationProduct.id);
    const currentCartQuantity = existingCartItem ? existingCartItem.quantity : 0;
    const stockValidation = validateStock(variationProduct, 1, currentCartQuantity);
    if (!stockValidation.isValid) {
      showToast(stockValidation.error || 'Insufficient stock', 'error');
      return;
    }
    onAddToCart(variationProduct);
    closeVariationModal();
  };

  const handleAddBaseProductToCart = (product: Product) => {
    const priceValidation = validatePrice(product.price);
    if (!priceValidation.isValid) {
      showToast(`Cannot add ${product.name}: ${priceValidation.error}`, 'error');
      return;
    }
    const existingCartItem = cart.find(item => item.product.id === product.id);
    const currentCartQuantity = existingCartItem ? existingCartItem.quantity : 0;
    const stockValidation = validateStock(product, 1, currentCartQuantity);
    if (!stockValidation.isValid) {
      showToast(stockValidation.error || 'Insufficient stock', 'error');
      return;
    }
    onAddToCart(product);
    closeVariationModal();
  };

  const filteredModalVariations = modalVariations
    .filter((variation) => {
      const label =
        variation.attributes && Object.keys(variation.attributes).length > 0
          ? Object.entries(variation.attributes).map(([k, v]) => `${k}: ${v}`).join(', ')
          : variation.sku;

      const colorValue = getVariationAttribute(variation, 'color');
      const sizeValue = getVariationAttribute(variation, 'size');
      const colorMatch = variationColorFilter === 'all' || colorValue.toLowerCase() === variationColorFilter.toLowerCase();
      const sizeMatch = variationSizeFilter === 'all' || sizeValue.toLowerCase() === variationSizeFilter.toLowerCase();

      const searchableText = `${label} ${variation.sku}`.toLowerCase();
      return searchableText.includes(variationSearchTerm.trim().toLowerCase()) && colorMatch && sizeMatch;
    })
    .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0));

  const availableVariantColors = useMemo(() => {
    const colors = modalVariations
      .map((variation) => getVariationAttribute(variation, 'color'))
      .filter((value) => value.trim().length > 0);
    return Array.from(new Set(colors));
  }, [getVariationAttribute, modalVariations]);

  const availableVariantSizes = useMemo(() => {
    const sizes = modalVariations
      .map((variation) => getVariationAttribute(variation, 'size'))
      .filter((value) => value.trim().length > 0);
    return Array.from(new Set(sizes));
  }, [getVariationAttribute, modalVariations]);

  return (
    <div className="pos-container">
      {showVariationModal && selectedProductForVariation && (
        <div className="variation-modal-overlay" onClick={closeVariationModal}>
          <div className="variation-modal" onClick={e => e.stopPropagation()}>
            <div className="variation-modal-header">
              <h2>Select Variation</h2>
              <p className="variation-modal-product-name">{selectedProductForVariation.name}</p>
              <div className="variation-modal-toolbar">
                <input
                  type="text"
                  value={variationSearchTerm}
                  onChange={(e) => setVariationSearchTerm(e.target.value)}
                  placeholder="Search variant by size, color, or SKU..."
                  className="variation-search-input"
                  autoFocus
                />
              </div>
              <button
                type="button"
                className="variation-modal-close"
                onClick={closeVariationModal}
                title="Close"
                aria-label="Close variation modal"
              >
                ×
              </button>
            </div>
            <div className="variation-modal-list">
              {(availableVariantColors.length > 0 || availableVariantSizes.length > 0) && (
                <div className="variation-filters">
                  {availableVariantColors.length > 0 && (
                    <div className="variation-filter-group">
                      <span className="variation-filter-label">Color</span>
                      <div className="variation-filter-row">
                        <button
                          type="button"
                          className={`swatch-filter-btn ${variationColorFilter === 'all' ? 'is-active' : ''}`}
                          onClick={() => setVariationColorFilter('all')}
                        >
                          All
                        </button>
                        {availableVariantColors.map((color) => {
                          const swatchStyle = swatchStyleForColor(color);
                          return (
                            <button
                              key={color}
                              type="button"
                              className={`swatch-filter-btn ${variationColorFilter === color ? 'is-active' : ''}`}
                              onClick={() => setVariationColorFilter(color)}
                              title={color}
                            >
                              {swatchStyle ? <span className="variant-swatch" style={swatchStyle} /> : null}
                              <span>{color}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {availableVariantSizes.length > 0 && (
                    <div className="variation-filter-group">
                      <span className="variation-filter-label">Size</span>
                      <div className="variation-filter-row">
                        <button
                          type="button"
                          className={`size-filter-btn ${variationSizeFilter === 'all' ? 'is-active' : ''}`}
                          onClick={() => setVariationSizeFilter('all')}
                        >
                          All
                        </button>
                        {availableVariantSizes.map((size) => (
                          <button
                            key={size}
                            type="button"
                            className={`size-filter-btn ${variationSizeFilter === size ? 'is-active' : ''}`}
                            onClick={() => setVariationSizeFilter(size)}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {loadingVariations ? (
                <p className="variation-modal-empty">Loading variations...</p>
              ) : modalVariations.length === 0 ? (
                <div className="variation-modal-empty">
                  <p>No variations for this product.</p>
                  <button
                    type="button"
                    className="add-base-product-btn"
                    onClick={() => selectedProductForVariation && handleAddBaseProductToCart(selectedProductForVariation)}
                  >
                    Add base product to cart
                  </button>
                </div>
              ) : filteredModalVariations.length === 0 ? (
                <div className="variation-modal-empty">
                  <p>No matching variations found.</p>
                </div>
              ) : filteredModalVariations.map(variation => {
                const attrsLabel = variation.attributes && typeof variation.attributes === 'object'
                  ? Object.entries(variation.attributes).map(([k, v]) => `${k}: ${v}`).join(', ')
                  : variation.sku;
                const colorValue = getVariationAttribute(variation, 'color');
                const sizeValue = getVariationAttribute(variation, 'size');
                const swatchStyle = swatchStyleForColor(colorValue);
                const price = variation.price ?? selectedProductForVariation!.price;
                const hasStock = variation.stock > 0;
                const variationImage =
                  (Array.isArray((variation as any).images) && (variation as any).images.length > 0
                    ? (variation as any).images[0]
                    : (selectedProductForVariation?.images?.[0] || ''));
                const variationImageSrc = resolveImageSrc(variationImage);
                return (
                  <button
                    key={variation.id}
                    type="button"
                    disabled={!hasStock}
                    className={`variation-card ${hasStock ? '' : 'variation-card-out-of-stock'}`}
                    onClick={() => hasStock && selectedProductForVariation && handleAddVariationToCart(selectedProductForVariation, variation)}
                  >
                    {variationImageSrc && (
                      <div className="variation-card-image">
                        <img
                          src={variationImageSrc}
                          alt={attrsLabel || variation.sku}
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    <div className="variation-card-main">
                      <span className="variation-card-label">{attrsLabel || variation.sku}</span>
                      {(colorValue || sizeValue) && (
                        <span className="variation-card-attributes">
                          {swatchStyle ? <span className="variant-swatch" style={swatchStyle} title={colorValue || 'Color'} /> : null}
                          {sizeValue ? <span className="variant-size-tag">{sizeValue}</span> : null}
                        </span>
                      )}
                      <span className="variation-card-sku">SKU: {variation.sku}</span>
                      <span className="variation-card-price">{formatCurrency(price ?? 0)}</span>
                    </div>
                    <span className={`variation-card-stock ${hasStock ? 'in-stock' : 'out-of-stock'}`}>
                      {hasStock ? `${variation.stock} in stock` : 'Out of stock'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="pos-content">
        <div className="products-section">
          <div className="search-bar">
            <div className="search-input-wrapper">
              <input
              ref={searchInputRef}
                type="text"
                placeholder="Search products or scan barcode"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => {
                  // Clear barcode scan when user starts typing manually
                  if (scannedBarcode) {
                    clearScan();
                    setScannedBarcode(null);
                  }
                }}
                className="search-input"
                autoFocus={false}
              />
              {isScanning && (
                <div className="barcode-scanner-icon" title="Barcode scanner active">
                  <ScanLine size={16} />
                </div>
              )}
              {!isScanning && !showBarcodeHelp && (
                <button
                  className="barcode-help-toggle"
                  onClick={() => setShowBarcodeHelp(true)}
                  title="Show barcode scanner help"
                >
                  <ScanLine size={16} />
                </button>
              )}
            </div>
           
          </div>

          {/* Barcode Scanner Help - Collapsible */}
          {showBarcodeHelp && (
            <div className="barcode-scanner-help">
              <div className="barcode-help-header">
                <div className="barcode-help-title">
                  <span className="scanner-icon"><ScanLine size={16} /></span>
                  <span>Barcode Scanner Ready</span>
                </div>
                <button
                  className="barcode-help-close"
                  onClick={() => setShowBarcodeHelp(false)}
                  title="Hide help"
                >
                  ×
                </button>
              </div>
              <div className="barcode-help-content">
                <div className="help-item">
                  <span className="help-icon">🎯</span>
                  <span>Point scanner at product barcode</span>
                </div>
                <div className="help-item">
                  <span className="help-icon">✅</span>
                  <span>Product auto-added to cart</span>
                </div>
                <div className="help-item">
                  <span className="help-icon">🔍</span>
                  <span>Not found? Search results shown</span>
                </div>
                <div className="help-item">
                  <span className="help-icon">⌨️</span>
                  <span>Press ESC to cancel scanning</span>
                </div>
              </div>
            </div>
          )}

          <div className="products-grid">
            {loading ? (
              <div className="loading">Loading products...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="loading">No products found</div>
            ) : (
              filteredProducts.map(product => {
                const mappedVariations = (product.variations || []).map(mapVariation);
                const hasAnyVariations = product.hasVariations || mappedVariations.length > 0;
                const totalVariationStock = mappedVariations.reduce(
                  (sum, variation) => sum + Math.max(variation.stock || 0, 0),
                  0
                );
                const inStockVariationCount = mappedVariations.filter(
                  (variation) => variation.stock > 0
                ).length;
                const productHasStock = hasAnyVariations
                  ? inStockVariationCount > 0
                  : product.stock > 0;
                const availableStock = hasAnyVariations ? totalVariationStock : product.stock;
                const stockState = !productHasStock ? 'out' : availableStock <= 5 ? 'low' : 'healthy';
                const stockLabel = stockState === 'out'
                  ? 'Out of stock'
                  : stockState === 'low'
                  ? `${availableStock} left`
                  : `${availableStock} in stock`;

                const inlineVariations = mappedVariations.slice(0, 3);
                const showInlineVariations =
                  inlineVariations.length > 0 && inlineVariations.length <= 3;
                const variationCount = mappedVariations.length;
                const productImageSrc = resolveImageSrc(product.images?.[0]);

                return (
                  <div
                    key={product.id}
                    className="product-card product-card-clickable enhanced-product-card"
                    onClick={() => handleProductClick(product)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleProductClick(product); }}
                  >
                    {product.category && (
                      <div className="product-category">
                        {product.category.name}
                      </div>
                    )}

                    {productImageSrc && (
                      <div className="product-card-image">
                        <img
                          src={productImageSrc}
                          alt={product.name || 'Product'}
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    {!productImageSrc && (
                      <div className="product-card-image product-card-image-placeholder" aria-hidden="true">
                        <ImageIcon size={24} />
                        <span>No Photo</span>
                      </div>
                    )}

                    <div className="product-info enhanced-product-info">
                      <h3>{product.name || 'Unnamed Product'}</h3>
                      <div className="product-meta-row">
                        <span className="sku">SKU: {product.sku || 'N/A'}</span>
                        {(product as any).barcode && (
                          <span className="barcode">Barcode: {(product as any).barcode}</span>
                        )}
                      </div>
                      <div className="product-price-stock-row">
                        <span className="price">{formatCurrency(product.price || 0)}</span>
                        <span className={`stock stock-pill ${stockState}`}>
                          {stockState === 'healthy' ? <CheckCircle2 size={12} /> : stockState === 'low' ? <AlertTriangle size={12} /> : <CircleOff size={12} />}
                          {stockLabel}
                        </span>
                      </div>

                      {showInlineVariations && (
                        <div className="variation-chips">
                          {inlineVariations.map(variation => {
                            const hasStock = variation.stock > 0;
                            const colorValue = getVariationAttribute(variation, 'color');
                            const sizeValue = getVariationAttribute(variation, 'size');
                            const label = sizeValue || variation.sku;
                            const swatchStyle = swatchStyleForColor(colorValue);
                            return (
                              <button
                                key={variation.id}
                                type="button"
                                className={`variation-chip ${hasStock ? '' : 'variation-chip-disabled'}`}
                                disabled={!hasStock}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddVariationToCart(product, variation);
                                }}
                                title={hasStock ? `Add ${label}` : 'Out of stock'}
                              >
                                {swatchStyle ? <span className="variant-swatch" style={swatchStyle} title={colorValue || 'Color'} /> : null}
                                <span className="variant-size-tag">{label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <p className="variations-hint">
                        {showInlineVariations
                          ? 'Tap a variant below, or open details'
                          : 'Tap to add / choose variant'}
                      </p>

                      <div className="product-card-footer">
                        <span className="product-card-type">
                          {hasAnyVariations ? `${variationCount} variants` : 'Simple product'}
                        </span>
                        <span className="product-card-cta">
                          {hasAnyVariations ? 'Choose ▸' : 'Add ▸'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="cart-section">
          <div className="cart-header">
            <h2>🛒 Current Sale</h2>
            {cart.length > 0 && onHoldTransaction && (
              <button
                onClick={onHoldTransaction}
                className="hold-transaction-btn-header"
                title="Hold this transaction and start a new one"
              >
                ⏸️ Hold
              </button>
            )}
          </div>

          <div className="cart-items">
            {cart.length === 0 ? (
              <div className="empty-cart empty-cart-illustrated">
                <ImageIcon size={34} />
                <h3>Ready for the next customer</h3>
                <p>Scan or tap a product to begin this sale.</p>
              </div>
            ) : (
              cart.map(item => (
                <div key={item.product.id} className="cart-item">
                  <div className="cart-item-image">
                    {resolveImageSrc(item.product.images?.[0]) ? (
                      <img
                        src={resolveImageSrc(item.product.images?.[0])}
                        alt={item.product.name || 'Product'}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="cart-item-image-placeholder" aria-hidden="true">
                        <ImageIcon size={14} />
                      </div>
                    )}
                  </div>
                  <div className="cart-item-content">
                    <div className="cart-item-header">
                      <div className="item-info">
                        <h4>{item.product.name || 'Unnamed Product'}</h4>
                        <p className="sku">{item.product.sku || 'N/A'}</p>
                        {(item.product as any).variationAttributes && (
                          <p className="variation-info">
                            {Object.entries((item.product as any).variationAttributes).map(([key, value]) => `${key}: ${value}`).join(', ')}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => onRemoveFromCart(item.product.id)}
                        className="remove-btn"
                        title="Remove from cart"
                      >
                        ×
                      </button>
                    </div>
                    
                    <div className="cart-item-footer">
                      <div className="price-info">
                        <span className="unit-price">{formatCurrency(item.product.price || 0)}</span>
                        <span className="unit-label">each</span>
                      </div>
                      
                      <div className="quantity-section">
                        <div className="quantity-controls">
                          <button
                            onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
                            className="quantity-btn decrease"
                            title="Decrease quantity"
                          >
                            −
                          </button>
                          <span className="quantity">{item.quantity}</span>
                          <button
                            onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
                            className="quantity-btn increase"
                            title="Increase quantity"
                          >
                            +
                          </button>
                        </div>
                        <div className="quick-quantity-buttons">
                          <button
                            onClick={() => onUpdateQuantity(item.product.id, 1)}
                            className="quick-qty-btn"
                            title="Set to 1"
                          >
                            1
                          </button>
                          <button
                            onClick={() => onUpdateQuantity(item.product.id, 2)}
                            className="quick-qty-btn"
                            title="Set to 2"
                          >
                            2
                          </button>
                          <button
                            onClick={() => onUpdateQuantity(item.product.id, 5)}
                            className="quick-qty-btn"
                            title="Set to 5"
                          >
                            5
                          </button>
                          <button
                            onClick={() => onUpdateQuantity(item.product.id, 10)}
                            className="quick-qty-btn"
                            title="Set to 10"
                          >
                            10
                          </button>
                        </div>
                      </div>
                      
                      <div className="item-total">
                        <span className="total-label">Total</span>
                        <span className="total-amount">{formatCurrency((item.product.price || 0) * item.quantity)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pending Transactions Panel */}
          {pendingTransactions && pendingTransactions.length > 0 && (
            <div className="pending-transactions-panel">
              <h3 className="pending-header">
                ⏸️ Pending Transactions ({pendingTransactions.length})
              </h3>
              <div className="pending-transactions-list">
                {pendingTransactions.map(transaction => {
                  const transactionTotal = transaction.cart.reduce(
                    (sum, item) => sum + (item.product.price * item.quantity), 0
                  );
                  const transactionDate = new Date(transaction.timestamp);

                  return (
                    <div key={transaction.id} className="pending-transaction-item">
                      <div className="pending-transaction-info">
                        <div className="pending-transaction-header">
                          <span className="pending-time">
                            {transactionDate.toLocaleTimeString()}
                          </span>
                          <span className="pending-items">
                            {transaction.cart.length} item{transaction.cart.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {transaction.customerName && (
                          <div className="pending-customer">
                            👤 {transaction.customerName}
                          </div>
                        )}
                        <div className="pending-total">
                          Total: {formatCurrency(transactionTotal)}
                        </div>
                      </div>
                      <div className="pending-transaction-actions">
                        {onResumeTransaction && (
                          <button
                            onClick={() => onResumeTransaction(transaction.id)}
                            className="resume-btn"
                            title="Resume this transaction"
                          >
                            ▶️ Resume
                          </button>
                        )}
                        {onDeletePendingTransaction && (
                          <button
                            onClick={() => onDeletePendingTransaction(transaction.id)}
                            className="delete-pending-btn"
                            title="Delete this pending transaction"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="cart-summary">
            <div className="summary-row">
              <span>Subtotal:</span>
              <span>{formatCurrency(getTotal())}</span>
            </div>
            <div className="summary-row total">
              <span>Total:</span>
              <span>{formatCurrency(getGrandTotal())}</span>
            </div>
          </div>

          <div className="checkout-section">
            <button
              onClick={onProceedToCheckout}
              className="checkout-btn proceed"
              disabled={cart.length === 0}
              title="Proceed to Checkout (F2)"
            >
              Proceed to Checkout
            </button>
            <p className="shortcut-hint">F2 Checkout · Esc Back</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductSelection;
