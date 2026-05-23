interface ElectronAPI {
  authenticate: (credentials: { email: string; password: string }) => Promise<{ success: boolean; token?: string; user?: any; error?: string }>;
  getAuthToken: () => Promise<string | null>;
  getUserData: () => Promise<any | null>;
  getBranches: () => Promise<{ success: boolean; branches?: any[]; error?: string; unauthorized?: boolean }>;
  logout: () => Promise<{ success: boolean }>;
  getProducts: (branchId?: string) => Promise<{ success: boolean; products?: any[]; error?: string }>;
  getProductVariations: (productId: string) => Promise<{ success: boolean; variations?: any[]; error?: string }>;
  createSale: (saleData: any) => Promise<{ success: boolean; sale?: any; receipt?: any; error?: string; queueSize?: number; maxQueueSize?: number; warningThreshold?: number; isWarning?: boolean; isCritical?: boolean }>;
  getReceipt: (saleId: string) => Promise<{ success: boolean; receipt?: any; error?: string }>;
  printReceipt: (receiptData: any) => Promise<{ success: boolean; error?: string }>;
  openCashDrawer: () => Promise<{ success: boolean; error?: string }>;
  getPrinterConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
  setPrinterConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
  listPrinters: () => Promise<{ success: boolean; printers?: any[]; error?: string }>;
  getOfflineSales: () => Promise<{ success: boolean; sales?: any[]; queueSize?: number; maxQueueSize?: number; warningThreshold?: number; isWarning?: boolean }>;
  syncOfflineSales: () => Promise<{ success: boolean; syncedCount?: number; errors?: string[]; totalAttempted?: number; cleanedCount?: number; remainingQueueSize?: number; cancelled?: boolean; error?: string }>;
  cancelSyncOfflineSales: () => Promise<{ success: boolean }>;
  onSyncProgress: (callback: (progress: SyncProgress) => void) => () => void;
  getSyncStatus: () => Promise<{ online: boolean; pendingSyncs: number; lastSync?: string; queueSize?: number; maxQueueSize?: number; warningThreshold?: number; isWarning?: boolean; isCritical?: boolean }>;
  syncProducts: () => Promise<{ success: boolean; products?: any[]; syncedAt?: string; error?: string; unauthorized?: boolean }>;
  getCatalogSyncStatus: () => Promise<{ success: boolean; hasCatalog: boolean; lastSynced: string | null; ageHours: number | null; productCount: number; isStale: boolean }>;
  getApiBaseUrl: () => Promise<string>;
  isOnline: () => boolean;
  quitApp: () => Promise<void>;
}

interface SyncProgress {
  total: number;
  processed: number;
  synced: number;
  failed: number;
  currentBatch: number;
  totalBatches: number;
  percentage: number;
  cancelled?: boolean;
  completed?: boolean;
  error?: string;
  failed?: boolean;
}

interface Window {
  electronAPI: ElectronAPI;
}
