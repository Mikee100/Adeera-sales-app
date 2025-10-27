import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

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

interface VirtualizedProductListProps {
  products: Product[];
  onProductSelect: (product: Product) => void;
  searchQuery: string;
  itemHeight?: number;
  maxHeight?: number;
}

interface ProductItemProps {
  product: Product;
  style: React.CSSProperties;
  onSelect: (product: Product) => void;
}

const ProductItem: React.FC<ProductItemProps> = React.memo(({ product, style, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(product);
  }, [product, onSelect]);

  const isLowStock = product.stock <= 5;
  const isOutOfStock = product.stock <= 0;

  return (
    <div
      style={style}
      className={`product-item ${isOutOfStock ? 'out-of-stock' : ''} ${isLowStock ? 'low-stock' : ''}`}
      onClick={handleClick}
    >
      <div className="product-info">
        <div className="product-header">
          <h4 className="product-name">{product.name}</h4>
          <span className="product-sku">SKU: {product.sku}</span>
        </div>

        <div className="product-details">
          <div className="product-price">
            <span className="price">${product.price.toFixed(2)}</span>
            {product.cost && (
              <span className="cost">Cost: ${product.cost.toFixed(2)}</span>
            )}
          </div>

          <div className="product-stock">
            <span className={`stock ${isLowStock ? 'low' : ''} ${isOutOfStock ? 'out' : ''}`}>
              Stock: {product.stock}
            </span>
          </div>
        </div>

        {product.description && (
          <p className="product-description">{product.description}</p>
        )}

        {product.supplier && (
          <div className="product-supplier">
            <small>Supplier: {product.supplier}</small>
          </div>
        )}
      </div>

      {product.images && product.images.length > 0 && (
        <div className="product-image">
          <img
            src={product.images[0]}
            alt={product.name}
            loading="lazy"
            onError={(e) => {
              // Fallback for broken images
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
    </div>
  );
});

ProductItem.displayName = 'ProductItem';

const VirtualizedProductList: React.FC<VirtualizedProductListProps> = ({
  products,
  onProductSelect,
  searchQuery,
  itemHeight = 120,
  maxHeight = 600,
}) => {
  const [filteredProducts, setFilteredProducts] = useState<Product[]>(products);

  // Debounced search filtering
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!searchQuery.trim()) {
        setFilteredProducts(products);
      } else {
        const filtered = products.filter(product =>
          product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          product.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (product.description && product.description.toLowerCase().includes(searchQuery.toLowerCase()))
        );
        setFilteredProducts(filtered);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [products, searchQuery]);

  const itemData = useMemo(() => ({
    products: filteredProducts,
    onProductSelect,
  }), [filteredProducts, onProductSelect]);

  const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const product = itemData.products[index];
    return (
      <ProductItem
        product={product}
        style={style}
        onSelect={itemData.onProductSelect}
      />
    );
  }, [itemData]);

  if (filteredProducts.length === 0) {
    return (
      <div className="no-products">
        <p>{searchQuery ? `No products found for "${searchQuery}"` : 'No products available'}</p>
      </div>
    );
  }

  return (
    <div className="virtualized-product-list" style={{ height: maxHeight }}>
      <AutoSizer>
        {({ height, width }) => (
          <List
            height={height}
            itemCount={filteredProducts.length}
            itemSize={itemHeight}
            width={width}
            itemData={itemData}
          >
            {Row}
          </List>
        )}
      </AutoSizer>
    </div>
  );
};

export default React.memo(VirtualizedProductList);
