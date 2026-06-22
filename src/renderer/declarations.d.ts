interface ElectronAPI {
  getUpdateSettings: () => Promise<{ success: boolean; channel: 'stable' | 'beta'; feedUrl: string; currentVersion: string; isPackaged: boolean }>;
  setUpdateChannel: (channel: 'stable' | 'beta') => Promise<{ success: boolean; channel: 'stable' | 'beta'; feedUrl: string; currentVersion: string }>;
  checkForAppUpdates: () => Promise<{ success: boolean; message?: string; error?: string; channel: 'stable' | 'beta'; feedUrl: string; currentVersion: string }>;
  installUpdate: () => Promise<void>;
  onAppUpdateStatus: (callback: (status: { status: string; channel?: 'stable' | 'beta'; feedUrl?: string; currentVersion?: string; availableVersion?: string; progressPercent?: number | null; message?: string; checkedAt?: string }) => void) => () => void;

  authenticate: (credentials: { email: string; password: string }) => Promise<{ success: boolean; token?: string; user?: any; error?: string }>;
  getAuthToken: () => Promise<string | null>;
  getUserData: () => Promise<any | null>;
  refreshCurrentUser: () => Promise<{ success: boolean; user?: any; error?: string }>;
  getDeviceBinding: () => Promise<{ success: boolean; binding: { tenantId: string; branchId?: string; tenantName?: string | null; branchName?: string | null; provisionedAt?: string } | null }>;
  getPosDisplayName: () => Promise<{ success: boolean; displayName: string; fallbackName?: string }>;
  resetDeviceBinding: (payload?: { approvedByUserId?: string }) => Promise<{ success: boolean; error?: string }>;
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
  getOfflineRestaurantOps: () => Promise<{ success: boolean; operations?: any[]; queueSize?: number; maxQueueSize?: number; warningThreshold?: number; isWarning?: boolean }>;
  syncOfflineRestaurantOps: () => Promise<{ success: boolean; syncedCount?: number; failedCount?: number; errors?: string[]; failedOperations?: Array<{ operationId: string; operationType: 'create-order' | 'add-items' | 'update-status' | 'checkout-order'; orderId?: string; localOrderId?: string; message: string; category: 'conflict' | 'validation' | 'authorization' | 'network' | 'server' | 'unknown'; statusCode?: number; suggestion: string }>; remainingQueueSize?: number; cancelled?: boolean; error?: string }>;
  cancelSyncOfflineRestaurantOps: () => Promise<{ success: boolean }>;
  retryOfflineRestaurantOp: (operationId: string) => Promise<{ success: boolean; operationId?: string; remainingQueueSize?: number; error?: string; failedOperation?: { operationId: string; operationType?: 'create-order' | 'add-items' | 'update-status' | 'checkout-order'; orderId?: string; localOrderId?: string; message: string; category: 'conflict' | 'validation' | 'authorization' | 'network' | 'server' | 'unknown'; statusCode?: number; suggestion: string } }>;
  dismissOfflineRestaurantOp: (operationId: string) => Promise<{ success: boolean; remainingQueueSize?: number; error?: string }>;
  getShiftStatus: () => Promise<{ success: boolean; currentShift?: any; queueSize?: number; error?: string }>;
  openShift: (payload: { openingCash: number; openedBy?: string }) => Promise<{ success: boolean; queued?: boolean; shift?: any; queueSize?: number; error?: string }>;
  closeShift: (payload: { closingCash: number; notes?: string }) => Promise<{ success: boolean; queued?: boolean; shift?: any; summary?: { salesCount: number; grossSales: number; expectedCash: number; variance: number }; queueSize?: number; error?: string }>;
  getOfflineShiftOps: () => Promise<{ success: boolean; operations?: any[]; queueSize?: number; error?: string }>;
  syncOfflineShiftOps: () => Promise<{ success: boolean; syncedCount?: number; failedCount?: number; errors?: string[]; remainingQueueSize?: number; error?: string }>;
  onSyncProgress: (callback: (progress: SyncProgress) => void) => () => void;
  getSyncStatus: () => Promise<{ online: boolean; pendingSyncs: number; pendingSalesSyncs?: number; pendingRestaurantSyncs?: number; lastSync?: string; queueSize?: number; maxQueueSize?: number; warningThreshold?: number; isWarning?: boolean; isCritical?: boolean }>;
  syncProducts: () => Promise<{ success: boolean; products?: any[]; syncedAt?: string; error?: string; unauthorized?: boolean }>;
  getCatalogSyncStatus: () => Promise<{ success: boolean; hasCatalog: boolean; lastSynced: string | null; ageHours: number | null; productCount: number; isStale: boolean }>;
  getApiBaseUrl: () => Promise<string>;
  isOnline: () => boolean;
  quitApp: () => Promise<void>;

  printKitchenTicket: (ticket: any) => Promise<{ success: boolean; ticketId?: string; error?: string }>;
  getRestaurantConfig: () => Promise<{ success: boolean; enabled: boolean }>;
  getBomRecipes: () => Promise<{ success: boolean; recipes: any[]; error?: string }>;
  createBomIngredientProduct: (data: { name: string; cost: number; unit: string; stock?: number }) => Promise<{ success: boolean; product?: any; error?: string }>;
  saveBomRecipe: (data: any) => Promise<{ success: boolean; recipe?: any; error?: string }>;
  getUsers: () => Promise<{ success: boolean; users: any[]; error?: string }>;
  createUser: (data: any) => Promise<{ success: boolean; user?: any; error?: string }>;
  setUserPosPin: (userId: string, pin: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  verifyUserPosPin: (userId: string, pin: string) => Promise<{ success: boolean; waiter?: any; reason?: string; error?: string }>;
  getDiningTables: () => Promise<{ success: boolean; tables: any[]; error?: string }>;
  getRestaurantOrders: () => Promise<{ success: boolean; orders: any[]; error?: string }>;
  getRestaurantOrderHistory: (filters?: { from?: string; to?: string; waiterId?: string; status?: string }) => Promise<{ success: boolean; orders: any[]; error?: string }>;
  getRestaurantActivity: (filters?: { from?: string; to?: string; actorUserId?: string; actionType?: string; orderId?: string; limit?: number }) => Promise<{ success: boolean; events: any[]; error?: string }>;
  createRestaurantOrder: (data: any) => Promise<{ success: boolean; queued?: boolean; queueSize?: number; warningThreshold?: number; isWarning?: boolean; order?: any; error?: string }>;
  addRestaurantOrderItems: (id: string, items: any[]) => Promise<{ success: boolean; queued?: boolean; queueSize?: number; warningThreshold?: number; isWarning?: boolean; result?: any; error?: string }>;
  updateRestaurantOrderStatus: (id: string, status: string, voidReason?: string) => Promise<{ success: boolean; queued?: boolean; queueSize?: number; warningThreshold?: number; isWarning?: boolean; order?: any; error?: string }>;
  checkoutRestaurantOrder: (id: string, payload: any) => Promise<{ success: boolean; queued?: boolean; queueSize?: number; warningThreshold?: number; isWarning?: boolean; receipt?: any; error?: string }>;
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
