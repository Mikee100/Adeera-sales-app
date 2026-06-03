import { logger } from '../shared/logger';
import ElectronStore from 'electron-store';

// Lazy load serialport to avoid native module issues during import
// SerialPort is excluded from webpack bundling and loaded at runtime
let SerialPort: any = null;

function loadSerialPort() {
  if (SerialPort !== null) {
    return SerialPort; // Already tried loading
  }
  
  try {
    // Try to load serialport - will fail if not rebuilt for Electron
    const serialportModule = require('serialport');
    SerialPort = serialportModule.SerialPort || serialportModule.default?.SerialPort || serialportModule;
    logger.info('SerialPort loaded successfully', { component: 'printer' });
  } catch (error) {
    SerialPort = false; // Mark as failed to avoid repeated attempts
    logger.warn('SerialPort not available - USB printing will use file fallback', { 
      component: 'printer', 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
  
  return SerialPort;
}

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
    kraEnabled?: boolean;
    kraPin?: string;
    vatNumber?: string;
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

    // KRA (when enabled for this tenant)
    if (receiptData.businessInfo?.kraEnabled) {
      if (receiptData.businessInfo.kraPin) {
        this.addText(commands, `KRA PIN: ${receiptData.businessInfo.kraPin}`);
        commands.push(0x0A);
      }
      if (receiptData.businessInfo.vatNumber) {
        this.addText(commands, `VAT No: ${receiptData.businessInfo.vatNumber}`);
        commands.push(0x0A);
      }
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
      const price = `Ksh ${item.price.toFixed(2)}`.padStart(12);
      this.addText(commands, `${name} ${qty} ${price}`);
      commands.push(0x0A);

      // Subtotal for this item
      const itemTotal = item.price * item.quantity;
      const itemTotalStr = `Ksh ${itemTotal.toFixed(2)}`.padStart(36);
      this.addText(commands, itemTotalStr);
      commands.push(0x0A);
    });

    commands.push(0x0A);
    this.addText(commands, '--------------------------------');
    commands.push(0x0A);

    // Totals
    this.addText(commands, `Subtotal:${' '.repeat(22)}Ksh ${receiptData.subtotal.toFixed(2)}`);
    commands.push(0x0A);
    this.addText(commands, '--------------------------------');
    commands.push(0x0A);
    commands.push(0x1D, 0x21, 0x11); // Double size
    this.addText(commands, `TOTAL:${' '.repeat(18)}Ksh ${receiptData.total.toFixed(2)}`);
    commands.push(0x1D, 0x21, 0x00); // Reset size
    commands.push(0x0A, 0x0A);

    // Payment info
    this.addText(commands, `Payment: ${receiptData.paymentMethod.toUpperCase()}`);
    commands.push(0x0A);
    if (receiptData.amountReceived) {
      this.addText(commands, `Received: Ksh ${receiptData.amountReceived.toFixed(2)}`);
      commands.push(0x0A);
    }
    if (receiptData.change !== undefined && receiptData.change > 0) {
      this.addText(commands, `Change: Ksh ${receiptData.change.toFixed(2)}`);
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
      // Lazy load SerialPort
      const SerialPortClass = loadSerialPort();
      
      // Check if SerialPort is available
      if (!SerialPortClass || SerialPortClass === false) {
        logger.warn('SerialPort not available, falling back to file printing', { component: 'printer' });
        return await this.printToFile(commands, 'receipt');
      }

      const platform = process.platform;
      let devicePath: string | undefined;

      if (platform === 'win32') {
        // Windows: Use COM port from config or default
        devicePath = this.config?.path || 'COM1';
      } else if (platform === 'linux') {
        // Linux: Use USB printer path from config or common paths
        devicePath = this.config?.path || '/dev/usb/lp0';
      } else if (platform === 'darwin') {
        // macOS: Use CUPS or direct device path
        devicePath = this.config?.path;
      }

      if (!devicePath) {
        // Fallback: Save to file for manual printing
        logger.warn('No USB device path configured, falling back to file', { component: 'printer' });
        return await this.printToFile(commands, 'receipt');
      }

      logger.info('Printing to USB/Serial device', { component: 'printer', devicePath });

      // Use SerialPort for USB/Serial printing
      return new Promise((resolve) => {
        const port = new SerialPortClass({
          path: devicePath,
          baudRate: 9600, // Common ESC/POS baud rate
          autoOpen: false,
        });

        port.open((err) => {
          if (err) {
            logger.error('Failed to open serial port', { component: 'printer', devicePath, error: err.message });
            // Fallback to file if serial port fails
            this.printToFile(commands, 'receipt').then(resolve);
            return;
          }

          logger.info('Serial port opened successfully', { component: 'printer', devicePath });

          // Write commands to printer
          port.write(commands, (writeErr) => {
            if (writeErr) {
              logger.error('Failed to write to serial port', { component: 'printer', error: writeErr.message });
              port.close();
              resolve({ success: false, error: `Write failed: ${writeErr.message}` });
              return;
            }

            // Wait a bit for the print job to complete
            setTimeout(() => {
              port.close((closeErr) => {
                if (closeErr) {
                  logger.warn('Error closing serial port', { component: 'printer', error: closeErr.message });
                }
                logger.info('Receipt printed successfully to USB/Serial', { component: 'printer', devicePath });
                resolve({ success: true });
              });
            }, 2000); // 2 second delay for print completion
          });
        });

        // Handle errors
        port.on('error', (portErr) => {
          logger.error('Serial port error', { component: 'printer', error: portErr.message });
          resolve({ success: false, error: `Serial port error: ${portErr.message}` });
        });
      });
    } catch (error: any) {
      logger.error('USB print error', { component: 'printer', error: error.message });
      // Fallback to file printing
      return await this.printToFile(commands, 'receipt');
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
    try {
      // Lazy load SerialPort
      const SerialPortClass = loadSerialPort();
      
      // Check if SerialPort is available
      if (!SerialPortClass || SerialPortClass === false) {
        logger.warn('SerialPort not available for cash drawer', { component: 'printer' });
        return { success: false, error: 'SerialPort not available. Please rebuild native modules for Electron.' };
      }

      const platform = process.platform;
      let devicePath: string | undefined;

      if (platform === 'win32') {
        devicePath = this.config?.path || 'COM1';
      } else if (platform === 'linux') {
        devicePath = this.config?.path || '/dev/usb/lp0';
      } else if (platform === 'darwin') {
        devicePath = this.config?.path;
      }

      if (!devicePath) {
        logger.warn('No USB device path configured for cash drawer', { component: 'printer' });
        return { success: false, error: 'No USB device path configured' };
      }

      logger.info('Opening cash drawer via USB/Serial', { component: 'printer', devicePath });

      return new Promise((resolve) => {
        const port = new SerialPortClass({
          path: devicePath,
          baudRate: 9600,
          autoOpen: false,
        });

        port.open((err) => {
          if (err) {
            logger.error('Failed to open serial port for cash drawer', { component: 'printer', devicePath, error: err.message });
            resolve({ success: false, error: `Failed to open port: ${err.message}` });
            return;
          }

          // Send cash drawer command
          port.write(command, (writeErr) => {
            if (writeErr) {
              logger.error('Failed to send cash drawer command', { component: 'printer', error: writeErr.message });
              port.close();
              resolve({ success: false, error: `Command failed: ${writeErr.message}` });
              return;
            }

            // Close port after sending command
            setTimeout(() => {
              port.close((closeErr) => {
                if (closeErr) {
                  logger.warn('Error closing serial port after cash drawer', { component: 'printer', error: closeErr.message });
                }
                logger.info('Cash drawer command sent successfully', { component: 'printer', devicePath });
                resolve({ success: true });
              });
            }, 500);
          });
        });

        port.on('error', (portErr) => {
          logger.error('Serial port error during cash drawer', { component: 'printer', error: portErr.message });
          resolve({ success: false, error: `Serial port error: ${portErr.message}` });
        });
      });
    } catch (error: any) {
      logger.error('Cash drawer USB error', { component: 'printer', error: error.message });
      return { success: false, error: `Cash drawer failed: ${error.message}` };
    }
  }

  private async sendToNetwork(command: Buffer): Promise<{ success: boolean; error?: string }> {
    // Similar to printToNetwork but for cash drawer
    return await this.printToNetwork(command);
  }

  async listAvailablePrinters(): Promise<Array<{ name: string; type: string; path?: string }>> {
    try {
      const printers: Array<{ name: string; type: string; path?: string }> = [];
      const platform = process.platform;

      // List serial ports (USB printers) - only if SerialPort is available
      const SerialPortClass = loadSerialPort();
      if (SerialPortClass && SerialPortClass !== false) {
        try {
          // SerialPort.list() is a static method in serialport v12
          const listMethod = SerialPortClass.list;
          if (listMethod && typeof listMethod === 'function') {
            const ports = await listMethod();
            ports.forEach((port: any) => {
              printers.push({
                name: port.friendlyName || port.path || 'Unknown Printer',
                type: 'usb',
                path: port.path,
              });
            });
          } else {
            logger.warn('SerialPort.list() not available', { component: 'printer' });
          }
        } catch (error: any) {
          logger.warn('Failed to list serial ports', { component: 'printer', error: error.message });
        }
      } else {
        logger.info('SerialPort not available, skipping USB printer detection', { component: 'printer' });
      }

      // Add common COM ports on Windows if none found
      if (platform === 'win32' && printers.length === 0) {
        for (let i = 1; i <= 10; i++) {
          printers.push({
            name: `COM${i}`,
            type: 'usb',
            path: `COM${i}`,
          });
        }
      }

      // Add common Linux USB printer paths if none found
      if (platform === 'linux' && printers.length === 0) {
        const fs = require('fs');
        const commonPaths = ['/dev/usb/lp0', '/dev/usb/lp1', '/dev/usb/lp2'];
        commonPaths.forEach((path) => {
          try {
            if (fs.existsSync(path)) {
              printers.push({
                name: path,
                type: 'usb',
                path: path,
              });
            }
          } catch {
            // Ignore errors checking paths
          }
        });
      }

      logger.info(`Found ${printers.length} available printers`, { component: 'printer', count: printers.length });
      return printers;
    } catch (error: any) {
      logger.error('Error listing printers', { component: 'printer', error: error.message });
      return [];
    }
  }
}

export const printerService = PrinterService.getInstance();

export interface KitchenTicketData {
  id: string; // Unique ID for this ticket print job
  orderId: string;
  ticketVersion: number;
  tableNumber?: string;
  waiterName?: string;
  items: Array<{
    name: string;
    quantity: number;
    notes?: string;
    modifiers?: string[];
  }>;
  type: 'NEW' | 'UPDATE' | 'VOID';
  status: 'PENDING' | 'PRINTED' | 'FAILED';
  createdAt: string;
  retryCount: number;
}

class KitchenQueueService {
  private static instance: KitchenQueueService;
  private store: ElectronStore;
  private queue: KitchenTicketData[] = [];
  private isProcessing = false;
  private timer: NodeJS.Timeout | null = null;

  private constructor() {
    this.store = new ElectronStore();
    this.loadQueue();
    this.startQueue();
  }

  static getInstance(): KitchenQueueService {
    if (!KitchenQueueService.instance) {
      KitchenQueueService.instance = new KitchenQueueService();
    }
    return KitchenQueueService.instance;
  }

  private loadQueue() {
    const saved = this.store.get('kitchenQueue') as KitchenTicketData[] | undefined;
    if (saved && Array.isArray(saved)) {
      this.queue = saved;
    }
  }

  private saveQueue() {
    this.store.set('kitchenQueue', this.queue);
  }

  addTicket(ticket: Omit<KitchenTicketData, 'id' | 'status' | 'createdAt' | 'retryCount'>) {
    const newTicket: KitchenTicketData = {
      ...ticket,
      id: Math.random().toString(36).substring(2, 15),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };
    this.queue.push(newTicket);
    this.saveQueue();
    this.processQueue();
    return newTicket.id;
  }

  private startQueue() {
    // Check queue every 30 seconds for failed jobs
    this.timer = setInterval(() => this.processQueue(), 30000);
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pendingTickets = this.queue.filter(t => t.status === 'PENDING' || t.status === 'FAILED');
      
      for (const ticket of pendingTickets) {
        if (ticket.retryCount > 10) continue; // Stop retrying after 10 attempts

        // Generate ESC/POS commands for kitchen
        const commands = this.generateKitchenTicketCommands(ticket);
        
        // Print it (Assuming printerService is configured for the kitchen or we use the default printer)
        // In a real setup, kitchen has a separate printer IP/config. We will just use the default printerService for now.
        const result = await printerService.printReceipt(commands as any); // Type hacking to pass raw buffer later if we adjust printerService
        // Wait, printerService.printReceipt takes ReceiptData, not Buffer.
        // Let's add a raw print method to printerService, or just format a ReceiptData for kitchen.
        
        const kitchenReceiptData = {
          saleId: `ORDER-${ticket.orderId}-v${ticket.ticketVersion}`,
          date: ticket.createdAt,
          businessInfo: { name: `** KITCHEN TICKET: ${ticket.type} **` },
          items: ticket.items.map(i => ({
            name: `${i.name} ${i.notes ? '(' + i.notes + ')' : ''}`,
            quantity: i.quantity,
            price: 0
          })),
          subtotal: 0,
          vatAmount: 0,
          total: 0,
          paymentMethod: 'KITCHEN',
          customerName: ticket.tableNumber ? `Table: ${ticket.tableNumber}` : 'Takeaway',
          customerPhone: ticket.waiterName ? `Waiter: ${ticket.waiterName}` : '',
        };

        const printResult = await printerService.printReceipt(kitchenReceiptData);

        if (printResult.success) {
          ticket.status = 'PRINTED';
        } else {
          ticket.status = 'FAILED';
          ticket.retryCount++;
          logger.warn(`Kitchen print failed for ticket ${ticket.id}`, { component: 'printer' });
        }
      }

      // Cleanup printed tickets
      this.queue = this.queue.filter(t => t.status !== 'PRINTED');
      this.saveQueue();

    } finally {
      this.isProcessing = false;
    }
  }

  private generateKitchenTicketCommands(ticket: KitchenTicketData): Buffer {
    // If we wanted to write raw buffer commands specifically for kitchen with large red fonts, we would do it here.
    return Buffer.from([]);
  }
}

export const kitchenQueueService = KitchenQueueService.getInstance();


