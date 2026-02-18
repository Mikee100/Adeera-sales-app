interface ElectronAPI {
  authenticate: (credentials: { email: string; password: string }) => Promise<{ success: boolean; token?: string; user?: any; error?: string }>;
  getAuthToken: () => Promise<string | null>;
  getUserData: () => Promise<any | null>;
  getBranches: () => Promise<{ success: boolean; branches?: any[]; error?: string; unauthorized?: boolean }>;
  logout: () => Promise<{ success: boolean }>;
  getProducts: () => Promise<{ success: boolean; products?: any[]; error?: string }>;
  getProductVariations: (productId: string) => Promise<{ success: boolean; variations?: any[]; error?: string }>;
  createSale: (saleData: any) => Promise<{ success: boolean; sale?: any; receipt?: any; error?: string }>;
  getReceipt: (saleId: string) => Promise<{ success: boolean; receipt?: any; error?: string }>;
  printReceipt: (receiptData: any) => Promise<{ success: boolean; error?: string }>;
  openCashDrawer: () => Promise<{ success: boolean; error?: string }>;
  getPrinterConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
  setPrinterConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
  listPrinters: () => Promise<{ success: boolean; printers?: any[]; error?: string }>;
  getOfflineSales: () => Promise<{ success: boolean; sales?: any[] }>;
  syncOfflineSales: () => Promise<{ success: boolean; syncedCount?: number; errors?: string[]; totalAttempted?: number; error?: string }>;
  getSyncStatus: () => Promise<{ online: boolean; pendingSyncs: number; lastSync?: string }>;
  isOnline: () => boolean;
}

interface Window {
  electronAPI: ElectronAPI;
}
