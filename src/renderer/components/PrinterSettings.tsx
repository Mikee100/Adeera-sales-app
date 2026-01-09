import React, { useState, useEffect } from 'react';
import '../printer-settings.css';

interface PrinterConfig {
  type: 'usb' | 'network' | 'file';
  vendorId?: number;
  productId?: number;
  path?: string;
  ip?: string;
  port?: number;
  autoOpenCashDrawer: boolean;
}

const PrinterSettings: React.FC = () => {
  const [config, setConfig] = useState<PrinterConfig>({
    type: 'usb',
    autoOpenCashDrawer: true,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfig();
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
        setMessage({ type: 'success', text: 'Printer settings saved successfully!' });
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to save settings' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to save settings' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
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
        setMessage({ type: 'success', text: 'Test print sent successfully!' });
      } else {
        setMessage({ type: 'error', text: response.error || 'Test print failed' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Test print failed' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleTestCashDrawer = async () => {
    setSaving(true);
    try {
      const response = await (window as any).electronAPI.openCashDrawer();
      if (response.success) {
        setMessage({ type: 'success', text: 'Cash drawer opened!' });
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to open cash drawer' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to open cash drawer' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) {
    return <div className="printer-settings-loading">Loading printer settings...</div>;
  }

  return (
    <div className="printer-settings">
      <h2>🖨️ Printer Settings</h2>

      {message && (
        <div className={`settings-message ${message.type}`}>
          {message.type === 'success' ? '✅' : '❌'} {message.text}
        </div>
      )}

      <div className="settings-section">
        <label className="setting-label">
          <span>Printer Type:</span>
          <select
            value={config.type}
            onChange={(e) => setConfig({ ...config, type: e.target.value as 'usb' | 'network' | 'file' })}
            className="setting-input"
          >
            <option value="usb">USB Printer</option>
            <option value="network">Network Printer</option>
            <option value="file">Save to File</option>
          </select>
        </label>
      </div>

      {config.type === 'usb' && (
        <div className="settings-section">
          <label className="setting-label">
            <span>Device Path:</span>
            <input
              type="text"
              value={config.path || ''}
              onChange={(e) => setConfig({ ...config, path: e.target.value })}
              placeholder="COM1 (Windows) or /dev/usb/lp0 (Linux)"
              className="setting-input"
            />
          </label>
          <small className="setting-hint">
            Windows: COM1, COM2, etc. | Linux: /dev/usb/lp0, /dev/usb/lp1, etc. | macOS: Leave empty for auto-detect
          </small>
        </div>
      )}

      {config.type === 'network' && (
        <>
          <div className="settings-section">
            <label className="setting-label">
              <span>Printer IP Address:</span>
              <input
                type="text"
                value={config.ip || ''}
                onChange={(e) => setConfig({ ...config, ip: e.target.value })}
                placeholder="192.168.1.100"
                className="setting-input"
              />
            </label>
          </div>
          <div className="settings-section">
            <label className="setting-label">
              <span>Port:</span>
              <input
                type="number"
                value={config.port || 9100}
                onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || 9100 })}
                placeholder="9100"
                className="setting-input"
              />
            </label>
          </div>
        </>
      )}

      <div className="settings-section">
        <label className="setting-label checkbox-label">
          <input
            type="checkbox"
            checked={config.autoOpenCashDrawer}
            onChange={(e) => setConfig({ ...config, autoOpenCashDrawer: e.target.checked })}
            className="setting-checkbox"
          />
          <span>Auto-open cash drawer on cash payments</span>
        </label>
      </div>

      <div className="settings-actions">
        <button onClick={handleTestPrint} disabled={saving} className="test-btn">
          🖨️ Test Print
        </button>
        <button onClick={handleTestCashDrawer} disabled={saving} className="test-btn">
          💰 Test Cash Drawer
        </button>
        <button onClick={handleSave} disabled={saving} className="save-btn">
          {saving ? 'Saving...' : '💾 Save Settings'}
        </button>
      </div>

      <div className="settings-info">
        <h3>📋 Notes:</h3>
        <ul>
          <li><strong>USB Printers:</strong> Make sure your printer is connected and drivers are installed.</li>
          <li><strong>Network Printers:</strong> Ensure the printer is on the same network and port 9100 is open.</li>
          <li><strong>File Mode:</strong> Receipts will be saved to Desktop/POS_Receipts folder.</li>
          <li><strong>Cash Drawer:</strong> Must be connected to the printer via RJ-11 or USB cable.</li>
        </ul>
      </div>
    </div>
  );
};

export default PrinterSettings;

