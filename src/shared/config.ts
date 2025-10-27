// Configuration constants for the POS application
export const API_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3001' // Next.js API routes
  : 'https://your-saas-domain.com/api'; // Production API

export const WS_BASE_URL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3001' // WebSocket connection
  : 'wss://your-saas-domain.com'; // Production WebSocket

export const APP_CONFIG = {
  name: 'SaaS POS',
  version: '1.0.0',
  window: {
    minWidth: 1000,
    minHeight: 700,
    defaultWidth: 1400,
    defaultHeight: 900,
  },
  features: {
    offlineMode: true,
    multiBranch: true,
    realTimeUpdates: true,
    receiptPrinting: true,
    barcodeScanning: true,
  },
};
