const { contextBridge, ipcRenderer } = require('electron');

interface Credentials {
  email: string;
  password: string;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  authenticate: (credentials: Credentials) => ipcRenderer.invoke('authenticate', credentials),
  getAuthToken: () => ipcRenderer.invoke('getAuthToken'),
  getUserData: () => ipcRenderer.invoke('getUserData'),
  getBranches: () => ipcRenderer.invoke('getBranches'),
  logout: () => ipcRenderer.invoke('logout'),
  getProducts: (branchId?: string) => ipcRenderer.invoke('getProducts', branchId),
  getProductVariations: (productId: string) => ipcRenderer.invoke('getProductVariations', productId),
  createSale: (saleData: any) => ipcRenderer.invoke('createSale', saleData),
  createReturn: (payload: any) => ipcRenderer.invoke('createReturn', payload),
  getReceipt: (saleId: string) => ipcRenderer.invoke('getReceipt', saleId),
  getRecentSales: () => ipcRenderer.invoke('getRecentSales'),
  printReceipt: (receiptData: any) => ipcRenderer.invoke('printReceipt', receiptData),
  openCashDrawer: () => ipcRenderer.invoke('openCashDrawer'),
  getPrinterConfig: () => ipcRenderer.invoke('getPrinterConfig'),
  setPrinterConfig: (config: any) => ipcRenderer.invoke('setPrinterConfig', config),
  listPrinters: () => ipcRenderer.invoke('listPrinters'),
  getOfflineSales: () => ipcRenderer.invoke('getOfflineSales'),
  syncOfflineSales: () => ipcRenderer.invoke('syncOfflineSales'),
  cancelSyncOfflineSales: () => ipcRenderer.invoke('cancelSyncOfflineSales'),
  getSyncStatus: () => ipcRenderer.invoke('getSyncStatus'),
  onSyncProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('sync-progress', (_event, progress) => callback(progress));
    return () => ipcRenderer.removeAllListeners('sync-progress');
  },
  syncProducts: () => ipcRenderer.invoke('syncProducts'),
  getCatalogSyncStatus: () => ipcRenderer.invoke('getCatalogSyncStatus'),
  getApiBaseUrl: () => ipcRenderer.invoke('getApiBaseUrl'),
  isOnline: () => navigator.onLine,
  quitApp: () => ipcRenderer.invoke('quitApp'),
  
  // Restaurant Mode IPCs
  printKitchenTicket: (ticket: any) => ipcRenderer.invoke('printKitchenTicket', ticket),
  getRestaurantConfig: () => ipcRenderer.invoke('getRestaurantConfig'),
  getDiningTables: () => ipcRenderer.invoke('getDiningTables'),
  getRestaurantOrders: () => ipcRenderer.invoke('getRestaurantOrders'),
  createRestaurantOrder: (data: any) => ipcRenderer.invoke('createRestaurantOrder', data),
  addRestaurantOrderItems: (id: string, items: any[]) => ipcRenderer.invoke('addRestaurantOrderItems', { id, items }),
  updateRestaurantOrderStatus: (id: string, status: string) => ipcRenderer.invoke('updateRestaurantOrderStatus', { id, status }),
  checkoutRestaurantOrder: (id: string, payload: any) => ipcRenderer.invoke('checkoutRestaurantOrder', { id, payload }),
});
