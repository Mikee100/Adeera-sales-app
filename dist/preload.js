/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "electron":
/*!***************************!*\
  !*** external "electron" ***!
  \***************************/
/***/ ((module) => {

module.exports = require("electron");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!*****************************!*\
  !*** ./src/main/preload.ts ***!
  \*****************************/

const { contextBridge, ipcRenderer } = __webpack_require__(/*! electron */ "electron");
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    authenticate: (credentials) => ipcRenderer.invoke('authenticate', credentials),
    getAuthToken: () => ipcRenderer.invoke('getAuthToken'),
    getUserData: () => ipcRenderer.invoke('getUserData'),
    getBranches: () => ipcRenderer.invoke('getBranches'),
    logout: () => ipcRenderer.invoke('logout'),
    getProducts: (branchId) => ipcRenderer.invoke('getProducts', branchId),
    getProductVariations: (productId) => ipcRenderer.invoke('getProductVariations', productId),
    createSale: (saleData) => ipcRenderer.invoke('createSale', saleData),
    createReturn: (payload) => ipcRenderer.invoke('createReturn', payload),
    getReceipt: (saleId) => ipcRenderer.invoke('getReceipt', saleId),
    getRecentSales: () => ipcRenderer.invoke('getRecentSales'),
    printReceipt: (receiptData) => ipcRenderer.invoke('printReceipt', receiptData),
    openCashDrawer: () => ipcRenderer.invoke('openCashDrawer'),
    getPrinterConfig: () => ipcRenderer.invoke('getPrinterConfig'),
    setPrinterConfig: (config) => ipcRenderer.invoke('setPrinterConfig', config),
    listPrinters: () => ipcRenderer.invoke('listPrinters'),
    getOfflineSales: () => ipcRenderer.invoke('getOfflineSales'),
    syncOfflineSales: () => ipcRenderer.invoke('syncOfflineSales'),
    cancelSyncOfflineSales: () => ipcRenderer.invoke('cancelSyncOfflineSales'),
    getSyncStatus: () => ipcRenderer.invoke('getSyncStatus'),
    onSyncProgress: (callback) => {
        ipcRenderer.on('sync-progress', (_event, progress) => callback(progress));
        return () => ipcRenderer.removeAllListeners('sync-progress');
    },
    syncProducts: () => ipcRenderer.invoke('syncProducts'),
    getCatalogSyncStatus: () => ipcRenderer.invoke('getCatalogSyncStatus'),
    getApiBaseUrl: () => ipcRenderer.invoke('getApiBaseUrl'),
    isOnline: () => navigator.onLine,
    quitApp: () => ipcRenderer.invoke('quitApp'),
    getUpdateSettings: () => ipcRenderer.invoke('getUpdateSettings'),
    setUpdateChannel: (channel) => ipcRenderer.invoke('setUpdateChannel', channel),
    checkForAppUpdates: () => ipcRenderer.invoke('checkForAppUpdates'),
    installUpdate: () => ipcRenderer.invoke('installUpdate'),
    onAppUpdateStatus: (callback) => {
        const handler = (_event, status) => callback(status);
        ipcRenderer.on('app-update-status', handler);
        return () => ipcRenderer.removeListener('app-update-status', handler);
    },
    // Restaurant Mode IPCs
    printKitchenTicket: (ticket) => ipcRenderer.invoke('printKitchenTicket', ticket),
    getRestaurantConfig: () => ipcRenderer.invoke('getRestaurantConfig'),
    getBomRecipes: () => ipcRenderer.invoke('getBomRecipes'),
    saveBomRecipe: (data) => ipcRenderer.invoke('saveBomRecipe', data),
    getUsers: () => ipcRenderer.invoke('getUsers'),
    createUser: (data) => ipcRenderer.invoke('createUser', data),
    setUserPosPin: (userId, pin) => ipcRenderer.invoke('setUserPosPin', { userId, pin }),
    verifyUserPosPin: (userId, pin) => ipcRenderer.invoke('verifyUserPosPin', { userId, pin }),
    getDiningTables: () => ipcRenderer.invoke('getDiningTables'),
    createDiningTable: (data) => ipcRenderer.invoke('createDiningTable', data),
    updateDiningTable: (id, data) => ipcRenderer.invoke('updateDiningTable', id, data),
    getRestaurantOrders: () => ipcRenderer.invoke('getRestaurantOrders'),
    getRestaurantOrderHistory: (filters) => ipcRenderer.invoke('getRestaurantOrderHistory', filters),
    createRestaurantOrder: (data) => ipcRenderer.invoke('createRestaurantOrder', data),
    addRestaurantOrderItems: (id, items) => ipcRenderer.invoke('addRestaurantOrderItems', { id, items }),
    updateRestaurantOrderStatus: (id, status, voidReason) => ipcRenderer.invoke('updateRestaurantOrderStatus', { id, status, voidReason }),
    checkoutRestaurantOrder: (id, payload) => ipcRenderer.invoke('checkoutRestaurantOrder', { id, payload }),
});

})();

/******/ })()
;
//# sourceMappingURL=preload.js.map