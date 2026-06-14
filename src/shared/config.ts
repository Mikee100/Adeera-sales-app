// Configuration constants for the POS application.
// Use IPv4 localhost during development/testing and hosted endpoints in production.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PROD_API_BASE_URL = 'https://saas-business.duckdns.org';
const DEV_API_BASE_URL = 'http://127.0.0.1:7000';
const PROD_WS_BASE_URL = 'wss://saas-business.duckdns.org';
const DEV_WS_BASE_URL = 'ws://127.0.0.1:7000';

export const API_BASE_URL = IS_PRODUCTION ? PROD_API_BASE_URL : DEV_API_BASE_URL;

export const WS_BASE_URL = IS_PRODUCTION ? PROD_WS_BASE_URL : DEV_WS_BASE_URL;

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
