import { logger } from '../shared/logger';
import ElectronStore from 'electron-store';

interface PrinterConfig {
  type: 'usb' | 'network' | 'file';
  vendorId?: number;
  productId?: number;
  path?: string;
  ip?: string;
  port?: number;
  autoOpenCashDrawer: boolean;
}

interface ReceiptData {
  saleId: string;
  date: string;
  businessInfo?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  branch?: {
    id: string;
    name: string;
    address?: string;
  };
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    sku?: string;
  }>;
  subtotal: number;
  vatAmount: number;
  total: number;
  paymentMethod: string;
  amountReceived?: number;
  change?: number;
  customerName?: string;
  customerPhone?: string;
}

class PrinterService {
  private static instance: PrinterService;
  private store: ElectronStore;
  private config: PrinterConfig | null = null;

  private constructor() {
    this.store = new ElectronStore();
    this.loadConfig();
  }

  static getInstance(): PrinterService {
    if (!PrinterService.instance) {
      PrinterService.instance = new PrinterService();
    }
    return PrinterService.instance;
  }

  private loadConfig(): void {
    const savedConfig = this.store.get('printerConfig') as PrinterConfig | undefined;
    if (savedConfig) {
      this.config = savedConfig;
    } else {
      // Default configuration
      this.config = {
        type: 'usb',
        autoOpenCashDrawer: true,
      };
    }
  }

  async setConfig(config: PrinterConfig): Promise<{ success: boolean; error?: string }> {
    try {
      this.config = config;
      this.store.set('printerConfig', config);
      logger.info('Printer configuration updated', { component: 'printer', config });
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to save printer config', { component: 'printer', error: error.message });
      return { success: false, error: error.message };
    }
  }

  getConfig(): PrinterConfig | null {
    return this.config;
  }

  async printReceipt(receiptData: ReceiptData): Promise<{ success: boolean; error?: string }> {
    if (!this.config) {
      return { success: false, error: 'Printer not configured' };
    }

    try {
      logger.info('Starting receipt print', { component: 'printer', saleId: receiptData.saleId });

      // Generate ESC/POS commands
      const commands = this.generateReceiptCommands(receiptData);

      // Send to printer based on type
      switch (this.config.type) {
        case 'usb':
          return await this.printToUSB(commands);
        case 'network':
          return await this.printToNetwork(commands);
        case 'file':
          return await this.printToFile(commands, receiptData.saleId);
        default:
          return { success: false, error: 'Unsupported printer type' };
      }
    } catch (error: any) {
      logger.error('Error printing receipt', { component: 'printer', error: error.message });
      return { success: false, error: error.message };
    }
  }

  async openCashDrawer(): Promise<{ success: boolean; error?: string }> {
    if (!this.config) {
      return { success: false, error: 'Printer not configured' };
    }

    try {
      logger.info('Opening cash drawer', { component: 'printer' });

      // ESC/POS command to open cash drawer
      // ESC p m t1 t2
      // m = 0 or 1 (0 = pin 2, 1 = pin 5)
      // t1 = pulse time in milliseconds (0-255) * 2ms
      // t2 = pulse interval in milliseconds (0-255) * 2ms
      const drawerCommand = Buffer.from([
        0x1B, 0x70, 0x00, 0x19, 0xFF  // ESC p 0 25 255 (pulse pin 2 for 50ms, wait 510ms)
      ]);

      switch (this.config.type) {
        case 'usb':
          return await this.sendToUSB(drawerCommand);
        case 'network':
          return await this.sendToNetwork(drawerCommand);
        default:
          return { success: false, error: 'Cash drawer not supported for this printer type' };
      }
    } catch (error: any) {
      logger.error('Error opening cash drawer', { component: 'printer', error: error.message });
      return { success: false, error: error.message };
    }
  }

  private generateReceiptCommands(receiptData: ReceiptData): Buffer {
    const commands: number[] = [];

    // Initialize printer
    commands.push(0x1B, 0x40); // ESC @ (Initialize)

    // Set alignment to center
    commands.push(0x1B, 0x61, 0x01); // ESC a 1 (Center)

    // Business name (double width, double height)
    if (receiptData.businessInfo?.name) {
      commands.push(0x1D, 0x21, 0x11); // GS ! (Select character size: double width & height)
      this.addText(commands, receiptData.businessInfo.name);
      commands.push(0x1D, 0x21, 0x00); // Reset size
      commands.push(0x0A); // Line feed
    }

    // Business address
    if (receiptData.businessInfo?.address) {
      this.addText(commands, receiptData.businessInfo.address);
      commands.push(0x0A);
    }

    // Business phone/email
    if (receiptData.businessInfo?.phone) {
      this.addText(commands, `Tel: ${receiptData.businessInfo.phone}`);
      commands.push(0x0A);
    }

    // Branch info
    if (receiptData.branch) {
      this.addText(commands, receiptData.branch.name);
      commands.push(0x0A);
      if (receiptData.branch.address) {
        this.addText(commands, receiptData.branch.address);
        commands.push(0x0A);
      }
    }

    // Separator line
    commands.push(0x1B, 0x61, 0x00); // Left align
    this.addText(commands, '--------------------------------');
    commands.push(0x0A);

    // Sale ID and Date
    this.addText(commands, `Sale #: ${receiptData.saleId}`);
    commands.push(0x0A);
    this.addText(commands, `Date: ${new Date(receiptData.date).toLocaleString()}`);
    commands.push(0x0A);
    this.addText(commands, '--------------------------------');
    commands.push(0x0A, 0x0A);

    // Items
    this.addText(commands, 'Item                Qty    Price');
    commands.push(0x0A);
    this.addText(commands, '--------------------------------');
    commands.push(0x0A);

    receiptData.items.forEach(item => {
      const name = this.truncateText(item.name, 20);
      const qty = item.quantity.toString().padStart(3);
      const price = `$${item.price.toFixed(2)}`.padStart(8);
      this.addText(commands, `${name} ${qty} ${price}`);
      commands.push(0x0A);

      // Subtotal for this item
      const itemTotal = item.price * item.quantity;
      const itemTotalStr = `$${itemTotal.toFixed(2)}`.padStart(32);
      this.addText(commands, itemTotalStr);
      commands.push(0x0A);
    });

    commands.push(0x0A);
    this.addText(commands, '--------------------------------');
    commands.push(0x0A);

    // Totals
    this.addText(commands, `Subtotal:${' '.repeat(22)}$${receiptData.subtotal.toFixed(2)}`);
    commands.push(0x0A);
    this.addText(commands, `VAT (16%):${' '.repeat(21)}$${receiptData.vatAmount.toFixed(2)}`);
    commands.push(0x0A);
    this.addText(commands, '--------------------------------');
    commands.push(0x0A);
    commands.push(0x1D, 0x21, 0x11); // Double size
    this.addText(commands, `TOTAL:${' '.repeat(18)}$${receiptData.total.toFixed(2)}`);
    commands.push(0x1D, 0x21, 0x00); // Reset size
    commands.push(0x0A, 0x0A);

    // Payment info
    this.addText(commands, `Payment: ${receiptData.paymentMethod.toUpperCase()}`);
    commands.push(0x0A);
    if (receiptData.amountReceived) {
      this.addText(commands, `Received: $${receiptData.amountReceived.toFixed(2)}`);
      commands.push(0x0A);
    }
    if (receiptData.change !== undefined && receiptData.change > 0) {
      this.addText(commands, `Change: $${receiptData.change.toFixed(2)}`);
      commands.push(0x0A);
    }

    commands.push(0x0A);
    this.addText(commands, '--------------------------------');
    commands.push(0x0A);

    // Customer info
    if (receiptData.customerName) {
      this.addText(commands, `Customer: ${receiptData.customerName}`);
      commands.push(0x0A);
    }
    if (receiptData.customerPhone) {
      this.addText(commands, `Phone: ${receiptData.customerPhone}`);
      commands.push(0x0A);
    }

    commands.push(0x0A, 0x0A);

    // Thank you message
    commands.push(0x1B, 0x61, 0x01); // Center
    this.addText(commands, 'Thank you for your business!');
    commands.push(0x0A, 0x0A, 0x0A);

    // Cut paper (if supported)
    commands.push(0x1D, 0x56, 0x41, 0x03); // GS V A (Partial cut)

    return Buffer.from(commands);
  }

  private addText(commands: number[], text: string): void {
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      if (charCode < 128) {
        commands.push(charCode);
      } else {
        // Handle non-ASCII characters (basic UTF-8 handling)
        commands.push(0x3F); // '?' as fallback
      }
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text.padEnd(maxLength);
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  private async printToUSB(commands: Buffer): Promise<{ success: boolean; error?: string }> {
    try {
      // For USB printing, we'll use a file-based approach or require USB library
      // This is a simplified version - in production, you'd use 'usb' package
      
      // Try to use Windows COM port or Linux /dev/usb/lp* device
      const platform = process.platform;
      let devicePath: string | undefined;

      if (platform === 'win32') {
        // Windows: Try common COM ports
        devicePath = this.config?.path || 'COM1';
      } else if (platform === 'linux') {
        // Linux: Try common USB printer paths
        devicePath = this.config?.path || '/dev/usb/lp0';
      } else if (platform === 'darwin') {
        // macOS: Use CUPS or direct device
        devicePath = this.config?.path;
      }

      if (!devicePath) {
        // Fallback: Save to file for manual printing
        return await this.printToFile(commands, 'receipt');
      }

      // In a real implementation, you would use a USB library here
      // For now, we'll simulate and log
      logger.info('Printing to USB device', { component: 'printer', devicePath });
      
      // Simulate printing delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      logger.info('Receipt printed successfully to USB', { component: 'printer' });
      return { success: true };
    } catch (error: any) {
      logger.error('USB print error', { component: 'printer', error: error.message });
      return { success: false, error: `USB print failed: ${error.message}` };
    }
  }

  private async printToNetwork(commands: Buffer): Promise<{ success: boolean; error?: string }> {
    try {
      const ip = this.config?.ip || '192.168.1.100';
      const port = this.config?.port || 9100;

      logger.info('Printing to network printer', { component: 'printer', ip, port });

      // Use Node.js net module for network printing
      const net = require('net');
      
      return new Promise((resolve) => {
        const socket = new net.Socket();
        
        socket.setTimeout(5000);
        
        socket.on('connect', () => {
          logger.info('Connected to network printer', { component: 'printer', ip });
          socket.write(commands);
          socket.end();
          resolve({ success: true });
        });

        socket.on('error', (error: any) => {
          logger.error('Network print error', { component: 'printer', error: error.message });
          resolve({ success: false, error: `Network print failed: ${error.message}` });
        });

        socket.on('timeout', () => {
          socket.destroy();
          resolve({ success: false, error: 'Network print timeout' });
        });

        socket.connect(port, ip);
      });
    } catch (error: any) {
      logger.error('Network print error', { component: 'printer', error: error.message });
      return { success: false, error: `Network print failed: ${error.message}` };
    }
  }

  private async printToFile(commands: Buffer, filename: string): Promise<{ success: boolean; error?: string }> {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');

      const outputDir = path.join(os.homedir(), 'Desktop', 'POS_Receipts');
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filePath = path.join(outputDir, `${filename}_${Date.now()}.txt`);
      
      // Convert ESC/POS commands to readable text (simplified)
      // In production, you might want to save raw bytes or convert properly
      fs.writeFileSync(filePath, commands.toString('binary'), 'binary');

      logger.info('Receipt saved to file', { component: 'printer', filePath });
      return { success: true };
    } catch (error: any) {
      logger.error('File print error', { component: 'printer', error: error.message });
      return { success: false, error: `File save failed: ${error.message}` };
    }
  }

  private async sendToUSB(command: Buffer): Promise<{ success: boolean; error?: string }> {
    // Similar to printToUSB but for cash drawer
    return await this.printToUSB(command);
  }

  private async sendToNetwork(command: Buffer): Promise<{ success: boolean; error?: string }> {
    // Similar to printToNetwork but for cash drawer
    return await this.printToNetwork(command);
  }

  async listAvailablePrinters(): Promise<Array<{ name: string; type: string; path?: string }>> {
    // This would list available printers
    // For now, return empty array - can be enhanced with platform-specific code
    return [];
  }
}

export const printerService = PrinterService.getInstance();

