import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
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

interface StockParityEntry {
  key: string;
  type: 'product' | 'variation';
  beforeStock: number;
  afterStock: number;
  delta: number;
  driftDetected: boolean;
  name?: string;
}

interface StockParityReport {
  generatedAt: string;
  syncedCount: number;
  checked: number;
  drifted: number;
  entries: StockParityEntry[];
}

type UpdateChannel = 'stable' | 'beta';

interface UpdateSettings {
  success: boolean;
  channel: UpdateChannel;
  feedUrl: string;
  currentVersion: string;
  isPackaged: boolean;
}

interface UpdateEventStatus {
  status: string;
  channel?: UpdateChannel;
  feedUrl?: string;
  currentVersion?: string;
  availableVersion?: string;
  progressPercent?: number | null;
  message?: string;
  checkedAt?: string;
}

interface StaffUser {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  roles?: string[];
  userRoles?: Array<{ role?: { name?: string } }>;
  hasPosPin?: boolean;
}

const Settings: React.FC<{ onClose: () => void; onUnauthorized?: () => void }> = ({ onClose, onUnauthorized }) => {
  const { logout, user } = useAuth();
  const { enterSleepMode } = useSleepMode();
  const [activeTab, setActiveTab] = useState<'printer' | 'system'>('printer');
  const [systemTab, setSystemTab] = useState<'catalog' | 'updates' | 'security' | 'controls'>('catalog');
  const [config, setConfig] = useState<PrinterConfig>({
    type: 'usb',
    autoOpenCashDrawer: true,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<CatalogSyncStatus | null>(null);
  const [parityReport, setParityReport] = useState<StockParityReport | null>(null);
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings | null>(null);
  const [selectedUpdateChannel, setSelectedUpdateChannel] = useState<UpdateChannel>('stable');
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateEventStatus | null>(null);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [loadingStaffUsers, setLoadingStaffUsers] = useState(false);
  const [selectedStaffUserId, setSelectedStaffUserId] = useState('');
  const [newPosPin, setNewPosPin] = useState('');
  const [savingPosPin, setSavingPosPin] = useState(false);
  const [posPinError, setPosPinError] = useState('');

  useEffect(() => {
    loadConfig();
    loadCatalogStatus();
    loadParityReport();
    loadUpdateSettings();
    loadStaffUsers();
    // Refresh catalog status every 30 seconds
    const statusInterval = setInterval(loadCatalogStatus, 30000);
    const parityInterval = setInterval(loadParityReport, 30000);

    const unsubscribeUpdateStatus = (window as any).electronAPI.onAppUpdateStatus((status: UpdateEventStatus) => {
      setUpdateStatus(status);
      if (status.channel) {
        setSelectedUpdateChannel(status.channel);
      }
      if (status.currentVersion || status.feedUrl || status.channel) {
        setUpdateSettings((prev) => {
          if (!prev) {
            return {
              success: true,
              channel: status.channel || 'stable',
              feedUrl: status.feedUrl || '',
              currentVersion: status.currentVersion || 'unknown',
              isPackaged: true,
            };
          }
          return {
            ...prev,
            channel: status.channel || prev.channel,
            feedUrl: status.feedUrl || prev.feedUrl,
            currentVersion: status.currentVersion || prev.currentVersion,
          };
        });
      }

      if (status.status === 'checking') {
        setCheckingUpdates(true);
      } else if (
        status.status === 'up-to-date' ||
        status.status === 'update-available' ||
        status.status === 'downloaded' ||
        status.status === 'error'
      ) {
        setCheckingUpdates(false);
      }
    });

    return () => {
      clearInterval(statusInterval);
      clearInterval(parityInterval);
      unsubscribeUpdateStatus();
    };
  }, []);

  const normalizeUserRoleNames = (entry: StaffUser): string[] => {
    const roleNames = new Set<string>();

    if (Array.isArray(entry.roles)) {
      for (const role of entry.roles) {
        const normalized = String(role || '').toLowerCase().trim();
        if (normalized) roleNames.add(normalized);
      }
    }

    if (Array.isArray(entry.userRoles)) {
      for (const userRole of entry.userRoles) {
        const normalized = String(userRole?.role?.name || '').toLowerCase().trim();
        if (normalized) roleNames.add(normalized);
      }
    }

    if (entry.role) {
      const normalized = String(entry.role).toLowerCase().trim();
      if (normalized) roleNames.add(normalized);
    }

    return Array.from(roleNames);
  };

  const displayUserRole = (entry: StaffUser): string => {
    const normalized = normalizeUserRoleNames(entry);
    if (!normalized.length) return 'staff';
    return normalized[0];
  };

  const currentUserRoles = Array.isArray((user as any)?.roles)
    ? (user as any).roles.map((role: string) => String(role || '').toLowerCase())
    : [];
  const canManagePosPins =
    currentUserRoles.includes('owner') ||
    currentUserRoles.includes('admin') ||
    currentUserRoles.includes('superadmin');

  const loadStaffUsers = async () => {
    setLoadingStaffUsers(true);
    try {
      const response = await (window as any).electronAPI?.getUsers?.();
      const users = Array.isArray(response?.users) ? response.users : [];
      const normalizedUsers = users
        .map((u: any) => ({
          id: String(u?.id || ''),
          name: typeof u?.name === 'string' ? u.name : '',
          email: typeof u?.email === 'string' ? u.email : '',
          role: typeof u?.role === 'string' ? u.role : undefined,
          roles: Array.isArray(u?.roles) ? u.roles : [],
          userRoles: Array.isArray(u?.userRoles) ? u.userRoles : [],
          hasPosPin: Boolean(u?.hasPosPin),
        }))
        .filter((u: StaffUser) => u.id)
        .sort((a: StaffUser, b: StaffUser) => {
          const left = (a.name || a.email || '').toLowerCase();
          const right = (b.name || b.email || '').toLowerCase();
          return left.localeCompare(right);
        });
      setStaffUsers(normalizedUsers);
    } catch {
      setStaffUsers([]);
    } finally {
      setLoadingStaffUsers(false);
    }
  };

  const handleSetPosPin = async () => {
    if (!selectedStaffUserId) {
      setPosPinError('Select a staff user first.');
      return;
    }

    const trimmed = newPosPin.trim();
    if (!/^\d{4,8}$/.test(trimmed)) {
      setPosPinError('PIN must be 4 to 8 digits.');
      return;
    }

    setSavingPosPin(true);
    setPosPinError('');
    setMessage(null);

    try {
      const result = await (window as any).electronAPI?.setUserPosPin?.(
        selectedStaffUserId,
        trimmed,
      );

      if (!result?.success) {
        setPosPinError(result?.error || 'Failed to set POS PIN.');
        return;
      }

      setMessage({ type: 'success', text: 'POS PIN updated successfully.' });
      setNewPosPin('');
      await loadStaffUsers();
      setTimeout(() => setMessage(null), 3000);
    } catch (error: any) {
      setPosPinError(error?.message || 'Failed to set POS PIN.');
    } finally {
      setSavingPosPin(false);
    }
  };

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
        vatAmount: 0,
        total: 10.00,
        paymentMethod: 'cash',
        amountReceived: 20.00,
        change: 10.00,
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

  const loadParityReport = async () => {
    try {
      const response = await (window as any).electronAPI.getLastStockParityReport() as {
        success: boolean;
        hasReport: boolean;
        report?: StockParityReport;
      };
      if (response?.success && response.hasReport && response.report) {
        setParityReport(response.report);
      } else {
        setParityReport(null);
      }
    } catch (error) {
      console.error('Failed to load stock parity report:', error);
    }
  };

  const loadUpdateSettings = async () => {
    try {
      const settings = await (window as any).electronAPI.getUpdateSettings() as UpdateSettings;
      if (settings?.success) {
        setUpdateSettings(settings);
        setSelectedUpdateChannel(settings.channel);
      }
    } catch (error) {
      console.error('Failed to load update settings:', error);
    }
  };

  const handleChangeUpdateChannel = async (channel: UpdateChannel) => {
    setSelectedUpdateChannel(channel);
    try {
      const response = await (window as any).electronAPI.setUpdateChannel(channel);
      if (response?.success) {
        setUpdateSettings((prev: UpdateSettings | null) => {
          if (!prev) {
            return {
              success: true,
              channel: response.channel,
              feedUrl: response.feedUrl,
              currentVersion: response.currentVersion,
              isPackaged: true,
            };
          }
          return {
            ...prev,
            channel: response.channel,
            feedUrl: response.feedUrl,
            currentVersion: response.currentVersion,
          };
        });
        setUpdateStatus({
          status: 'channel-updated',
          channel: response.channel,
          feedUrl: response.feedUrl,
          currentVersion: response.currentVersion,
          checkedAt: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to set update channel' });
      setTimeout(() => setMessage(null), 5000);
      setSelectedUpdateChannel(updateSettings?.channel || 'stable');
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const response = await (window as any).electronAPI.checkForAppUpdates();
      if (!response?.success) {
        setCheckingUpdates(false);
        setMessage({ type: 'error', text: response?.error || 'Failed to check for updates' });
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (error: any) {
      setCheckingUpdates(false);
      setMessage({ type: 'error', text: error.message || 'Failed to check for updates' });
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    try {
      await (window as any).electronAPI.installUpdate();
    } catch (error: any) {
      setInstallingUpdate(false);
      setMessage({ type: 'error', text: error.message || 'Failed to install update' });
      setTimeout(() => setMessage(null), 5000);
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
        await loadParityReport();
      } else {
        const isUnauthorized = response.unauthorized ||
          (response.error && (response.error.includes('Unauthorized') || response.error.includes('log in again')));
        setMessage({
          type: 'error',
          text: isUnauthorized
            ? 'Session expired. Please log in again to sync the catalog.'
            : (response.error || 'Failed to sync products'),
        });
        if (isUnauthorized && onUnauthorized) {
          setTimeout(() => {
            onUnauthorized();
          }, 1200);
        }
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
      if (isUnauthorized && onUnauthorized) {
        setTimeout(() => {
          onUnauthorized();
        }, 1200);
      }
      setTimeout(() => setMessage(null), 8000);
    } finally {
      setSyncing(false);
    }
  };

  const isPackagedBuild = !!updateSettings?.isPackaged;
  const showCatalogTab = activeTab === 'system' && systemTab === 'catalog';
  const showUpdatesTab = activeTab === 'system' && systemTab === 'updates';
  const showSecurityTab = activeTab === 'system' && systemTab === 'security';
  const showControlsTab = activeTab === 'system' && systemTab === 'controls';

  return (
    <div className="settings-page">
      <div className="settings-modal settings-page-modal">
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
                  <div className="settings-subtabs-nav">
                    <button
                      className={`settings-subtab ${systemTab === 'catalog' ? 'active' : ''}`}
                      onClick={() => setSystemTab('catalog')}
                    >
                      Catalog
                    </button>
                    <button
                      className={`settings-subtab ${systemTab === 'updates' ? 'active' : ''}`}
                      onClick={() => setSystemTab('updates')}
                    >
                      Updates
                    </button>
                    <button
                      className={`settings-subtab ${systemTab === 'security' ? 'active' : ''}`}
                      onClick={() => setSystemTab('security')}
                    >
                      POS Security
                    </button>
                    <button
                      className={`settings-subtab ${systemTab === 'controls' ? 'active' : ''}`}
                      onClick={() => setSystemTab('controls')}
                    >
                      Controls
                    </button>
                  </div>

                  {/* Product Catalog Sync */}
                  {showCatalogTab && (
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
                  )}

                  {/* Offline Stock Drift Debug */}
                  {showCatalogTab && (
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <h3 className="settings-card-title">Offline Stock Drift Debug</h3>
                      <p className="settings-card-description">Latest parity report after offline sales synchronization</p>
                    </div>
                    <div className="settings-card-body">
                      {!parityReport ? (
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>
                          No parity report yet. Complete an offline sales sync to generate one.
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px', marginBottom: '12px' }}>
                            <div style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}>
                              <div style={{ color: '#6b7280' }}>Synced</div>
                              <div style={{ fontWeight: 700 }}>{parityReport.syncedCount}</div>
                            </div>
                            <div style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}>
                              <div style={{ color: '#6b7280' }}>Checked</div>
                              <div style={{ fontWeight: 700 }}>{parityReport.checked}</div>
                            </div>
                            <div style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}>
                              <div style={{ color: '#6b7280' }}>Drifted</div>
                              <div style={{ fontWeight: 700, color: parityReport.drifted > 0 ? '#b45309' : '#047857' }}>{parityReport.drifted}</div>
                            </div>
                            <div style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}>
                              <div style={{ color: '#6b7280' }}>Generated</div>
                              <div style={{ fontWeight: 700 }}>{new Date(parityReport.generatedAt).toLocaleTimeString()}</div>
                            </div>
                          </div>

                          <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                            {(parityReport.entries || []).slice(0, 20).map((entry) => (
                              <div
                                key={entry.key}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1.5fr 0.8fr 0.7fr 0.7fr 0.6fr',
                                  gap: '8px',
                                  padding: '6px 8px',
                                  borderBottom: '1px solid #f3f4f6',
                                  fontSize: '12px',
                                  lineHeight: 1.3,
                                  backgroundColor: entry.driftDetected ? '#fffbeb' : '#ffffff',
                                }}
                              >
                                <span title={entry.key} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {entry.name || entry.key}
                                </span>
                                <span>{entry.type}</span>
                                <span>{entry.beforeStock}</span>
                                <span>{entry.afterStock}</span>
                                <span style={{ color: entry.delta === 0 ? '#111827' : entry.delta > 0 ? '#047857' : '#b45309', fontWeight: 600 }}>
                                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="settings-field-hint" style={{ marginTop: '8px' }}>
                            Showing up to 20 latest entries from last parity run.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  )}

                  {/* App Updates */}
                  {showUpdatesTab && (
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <h3 className="settings-card-title">App Updates</h3>
                      <p className="settings-card-description">Control remote update channel and check for new POS releases</p>
                    </div>
                    <div className="settings-card-body">
                      <div className="settings-field">
                        <label className="settings-label">
                          <span className="settings-label-text">Update Channel</span>
                          <select
                            value={selectedUpdateChannel}
                            onChange={(e) => handleChangeUpdateChannel(e.target.value as UpdateChannel)}
                            className="settings-select"
                          >
                            <option value="stable">Stable (recommended for clients)</option>
                            <option value="beta">Beta (pilot clients only)</option>
                          </select>
                        </label>
                        <p className="settings-field-hint" style={{ marginTop: '8px' }}>
                          Stable is safest for all shops. Beta is for staged rollouts and early testing.
                        </p>
                      </div>

                      <div className="settings-field" style={{ marginTop: '16px' }}>
                        <div style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.6' }}>
                          <div>
                            <strong>Current Version:</strong> {updateSettings?.currentVersion || 'Unknown'}
                          </div>
                          <div>
                            <strong>Feed URL:</strong> {updateSettings?.feedUrl || 'Not configured'}
                          </div>
                          <div>
                            <strong>Runtime:</strong> {updateSettings?.isPackaged ? 'Installed app' : 'Development mode'}
                          </div>
                        </div>
                      </div>

                      {updateStatus && (
                        <div className="settings-field" style={{ marginTop: '16px' }}>
                          <div style={{ fontSize: '14px', color: '#374151', lineHeight: '1.6' }}>
                            <div>
                              <strong>Status:</strong> {updateStatus.status}
                            </div>
                            {updateStatus.availableVersion && (
                              <div>
                                <strong>Available Version:</strong> {updateStatus.availableVersion}
                              </div>
                            )}
                            {typeof updateStatus.progressPercent === 'number' && (
                              <div>
                                <strong>Download Progress:</strong> {updateStatus.progressPercent}%
                              </div>
                            )}
                            {updateStatus.message && (
                              <div>
                                <strong>Details:</strong> {updateStatus.message}
                              </div>
                            )}
                            {updateStatus.checkedAt && (
                              <div>
                                <strong>Last Check:</strong> {new Date(updateStatus.checkedAt).toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="settings-actions-grid" style={{ marginTop: '16px' }}>
                        {!isPackagedBuild && (
                          <p className="settings-field-hint" style={{ marginTop: '0', marginBottom: '8px', gridColumn: '1 / -1' }}>
                            Update checks are disabled in development mode. Install and run the packaged EXE to test real updates.
                          </p>
                        )}

                        <button
                          onClick={handleCheckForUpdates}
                          disabled={checkingUpdates || !isPackagedBuild}
                          className="settings-action-btn settings-action-btn-primary"
                        >
                          {checkingUpdates ? (
                            <>
                              <div className="settings-btn-spinner"></div>
                              <span>Checking...</span>
                            </>
                          ) : (
                            <>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <polyline points="1 20 1 14 7 14"></polyline>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                              </svg>
                              <span>Check for Updates</span>
                            </>
                          )}
                        </button>

                        <button
                          onClick={handleInstallUpdate}
                          disabled={installingUpdate || updateStatus?.status !== 'downloaded' || !isPackagedBuild}
                          className="settings-action-btn settings-action-btn-secondary"
                        >
                          {installingUpdate ? (
                            <>
                              <div className="settings-btn-spinner"></div>
                              <span>Installing...</span>
                            </>
                          ) : (
                            <>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                              </svg>
                              <span>Install Downloaded Update</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  )}

                  {/* System Controls */}
                  {showSecurityTab && (
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <h3 className="settings-card-title">POS PIN Management</h3>
                      <p className="settings-card-description">Set or reset staff POS PINs used for approvals and secure actions</p>
                    </div>
                    <div className="settings-card-body">
                      {!canManagePosPins ? (
                        <div style={{ fontSize: '13px', color: '#b45309' }}>
                          You need owner/admin permissions to set POS PINs.
                        </div>
                      ) : (
                        <>
                          <div className="settings-field">
                            <label className="settings-label">
                              <span className="settings-label-text">Staff User</span>
                              <select
                                className="settings-select"
                                value={selectedStaffUserId}
                                onChange={(e) => {
                                  setSelectedStaffUserId(e.target.value);
                                  if (posPinError) setPosPinError('');
                                }}
                                disabled={loadingStaffUsers}
                              >
                                <option value="">Select user</option>
                                {staffUsers.map((member) => (
                                  <option key={member.id} value={member.id}>
                                    {(member.name || member.email || member.id)} ({displayUserRole(member)})
                                    {member.hasPosPin ? ' - PIN Set' : ' - PIN Not Set'}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div className="settings-field" style={{ marginBottom: '12px' }}>
                            <label className="settings-label">
                              <span className="settings-label-text">New PIN</span>
                              <input
                                type="password"
                                inputMode="numeric"
                                maxLength={8}
                                className="settings-input"
                                value={newPosPin}
                                onChange={(e) => {
                                  setNewPosPin(e.target.value.replace(/\D/g, ''));
                                  if (posPinError) setPosPinError('');
                                }}
                                placeholder="Enter 4-8 digits"
                              />
                            </label>
                            <p className="settings-field-hint">Only digits are allowed. This will overwrite any existing PIN for that user.</p>
                          </div>

                          {posPinError && (
                            <div style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              border: '1px solid #fecaca',
                              background: '#fef2f2',
                              color: '#991b1b',
                              fontSize: '13px',
                              marginBottom: '12px',
                            }}>
                              {posPinError}
                            </div>
                          )}

                          <div className="settings-actions-grid">
                            <button
                              onClick={handleSetPosPin}
                              disabled={savingPosPin || loadingStaffUsers}
                              className="settings-action-btn settings-action-btn-primary"
                            >
                              {savingPosPin ? (
                                <>
                                  <div className="settings-btn-spinner"></div>
                                  <span>Saving PIN...</span>
                                </>
                              ) : (
                                <>
                                  <span>Set / Reset POS PIN</span>
                                </>
                              )}
                            </button>

                            <button
                              onClick={loadStaffUsers}
                              disabled={loadingStaffUsers}
                              className="settings-action-btn settings-action-btn-secondary"
                            >
                              <span>{loadingStaffUsers ? 'Refreshing...' : 'Refresh Staff List'}</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  )}

                  {/* System Controls */}
                  {showControlsTab && (
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
                      <div className="settings-field">
                        <label className="settings-label">
                          <span className="settings-label-text">Logout</span>
                          <p className="settings-label-description">Sign out of your account and return to the login screen.</p>
                        </label>
                        <button
                          className="settings-logout-btn"
                          onClick={async () => {
                            await logout();
                            onClose();
                          }}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 16l4-4m0 0l-4-4m4 4H7"></path>
                            <path d="M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z"></path>
                          </svg>
                          <span>Logout</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  )}
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
