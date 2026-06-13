// Configuration constants for the POS application.
// Default to hosted backend so sales can be posted directly in production.
export const API_BASE_URL = 'https://saas-business.duckdns.org';

export const WS_BASE_URL = 'wss://saas-business.duckdns.org';

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
