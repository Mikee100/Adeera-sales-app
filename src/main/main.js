const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const ElectronStore = require('electron-store');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

function createWindow () {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    height: 800,
    width: 1200,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    },
    show: false // Don't show until ready
  });

  // Load the index.html of the app.
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:8080');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
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
}

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

// IPC Handlers for renderer communication
ipcMain.handle('authenticate', async (event, credentials) => {
  try {
    // Mock authentication - replace with actual API call to SaaS backend
    if (credentials.email === 'test@saas.com' && credentials.password === 'password') {
      const token = 'mock-jwt-token';
      const user = { id: '1', name: 'Test User', email: credentials.email, role: 'cashier' };
      
      // Store token
      const store = new ElectronStore();
      store.set('authToken', token);
      
      return { token, user };
    } else {
      throw new Error('Invalid credentials. Use test@saas.com / password');
    }
  } catch (error) {
    throw error;
  }
});

ipcMain.handle('getAuthToken', () => {
  const store = new ElectronStore();
  return store.get('authToken', null);
});

ipcMain.handle('logout', () => {
  const store = new ElectronStore();
  store.delete('authToken');
  return { success: true };
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
