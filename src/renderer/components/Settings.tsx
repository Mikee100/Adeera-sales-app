import React, { useState, useEffect } from 'react';
import { useSleepMode } from '../contexts/SleepModeContext';
import './Settings.css';

interface PrinterConfig {
  type: 'usb' | 'network' | 'file';
  vendorId?: number;
  productId?: number;
  path?: string;
  ip?: string;
  port?: number;
  autoOpenCashDrawer: boolean;
}

interface CatalogSyncStatus {
  success: boolean;
  hasCatalog: boolean;
  lastSynced: string | null;
  ageHours: number | null;
  productCount: number;
  isStale: boolean;
}

const Settings: React.FC<{ onClose: () => void; onUnauthorized?: () => void }> = ({ onClose, onUnauthorized }) => {
  const { enterSleepMode } = useSleepMode();
  const [activeTab, setActiveTab] = useState<'printer' | 'system'>('printer');
  const [config, setConfig] = useState<PrinterConfig>({
    type: 'usb',
    autoOpenCashDrawer: true,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogSyncStatus | null>(null);

  useEffect(() => {
    loadConfig();
    loadCatalogStatus();
    // Refresh catalog status every 30 seconds
    const statusInterval = setInterval(loadCatalogStatus, 30000);
    return () => clearInterval(statusInterval);
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await (window as any).electronAPI.getPrinterConfig();
      if (response.success && response.config) {
        setConfig(response.config);
      }
    } catch (error) {
      console.error('Failed to load printer config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await (window as any).electronAPI.setPrinterConfig(config);
      if (response.success) {
        setMessage({ type: 'success', text: 'Settings saved successfully' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to save settings' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to save settings' });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setSaving(true);
    try {
      const testReceipt = {
        saleId: 'TEST-001',
        date: new Date().toISOString(),
        businessInfo: {
          name: 'Test Business',
          address: '123 Test Street',
          phone: '+1234567890',
        },
        items: [
          { name: 'Test Item', quantity: 1, price: 10.00, sku: 'TEST-001' },
        ],
        subtotal: 10.00,
        vatAmount: 1.60,
        total: 11.60,
        paymentMethod: 'cash',
        amountReceived: 20.00,
        change: 8.40,
      };

      const response = await (window as any).electronAPI.printReceipt(testReceipt);
      if (response.success) {
        setMessage({ type: 'success', text: 'Test print sent successfully' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: response.error || 'Test print failed' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Test print failed' });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestCashDrawer = async () => {
    setSaving(true);
    try {
      const response = await (window as any).electronAPI.openCashDrawer();
      if (response.success) {
        setMessage({ type: 'success', text: 'Cash drawer opened successfully' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to open cash drawer' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to open cash drawer' });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const loadCatalogStatus = async () => {
    try {
      const status = await (window as any).electronAPI.getCatalogSyncStatus() as CatalogSyncStatus;
      setCatalogStatus(status);
    } catch (error) {
      console.error('Failed to load catalog status:', error);
    }
  };

  const handleSyncProducts = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const response = await (window as any).electronAPI.syncProducts();
      if (response.success) {
        setMessage({ type: 'success', text: `Products synced successfully! ${response.products?.length || 0} products loaded.` });
        setTimeout(() => setMessage(null), 5000);
        // Refresh catalog status
        await loadCatalogStatus();
      } else {
        const isUnauthorized = response.unauthorized ||
          (response.error && (response.error.includes('Unauthorized') || response.error.includes('log in again')));
        setMessage({
          type: 'error',
          text: isUnauthorized
            ? 'Session expired. Please log in again to sync the catalog.'
            : (response.error || 'Failed to sync products'),
        });
        setTimeout(() => setMessage(null), 8000);
      }
    } catch (error: any) {
      const isUnauthorized = error?.message?.includes('Unauthorized') || error?.message?.includes('log in again');
      setMessage({
        type: 'error',
        text: isUnauthorized
          ? 'Session expired. Please log in again to sync the catalog.'
          : (error.message || 'Failed to sync products'),
      });
      setTimeout(() => setMessage(null), 8000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-header">
          <div className="settings-header-content">
            <h1 className="settings-title">Settings</h1>
            <p className="settings-subtitle">Configure your POS system preferences</p>
          </div>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="settings-tabs-nav">
          <button
            className={`settings-tab ${activeTab === 'printer' ? 'active' : ''}`}
            onClick={() => setActiveTab('printer')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            <span>Printer</span>
          </button>
          <button
            className={`settings-tab ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span>System</span>
          </button>
        </div>

        {/* Message Alert */}
        {message && (
          <div className={`settings-alert ${message.type}`}>
            <div className="settings-alert-icon">
              {message.type === 'success' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              )}
            </div>
            <div className="settings-alert-body">
              <span className="settings-alert-text">{message.text}</span>
              {message.type === 'error' && message.text.includes('log in again') && onUnauthorized && (
                <button
                  type="button"
                  className="settings-alert-action-btn"
                  onClick={() => {
                    onUnauthorized();
                    onClose();
                  }}
                >
                  Log in again
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="settings-content">
          {loading ? (
            <div className="settings-loading">
              <div className="settings-spinner"></div>
              <p>Loading settings...</p>
            </div>
          ) : (
            <>
              {activeTab === 'printer' && (
                <div className="settings-tab-content">
                  {/* Printer Type */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <h3 className="settings-card-title">Printer Configuration</h3>
                      <p className="settings-card-description">Select your printer type and configure connection settings</p>
                    </div>
                    <div className="settings-card-body">
                      <div className="settings-field">
                        <label className="settings-label">
                          <span className="settings-label-text">Printer Type</span>
                          <select
                            value={config.type}
                            onChange={(e) => setConfig({ ...config, type: e.target.value as 'usb' | 'network' | 'file' })}
                            className="settings-select"
                          >
                            <option value="usb">USB Printer</option>
                            <option value="network">Network Printer</option>
                            <option value="file">Save to File</option>
                          </select>
                        </label>
                      </div>

                      {config.type === 'usb' && (
                        <div className="settings-field">
                          <label className="settings-label">
                            <span className="settings-label-text">Device Path</span>
                            <input
                              type="text"
                              value={config.path || ''}
                              onChange={(e) => setConfig({ ...config, path: e.target.value })}
                              placeholder="COM1 (Windows) or /dev/usb/lp0 (Linux)"
                              className="settings-input"
                            />
                          </label>
                          <p className="settings-field-hint">
                            Windows: COM1, COM2, etc. | Linux: /dev/usb/lp0, /dev/usb/lp1, etc. | macOS: Leave empty for auto-detect
                          </p>
                        </div>
                      )}

                      {config.type === 'network' && (
                        <>
                          <div className="settings-field">
                            <label className="settings-label">
                              <span className="settings-label-text">Printer IP Address</span>
                              <input
                                type="text"
                                value={config.ip || ''}
                                onChange={(e) => setConfig({ ...config, ip: e.target.value })}
                                placeholder="192.168.1.100"
                                className="settings-input"
                              />
                            </label>
                          </div>
                          <div className="settings-field">
                            <label className="settings-label">
                              <span className="settings-label-text">Port</span>
                              <input
                                type="number"
                                value={config.port || 9100}
                                onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || 9100 })}
                                placeholder="9100"
                                className="settings-input"
                              />
                            </label>
                          </div>
                        </>
                      )}

                      <div className="settings-field">
                        <label className="settings-checkbox-label">
                          <input
                            type="checkbox"
                            checked={config.autoOpenCashDrawer}
                            onChange={(e) => setConfig({ ...config, autoOpenCashDrawer: e.target.checked })}
                            className="settings-checkbox"
                          />
                          <span className="settings-checkbox-text">Auto-open cash drawer on cash payments</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Test Actions */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <h3 className="settings-card-title">Test Printer</h3>
                      <p className="settings-card-description">Test your printer configuration</p>
                    </div>
                    <div className="settings-card-body">
                      <div className="settings-actions-grid">
                        <button
                          onClick={handleTestPrint}
                          disabled={saving}
                          className="settings-action-btn settings-action-btn-secondary"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                          </svg>
                          <span>Test Print</span>
                        </button>
                        <button
                          onClick={handleTestCashDrawer}
                          disabled={saving}
                          className="settings-action-btn settings-action-btn-secondary"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                          </svg>
                          <span>Test Cash Drawer</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Info Card */}
                  <div className="settings-info-card">
                    <div className="settings-info-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                      </svg>
                    </div>
                    <div className="settings-info-content">
                      <h4 className="settings-info-title">Printer Setup Notes</h4>
                      <ul className="settings-info-list">
                        <li><strong>USB Printers:</strong> Ensure printer is connected and drivers are installed</li>
                        <li><strong>Network Printers:</strong> Printer must be on the same network with port 9100 open</li>
                        <li><strong>File Mode:</strong> Receipts saved to Desktop/POS_Receipts folder</li>
                        <li><strong>Cash Drawer:</strong> Must be connected via RJ-11 or USB cable</li>
                      </ul>
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="settings-footer">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="settings-save-btn"
                    >
                      {saving ? (
                        <>
                          <div className="settings-btn-spinner"></div>
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                            <polyline points="17 21 17 13 7 13 7 21"></polyline>
                            <polyline points="7 3 7 8 15 8"></polyline>
                          </svg>
                          <span>Save Settings</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'system' && (
                <div className="settings-tab-content">
                  {/* Product Catalog Sync */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <h3 className="settings-card-title">Product Catalog</h3>
                      <p className="settings-card-description">Sync product catalog from backend</p>
                    </div>
                    <div className="settings-card-body">
                      {catalogStatus && (
                        <div className="settings-field" style={{ marginBottom: '16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span className="settings-label-text">Catalog Status</span>
                            {catalogStatus.isStale && (
                              <span style={{ 
                                color: '#f59e0b', 
                                fontSize: '12px', 
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="12" r="10"></circle>
                                  <line x1="12" y1="8" x2="12" y2="12"></line>
                                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                </svg>
                                Stale
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.6' }}>
                            {catalogStatus.hasCatalog ? (
                              <>
                                <div><strong>{catalogStatus.productCount}</strong> products cached</div>
                                {catalogStatus.lastSynced && (
                                  <div>
                                    Last synced: {catalogStatus.ageHours !== null 
                                      ? catalogStatus.ageHours < 1 
                                        ? `${Math.round(catalogStatus.ageHours * 60)} minutes ago`
                                        : `${catalogStatus.ageHours.toFixed(1)} hours ago`
                                      : 'Unknown'}
                                  </div>
                                )}
                                {catalogStatus.isStale && (
                                  <div style={{ color: '#f59e0b', marginTop: '8px', fontWeight: '500' }}>
                                    ⚠️ Catalog is outdated. Please sync to get the latest products.
                                  </div>
                                )}
                              </>
                            ) : (
                              <div style={{ color: '#ef4444' }}>No product catalog cached</div>
                            )}
                          </div>
                        </div>
                      )}
                      <button
                        onClick={handleSyncProducts}
                        disabled={syncing}
                        className="settings-action-btn settings-action-btn-primary"
                        style={{ width: '100%' }}
                      >
                        {syncing ? (
                          <>
                            <div className="settings-btn-spinner"></div>
                            <span>Syncing...</span>
                          </>
                        ) : (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="23 4 23 10 17 10"></polyline>
                              <polyline points="1 20 1 14 7 14"></polyline>
                              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                            <span>Sync Products</span>
                          </>
                        )}
                      </button>
                      <p className="settings-field-hint" style={{ marginTop: '8px' }}>
                        Products are automatically synced every 5 minutes. Use this button to sync manually.
                      </p>
                    </div>
                  </div>

                  {/* System Controls */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <h3 className="settings-card-title">System Controls</h3>
                      <p className="settings-card-description">Manage system behavior and preferences</p>
                    </div>
                    <div className="settings-card-body">
                      <div className="settings-field">
                        <label className="settings-label">
                          <span className="settings-label-text">Sleep Mode</span>
                          <p className="settings-label-description">Put the system into sleep mode. Move mouse or press any key to wake.</p>
                        </label>
                        <button
                          className="settings-sleep-btn"
                          onClick={() => {
                            onClose();
                            setTimeout(() => {
                              enterSleepMode();
                            }, 100);
                          }}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                          </svg>
                          <span>Enter Sleep Mode</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
