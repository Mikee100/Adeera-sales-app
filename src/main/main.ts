import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import ElectronStore from 'electron-store';
import axios from 'axios';
import { logger } from '../shared/logger';
import { cacheService } from '../shared/cache-service';
import { printerService } from './printer-service';
import { API_BASE_URL } from '../shared/config';

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

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow | null;

// Backend configuration: prefer explicit environment variables when present.
// The shared API_BASE_URL already handles dev vs production defaults.
const BACKEND_BASE_URL =
  process.env.BACKEND_BASE_URL || API_BASE_URL;

// Log backend URL on startup for debugging
console.log(`🌐 Backend URL configured: ${BACKEND_BASE_URL}`);

const BACKEND_HEALTH_URL =
  process.env.BACKEND_HEALTH_URL || `${BACKEND_BASE_URL.replace(/\/$/, '')}/health`;

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
    // icon: path.join(__dirname, '../assets/icon.png'), // Add icon later
    show: false, // Don't show until ready
  });

  // Load the index.html of the app.
  // In development: load the POS renderer from this app's webpack dev server (port 3001).
  // Port 3000 is the Next.js SaaS website – we must use a different port for the POS UI.
  if (process.env.NODE_ENV === 'development') {
    const devServerUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3001';
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open the DevTools if in development
  if (process.env.NODE_ENV === 'development') {
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
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
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
      logger.debug('Sending login request to backend', { component: 'auth', url: loginUrl });
      console.log(`🔐 Attempting login at: ${loginUrl}`);
      const response = await axios.post(loginUrl, credentials);
      logger.debug('Backend response received', { component: 'auth', status: response.status });

      if (response.data.access_token && response.data.user) {
        logger.info('Login successful, caching data', { component: 'auth' });
        // Cache token and user data locally
        store.set('authToken', response.data.access_token);
        store.set('user', response.data.user);
        logger.debug('Data cached successfully', { component: 'auth' });
        return { success: true, token: response.data.access_token, user: response.data.user };
      } else {
        logger.warn('Login failed: Invalid response format', { component: 'auth' });
        return { success: false, error: 'Authentication failed' };
      }
    } catch (error: any) {
      logger.error('Login error', { component: 'auth', status: error.response?.status, error: error.response?.data || error.message });
      
      // Extract error message from NestJS exception response
      // NestJS formats errors as: { statusCode: 401, message: 'Invalid credentials', error: 'Unauthorized' }
      let errorMessage = 'Authentication error';
      
      if (error.response?.data) {
        // Try different possible error message locations
        errorMessage = 
          error.response.data.message || 
          error.response.data.error || 
          (Array.isArray(error.response.data.message) ? error.response.data.message[0] : null) ||
          error.message ||
          'Authentication error';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
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
        // Allow offline login without password verification
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
  const store = new ElectronStore();
  return store.get('authToken', null);
});

ipcMain.handle('getUserData', () => {
  const store = new ElectronStore();
  return store.get('user', null);
});

ipcMain.handle('getBranches', async () => {
  const store = new ElectronStore();
  const token = store.get('authToken') as string;
  
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
      const response = await axios.get(`${BACKEND_BASE_URL}/branches`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      
      const branches = Array.isArray(response.data) ? response.data : [];
      logger.info(`Fetched ${branches.length} branches`, { component: 'branches' });
      
      // Cache branches for offline use
      store.set('cachedBranches', branches);
      
      return { success: true, branches };
    } else {
      // Offline mode: return cached branches if available
      const cachedBranches = store.get('cachedBranches') as any[];
      if (cachedBranches && Array.isArray(cachedBranches)) {
        logger.info(`Returning ${cachedBranches.length} cached branches (offline)`, { component: 'branches' });
        return { success: true, branches: cachedBranches };
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
      logger.info(`Returning ${cachedBranches.length} cached branches (error fallback)`, { component: 'branches' });
      return { success: true, branches: cachedBranches };
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
  store.delete('authToken');
  store.delete('user');
  store.delete('cachedProducts'); // Clear cached products on logout
  store.delete('cachedBranches'); // Clear cached branches on logout
  logger.info('User logged out, cleared all cached data', { component: 'auth' });
  return { success: true };
});

ipcMain.handle('getProducts', async () => {
  const store = new ElectronStore();

  try {
    // Get stored JWT token
    const token = store.get('authToken') as string;
    if (!token) {
      logger.warn('No authentication token found', { component: 'products' });
      // Return cached products if available
      const cachedProducts = store.get('cachedProducts') as any[];
      if (cachedProducts && Array.isArray(cachedProducts)) {
        logger.info(`Returning ${cachedProducts.length} cached products (no token)`, { component: 'products' });
        return { success: true, products: cachedProducts };
      } else if (cachedProducts) {
        logger.warn('Cached products found but not in array format, clearing cache', { component: 'products' });
        store.delete('cachedProducts');
      }
      return { success: false, error: 'No authentication token found' };
    }

    logger.info('Fetching products from backend', { component: 'products' });

    // Check online status first
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
        const user = store.get('user') as { branchId?: string } | undefined;
        const response = await axios.get(`${BACKEND_BASE_URL}/products?page=1&limit=1000&includeVariations=true`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(user?.branchId && { 'x-branch-id': user.branchId }),
          },
          timeout: 10000, // 10 second timeout
        });

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

        // Cache the products locally
        store.set('cachedProducts', products);
        logger.debug('Products cached successfully', { component: 'products' });

        return { success: true, products };
      } catch (error: any) {
        logger.error('Error fetching products from backend', { component: 'products', status: error.response?.status, error: error.response?.data || error.message });
        // Fall back to cached products
        const cachedProducts = store.get('cachedProducts') as any[];
        if (cachedProducts && Array.isArray(cachedProducts)) {
          logger.info(`Returning ${cachedProducts.length} cached products (backend error)`, { component: 'products' });
          return { success: true, products: cachedProducts };
        } else if (cachedProducts) {
          logger.warn('Cached products found but not in array format, clearing cache', { component: 'products' });
          store.delete('cachedProducts');
        }
        throw error; // Re-throw if no cache available
      }
    } else {
      // Offline mode: return cached products
      logger.info('Backend offline, using cached products', { component: 'products' });
      const cachedProducts = store.get('cachedProducts') as any[];
      if (cachedProducts && Array.isArray(cachedProducts)) {
        logger.info(`Returning ${cachedProducts.length} cached products (offline mode)`, { component: 'products' });
        return { success: true, products: cachedProducts };
      } else if (cachedProducts) {
        logger.warn('Cached products found but not in array format, clearing cache', { component: 'products' });
        store.delete('cachedProducts');
      } else {
        logger.warn('No cached products available in offline mode', { component: 'products' });
        return { success: false, error: 'No cached products available. Please connect to the internet and try again.' };
      }
    }
  } catch (error: any) {
    logger.error('Error in getProducts', { component: 'products', error: error.message });

    // Final fallback: try to return cached products
    const cachedProducts = store.get('cachedProducts') as any[];
    if (cachedProducts && Array.isArray(cachedProducts)) {
      logger.info(`Returning ${cachedProducts.length} cached products (final fallback)`, { component: 'products' });
      return { success: true, products: cachedProducts };
    } else if (cachedProducts) {
      logger.warn('Cached products found but not in array format, clearing cache', { component: 'products' });
      store.delete('cachedProducts');
    }

    const errorMessage = error.response?.data?.message || error.message || 'Failed to fetch products';
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('getProductVariations', async (_event, productId: string) => {
  const store = new ElectronStore();
  const token = store.get('authToken') as string;
  if (!token) return { success: false, variations: [], error: 'Not authenticated', unauthorized: true };
  try {
    const response = await axios.get(`${BACKEND_BASE_URL}/products/${productId}/variations`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-branch-id': (store.get('user') as any)?.branchId || '',
      },
      timeout: 10000,
    });
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

  try {
    // Get stored JWT token
    const token = store.get('authToken') as string;
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

        // Update cached products after sale (reduce stock)
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
          logger.debug('Product stock updated in cache', { component: 'sales' });
        }

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
        
        let errorMessage = 'Failed to create sale';
        
        // Extract error message from various possible formats (NestJS validation errors)
        if (errorData) {
          // Check for validation error array (common NestJS format)
          if (Array.isArray(errorData)) {
            errorMessage = errorData.map((err: any) => {
              if (typeof err === 'string') return err;
              if (err?.constraints) {
                return Object.values(err.constraints).join(', ');
              }
              if (err?.property && err?.constraints) {
                return `${err.property}: ${Object.values(err.constraints).join(', ')}`;
              }
              return JSON.stringify(err);
            }).join('; ');
          } else if (errorData.message) {
            if (Array.isArray(errorData.message)) {
              // NestJS validation errors come as array of constraint messages
              errorMessage = errorData.message.map((msg: any) => {
                if (typeof msg === 'string') return msg;
                if (msg?.constraints) {
                  const property = msg.property ? `${msg.property}: ` : '';
                  return property + Object.values(msg.constraints).join(', ');
                }
                return JSON.stringify(msg);
              }).join('; ');
            } else {
              errorMessage = String(errorData.message);
            }
          } else if (errorData.error) {
            errorMessage = Array.isArray(errorData.error) ? errorData.error.join('; ') : String(errorData.error);
          } else if (typeof errorData === 'string') {
            errorMessage = errorData;
          } else {
            // Try to extract any useful information from the error object
            const errorKeys = Object.keys(errorData);
            if (errorKeys.length > 0) {
              const errorDetails = errorKeys
                .map(key => {
                  const value = errorData[key];
                  if (key === 'message' || key === 'statusCode') return null;
                  return `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`;
                })
                .filter(Boolean)
                .join(', ');
              if (errorDetails) {
                errorMessage = `Bad Request: ${errorDetails}`;
              } else {
                errorMessage = errorStatus === 400 ? `Bad Request: ${JSON.stringify(errorData)}` : JSON.stringify(errorData);
              }
            } else {
              errorMessage = errorStatus === 400 ? `Bad Request: ${JSON.stringify(errorData)}` : JSON.stringify(errorData);
            }
          }
        } else if (errorStatus === 400) {
          // For 400 errors, provide more context about what might be wrong
          const requestSummary = `Items: ${saleData.items?.length || 0}, Payment: ${saleData.paymentMethod}, Branch: ${saleData.branchId ? 'set' : 'missing'}`;
          if (errorData && typeof errorData === 'object') {
            // Try to extract any additional error details
            const errorDetails = Object.keys(errorData)
              .filter(key => key !== 'message' && key !== 'statusCode')
              .map(key => `${key}: ${JSON.stringify(errorData[key])}`)
              .join(', ');
            errorMessage = `Bad Request: ${errorDetails || errorStatusText || 'Invalid request data'}. Request: ${requestSummary}. Note: Backend validation errors are hidden in production. Check server logs for details.`;
          } else {
            errorMessage = `Bad Request: ${errorStatusText || 'Invalid request data'}. Request: ${requestSummary}. Note: Backend validation errors are hidden in production. Check server logs for details.`;
          }
        } else if (error.message) {
          errorMessage = error.message;
        } else if (error.code) {
          errorMessage = `Network error: ${error.code}`;
        }
        
        logger.error('Extracted error message', { 
          component: 'sales', 
          errorMessage, 
          rawData: errorData ? JSON.stringify(errorData) : null,
          status: errorStatus,
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
      const offlineSale = {
        id: `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        saleData,
        timestamp: new Date().toISOString(),
        status: 'pending'
      };

      offlineSales.push(offlineSale);
      store.set('offlineSales', offlineSales);

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

      logger.info('Sale queued for offline sync', { component: 'sales' });

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

      // Return success with offline receipt
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
        vatAmount: saleData.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0) * 0.16,
        total: saleData.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0) * 1.16,
        paymentMethod: saleData.paymentMethod,
        amountReceived: saleData.amountReceived,
        change: saleData.amountReceived ? saleData.amountReceived - (saleData.items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0) * 1.16) : undefined,
        businessInfo: { name: 'Business Name' }, // Placeholder
        branch: saleData.branchId ? { id: saleData.branchId, name: `Branch ${saleData.branchId}` } : undefined
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
    // Get stored JWT token
    const token = store.get('authToken') as string;
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

    // Get receipt from backend API
    const response = await axios.get(`${BACKEND_BASE_URL}/sales/${saleId}/receipt`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    logger.info('Receipt fetched successfully', { component: 'receipts', saleId });

    return {
      success: true,
      receipt: response.data
    };

  } catch (error: any) {
    logger.error('Error fetching receipt', { component: 'receipts', saleId, status: error.response?.status, error: error.response?.data || error.message });
    const errorMessage = error.response?.data?.message || error.message || 'Failed to fetch receipt';
    return { success: false, error: errorMessage };
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
  const offlineSales = store.get('offlineSales', []) as any[];
  logger.info(`Returning ${offlineSales.length} offline sales`, { component: 'offline' });
  return { success: true, sales: offlineSales };
});

ipcMain.handle('syncOfflineSales', async () => {
  const store = new ElectronStore();

  try {
    const offlineSales = store.get('offlineSales', []) as any[];
    if (offlineSales.length === 0) {
      logger.info('No offline sales to sync', { component: 'offline' });
      return { success: true, syncedCount: 0, errors: [] };
    }

    logger.info(`Starting batched sync of ${offlineSales.length} offline sales`, { component: 'offline' });

    const token = store.get('authToken') as string;
    if (!token) {
      return { success: false, error: 'No authentication token found' };
    }

    // Batch sales for more efficient syncing (process in groups of 5)
    const batchSize = 5;
    let totalSyncedCount = 0;
    const allErrors: string[] = [];
    const remainingSales: any[] = [];

    for (let i = 0; i < offlineSales.length; i += batchSize) {
      const batch = offlineSales.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(offlineSales.length / batchSize)} (${batch.length} sales)`, { component: 'offline' });

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

            // Attempt to sync with backend
            const response = await axios.post(`${BACKEND_BASE_URL}/sales`, offlineSale.saleData, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              timeout,
            });

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

      // Small delay between batches to prevent overwhelming the server
      if (i + batchSize < offlineSales.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Update the store with final state
    store.set('offlineSales', remainingSales);
    store.set('lastSync', new Date().toISOString());

    // Clean up old cached data (older than 30 days)
    await cleanupOldData(store);

    logger.info(`Batched sync completed: ${totalSyncedCount} synced, ${allErrors.length} failed`, { component: 'offline' });

    return {
      success: true,
      syncedCount: totalSyncedCount,
      errors: allErrors,
      totalAttempted: offlineSales.length
    };

  } catch (error: any) {
    logger.error('Error in syncOfflineSales', { component: 'offline', error: error.message });
    return { success: false, error: error.message || 'Failed to sync offline sales' };
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

  const offlineSales = store.get('offlineSales', []) as any[];
  const pendingSyncs = offlineSales.filter((sale: any) => sale.status === 'pending').length;
  const lastSync = store.get('lastSync') as string | undefined;

  return {
    online,
    pendingSyncs,
    lastSync
  };
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
