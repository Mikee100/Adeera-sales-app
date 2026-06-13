declare global {
  interface Window {
    electronAPI: {
      authenticate: (credentials: { email: string; password: string }) => Promise<{
        success: boolean;
        token?: string;
        user?: any;
        error?: string;
      }>;
      getAuthToken: () => Promise<string | null>;
      getUserData: () => Promise<any>;
      logout: () => Promise<{ success: boolean }>;
      getProducts: (branchId?: string) => Promise<{
        success: boolean;
        products?: any[];
        error?: string;
      }>;
      getRestaurantActivity?: (filters?: { from?: string; to?: string; actorUserId?: string; actionType?: string; orderId?: string; limit?: number }) => Promise<{
        success: boolean;
        events?: any[];
        error?: string;
      }>;
      isOnline: () => boolean;
      createSale: (saleData: CreateSaleData) => Promise<{ success: boolean; sale?: any; receipt?: any; error?: string }>;
      getReceipt: (saleId: string) => Promise<{ success: boolean; receipt?: any; error?: string }>;
      printReceipt: (receiptData: any) => Promise<{ success: boolean; error?: string }>;
      getOfflineSales: () => Promise<{ success: boolean; sales?: OfflineSaleData[]; error?: string }>;
      syncOfflineSales: () => Promise<{ success: boolean; syncedCount?: number; errors?: string[]; error?: string }>;
      getSyncStatus: () => Promise<{ online: boolean; pendingSyncs: number; lastSync?: string }>;
    };
  }
}

interface CreateSaleData {
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  paymentMethod: 'cash' | 'mpesa' | 'credit';
  amountReceived?: number;
  customerName?: string;
  customerPhone?: string;
  branchId?: string;
  idempotencyKey: string;
  creditAmount?: number;
  creditDueDate?: string;
  creditNotes?: string;
}

interface SaleReceipt {
  saleId: string;
  date: string;
  customerName?: string;
  customerPhone?: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  subtotal: number;
  vatAmount: number;
  total: number;
  paymentMethod: string;
  amountReceived?: number;
  change?: number;
  businessInfo?: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  branch?: {
    id: string;
    name: string;
    address?: string;
  };
}

interface OfflineSaleData {
  id: string;
  saleData: CreateSaleData;
  timestamp: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  receipt?: SaleReceipt;
  error?: string;
}
