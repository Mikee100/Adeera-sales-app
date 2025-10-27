import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import ElectronStore from 'electron-store';
import axios from 'axios';

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

const createWindow = (): void => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    height: 800,
    width: 1200,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    // icon: path.join(__dirname, '../assets/icon.png'), // Add icon later
    show: false, // Don't show until ready
  });

  // Load the index.html of the app.
  // For development, load from webpack dev server if available
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:8080');
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
app.whenReady().then(createWindow);

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

  console.log('🔐 Authentication attempt:', { email: credentials.email });

  // Check online status
  let online = false;
  try {
    console.log('🌐 Checking backend health...');
    // Use the root endpoint to check if backend is online (it's public)
    await axios.get('http://127.0.0.1:9000/', { timeout: 5000 });
    online = true;
    console.log('✅ Backend is online');
  } catch (error: any) {
    online = false;
    console.log('❌ Backend is offline:', error.message);
  }

  if (online) {
    // Online mode: authenticate against backend API
    try {
      console.log('📡 Sending login request to backend...');
      const response = await axios.post('http://127.0.0.1:9000/auth/login', credentials);
      console.log('📨 Backend response:', response.status, response.data);

      if (response.data.access_token && response.data.user) {
        console.log('✅ Login successful, caching data...');
        // Cache token and user data locally
        store.set('authToken', response.data.access_token);
        store.set('user', response.data.user);
        console.log('💾 Data cached successfully');
        return { success: true, token: response.data.access_token, user: response.data.user };
      } else {
        console.log('❌ Login failed: Invalid response format');
        return { success: false, error: 'Authentication failed' };
      }
    } catch (error: any) {
      console.log('❌ Login error:', error.response?.status, error.response?.data || error.message);
      const errorMessage = error.response?.data?.message || error.message || 'Authentication error';
      return { success: false, error: errorMessage };
    }
  } else {
    console.log('🔄 Backend offline, checking cached credentials...');
    // Offline mode: check cached user data
    const cachedUser = store.get('user') as User | undefined;
    const cachedToken = store.get('authToken') as string | undefined;

    if (cachedUser && cachedToken) {
      // Optionally, verify credentials match cached user email
      if (credentials.email === cachedUser.email) {
        console.log('✅ Offline login successful');
        // Allow offline login without password verification
        return { success: true, token: cachedToken, user: cachedUser };
      } else {
        console.log('❌ Offline login failed: email mismatch');
        return { success: false, error: 'Offline login failed: user not found' };
      }
    } else {
      console.log('❌ Offline login failed: no cached session');
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

ipcMain.handle('logout', () => {
  const store = new ElectronStore();
  store.delete('authToken');
  store.delete('user');
  store.delete('cachedProducts'); // Clear cached products on logout
  console.log('🚪 User logged out, cleared all cached data');
  return { success: true };
});

ipcMain.handle('getProducts', async () => {
  const store = new ElectronStore();

  try {
    // Get stored JWT token
    const token = store.get('authToken') as string;
    if (!token) {
      console.log('❌ No authentication token found');
      // Return cached products if available
      const cachedProducts = store.get('cachedProducts') as any[];
      if (cachedProducts) {
        console.log(`📦 Returning ${cachedProducts.length} cached products (no token)`);
        return { success: true, products: cachedProducts };
      }
      return { success: false, error: 'No authentication token found' };
    }

    console.log('📦 Fetching products from backend...');

    // Check online status first
    let online = false;
    try {
      await axios.get('http://127.0.0.1:9000/', { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (online) {
      // Online mode: fetch from backend and cache
      try {
        const response = await axios.get('http://127.0.0.1:9000/products', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000, // 10 second timeout
        });

        console.log(`📦 Received ${response.data.length} products from backend`);

        // Transform product data to match frontend expectations
        const products = response.data.map((product: any) => ({
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
        }));

        // Cache the products locally
        store.set('cachedProducts', products);
        console.log('💾 Products cached successfully');

        return { success: true, products };
      } catch (error: any) {
        console.error('❌ Error fetching products from backend:', error.response?.status, error.response?.data || error.message);
        // Fall back to cached products
        const cachedProducts = store.get('cachedProducts') as any[];
        if (cachedProducts) {
          console.log(`📦 Returning ${cachedProducts.length} cached products (backend error)`);
          return { success: true, products: cachedProducts };
        }
        throw error; // Re-throw if no cache available
      }
    } else {
      // Offline mode: return cached products
      console.log('🔄 Backend offline, using cached products');
      const cachedProducts = store.get('cachedProducts') as any[];
      if (cachedProducts) {
        console.log(`📦 Returning ${cachedProducts.length} cached products (offline mode)`);
        return { success: true, products: cachedProducts };
      } else {
        console.log('❌ No cached products available in offline mode');
        return { success: false, error: 'No cached products available. Please connect to the internet and try again.' };
      }
    }
  } catch (error: any) {
    console.error('❌ Error in getProducts:', error.message);

    // Final fallback: try to return cached products
    const cachedProducts = store.get('cachedProducts') as any[];
    if (cachedProducts) {
      console.log(`📦 Returning ${cachedProducts.length} cached products (final fallback)`);
      return { success: true, products: cachedProducts };
    }

    const errorMessage = error.response?.data?.message || error.message || 'Failed to fetch products';
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('createSale', async (event, saleData) => {
  const store = new ElectronStore();

  try {
    // Get stored JWT token
    const token = store.get('authToken') as string;
    if (!token) {
      console.log('❌ No authentication token found for sale creation');
      return { success: false, error: 'No authentication token found' };
    }

    console.log('💰 Creating sale:', { items: saleData.items.length, paymentMethod: saleData.paymentMethod });

    // Check online status
    let online = false;
    try {
      await axios.get('http://127.0.0.1:9000/', { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (online) {
      // Online mode: create sale via backend API
      try {
        const response = await axios.post('http://127.0.0.1:9000/sales', saleData, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000, // 15 second timeout for sale creation
        });

        console.log('✅ Sale created successfully:', response.data.data.saleId);

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
          console.log('💾 Product stock updated in cache');
        }

        return {
          success: true,
          sale: response.data.data,
          receipt: response.data.data // The backend returns receipt data in the response
        };
      } catch (error: any) {
        console.error('❌ Error creating online sale:', error.response?.status, error.response?.data || error.message);
        const errorMessage = error.response?.data?.message || error.message || 'Failed to create sale';
        return { success: false, error: errorMessage };
      }
    } else {
      // Offline mode: queue sale for later sync
      console.log('🔄 Backend offline, queuing sale for later sync');

      const offlineSales = store.get('offlineSales', []) as any[];
      const offlineSale = {
        id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
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
        console.log('💾 Product stock updated in cache for offline sale');
      }

      console.log('✅ Sale queued for offline sync');

      // Return success with offline receipt
      const offlineReceipt = {
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

      return {
        success: true,
        sale: { id: offlineSale.id, status: 'offline' },
        receipt: offlineReceipt
      };
    }

  } catch (error: any) {
    console.error('❌ Error in createSale:', error.message);
    return { success: false, error: error.message || 'Failed to create sale' };
  }
});

ipcMain.handle('getReceipt', async (event, saleId) => {
  const store = new ElectronStore();

  try {
    // Get stored JWT token
    const token = store.get('authToken') as string;
    if (!token) {
      console.log('❌ No authentication token found for receipt');
      return { success: false, error: 'No authentication token found' };
    }

    console.log('🧾 Fetching receipt for sale:', saleId);

    // Check online status
    let online = false;
    try {
      await axios.get('http://127.0.0.1:9000/', { timeout: 5000 });
      online = true;
    } catch {
      online = false;
    }

    if (!online) {
      console.log('❌ Backend offline, cannot fetch receipt');
      return { success: false, error: 'Cannot fetch receipt while offline. Please check your internet connection.' };
    }

    // Get receipt from backend API
    const response = await axios.get(`http://127.0.0.1:9000/sales/${saleId}/receipt`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    console.log('✅ Receipt fetched successfully');

    return {
      success: true,
      receipt: response.data
    };

  } catch (error: any) {
    console.error('❌ Error fetching receipt:', error.response?.status, error.response?.data || error.message);
    const errorMessage = error.response?.data?.message || error.message || 'Failed to fetch receipt';
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('printReceipt', async (event, receiptData) => {
  try {
    console.log('🖨️ Printing receipt for sale:', receiptData.saleId);

    // For now, we'll just log the receipt data
    // In a real implementation, you would integrate with a receipt printer
    console.log('Receipt Data:', JSON.stringify(receiptData, null, 2));

    // Simulate printing delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('✅ Receipt printed successfully');

    return { success: true };

  } catch (error: any) {
    console.error('❌ Error printing receipt:', error.message);
    return { success: false, error: error.message || 'Failed to print receipt' };
  }
});

// New IPC handlers for offline functionality
ipcMain.handle('getOfflineSales', () => {
  const store = new ElectronStore();
  const offlineSales = store.get('offlineSales', []) as any[];
  console.log(`📋 Returning ${offlineSales.length} offline sales`);
  return { success: true, sales: offlineSales };
});

ipcMain.handle('syncOfflineSales', async () => {
  const store = new ElectronStore();

  try {
    const offlineSales = store.get('offlineSales', []) as any[];
    if (offlineSales.length === 0) {
      console.log('📋 No offline sales to sync');
      return { success: true, syncedCount: 0, errors: [] };
    }

    console.log(`🔄 Starting batched sync of ${offlineSales.length} offline sales`);

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
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(offlineSales.length / batchSize)} (${batch.length} sales)`);

      // Process batch with parallel requests but controlled concurrency
      const batchPromises = batch.map(async (offlineSale) => {
        // Skip already synced sales
        if (offlineSale.status === 'synced') {
          return { sale: offlineSale, success: true, error: null };
        }

        // Fix branchId for existing offline sales that may have undefined branchId
        if (!offlineSale.saleData.branchId || typeof offlineSale.saleData.branchId !== 'string') {
          console.log(`🔧 Fixing branchId for offline sale ${offlineSale.id}`);
          // Get user data to determine the correct branchId
          const userData = store.get('user') as User | undefined;
          if (userData?.branchId) {
            offlineSale.saleData.branchId = userData.branchId;
            console.log(`🔧 Set branchId to user's branch: ${userData.branchId}`);
          } else {
            console.warn(`⚠️ No branchId found for user, using fallback`);
            offlineSale.saleData.branchId = 'c4011fff-2c65-4088-901a-b9a070b8aadc'; // Fallback to known valid branch
          }
        }

        // Validate sale data before sync
        const validationError = validateSaleData(offlineSale.saleData);
        if (validationError) {
          console.warn(`⚠️ Validation failed for sale ${offlineSale.id}: ${validationError}`);
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
            const response = await axios.post('http://127.0.0.1:9000/sales', offlineSale.saleData, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              timeout,
            });

            console.log(`✅ Synced offline sale ${offlineSale.id} -> ${response.data.data.saleId} (attempt ${retryCount + 1})`);

            // Mark as synced and store receipt
            offlineSale.status = 'synced';
            offlineSale.receipt = response.data.data;
            offlineSale.syncedAt = new Date().toISOString();

            return { sale: offlineSale, success: true, error: null };

          } catch (error: any) {
            lastError = error;
            retryCount++;

            console.warn(`⚠️ Sync attempt ${retryCount} failed for sale ${offlineSale.id}:`, error.message);

            if (retryCount < maxRetries) {
              // Wait before retry with exponential backoff (1s, 2s, 4s)
              const waitTime = 1000 * Math.pow(2, retryCount - 1);
              console.log(`⏳ Waiting ${waitTime}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        }

        // If all retries failed, mark as failed
        console.error(`❌ Failed to sync offline sale ${offlineSale.id} after ${maxRetries} attempts:`, lastError.message);
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

    console.log(`🔄 Batched sync completed: ${totalSyncedCount} synced, ${allErrors.length} failed`);

    return {
      success: true,
      syncedCount: totalSyncedCount,
      errors: allErrors,
      totalAttempted: offlineSales.length
    };

  } catch (error: any) {
    console.error('❌ Error in syncOfflineSales:', error.message);
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
      console.log(`🧹 Cleaned up ${removedCount} old offline sales`);
    }

    // Clean up old cached products if they're too old (optional - products might be needed longer)
    const lastProductUpdate = store.get('lastProductUpdate') as string;
    if (lastProductUpdate) {
      const lastUpdate = new Date(lastProductUpdate);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      if (lastUpdate < sevenDaysAgo) {
        console.log('🧹 Cached products are older than 7 days, will refresh on next fetch');
        // Don't delete cached products immediately, let them refresh naturally
      }
    }

  } catch (error: any) {
    console.warn('⚠️ Error during data cleanup:', error.message);
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
