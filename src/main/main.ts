import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { FSWatcher, watch } from 'fs';
import ElectronStore from 'electron-store';
import axios from 'axios';
import { logger } from '../shared/logger';
import { cacheService } from '../shared/cache-service';
import { printerService, kitchenQueueService } from './printer-service';
import { API_BASE_URL } from '../shared/config';
import { SecureTokenStorage } from './secure-token-storage';
import { rateLimitedAxios, extractEndpoint, apiRateLimiter, authRateLimiter, syncRateLimiter } from '../shared/rate-limiter';
import { parseAxiosError, getUserFriendlyMessage, enhanceErrorMessage } from '../shared/error-parser';
import { detectStockConflict } from '../shared/stock-conflict-handler';

// Helper function to get auth token (handles both encrypted and plain text)
function getAuthToken(store: ElectronStore): string | null {
  const { SecureTokenStorage } = require('./secure-token-storage');
  
  // Try to get encrypted token first
  if (SecureTokenStorage.isAvailable()) {
    const encryptedToken = SecureTokenStorage.getToken();
    if (encryptedToken) {
      return encryptedToken;
    }
  }
  
  // Fallback to plain text token (for migration or if encryption not available)
  const plainToken = store.get('authToken', null) as string | null;
  
  // Migrate plain text token to encrypted storage if available
  if (plainToken && SecureTokenStorage.isAvailable()) {
    logger.info('Migrating plain text token to encrypted storage', { component: 'auth' });
    SecureTokenStorage.migratePlainTextToken(plainToken);
    // Delete plain text token after migration
    store.delete('authToken');
  }
  
  return plainToken;
}

interface Credentials {
  email: string;
  password: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  branchId?: string;
  roles: string[];
  permissions: string[];
}

interface AuthResponse {
  success: boolean;
  token?: string;
  user?: User;
  error?: string;
}

function isCashierOrStaffUser(user: Partial<User> | undefined): boolean {
  if (!user) return false;
  const roleNames = Array.isArray(user.roles)
    ? user.roles.map((role) => String(role).toLowerCase())
    : [];
  const primaryRole = String((user as any).role || '').toLowerCase();

  return (
    roleNames.includes('cashier') ||
    roleNames.includes('staff') ||
    primaryRole === 'cashier' ||
    primaryRole === 'staff'
  );
}

function shouldLockUserToAssignedBranch(user: Partial<User> | undefined): boolean {
  return !!(user?.branchId && isCashierOrStaffUser(user));
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null;
const devRendererWatchers: FSWatcher[] = [];

// Global ElectronStore instance for reading configuration values such as backendBaseUrl.
const globalStore = new ElectronStore();

// Backend configuration: prefer a value set in local config (ElectronStore) when present,
// then explicit environment variables, and finally the shared API_BASE_URL default.
// This allows IT to change the backend API URL on an installed machine without rebuilding,
// by setting "backendBaseUrl" in the app's ElectronStore config.
const BACKEND_BASE_URL = (() => {
  const fromStore = globalStore.get('backendBaseUrl') as string | undefined;
  if (typeof fromStore === 'string' && fromStore.trim().length > 0) {
    console.log(`Backend URL configured from local store: ${fromStore}`);
    return fromStore.trim();
  }

  if (typeof process.env.BACKEND_BASE_URL === 'string' && process.env.BACKEND_BASE_URL.trim().length > 0) {
    console.log(`Backend URL configured from BACKEND_BASE_URL env: ${process.env.BACKEND_BASE_URL}`);
    return process.env.BACKEND_BASE_URL.trim();
  }

  console.log(`Backend URL falling back to API_BASE_URL from shared config: ${API_BASE_URL}`);
  return API_BASE_URL;
})();

// Log backend URL on startup for debugging
console.log(`Backend URL resolved at startup: ${BACKEND_BASE_URL}`);

const BACKEND_HEALTH_URL =
  process.env.BACKEND_HEALTH_URL || `${BACKEND_BASE_URL.replace(/\/$/, '')}/health`;

// ---- GLOBAL AXIOS INTERCEPTOR FOR AUTOMATIC TOKEN REFRESH ----
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value?: unknown) => void; reject: (reason?: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Intercept 401 Unauthorized for non-auth endpoints
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            return axios(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const store = new ElectronStore();
        const { SecureTokenStorage } = require('./secure-token-storage');
        let refreshToken = null;

        if (SecureTokenStorage.isAvailable()) {
          refreshToken = SecureTokenStorage.getRefreshToken();
        }
        if (!refreshToken) {
          refreshToken = store.get('refreshToken');
        }

        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        logger.info('Attempting silent token refresh...', { component: 'auth' });
        const refreshResponse = await axios.post(`${BACKEND_BASE_URL}/auth/refresh`, {
          refreshToken: refreshToken,
        });

        const newAccessToken = refreshResponse.data.access_token;
        const newRefreshToken = refreshResponse.data.refresh_token;

        if (newAccessToken) {
          const encryptionAvailable = SecureTokenStorage.isAvailable();
          if (encryptionAvailable) {
            SecureTokenStorage.setToken(newAccessToken);
            if (newRefreshToken) SecureTokenStorage.setRefreshToken(newRefreshToken);
          } else {
            store.set('authToken', newAccessToken);
            if (newRefreshToken) store.set('refreshToken', newRefreshToken);
          }

          originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
          
          processQueue(null, newAccessToken);
          isRefreshing = false;

          logger.info('Silent token refresh successful! Retrying original request.', { component: 'auth' });
          return axios(originalRequest);
        } else {
           throw new Error('Refresh response missing token');
        }
      } catch (refreshError: any) {
        processQueue(refreshError, null);
        isRefreshing = false;
        
        logger.warn('Token refresh failed, forcing logout state', { component: 'auth', error: refreshError.message });
        return Promise.reject(error); // Reject with original 401 so renderer kicks user out
      }
    }

    return Promise.reject(error);
  }
);
// ---------------------------------------------------------------

const createWindow = (): void => {
  // Create the browser window – fullscreen like games and POS systems
  mainWindow = new BrowserWindow({
    fullscreen: true,
    fullscreenable: true,
    frame: true, // Keep title bar for close/minimize (user can press Esc to exit fullscreen)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '..', 'assets', 'favicon.ico'),
    show: false, // Don't show until ready
  });

  // Load renderer UI.
  // In development, prefer ELECTRON_RENDERER_URL when explicitly provided.
  // Otherwise load the locally-built dist/index.html to avoid requiring a dev server port.
  if (process.env.NODE_ENV === 'development') {
    const devServerUrl = (process.env.ELECTRON_RENDERER_URL || '').trim();
    if (devServerUrl) {
      mainWindow.loadURL(devServerUrl);
    } else {
      mainWindow.loadFile(path.join(__dirname, 'index.html'));
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open DevTools only when explicitly requested.
  // Set OPEN_DEVTOOLS=true to enable it during development.
  if (process.env.NODE_ENV === 'development' && process.env.OPEN_DEVTOOLS === 'true') {
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });
};

const setupDevRendererLiveReload = (): void => {
  if (process.env.NODE_ENV !== 'development') return;

  // If a dedicated renderer URL is used, rely on that server's own reload behavior.
  const devServerUrl = (process.env.ELECTRON_RENDERER_URL || '').trim();
  if (devServerUrl) return;

  if (devRendererWatchers.length > 0) return;

  const filesToWatch = ['index.html', 'renderer.js'];
  let reloadTimer: NodeJS.Timeout | null = null;

  for (const fileName of filesToWatch) {
    const filePath = path.join(__dirname, fileName);
    try {
      const watcher = watch(filePath, () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        if (reloadTimer) {
          clearTimeout(reloadTimer);
        }

        reloadTimer = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.reloadIgnoringCache();
          }
        }, 120);
      });
      devRendererWatchers.push(watcher);
    } catch (error: any) {
      logger.warn('Dev live reload watcher could not be attached', {
        component: 'app',
        fileName,
        errorMessage: error?.message,
      });
    }
  }
};

// Periodic product sync timer (runs every 5 minutes)
let productSyncInterval: NodeJS.Timeout | null = null;

function startPeriodicProductSync() {
  // Clear existing interval if any
  if (productSyncInterval) {
    clearInterval(productSyncInterval);
  }

  // Sync products every 5 minutes (300000ms)
  productSyncInterval = setInterval(async () => {
    const store = new ElectronStore();
    const token = getAuthToken(store);
    
    // Only sync if user is authenticated
    if (token) {
      logger.info('Running periodic product sync', { component: 'products' });
      try {
        // Use the syncProducts handler logic inline to avoid circular dependencies
        let online = false;
        try {
          await axios.get(BACKEND_HEALTH_URL, { timeout: 5000 });
          online = true;
        } catch {
          online = false;
        }

        if (online) {
    const user = store.get('user') as { branchId?: string } | undefined;
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/products`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    
    const response = await rateLimitedAxios(
      () => axios.get(`${BACKEND_BASE_URL}/products?page=1&limit=1000&includeVariations=true`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(user?.branchId && { 'x-branch-id': user.branchId }),
        },
        timeout: 10000,
      }),
      endpoint
    );

          const responseData = response.data;
          let productsArray: any[] = [];
          if (Array.isArray(responseData)) {
            productsArray = responseData;
          } else if (responseData && typeof responseData === 'object' && responseData.products) {
            productsArray = Array.isArray(responseData.products) ? responseData.products : [];
          }

          if (Array.isArray(productsArray)) {
            const products = productsArray.map((product: any) => {
              const base: any = {
                id: product.id,
                name: product.name,
                sku: product.sku,
                price: parseFloat(product.price),
                stock: parseInt(product.stock) || 0,
                description: product.description || '',
                cost: product.cost ? parseFloat(product.cost) : 0,
                supplier: product.supplier ? product.supplier.name : null,
                images: product.images || [],
                branchId: product.branchId,
                tenantId: product.tenantId,
                category: product.category || null,
                customFields: product.customFields || product.custom_fields || {},
              };
              if (product.variations && Array.isArray(product.variations) && product.variations.length > 0) {
                base.hasVariations = true;
                base.variations = product.variations.map((v: any) => ({
                  id: v.id,
                  sku: v.sku,
                  price: v.price != null ? parseFloat(v.price) : null,
                  stock: parseInt(v.stock) || 0,
                  attributes: v.attributes || {},
                }));
              }
              return base;
            });

            store.set('cachedProducts', products);
            store.set('catalogLastSynced', new Date().toISOString());
            logger.info(`Periodic sync completed: ${products.length} products`, { component: 'products' });
          }
        }
      } catch (error: any) {
        logger.warn('Periodic product sync failed', { component: 'products', error: error.message });
      }
    }
  }, 5 * 60 * 1000); // 5 minutes

  logger.info('Periodic product sync started (every 5 minutes)', { component: 'products' });
}

function stopPeriodicProductSync() {
  if (productSyncInterval) {
    clearInterval(productSyncInterval);
    productSyncInterval = null;
    logger.info('Periodic product sync stopped', { component: 'products' });
  }
}

// Optional auto-update wiring. This uses electron-updater when available,
// but fails gracefully (logs a warning) if the module is not installed or
// no update server is configured yet. This lets you keep installers manual
// today and plug in a real update channel later without code changes.
// Auto-updater instance
let autoUpdaterInstance: any;

function setupAutoUpdater() {
  if (!app.isPackaged) {
    // Do not run auto-updates in development mode.
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const updaterModule = require('electron-updater');
    autoUpdaterInstance = updaterModule.autoUpdater;
  } catch (error: any) {
    logger.warn('Auto-update module not available; skipping update checks', {
      component: 'autoUpdater',
      errorMessage: error?.message,
    });
    return;
  }

  try {
    autoUpdaterInstance.logger = logger;
  } catch {
    // Ignore if logger cannot be attached
  }

  autoUpdaterInstance.on('error', (error: Error) => {
    logger.warn('Auto-update error', {
      component: 'autoUpdater',
      errorMessage: error.message,
    });
  });

  autoUpdaterInstance.on('update-available', () => {
    logger.info('Update available', { component: 'autoUpdater' });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available');
    }
  });

  autoUpdaterInstance.on('update-downloaded', () => {
    logger.info('Update downloaded', { component: 'autoUpdater' });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded');
    }
  });

  // Initial check; will download and notify when configured with a publish target.
  try {
    autoUpdaterInstance.checkForUpdatesAndNotify();
  } catch (error: any) {
    logger.warn('Failed to check for updates', {
      component: 'autoUpdater',
      errorMessage: error?.message,
    });
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Start POS at login when packaged (not in dev mode)
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
      });
    } catch (e) {
      logger.warn('Could not set login item settings', { component: 'app', errorMessage: (e as Error).message });
    }
  }
  createWindow();
  setupDevRendererLiveReload();
  setupAutoUpdater();
  
  // Start periodic product sync if user is already logged in (e.g., app restart)
  const store = new ElectronStore();
  const token = getAuthToken(store);
  if (token) {
    logger.info('User session found on app start, starting periodic sync', { component: 'app' });
    startPeriodicProductSync();
  }
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  for (const watcher of devRendererWatchers) {
    watcher.close();
  }
  devRendererWatchers.length = 0;

  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});

// Helper function to check online status
const isOnline = (): boolean => {
  return require('dns').resolve('www.google.com', (err: any) => !err);
};

// IPC Handlers for renderer communication
ipcMain.handle('quitApp', () => {
  app.quit();
});

ipcMain.handle('installUpdate', () => {
  if (autoUpdaterInstance) {
    logger.info('User requested installUpdate; quitting and installing', { component: 'autoUpdater' });
    autoUpdaterInstance.quitAndInstall();
  } else {
    logger.warn('installUpdate requested but autoUpdater is not initialized', { component: 'autoUpdater' });
  }
});

ipcMain.handle('authenticate', async (event: IpcMainInvokeEvent, credentials: Credentials) => {
  const store = new ElectronStore();

  logger.info('Authentication attempt', { component: 'auth', email: credentials.email });

  // Check online status
  let online = false;
  try {
    logger.debug('Checking backend health', { component: 'auth' });
    // Use the root endpoint to check if backend is online (it's public)
    await axios.get(BACKEND_HEALTH_URL, { timeout: 5000 });
    online = true;
    logger.info('Backend is online', { component: 'auth' });
  } catch (error: any) {
    online = false;
    logger.warn('Backend is offline', { component: 'auth', error: error.message });
  }

  if (online) {
    // Online mode: authenticate against backend API
    try {
      const loginUrl = `${BACKEND_BASE_URL}/auth/login`;
      const endpoint = extractEndpoint(loginUrl);
      
      // Apply rate limiting for auth endpoints (stricter limits)
      await authRateLimiter.waitIfNeeded(endpoint);
      authRateLimiter.recordRequest(endpoint);
      
      logger.debug('Sending login request to backend', { component: 'auth', url: loginUrl });
      console.log(`🔐 Attempting login at: ${loginUrl}`);
      const response = await rateLimitedAxios(
        () => axios.post(loginUrl, credentials),
        endpoint,
        authRateLimiter
      );
      logger.debug('Backend response received', { component: 'auth', status: response.status });

      if (response.data.access_token && response.data.user) {
        logger.info('Login successful, caching data', { component: 'auth' });
        
        // SECURE: Store token using encrypted storage
        const { SecureTokenStorage } = require('./secure-token-storage');
        const tokenExpiry = response.data.expires_in 
          ? Date.now() + (response.data.expires_in * 1000)
          : undefined;
        
        const encryptionAvailable = SecureTokenStorage.isAvailable();
        if (encryptionAvailable) {
          const stored = SecureTokenStorage.setToken(response.data.access_token, tokenExpiry);
          if (!stored) {
            logger.warn('Failed to store token securely, falling back to plain storage', { component: 'auth' });
            // Fallback to plain storage if encryption fails
            store.set('authToken', response.data.access_token);
          }
        } else {
          logger.warn('Encryption not available, storing token in plain text (less secure)', { component: 'auth' });
          // Fallback: store in plain text if encryption not available
          store.set('authToken', response.data.access_token);
        }
        
        // Store refresh token if provided
        if (response.data.refresh_token) {
          if (encryptionAvailable) {
            SecureTokenStorage.setRefreshToken(response.data.refresh_token);
          } else {
            store.set('refreshToken', response.data.refresh_token);
          }
        }
        
        // Store user data (not sensitive, can be plain)
        store.set('user', response.data.user);
        // Clear stale cached data from any previous user/session before refilling.
        store.delete('cachedBranches');
        store.delete('cachedProducts');
        logger.debug('Data cached successfully', { component: 'auth', encrypted: encryptionAvailable });
        
        // Start periodic product sync after successful login
        startPeriodicProductSync();
        
        return { success: true, token: response.data.access_token, user: response.data.user };
      } else {
        logger.warn('Login failed: Invalid response format', { component: 'auth' });
        return { success: false, error: 'Authentication failed' };
      }
    } catch (error: any) {
      logger.error('Login error', { component: 'auth', status: error.response?.status, error: error.response?.data || error.message });
      
      // IMPROVED: Use error parser for consistent error message extraction
      const parsedError = enhanceErrorMessage(parseAxiosError(error));
      const errorMessage = getUserFriendlyMessage(parsedError) || 'Authentication error';
      
      return { success: false, error: errorMessage };
    }
  } else {
    logger.info('Backend offline, checking cached credentials', { component: 'auth' });
    // Offline mode: check cached user data
    const cachedUser = store.get('user') as User | undefined;
    const cachedToken = store.get('authToken') as string | undefined;

    if (cachedUser && cachedToken) {
      // Optionally, verify credentials match cached user email
      if (credentials.email === cachedUser.email) {
        logger.info('Offline login successful', { component: 'auth' });
        // Start periodic sync even in offline mode (will sync when backend comes online)
        startPeriodicProductSync();
        // Allow offline login without password verification
        // Note: cachedToken might be plain text, will be migrated on next getAuthToken call
        return { success: true, token: cachedToken, user: cachedUser };
      } else {
        logger.warn('Offline login failed: email mismatch', { component: 'auth' });
        return { success: false, error: 'Offline login failed: user not found' };
      }
    } else {
      logger.warn('Offline login failed: no cached session', { component: 'auth' });
      return { success: false, error: 'Offline login failed: no cached session' };
    }
  }
});

ipcMain.handle('getAuthToken', () => {
  const { SecureTokenStorage } = require('./secure-token-storage');
  
  // Try to get encrypted token first
  if (SecureTokenStorage.isAvailable()) {
    const encryptedToken = SecureTokenStorage.getToken();
    if (encryptedToken) {
      return encryptedToken;
    }
  }
  
  // Fallback to plain text token (for migration or if encryption not available)
  const store = new ElectronStore();
  const plainToken = store.get('authToken', null) as string | null;
  
  // Migrate plain text token to encrypted storage if available
  if (plainToken && SecureTokenStorage.isAvailable()) {
    logger.info('Migrating plain text token to encrypted storage', { component: 'auth' });
    SecureTokenStorage.migratePlainTextToken(plainToken);
    // Delete plain text token after migration
    store.delete('authToken');
  }
  
  return plainToken;
});

ipcMain.handle('getUserData', () => {
  const store = new ElectronStore();
  return store.get('user', null);
});

ipcMain.handle('getBranches', async () => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  const lockToAssignedBranch = shouldLockUserToAssignedBranch(user);
  const assignedBranchId = user?.branchId;
  
  if (!token) {
    logger.warn('No authentication token found for branches', { component: 'branches' });
    return { success: false, branches: [], error: 'Not authenticated', unauthorized: true };
  }

  try {
    // Check online status
    let online = false;
    try {
      await axios.get(BACKEND_HEALTH_URL, { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (online) {
      const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/branches`);
      await apiRateLimiter.waitIfNeeded(endpoint);
      
      const response = await rateLimitedAxios(
        () => axios.get(`${BACKEND_BASE_URL}/branches`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }),
        endpoint
      );
      
      const branches = Array.isArray(response.data) ? response.data : [];
      const visibleBranches = lockToAssignedBranch && assignedBranchId
        ? branches.filter((branch: any) => branch?.id === assignedBranchId)
        : branches;

      logger.info(`Fetched ${visibleBranches.length} branches`, { component: 'branches' });
      
      // Cache branches for offline use
      store.set('cachedBranches', visibleBranches);
      
      return { success: true, branches: visibleBranches };
    } else {
      // Offline mode: return cached branches if available
      const cachedBranches = store.get('cachedBranches') as any[];
      if (cachedBranches && Array.isArray(cachedBranches)) {
        const visibleBranches = lockToAssignedBranch && assignedBranchId
          ? cachedBranches.filter((branch: any) => branch?.id === assignedBranchId)
          : cachedBranches;
        logger.info(`Returning ${visibleBranches.length} cached branches (offline)`, { component: 'branches' });
        return { success: true, branches: visibleBranches };
      }
      return { success: false, branches: [], error: 'Backend offline and no cached branches' };
    }
  } catch (error: any) {
    const status = error.response?.status;
    const unauthorized = status === 401 || status === 403;
    logger.warn('Failed to fetch branches', { component: 'branches', status, error: error.message });
    
    // Try to return cached branches on error
    const cachedBranches = store.get('cachedBranches') as any[];
    if (cachedBranches && Array.isArray(cachedBranches)) {
      const visibleBranches = lockToAssignedBranch && assignedBranchId
        ? cachedBranches.filter((branch: any) => branch?.id === assignedBranchId)
        : cachedBranches;
      logger.info(`Returning ${visibleBranches.length} cached branches (error fallback)`, { component: 'branches' });
      return { success: true, branches: visibleBranches };
    }
    
    return {
      success: false,
      branches: [],
      error: error.response?.data?.message || error.message,
      unauthorized,
    };
  }
});

ipcMain.handle('logout', () => {
  const store = new ElectronStore();
  
  // SECURE: Delete encrypted token
  const { SecureTokenStorage } = require('./secure-token-storage');
  SecureTokenStorage.deleteToken();
  
  // Also delete plain text token (for migration/compatibility)
  store.delete('authToken');
  store.delete('refreshToken');
  store.delete('user');
  store.delete('cachedProducts'); // Clear cached products on logout
  store.delete('cachedBranches'); // Clear cached branches on logout
  store.delete('catalogLastSynced'); // Clear catalog sync timestamp
  
  // Stop periodic product sync on logout
  stopPeriodicProductSync();
  
  logger.info('User logged out, cleared all cached data', { component: 'auth' });
  return { success: true };
});

ipcMain.handle('getProducts', async (_event, branchId?: string) => {
  const store = new ElectronStore();

  try {
    const user = store.get('user') as { branchId?: string } | undefined;
    const requestedBranchId = typeof branchId === 'string' && branchId.trim().length > 0
      ? branchId.trim()
      : undefined;
    const effectiveBranchId = requestedBranchId || user?.branchId;
    const branchCacheKey = effectiveBranchId ? `cachedProducts:${effectiveBranchId}` : 'cachedProducts';

    // Get stored JWT token (encrypted or plain text)
    const token = getAuthToken(store);
    if (!token) {
      logger.warn('No authentication token found', { component: 'products' });
      // Return cached products if available
      const cachedProducts = store.get(branchCacheKey) as any[];
      if (cachedProducts && Array.isArray(cachedProducts)) {
        logger.info(`Returning ${cachedProducts.length} cached products (no token)`, {
          component: 'products',
          branchId: effectiveBranchId,
        });
        return { success: true, products: cachedProducts };
      } else if (cachedProducts) {
        logger.warn('Cached products found but not in array format, clearing cache', { component: 'products' });
        store.delete(branchCacheKey);
      }
      return { success: false, error: 'No authentication token found' };
    }

    logger.info('Fetching products from backend', { component: 'products' });

    // Check online status first (health check doesn't need rate limiting)
    let online = false;
    try {
      await axios.get(BACKEND_HEALTH_URL, { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (online) {
      // Online mode: fetch from backend and cache
      try {
        // Fetch products with pagination and variations for POS (includeVariations needed for product variation selection)
        const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/products`);
        await apiRateLimiter.waitIfNeeded(endpoint);
        
        const response = await rateLimitedAxios(
          () => axios.get(`${BACKEND_BASE_URL}/products?page=1&limit=1000&includeVariations=true`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              ...(effectiveBranchId && { 'x-branch-id': effectiveBranchId }),
            },
            timeout: 10000, // 10 second timeout
          }),
          endpoint
        );

        // Backend now returns { products: [...], pagination: {...} }
        const responseData = response.data;
        
        // Handle both old format (array) and new format (object with products property)
        let productsArray: any[] = [];
        if (Array.isArray(responseData)) {
          productsArray = responseData;
        } else if (responseData && typeof responseData === 'object' && responseData.products) {
          productsArray = Array.isArray(responseData.products) ? responseData.products : [];
        } else {
          logger.warn('Unexpected response format from backend', { component: 'products', responseData: typeof responseData });
          productsArray = [];
        }

        logger.info(`Received ${productsArray.length} products from backend`, { component: 'products' });

        // Ensure productsArray is actually an array before mapping
        if (!Array.isArray(productsArray)) {
          logger.error('productsArray is not an array', { component: 'products', type: typeof productsArray, value: productsArray });
          productsArray = [];
        }

        // Transform product data to match frontend expectations (preserve hasVariations and variations for POS)
        const products = productsArray.map((product: any) => {
          const base: any = {
            id: product.id,
            name: product.name,
            sku: product.sku,
            price: parseFloat(product.price),
            stock: parseInt(product.stock) || 0,
            description: product.description || '',
            cost: product.cost ? parseFloat(product.cost) : 0,
            supplier: product.supplier ? product.supplier.name : null,
            images: product.images || [],
            branchId: product.branchId,
            tenantId: product.tenantId,
            category: product.category || null,
            customFields: product.customFields || product.custom_fields || {},
          };
          // Show variations when product has them, even if hasVariations flag isn't set
          if (product.variations && Array.isArray(product.variations) && product.variations.length > 0) {
            base.hasVariations = true;
            base.variations = product.variations.map((v: any) => ({
              id: v.id,
              sku: v.sku,
              price: v.price != null ? parseFloat(v.price) : null,
              stock: parseInt(v.stock) || 0,
              attributes: v.attributes || {},
            }));
          }
          return base;
        });

        // Cache the products locally with timestamp
        store.set(branchCacheKey, products);
        store.set('catalogLastSynced', new Date().toISOString());
        logger.debug('Products cached successfully', {
          component: 'products',
          productCount: products.length,
          branchId: effectiveBranchId,
        });

        return { success: true, products };
      } catch (error: any) {
        logger.error('Error fetching products from backend', { component: 'products', status: error.response?.status, error: error.response?.data || error.message });
        // Fall back to cached products
        const cachedProducts = store.get(branchCacheKey) as any[];
        if (cachedProducts && Array.isArray(cachedProducts)) {
          logger.info(`Returning ${cachedProducts.length} cached products (backend error)`, {
            component: 'products',
            branchId: effectiveBranchId,
          });
          return { success: true, products: cachedProducts };
        } else if (cachedProducts) {
          logger.warn('Cached products found but not in array format, clearing cache', { component: 'products' });
          store.delete(branchCacheKey);
        }
        throw error; // Re-throw if no cache available
      }
    } else {
      // Offline mode: return cached products
      logger.info('Backend offline, using cached products', { component: 'products' });
      const cachedProducts = store.get(branchCacheKey) as any[];
      if (cachedProducts && Array.isArray(cachedProducts)) {
        logger.info(`Returning ${cachedProducts.length} cached products (offline mode)`, {
          component: 'products',
          branchId: effectiveBranchId,
        });
        return { success: true, products: cachedProducts };
      } else if (cachedProducts) {
        logger.warn('Cached products found but not in array format, clearing cache', { component: 'products' });
        store.delete(branchCacheKey);
      } else {
        logger.warn('No cached products available in offline mode', { component: 'products' });
        return { success: false, error: 'No cached products available. Please connect to the internet and try again.' };
      }
    }
  } catch (error: any) {
    logger.error('Error in getProducts', { component: 'products', error: error.message });

    // Final fallback: try to return cached products
    const user = store.get('user') as { branchId?: string } | undefined;
    const requestedBranchId = typeof branchId === 'string' && branchId.trim().length > 0
      ? branchId.trim()
      : undefined;
    const effectiveBranchId = requestedBranchId || user?.branchId;
    const branchCacheKey = effectiveBranchId ? `cachedProducts:${effectiveBranchId}` : 'cachedProducts';
    const cachedProducts = store.get(branchCacheKey) as any[];
    if (cachedProducts && Array.isArray(cachedProducts)) {
      logger.info(`Returning ${cachedProducts.length} cached products (final fallback)`, {
        component: 'products',
        branchId: effectiveBranchId,
      });
      return { success: true, products: cachedProducts };
    } else if (cachedProducts) {
      logger.warn('Cached products found but not in array format, clearing cache', { component: 'products' });
      store.delete(branchCacheKey);
    }

    // IMPROVED: Use error parser for consistent error message extraction
    const parsedError = enhanceErrorMessage(parseAxiosError(error));
    const errorMessage = getUserFriendlyMessage(parsedError) || 'Failed to fetch products';
    return { success: false, error: errorMessage };
  }
});

// Force sync products from backend (bypasses cache)
ipcMain.handle('syncProducts', async () => {
  const store = new ElectronStore();

  try {
    // Get stored JWT token (encrypted or plain text)
    const token = getAuthToken(store);
    if (!token) {
      logger.warn('No authentication token found for product sync', { component: 'products' });
      return { success: false, error: 'No authentication token found' };
    }

    logger.info('Force syncing products from backend', { component: 'products' });

    // Check online status
    let online = false;
    try {
      await axios.get(BACKEND_HEALTH_URL, { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (!online) {
      return { success: false, error: 'Backend is offline. Cannot sync products.' };
    }

    // Fetch products from backend (same logic as getProducts but always fetches fresh)
    const user = store.get('user') as { branchId?: string } | undefined;
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/products`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    
    const response = await rateLimitedAxios(
      () => axios.get(`${BACKEND_BASE_URL}/products?page=1&limit=1000&includeVariations=true`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(user?.branchId && { 'x-branch-id': user.branchId }),
        },
        timeout: 10000,
      }),
      endpoint
    );

    const responseData = response.data;
    let productsArray: any[] = [];
    if (Array.isArray(responseData)) {
      productsArray = responseData;
    } else if (responseData && typeof responseData === 'object' && responseData.products) {
      productsArray = Array.isArray(responseData.products) ? responseData.products : [];
    }

    if (!Array.isArray(productsArray)) {
      productsArray = [];
    }

    // Transform product data
    const products = productsArray.map((product: any) => {
      const base: any = {
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: parseFloat(product.price),
        stock: parseInt(product.stock) || 0,
        description: product.description || '',
        cost: product.cost ? parseFloat(product.cost) : 0,
        supplier: product.supplier ? product.supplier.name : null,
        images: product.images || [],
        branchId: product.branchId,
        tenantId: product.tenantId,
        category: product.category || null,
        customFields: product.customFields || product.custom_fields || {},
      };
      if (product.variations && Array.isArray(product.variations) && product.variations.length > 0) {
        base.hasVariations = true;
        base.variations = product.variations.map((v: any) => ({
          id: v.id,
          sku: v.sku,
          price: v.price != null ? parseFloat(v.price) : null,
          stock: parseInt(v.stock) || 0,
          attributes: v.attributes || {},
        }));
      }
      return base;
    });

    // Update cache with timestamp
    store.set('cachedProducts', products);
    store.set('catalogLastSynced', new Date().toISOString());
    
    logger.info(`Products synced successfully: ${products.length} products`, { component: 'products' });

    return { success: true, products, syncedAt: new Date().toISOString() };
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      logger.warn('Authentication failed during product sync, clearing token', { component: 'products' });
      store.delete('authToken');
      return { success: false, error: 'Unauthorized - Please log in again', unauthorized: true };
    }
    logger.error('Error syncing products', { component: 'products', error: error.message });
    // IMPROVED: Use error parser for consistent error message extraction
    const parsedError = enhanceErrorMessage(parseAxiosError(error));
    const errorMessage = getUserFriendlyMessage(parsedError) || 'Failed to sync products';
    return { success: false, error: errorMessage };
  }
});

// Get catalog sync status (last sync time, age, etc.)
ipcMain.handle('getCatalogSyncStatus', async () => {
  const store = new ElectronStore();
  const lastSynced = store.get('catalogLastSynced') as string | undefined;
  const cachedProducts = store.get('cachedProducts') as any[] | undefined;

  if (!lastSynced || !cachedProducts) {
    return {
      success: true,
      hasCatalog: false,
      lastSynced: null,
      ageHours: null,
      productCount: 0,
      isStale: true,
    };
  }

  const lastSyncedDate = new Date(lastSynced);
  const now = new Date();
  const ageMs = now.getTime() - lastSyncedDate.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const isStale = ageHours > 2; // Consider stale if older than 2 hours

  return {
    success: true,
    hasCatalog: true,
    lastSynced: lastSynced,
    ageHours: Math.round(ageHours * 10) / 10, // Round to 1 decimal
    productCount: cachedProducts.length,
    isStale,
  };
});

ipcMain.handle('getProductVariations', async (_event, productId: string) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  if (!token) return { success: false, variations: [], error: 'Not authenticated', unauthorized: true };
  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/products/${productId}/variations`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    
    const response = await rateLimitedAxios(
      () => axios.get(`${BACKEND_BASE_URL}/products/${productId}/variations`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-branch-id': (store.get('user') as any)?.branchId || '',
        },
        timeout: 10000,
      }),
      endpoint
    );
    const variations = Array.isArray(response.data) ? response.data : [];
    return { success: true, variations };
  } catch (error: any) {
    const status = error.response?.status;
    const unauthorized = status === 401 || status === 403;
    logger.warn('Failed to fetch variations', { component: 'products', productId, status, error: error.message });
    return {
      success: false,
      variations: [],
      error: error.response?.data?.message || error.message,
      unauthorized,
    };
  }
});

ipcMain.handle('createSale', async (event, saleData) => {
  const store = new ElectronStore();
  const user = store.get('user') as User | undefined;
  const lockToAssignedBranch = shouldLockUserToAssignedBranch(user);
  const assignedBranchId = user?.branchId;

  if (lockToAssignedBranch && assignedBranchId) {
    if (saleData.branchId && saleData.branchId !== assignedBranchId) {
      logger.warn('Overriding mismatched sale branch for restricted user', {
        component: 'sales',
        requestedBranchId: saleData.branchId,
        assignedBranchId,
        userId: user?.id,
      });
    }
    saleData.branchId = assignedBranchId;
  }

  try {
    // Get stored JWT token (encrypted or plain text)
    const token = getAuthToken(store);
    if (!token) {
      logger.warn('No authentication token found for sale creation', { component: 'sales' });
      return { success: false, error: 'No authentication token found' };
    }

    logger.info('Creating sale', { 
      component: 'sales', 
      items: saleData.items?.length,
      paymentMethod: saleData.paymentMethod,
      branchId: saleData.branchId,
      hasIdempotencyKey: !!saleData.idempotencyKey,
      saleDataKeys: Object.keys(saleData),
    });

    // Log full sale data for debugging (excluding sensitive data)
    logger.debug('Sale data being sent', {
      component: 'sales',
      items: saleData.items?.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        hasVariationId: !!item.variationId,
      })),
      paymentMethod: saleData.paymentMethod,
      branchId: saleData.branchId,
      idempotencyKey: saleData.idempotencyKey,
      amountReceived: saleData.amountReceived,
      discountAmount: saleData.discountAmount,
    });

    // Check online status
    let online = false;
    try {
      await axios.get(BACKEND_HEALTH_URL, { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (online) {
      // Online mode: create sale via backend API
      try {
        // Console log the request being sent for debugging
        console.log('📤 Sending sale request:', {
          url: `${BACKEND_BASE_URL}/sales`,
          items: saleData.items?.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            variationId: item.variationId,
          })),
          paymentMethod: saleData.paymentMethod,
          branchId: saleData.branchId,
          idempotencyKey: saleData.idempotencyKey,
          amountReceived: saleData.amountReceived,
          discountAmount: saleData.discountAmount,
          customerName: saleData.customerName,
          customerPhone: saleData.customerPhone,
          creditAmount: saleData.creditAmount,
          creditDueDate: saleData.creditDueDate,
          creditNotes: saleData.creditNotes,
        });
        
        // Log the full JSON payload for debugging backend validation issues
        console.log('📋 Full JSON payload:', JSON.stringify(saleData, null, 2));
        
        const response = await axios.post(`${BACKEND_BASE_URL}/sales`, saleData, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000, // 15 second timeout for sale creation
        });

        logger.info('Sale created successfully', { component: 'sales', saleId: response.data.data.saleId });

        // IMPORTANT: Do NOT update cache optimistically - wait for backend confirmation
        // The backend has already updated stock in the database. We'll refresh products
        // from backend to get accurate stock levels instead of calculating locally.
        // This prevents race conditions where multiple users sell the same stock.
        
        // Refresh products from backend after successful sale to get accurate stock
        // Do this asynchronously so it doesn't block the sale response
        setTimeout(async () => {
          try {
            logger.info('Refreshing product catalog after successful sale', { component: 'sales' });
            const user = store.get('user') as { branchId?: string } | undefined;
            const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/products`);
            await apiRateLimiter.waitIfNeeded(endpoint);
            
            const refreshResponse = await rateLimitedAxios(
              () => axios.get(`${BACKEND_BASE_URL}/products?page=1&limit=1000&includeVariations=true`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                  ...(user?.branchId && { 'x-branch-id': user.branchId }),
                },
                timeout: 10000,
              }),
              endpoint
            );

            const responseData = refreshResponse.data;
            let productsArray: any[] = [];
            if (Array.isArray(responseData)) {
              productsArray = responseData;
            } else if (responseData && typeof responseData === 'object' && responseData.products) {
              productsArray = Array.isArray(responseData.products) ? responseData.products : [];
            }

            if (Array.isArray(productsArray)) {
              const products = productsArray.map((product: any) => {
                const base: any = {
                  id: product.id,
                  name: product.name,
                  sku: product.sku,
                  price: parseFloat(product.price),
                  stock: parseInt(product.stock) || 0,
                  description: product.description || '',
                  cost: product.cost ? parseFloat(product.cost) : 0,
                  supplier: product.supplier ? product.supplier.name : null,
                  images: product.images || [],
                  branchId: product.branchId,
                  tenantId: product.tenantId,
                  category: product.category || null,
                  customFields: product.customFields || product.custom_fields || {},
                };
                if (product.variations && Array.isArray(product.variations) && product.variations.length > 0) {
                  base.hasVariations = true;
                  base.variations = product.variations.map((v: any) => ({
                    id: v.id,
                    sku: v.sku,
                    price: v.price != null ? parseFloat(v.price) : null,
                    stock: parseInt(v.stock) || 0,
                    attributes: v.attributes || {},
                  }));
                }
                return base;
              });

              store.set('cachedProducts', products);
              store.set('catalogLastSynced', new Date().toISOString());
              logger.info(`Product catalog refreshed after sale: ${products.length} products`, { component: 'sales' });
            }
          } catch (refreshError: any) {
            logger.warn('Failed to refresh products after sale (non-critical)', { 
              component: 'sales', 
              error: refreshError.message 
            });
            // Don't fail the sale if refresh fails - cache will be updated on next sync
          }
        }, 500); // Small delay to not block sale response

        // Auto-open cash drawer if payment method is cash and auto-open is enabled
        if (saleData.paymentMethod === 'cash') {
          const printerConfig = printerService.getConfig();
          if (printerConfig?.autoOpenCashDrawer) {
            // Open cash drawer asynchronously (don't wait for it)
            printerService.openCashDrawer().catch((error: any) => {
              logger.warn('Failed to auto-open cash drawer', { component: 'sales', error: error.message });
            });
          }
        }

        return {
          success: true,
          sale: response.data.data,
          receipt: response.data.data // The backend returns receipt data in the response
        };
      } catch (error: any) {
        // Log full error details for debugging - handle both axios errors and other errors
        const errorResponse = error.response;
        const errorData = errorResponse?.data;
        const errorStatus = errorResponse?.status;
        const errorStatusText = errorResponse?.statusText;
        
        // Console log for immediate debugging (logger might not serialize objects properly)
        console.error('❌ Sale creation error:', {
          status: errorStatus,
          statusText: errorStatusText,
          errorData: errorData,
          errorDataString: JSON.stringify(errorData, null, 2),
          errorMessage: error.message,
          errorCode: error.code,
          hasResponse: !!errorResponse,
          responseHeaders: errorResponse?.headers ? Object.fromEntries(Object.entries(errorResponse.headers)) : null,
          fullError: error,
        });
        
        // Try to get more details from the response
        if (errorResponse?.data) {
          console.error('📋 Full error response data:', JSON.stringify(errorResponse.data, null, 2));
        }
        
        logger.error('Error creating online sale', { 
          component: 'sales', 
          status: errorStatus,
          statusText: errorStatusText,
          errorData: errorData ? JSON.stringify(errorData) : null,
          errorMessage: error.message,
          errorCode: error.code,
          errorType: error.name,
          hasResponse: !!errorResponse,
          saleData: {
            itemsCount: saleData.items?.length,
            paymentMethod: saleData.paymentMethod,
            branchId: saleData.branchId,
            hasIdempotencyKey: !!saleData.idempotencyKey,
          }
        });
        
        // Handle 401 Unauthorized - token expired
        if (errorStatus === 401 || errorStatus === 403) {
          logger.warn('Authentication failed, clearing token', { component: 'sales' });
          // Clear invalid token
          store.delete('authToken');
          return { success: false, error: 'Unauthorized - Please log in again' };
        }
        
        // IMPROVED: Parse error using dedicated error parser utility
        const parsedError = enhanceErrorMessage(parseAxiosError(error));
        let errorMessage = getUserFriendlyMessage(parsedError);
        
        // If we still have a generic "Bad Request", try to extract more details
        if (errorMessage === 'Bad Request' || errorMessage === 'An error occurred' || (errorMessage.includes('Bad Request') && !parsedError.fieldErrors)) {
          // Fallback to detailed extraction
          if (errorData) {
            const parsed = parseAxiosError(error);
            if (parsed.message && parsed.message !== 'Bad Request') {
              errorMessage = parsed.message;
            } else {
              // Provide context about the request
              const requestSummary = `Items: ${saleData.items?.length || 0}, Payment: ${saleData.paymentMethod}, Branch: ${saleData.branchId ? 'set' : 'missing'}`;
              errorMessage = `Validation failed. Please check: ${requestSummary}`;
            }
          } else {
            errorMessage = `Request failed with status ${errorStatus}. Please check your input and try again.`;
          }
        }
        
        // Add field-specific errors if available
        if (parsedError.fieldErrors && Object.keys(parsedError.fieldErrors).length > 0) {
          const fieldMessages = Object.entries(parsedError.fieldErrors)
            .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
            .join('; ');
          errorMessage = `${errorMessage}\n\nField errors:\n${fieldMessages}`;
        }
        
        // Check for stock conflict errors
        const stockConflict = detectStockConflict(error);
        if (stockConflict.isStockConflict) {
          logger.warn('Stock conflict detected during sale creation', { 
            component: 'sales',
            conflictingProducts: stockConflict.conflictingProducts,
            errorMessage: stockConflict.message,
            status: errorStatus,
          });
          
          // Enhance error message with stock conflict details
          if (stockConflict.conflictingProducts && stockConflict.conflictingProducts.length > 0) {
            errorMessage = `Stock conflict: ${stockConflict.conflictingProducts.join(', ')}. Stock may have changed. Please refresh and try again.`;
          } else {
            errorMessage = 'Stock conflict detected. Stock may have changed. Please refresh products and try again.';
          }
        }
        
        // Log product-related errors for frontend to handle auto-sync
        const errorMessageLower = errorMessage.toLowerCase();
        if (errorMessageLower.includes('invalid product') || 
            (errorMessageLower.includes('product') && errorMessageLower.includes('not found')) ||
            (errorMessageLower.includes('product') && errorMessageLower.includes('deleted'))) {
          logger.warn('Product not found error detected - frontend will trigger auto-sync', { component: 'sales' });
        }
        
        // Log parsed error details for debugging
        logger.error('Extracted error message', { 
          component: 'sales', 
          errorMessage,
          parsedError,
          stockConflict: stockConflict.isStockConflict ? stockConflict : null,
          rawData: errorData ? JSON.stringify(errorData) : null,
          status: errorStatus,
          fieldErrors: parsedError.fieldErrors,
          requestSummary: {
            itemsCount: saleData.items?.length,
            paymentMethod: saleData.paymentMethod,
            branchId: saleData.branchId,
            hasIdempotencyKey: !!saleData.idempotencyKey,
          }
        });
        return { success: false, error: errorMessage };
      }
    } else {
      // Offline mode: queue sale for later sync
      logger.info('Backend offline, queuing sale for later sync', { component: 'sales' });

      const offlineSales = store.get('offlineSales', []) as any[];
      
      // MAX QUEUE SIZE: Limit to 1000 sales to prevent memory issues
      const MAX_QUEUE_SIZE = 1000;
      const WARNING_THRESHOLD = 100;
      
      // Clean up old failed syncs (older than 7 days) before adding new sale
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const cleanedSales = offlineSales.filter((sale: any) => {
        if (sale.status === 'failed' && sale.finalFailureAt) {
          const failureDate = new Date(sale.finalFailureAt);
          if (failureDate < sevenDaysAgo) {
            logger.info(`Removing old failed sale from queue: ${sale.id} (failed ${failureDate.toISOString()})`, { component: 'sales' });
            return false; // Remove old failed sales
          }
        }
        return true; // Keep all other sales
      });
      
      // Check if queue is at max capacity
      if (cleanedSales.length >= MAX_QUEUE_SIZE) {
        const errorMessage = `Offline sales queue is full (${MAX_QUEUE_SIZE} sales). Please sync existing sales before creating new ones.`;
        logger.error(errorMessage, { component: 'sales', queueSize: cleanedSales.length });
        return { 
          success: false, 
          error: errorMessage,
          queueSize: cleanedSales.length,
          maxQueueSize: MAX_QUEUE_SIZE
        };
      }
      
      // Warn if queue is getting large
      if (cleanedSales.length >= WARNING_THRESHOLD) {
        logger.warn(`Offline sales queue is large: ${cleanedSales.length} sales (warning threshold: ${WARNING_THRESHOLD})`, { 
          component: 'sales',
          queueSize: cleanedSales.length,
          warningThreshold: WARNING_THRESHOLD
        });
      }
      
      const offlineSale = {
        id: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        saleData,
        timestamp: new Date().toISOString(),
        status: 'pending'
      };

      cleanedSales.push(offlineSale);
      store.set('offlineSales', cleanedSales);
      
      logger.info(`Sale queued for offline sync. Queue size: ${cleanedSales.length}/${MAX_QUEUE_SIZE}`, { 
        component: 'sales',
        queueSize: cleanedSales.length,
        maxQueueSize: MAX_QUEUE_SIZE
      });

      // Update cached products immediately (reduce stock)
      const cachedProducts = store.get('cachedProducts') as any[];
      if (cachedProducts) {
        const updatedProducts = cachedProducts.map((product: any) => {
          const soldItem = saleData.items.find((item: any) => item.productId === product.id);
          if (soldItem) {
            return { ...product, stock: Math.max(0, product.stock - soldItem.quantity) };
          }
          return product;
        });
        store.set('cachedProducts', updatedProducts);
        logger.debug('Product stock updated in cache for offline sale', { component: 'sales' });
      }

      // Return success with queue info for frontend warnings
      return {
        success: true,
        sale: offlineSale,
        queueSize: cleanedSales.length,
        maxQueueSize: MAX_QUEUE_SIZE,
        warningThreshold: WARNING_THRESHOLD,
        isWarning: cleanedSales.length >= WARNING_THRESHOLD
      };

      // Auto-open cash drawer if payment method is cash and auto-open is enabled
      if (saleData.paymentMethod === 'cash') {
        const printerConfig = printerService.getConfig();
        if (printerConfig?.autoOpenCashDrawer) {
          // Open cash drawer asynchronously (don't wait for it)
          printerService.openCashDrawer().catch((error: any) => {
            logger.warn('Failed to auto-open cash drawer', { component: 'sales', error: error.message });
          });
        }
      }

      // Use stored user and cached branches for business and branch names
      const userData = store.get('user') as { tenantName?: string; branchName?: string; branchId?: string } | undefined;
      const cachedBranches = store.get('cachedBranches') as { id: string; name: string; address?: string }[] | undefined;
      const branchForReceipt = saleData.branchId && Array.isArray(cachedBranches)
        ? cachedBranches.find((b: { id: string }) => b.id === saleData.branchId)
        : undefined;

      const offlineReceipt: any = {
        saleId: offlineSale.id,
        date: offlineSale.timestamp,
        customerName: saleData.customerName,
        customerPhone: saleData.customerPhone,
        items: saleData.items.map((item: any) => ({
          productId: item.productId,
          name: 'Product', // Will be resolved during sync
          price: item.price,
          quantity: item.quantity
        })),
        subtotal: saleData.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0),
        vatAmount: 0,
        total: saleData.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0),
        paymentMethod: saleData.paymentMethod,
        amountReceived: saleData.amountReceived,
        change: saleData.amountReceived ? saleData.amountReceived - saleData.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0) : undefined,
        businessInfo: { name: userData?.tenantName || 'Business' },
        branch: saleData.branchId ? {
          id: saleData.branchId,
          name: branchForReceipt?.name || userData?.branchName || `Branch ${saleData.branchId}`,
          address: branchForReceipt?.address,
        } : undefined,
      };

      // Add credit information if payment method is credit
      if (saleData.paymentMethod === 'credit') {
        offlineReceipt.creditDueDate = saleData.creditDueDate;
        offlineReceipt.creditNotes = saleData.creditNotes;
      }

      return {
        success: true,
        sale: { id: offlineSale.id, status: 'offline' },
        receipt: offlineReceipt
      };
    }

  } catch (error: any) {
    logger.error('Error in createSale', { component: 'sales', error: error.message });
    return { success: false, error: error.message || 'Failed to create sale' };
  }
});

ipcMain.handle('getReceipt', async (event, saleId) => {
  const store = new ElectronStore();

  try {
    // Get stored JWT token (encrypted or plain text)
    const token = getAuthToken(store);
    if (!token) {
      logger.warn('No authentication token found for receipt', { component: 'receipts' });
      return { success: false, error: 'No authentication token found' };
    }

    logger.info('Fetching receipt for sale', { component: 'receipts', saleId });

    // Check online status
    let online = false;
    try {
      await axios.get(BACKEND_HEALTH_URL, { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (!online) {
      logger.warn('Backend offline, cannot fetch receipt', { component: 'receipts' });
      return { success: false, error: 'Cannot fetch receipt while offline. Please check your internet connection.' };
    }

    // Get receipt from backend API (with rate limiting)
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/sales/${saleId}/receipt`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    
    const response = await rateLimitedAxios(
      () => axios.get(`${BACKEND_BASE_URL}/sales/${saleId}/receipt`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }),
      endpoint
    );

    logger.info('Receipt fetched successfully', { component: 'receipts', saleId });

    return {
      success: true,
      receipt: response.data
    };

  } catch (error: any) {
    logger.error('Error fetching receipt', { component: 'receipts', saleId, status: error.response?.status, error: error.response?.data || error.message });
    // IMPROVED: Use error parser for consistent error message extraction
    const parsedError = enhanceErrorMessage(parseAxiosError(error));
    const errorMessage = getUserFriendlyMessage(parsedError) || 'Failed to fetch receipt';
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('getRecentSales', async () => {
  const store = new ElectronStore();

  try {
    const token = getAuthToken(store);
    if (!token) {
      logger.warn('No authentication token for recent sales', { component: 'sales' });
      return { success: false, error: 'Not authenticated', sales: [] };
    }

    let online = false;
    try {
      await axios.get(BACKEND_HEALTH_URL, { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (!online) {
      return { success: false, error: 'Offline', sales: [] };
    }

    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/sales/recent`);
    await apiRateLimiter.waitIfNeeded(endpoint);

    const response = await rateLimitedAxios(
      () => axios.get(`${BACKEND_BASE_URL}/sales/recent`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }),
      endpoint
    );

    return { success: true, sales: response.data ?? [] };
  } catch (error: any) {
    logger.error('Error fetching recent sales', { component: 'sales', error: error.message });
    const parsedError = enhanceErrorMessage(parseAxiosError(error));
    return { success: false, error: parsedError?.message || 'Failed to fetch recent sales', sales: [] };
  }
});

ipcMain.handle('printReceipt', async (event, receiptData) => {
  try {
    logger.info('Printing receipt for sale', { component: 'receipts', saleId: receiptData.saleId });

    const result = await printerService.printReceipt(receiptData);
    
    if (result.success) {
      logger.info('Receipt printed successfully', { component: 'receipts', saleId: receiptData.saleId });
    } else {
      const errorMsg: string = result.error || 'Unknown error';
      logger.error('Receipt print failed', { component: 'receipts', saleId: receiptData.saleId, errorMessage: errorMsg });
    }

    return result;

  } catch (error: any) {
    logger.error('Error printing receipt', { component: 'receipts', saleId: receiptData.saleId, error: error.message });
    return { success: false, error: error.message || 'Failed to print receipt' };
  }
});

ipcMain.handle('printKitchenTicket', async (event, ticketData) => {
  try {
    logger.info('Queueing kitchen ticket', { component: 'kitchen', orderId: ticketData.orderId });
    const ticketId = kitchenQueueService.addTicket(ticketData);
    return { success: true, ticketId };
  } catch (error: any) {
    logger.error('Error queueing kitchen ticket', { component: 'kitchen', error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('getRestaurantConfig', async () => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  if (!token) return { success: false, enabled: false };
  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/config`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(() => axios.get(`${BACKEND_BASE_URL}/restaurant/config`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 5000,
    }), endpoint);
    return { success: true, enabled: response.data.enabled };
  } catch (err) {
    return { success: false, enabled: false };
  }
});

ipcMain.handle('getBomRecipes', async () => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, recipes: [], error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/bom/recipes`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(
      () =>
        axios.get(`${BACKEND_BASE_URL}/restaurant/bom/recipes`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            ...(user?.branchId && { 'x-branch-id': user.branchId }),
          },
          timeout: 7000,
        }),
      endpoint,
    );

    const recipes = Array.isArray(response.data) ? response.data : [];
    return { success: true, recipes };
  } catch (error: any) {
    logger.error('Failed to get BOM recipes', { error: error.message });
    return { success: false, recipes: [], error: error.message };
  }
});

ipcMain.handle('saveBomRecipe', async (_event, data: any) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/bom/recipes`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(
      () =>
        axios.post(`${BACKEND_BASE_URL}/restaurant/bom/recipes`, data, {
          headers: {
            'Authorization': `Bearer ${token}`,
            ...(user?.branchId && { 'x-branch-id': user.branchId }),
          },
          timeout: 10000,
        }),
      endpoint,
    );

    return { success: true, recipe: response.data };
  } catch (error: any) {
    logger.error('Failed to save BOM recipe', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('getDiningTables', async () => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, tables: [] };
  
  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/tables`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(() => axios.get(`${BACKEND_BASE_URL}/restaurant/tables`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        ...(user?.branchId && { 'x-branch-id': user.branchId }),
      },
      timeout: 5000,
    }), endpoint);

    const raw = response.data;
    const tables = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.tables)
      ? raw.tables
      : [];

    // First-use bootstrap: create default tables for branches with none.
    if (tables.length === 0) {
      logger.info('No dining tables found, bootstrapping defaults', {
        component: 'restaurant',
        branchId: user?.branchId,
      });

      const createEndpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/tables`);
      for (let i = 1; i <= 12; i += 1) {
        await apiRateLimiter.waitIfNeeded(createEndpoint);
        try {
          await rateLimitedAxios(
            () =>
              axios.post(
                `${BACKEND_BASE_URL}/restaurant/tables`,
                { number: String(i), capacity: i <= 4 ? 4 : i <= 8 ? 6 : 8 },
                {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    ...(user?.branchId && { 'x-branch-id': user.branchId }),
                  },
                  timeout: 5000,
                },
              ),
            createEndpoint,
          );
        } catch (createErr: any) {
          logger.warn('Default table bootstrap item failed', {
            component: 'restaurant',
            number: i,
            error: createErr?.message,
          });
        }
      }

      await apiRateLimiter.waitIfNeeded(endpoint);
      const refreshed = await rateLimitedAxios(
        () =>
          axios.get(`${BACKEND_BASE_URL}/restaurant/tables`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              ...(user?.branchId && { 'x-branch-id': user.branchId }),
            },
            timeout: 5000,
          }),
        endpoint,
      );

      const refreshedRaw = refreshed.data;
      const refreshedTables = Array.isArray(refreshedRaw)
        ? refreshedRaw
        : Array.isArray(refreshedRaw?.tables)
        ? refreshedRaw.tables
        : [];

      return { success: true, tables: refreshedTables };
    }

    return { success: true, tables };
  } catch (error: any) {
    logger.error('Failed to get tables', { error: error.message });
    return { success: false, tables: [], error: error.message };
  }
});

ipcMain.handle('getUsers', async () => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, users: [], error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/user`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(
      () =>
        axios.get(`${BACKEND_BASE_URL}/user`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            ...(user?.branchId && { 'x-branch-id': user.branchId }),
          },
          timeout: 7000,
        }),
      endpoint,
    );

    return { success: true, users: Array.isArray(response.data) ? response.data : [] };
  } catch (error: any) {
    logger.error('Failed to get users', { error: error.message });
    return { success: false, users: [], error: error.message };
  }
});

ipcMain.handle('createUser', async (_event, data: any) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/user`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(
      () =>
        axios.post(`${BACKEND_BASE_URL}/user`, data, {
          headers: {
            'Authorization': `Bearer ${token}`,
            ...(user?.branchId && { 'x-branch-id': user.branchId }),
          },
          timeout: 10000,
        }),
      endpoint,
    );

    return { success: true, user: response.data };
  } catch (error: any) {
    logger.error('Failed to create user', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setUserPosPin', async (_event, { userId, pin }) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/user/${userId}/pos-pin`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(
      () =>
        axios.put(
          `${BACKEND_BASE_URL}/user/${userId}/pos-pin`,
          { pin },
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              ...(user?.branchId && { 'x-branch-id': user.branchId }),
            },
            timeout: 10000,
          },
        ),
      endpoint,
    );

    return { success: true, result: response.data };
  } catch (error: any) {
    logger.error('Failed to set user POS PIN', { error: error.message, userId });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('verifyUserPosPin', async (_event, { userId, pin }) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/user/verify-pos-pin`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(
      () =>
        axios.post(
          `${BACKEND_BASE_URL}/user/verify-pos-pin`,
          { userId, pin },
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              ...(user?.branchId && { 'x-branch-id': user.branchId }),
            },
            timeout: 10000,
          },
        ),
      endpoint,
    );

    return response.data;
  } catch (error: any) {
    logger.error('Failed to verify user POS PIN', { error: error.message, userId });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('createDiningTable', async (_event, data: { number: string; capacity?: number }) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/tables`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(
      () =>
        axios.post(`${BACKEND_BASE_URL}/restaurant/tables`, data, {
          headers: {
            'Authorization': `Bearer ${token}`,
            ...(user?.branchId && { 'x-branch-id': user.branchId }),
          },
          timeout: 5000,
        }),
      endpoint,
    );
    return { success: true, table: response.data };
  } catch (error: any) {
    logger.error('Failed to create dining table', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('updateDiningTable', async (_event, id: string, data: { number?: string; capacity?: number }) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/tables/${id}`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(
      () =>
        axios.put(`${BACKEND_BASE_URL}/restaurant/tables/${id}`, data, {
          headers: {
            'Authorization': `Bearer ${token}`,
            ...(user?.branchId && { 'x-branch-id': user.branchId }),
          },
          timeout: 5000,
        }),
      endpoint,
    );
    return { success: true, table: response.data };
  } catch (error: any) {
    logger.error('Failed to update dining table', { error: error.message, tableId: id });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('getRestaurantOrders', async () => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, orders: [] };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/orders`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(() => axios.get(`${BACKEND_BASE_URL}/restaurant/orders`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(user?.branchId && { 'x-branch-id': user.branchId }),
      },
      timeout: 5000,
    }), endpoint);
    return { success: true, orders: response.data };
  } catch (error: any) {
    logger.error('Failed to get restaurant orders', { error: error.message });
    return { success: false, orders: [], error: error.message };
  }
});

ipcMain.handle(
  'getRestaurantOrderHistory',
  async (
    _event,
    filters?: { from?: string; to?: string; waiterId?: string; status?: string },
  ) => {
    const store = new ElectronStore();
    const token = getAuthToken(store);
    const user = store.get('user') as User | undefined;
    if (!token) return { success: false, orders: [] };

    try {
      const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/orders/history`);
      await apiRateLimiter.waitIfNeeded(endpoint);
      const response = await rateLimitedAxios(
        () =>
          axios.get(`${BACKEND_BASE_URL}/restaurant/orders/history`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              ...(user?.branchId && { 'x-branch-id': user.branchId }),
            },
            params: {
              ...(filters?.from ? { from: filters.from } : {}),
              ...(filters?.to ? { to: filters.to } : {}),
              ...(filters?.waiterId ? { waiterId: filters.waiterId } : {}),
              ...(filters?.status ? { status: filters.status } : {}),
            },
            timeout: 7000,
          }),
        endpoint,
      );
      return { success: true, orders: response.data };
    } catch (error: any) {
      logger.error('Failed to get restaurant order history', { error: error.message });
      return { success: false, orders: [], error: error.message };
    }
  },
);

ipcMain.handle('createRestaurantOrder', async (event, data) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/orders`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(() => axios.post(`${BACKEND_BASE_URL}/restaurant/orders`, data, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        ...(user?.branchId && { 'x-branch-id': user.branchId }),
      },
      timeout: 10000,
    }), endpoint);
    return { success: true, order: response.data };
  } catch (error: any) {
    logger.error('Failed to create order', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('addRestaurantOrderItems', async (event, { id, items }) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  const user = store.get('user') as User | undefined;
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/orders/${id}/items`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(() => axios.post(`${BACKEND_BASE_URL}/restaurant/orders/${id}/items`, { items }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(user?.branchId && { 'x-branch-id': user.branchId }),
      },
      timeout: 10000,
    }), endpoint);

    return { success: true, result: response.data };
  } catch (error: any) {
    logger.error('Failed to add restaurant order items', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('updateRestaurantOrderStatus', async (event, { id, status, voidReason }) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  if (!token) return { success: false };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/orders/${id}/status`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(() => axios.put(`${BACKEND_BASE_URL}/restaurant/orders/${id}/status`, { status, voidReason }, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000,
    }), endpoint);
    return { success: true, order: response.data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('checkoutRestaurantOrder', async (event, { id, payload }) => {
  const store = new ElectronStore();
  const token = getAuthToken(store);
  if (!token) return { success: false, error: 'No token' };

  try {
    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/restaurant/orders/${id}/checkout`);
    await apiRateLimiter.waitIfNeeded(endpoint);
    const response = await rateLimitedAxios(() => axios.post(`${BACKEND_BASE_URL}/restaurant/orders/${id}/checkout`, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      timeout: 15000,
    }), endpoint);

    return { success: true, receipt: response.data };
  } catch (error: any) {
    logger.error('Failed to checkout restaurant order', { error: error.message });
    return { success: false, error: error.message };
  }
});

// Create a return for an existing sale
ipcMain.handle('createReturn', async (_event, payload: { saleId: string; items: any[]; reason?: string; refundMethod?: string }) => {
  const store = new ElectronStore();

  try {
    const token = getAuthToken(store);
    if (!token) {
      logger.warn('No authentication token found for return creation', { component: 'returns' });
      return { success: false, error: 'No authentication token found' };
    }

    if (!payload?.saleId || !Array.isArray(payload.items) || payload.items.length === 0) {
      return { success: false, error: 'Return must include a saleId and at least one item' };
    }

    logger.info('Creating return for sale', {
      component: 'returns',
      saleId: payload.saleId,
      items: payload.items.length,
    });

    const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/sales/${payload.saleId}/returns`);
    await apiRateLimiter.waitIfNeeded(endpoint);

    const response = await rateLimitedAxios(
      () =>
        axios.post(
          `${BACKEND_BASE_URL}/sales/${payload.saleId}/returns`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        ),
      endpoint
    );

    logger.info('Return created successfully', {
      component: 'returns',
      saleId: payload.saleId,
      returnId: response.data?.id || response.data?.returnId,
    });

    return { success: true, data: response.data };
  } catch (error: any) {
    logger.error('Error creating return', {
      component: 'returns',
      saleId: payload?.saleId,
      status: error.response?.status,
      error: error.response?.data || error.message,
    });

    const parsedError = enhanceErrorMessage(parseAxiosError(error));
    const errorMessage = getUserFriendlyMessage(parsedError) || 'Failed to create return';

    return { success: false, error: errorMessage };
  }
});

// Cash drawer handlers
ipcMain.handle('openCashDrawer', async () => {
  try {
    logger.info('Opening cash drawer', { component: 'cashdrawer' });
    const result = await printerService.openCashDrawer();
    
    if (result.success) {
      logger.info('Cash drawer opened successfully', { component: 'cashdrawer' });
    } else {
      const errorMessage: string = result.error || 'Unknown error';
      logger.error('Cash drawer open failed', { component: 'cashdrawer', errorMessage });
    }

    return result;
  } catch (error: any) {
    logger.error('Error opening cash drawer', { component: 'cashdrawer', error: error.message });
    return { success: false, error: error.message || 'Failed to open cash drawer' };
  }
});

// Printer configuration handlers
ipcMain.handle('getPrinterConfig', () => {
  try {
    const config = printerService.getConfig();
    return { success: true, config };
  } catch (error: any) {
    logger.error('Error getting printer config', { component: 'printer', error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setPrinterConfig', async (event, config) => {
  try {
    const result = await printerService.setConfig(config);
    return result;
  } catch (error: any) {
    logger.error('Error setting printer config', { component: 'printer', error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('listPrinters', async () => {
  try {
    const printers = await printerService.listAvailablePrinters();
    return { success: true, printers };
  } catch (error: any) {
    logger.error('Error listing printers', { component: 'printer', error: error.message });
    return { success: false, error: error.message, printers: [] };
  }
});

// New IPC handlers for offline functionality
ipcMain.handle('getOfflineSales', () => {
  const store = new ElectronStore();
  let offlineSales = store.get('offlineSales', []) as any[];
  
  // Clean up old failed syncs (older than 7 days) when retrieving
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const initialCount = offlineSales.length;
  
  offlineSales = offlineSales.filter((sale: any) => {
    if (sale.status === 'failed' && sale.finalFailureAt) {
      const failureDate = new Date(sale.finalFailureAt);
      if (failureDate < sevenDaysAgo) {
        return false; // Remove old failed sales
      }
    }
    return true; // Keep all other sales
  });
  
  if (offlineSales.length !== initialCount) {
    store.set('offlineSales', offlineSales); // Update store with cleaned list
  }
  
  const MAX_QUEUE_SIZE = 1000;
  const WARNING_THRESHOLD = 100;
  
  logger.info(`Returning ${offlineSales.length} offline sales`, { component: 'offline' });
  return { 
    success: true, 
    sales: offlineSales,
    queueSize: offlineSales.length,
    maxQueueSize: MAX_QUEUE_SIZE,
    warningThreshold: WARNING_THRESHOLD,
    isWarning: offlineSales.length >= WARNING_THRESHOLD
  };
});

// Track sync cancellation state
let syncCancelled = false;
let currentSyncEvent: IpcMainInvokeEvent | null = null;

ipcMain.handle('cancelSyncOfflineSales', async () => {
  syncCancelled = true;
  logger.info('Sync cancellation requested', { component: 'offline' });
  return { success: true };
});

ipcMain.handle('syncOfflineSales', async (event: IpcMainInvokeEvent) => {
  const store = new ElectronStore();
  syncCancelled = false;
  currentSyncEvent = event;

  try {
    let offlineSales = store.get('offlineSales', []) as any[];
    
    // Clean up old failed syncs (older than 7 days) before syncing
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const initialCount = offlineSales.length;
    
    offlineSales = offlineSales.filter((sale: any) => {
      if (sale.status === 'failed' && sale.finalFailureAt) {
        const failureDate = new Date(sale.finalFailureAt);
        if (failureDate < sevenDaysAgo) {
          return false; // Remove old failed sales
        }
      }
      return true; // Keep all other sales
    });
    
    if (offlineSales.length !== initialCount) {
      store.set('offlineSales', offlineSales); // Update store with cleaned list
    }
    
    if (offlineSales.length === 0) {
      logger.info('No offline sales to sync', { component: 'offline' });
      return { success: true, syncedCount: 0, errors: [] };
    }

    logger.info(`Starting batched sync of ${offlineSales.length} offline sales`, { component: 'offline' });

    const token = getAuthToken(store);
    if (!token) {
      return { success: false, error: 'No authentication token found' };
    }

    // Process in smaller batches (5-10 sales) to prevent UI freezing
    const batchSize = 8; // Optimal balance between efficiency and UI responsiveness
    const totalBatches = Math.ceil(offlineSales.length / batchSize);
    let totalSyncedCount = 0;
    const allErrors: string[] = [];
    const cleanedCount = initialCount - offlineSales.length; // Track cleaned count
    const remainingSales: any[] = [];
    
    // Send initial progress
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-progress', {
        total: offlineSales.length,
        processed: 0,
        synced: 0,
        failed: 0,
        currentBatch: 0,
        totalBatches,
        percentage: 0,
      });
    }

    for (let i = 0; i < offlineSales.length; i += batchSize) {
      // Check for cancellation
      if (syncCancelled) {
        logger.info('Sync cancelled by user', { component: 'offline', processed: i, total: offlineSales.length });
        // Update store with remaining sales
        const remainingSales = offlineSales.slice(i).concat(remainingSales);
        store.set('offlineSales', remainingSales);
        
        // Send cancellation progress
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sync-progress', {
            total: offlineSales.length,
            processed: i,
            synced: totalSyncedCount,
            failed: allErrors.length,
            currentBatch: Math.floor(i / batchSize),
            totalBatches,
            percentage: Math.round((i / offlineSales.length) * 100),
            cancelled: true,
          });
        }
        
        return {
          success: true,
          syncedCount: totalSyncedCount,
          errors: allErrors,
          totalAttempted: i,
          cancelled: true,
          remainingQueueSize: remainingSales.length,
        };
      }

      const batch = offlineSales.slice(i, i + batchSize);
      const currentBatch = Math.floor(i / batchSize) + 1;
      logger.info(`Processing batch ${currentBatch}/${totalBatches} (${batch.length} sales)`, { component: 'offline' });
      
      // Send batch start progress
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-progress', {
          total: offlineSales.length,
          processed: i,
          synced: totalSyncedCount,
          failed: allErrors.length,
          currentBatch,
          totalBatches,
          percentage: Math.round((i / offlineSales.length) * 100),
        });
      }

      // Process batch with parallel requests but controlled concurrency
      const batchPromises = batch.map(async (offlineSale) => {
        // Skip already synced sales
        if (offlineSale.status === 'synced') {
          return { sale: offlineSale, success: true, error: null };
        }

        // Fix branchId for existing offline sales that may have undefined branchId
        if (!offlineSale.saleData.branchId || typeof offlineSale.saleData.branchId !== 'string') {
          logger.info(`Fixing branchId for offline sale ${offlineSale.id}`, { component: 'offline' });
          // Get user data to determine the correct branchId
          const userData = store.get('user') as User | undefined;
          if (userData?.branchId) {
            offlineSale.saleData.branchId = userData.branchId;
            logger.info(`Set branchId to user's branch: ${userData.branchId}`, { component: 'offline' });
          } else {
            logger.warn(`No branchId found for user, using fallback`, { component: 'offline' });
            offlineSale.saleData.branchId = 'c4011fff-2c65-4088-901a-b9a070b8aadc'; // Fallback to known valid branch
          }
        }

        // Validate sale data before sync
        const validationError = validateSaleData(offlineSale.saleData);
        if (validationError) {
          logger.warn(`Validation failed for sale ${offlineSale.id}: ${validationError}`, { component: 'offline' });
          offlineSale.status = 'failed';
          offlineSale.error = validationError;
          offlineSale.finalFailureAt = new Date().toISOString();
          return { sale: offlineSale, success: false, error: validationError! };
        }

        // Implement retry logic with exponential backoff
        let retryCount = 0;
        const maxRetries = 3;
        let lastError: any = null;

        while (retryCount < maxRetries) {
          try {
            // Update status to syncing
            offlineSale.status = 'syncing';
            offlineSale.retryCount = retryCount;
            offlineSale.lastAttempt = new Date().toISOString();

            // Calculate timeout with exponential backoff (15s, 30s, 60s)
            const timeout = 15000 * Math.pow(2, retryCount);

            // Attempt to sync with backend (with rate limiting)
            const endpoint = extractEndpoint(`${BACKEND_BASE_URL}/sales`);
            await syncRateLimiter.waitIfNeeded(endpoint);
            
            const response = await rateLimitedAxios(
              () => axios.post(`${BACKEND_BASE_URL}/sales`, offlineSale.saleData, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                timeout,
              }),
              endpoint,
              syncRateLimiter
            );

            logger.info(`Synced offline sale ${offlineSale.id} -> ${response.data.data.saleId} (attempt ${retryCount + 1})`, { component: 'offline' });

            // Mark as synced and store receipt
            offlineSale.status = 'synced';
            offlineSale.receipt = response.data.data;
            offlineSale.syncedAt = new Date().toISOString();

            return { sale: offlineSale, success: true, error: null };

          } catch (error: any) {
            lastError = error;
            retryCount++;

            logger.warn(`Sync attempt ${retryCount} failed for sale ${offlineSale.id}: ${error.message}`, { component: 'offline' });

            if (retryCount < maxRetries) {
              // Wait before retry with exponential backoff (1s, 2s, 4s)
              const waitTime = 1000 * Math.pow(2, retryCount - 1);
              logger.debug(`Waiting ${waitTime}ms before retry`, { component: 'offline', saleId: offlineSale.id, retryCount });
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        }

        // If all retries failed, mark as failed
        logger.error(`Failed to sync offline sale ${offlineSale.id} after ${maxRetries} attempts`, { component: 'offline', saleId: offlineSale.id, error: lastError.message });
        offlineSale.status = 'failed';
        offlineSale.error = lastError.message;
        offlineSale.finalFailureAt = new Date().toISOString();

        const errorMessage = `Sale ${offlineSale.id}: ${lastError.message}. ${getErrorSuggestion(lastError)}`;
        return { sale: offlineSale, success: false, error: errorMessage };
      });

      // Wait for all sales in batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process results
      for (const result of batchResults) {
        if (result.success) {
          totalSyncedCount++;
        } else {
          allErrors.push(result.error ?? 'Unknown error');
          remainingSales.push(result.sale);
        }
      }

      // Send batch completion progress
      const processed = Math.min(i + batchSize, offlineSales.length);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-progress', {
          total: offlineSales.length,
          processed,
          synced: totalSyncedCount,
          failed: allErrors.length,
          currentBatch: currentBatch,
          totalBatches,
          percentage: Math.round((processed / offlineSales.length) * 100),
        });
      }

      // Delay between batches to prevent UI freezing and server overload
      // Use requestAnimationFrame-like delay to keep UI responsive
      if (i + batchSize < offlineSales.length) {
        await new Promise(resolve => setTimeout(resolve, 200)); // Reduced delay, batches are smaller
      }
    }

    // Update the store with final state
    store.set('offlineSales', remainingSales);
    store.set('lastSync', new Date().toISOString());

    // Clean up old cached data (older than 30 days)
    await cleanupOldData(store);

    logger.info(`Batched sync completed: ${totalSyncedCount} synced, ${allErrors.length} failed`, { component: 'offline' });

    // Send final progress
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-progress', {
        total: offlineSales.length,
        processed: offlineSales.length,
        synced: totalSyncedCount,
        failed: allErrors.length,
        currentBatch: totalBatches,
        totalBatches,
        percentage: 100,
        completed: true,
      });
    }

    return {
      success: true,
      syncedCount: totalSyncedCount,
      errors: allErrors,
      totalAttempted: offlineSales.length,
      cleanedCount: cleanedCount || 0,
      remainingQueueSize: remainingSales.length
    };

  } catch (error: any) {
    logger.error('Error in syncOfflineSales', { component: 'offline', error: error.message });
    
    // Send error progress
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-progress', {
        error: error.message || 'Failed to sync offline sales',
        failed: true,
      });
    }
    
    return { success: false, error: error.message || 'Failed to sync offline sales' };
  } finally {
    syncCancelled = false;
    currentSyncEvent = null;
  }
});

// Helper function to validate sale data before sync
function validateSaleData(saleData: any): string | null {
  if (!saleData) {
    return 'Sale data is missing';
  }

  if (!saleData.items || !Array.isArray(saleData.items) || saleData.items.length === 0) {
    return 'Sale must contain at least one item';
  }

  for (const item of saleData.items) {
    if (!item.productId || typeof item.productId !== 'string') {
      return 'Each sale item must have a valid product ID';
    }
    if (!item.price || typeof item.price !== 'number' || item.price <= 0) {
      return 'Each sale item must have a valid positive price';
    }
    if (!item.quantity || typeof item.quantity !== 'number' || item.quantity <= 0) {
      return 'Each sale item must have a valid positive quantity';
    }
  }

  if (!saleData.paymentMethod || typeof saleData.paymentMethod !== 'string') {
    return 'Sale must have a valid payment method';
  }

  if (!saleData.branchId || typeof saleData.branchId !== 'string') {
    return 'Sale must have a valid branch ID';
  }

  return null; // No validation errors
}

// Helper function to clean up old cached data
async function cleanupOldData(store: ElectronStore): Promise<void> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Clean up old offline sales (older than 30 days)
    const offlineSales = store.get('offlineSales', []) as any[];
    const recentSales = offlineSales.filter((sale: any) => {
      const saleDate = new Date(sale.timestamp);
      return saleDate >= thirtyDaysAgo;
    });

    if (recentSales.length !== offlineSales.length) {
      const removedCount = offlineSales.length - recentSales.length;
      store.set('offlineSales', recentSales);
      logger.info(`Cleaned up ${removedCount} old offline sales`, { component: 'offline' });
    }

    // Clean up old cached products if they're too old (optional - products might be needed longer)
    const lastProductUpdate = store.get('lastProductUpdate') as string;
    if (lastProductUpdate) {
      const lastUpdate = new Date(lastProductUpdate);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      if (lastUpdate < sevenDaysAgo) {
        logger.info('Cached products are older than 7 days, will refresh on next fetch', { component: 'offline' });
        // Don't delete cached products immediately, let them refresh naturally
      }
    }

  } catch (error: any) {
    logger.warn('Error during data cleanup', { component: 'offline', error: error.message });
  }
}

// Helper function to provide actionable error suggestions
function getErrorSuggestion(error: any): string {
  if (error.code === 'ECONNREFUSED') {
    return 'Check if the backend server is running and accessible.';
  }
  if (error.code === 'ENOTFOUND') {
    return 'Verify your internet connection and backend URL.';
  }
  if (error.response?.status === 401) {
    return 'Your session may have expired. Try logging out and back in.';
  }
  if (error.response?.status === 403) {
    return 'You may not have permission to create sales. Contact your administrator.';
  }
  if (error.response?.status === 409) {
    return 'This sale may have already been processed. Check for duplicates.';
  }
  if (error.response?.status >= 500) {
    return 'Server error occurred. Try again later or contact support.';
  }
  return 'Please try again or contact support if the issue persists.';
}

ipcMain.handle('getSyncStatus', async () => {
  const store = new ElectronStore();

  // Check online status by testing internet connectivity to an external service
  let online = false;
  try {
    await axios.get('https://www.google.com', { timeout: 5000 });
    online = true;
  } catch {
    online = false;
  }

  let offlineSales = store.get('offlineSales', []) as any[];
  
  // Clean up old failed syncs (older than 7 days) when checking status
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const initialCount = offlineSales.length;
  
  offlineSales = offlineSales.filter((sale: any) => {
    if (sale.status === 'failed' && sale.finalFailureAt) {
      const failureDate = new Date(sale.finalFailureAt);
      if (failureDate < sevenDaysAgo) {
        return false; // Remove old failed sales
      }
    }
    return true; // Keep all other sales
  });
  
  if (offlineSales.length !== initialCount) {
    store.set('offlineSales', offlineSales); // Update store with cleaned list
  }
  
  const pendingSyncs = offlineSales.filter((sale: any) => sale.status === 'pending').length;
  const lastSync = store.get('lastSync') as string | undefined;
  
  const MAX_QUEUE_SIZE = 1000;
  const WARNING_THRESHOLD = 100;
  const queueSize = offlineSales.length;
  const isWarning = queueSize >= WARNING_THRESHOLD;
  const isCritical = queueSize >= MAX_QUEUE_SIZE;

  return {
    online,
    pendingSyncs,
    lastSync,
    queueSize,
    maxQueueSize: MAX_QUEUE_SIZE,
    warningThreshold: WARNING_THRESHOLD,
    isWarning,
    isCritical
  };
});

// Expose API base URL to renderer process
ipcMain.handle('getApiBaseUrl', () => {
  return BACKEND_BASE_URL;
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
