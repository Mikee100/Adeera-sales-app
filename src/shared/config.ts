// Configuration constants for the POS application
// Use localhost backend for development; override via env vars.
// Use 127.0.0.1 instead of localhost to avoid IPv6 (::1) connection issues on Windows
export const API_BASE_URL =
  process.env.API_BASE_URL || 'http://127.0.0.1:9000';

export const WS_BASE_URL =
  process.env.WS_BASE_URL || 'ws://127.0.0.1:9000';

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
