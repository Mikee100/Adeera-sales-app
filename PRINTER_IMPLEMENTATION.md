# Receipt Printer & Cash Drawer Implementation

## ✅ Features Implemented

### 1. Receipt Printer Integration
- **ESC/POS Support**: Full ESC/POS command generation for thermal printers
- **Multiple Printer Types**: 
  - USB printers (Windows COM ports, Linux /dev/usb/lp*, macOS)
  - Network printers (IP address + port)
  - File mode (saves receipts to Desktop/POS_Receipts folder)
- **Receipt Formatting**: 
  - Business information header
  - Branch details
  - Itemized list with quantities and prices
  - Subtotal, VAT, and total calculations
  - Payment method and change
  - Customer information
  - Thank you message
  - Automatic paper cut

### 2. Cash Drawer Integration
- **Auto-open on Cash Payments**: Automatically opens cash drawer when cash payment is completed
- **Manual Open Button**: Manual cash drawer button on receipt screen
- **ESC/POS Commands**: Uses standard ESC/POS cash drawer commands
- **Configurable**: Can be enabled/disabled in settings

### 3. Printer Settings UI
- **Settings Modal**: Accessible from POS header (⚙️ Settings button)
- **Configuration Options**:
  - Printer type selection (USB/Network/File)
  - Device path for USB printers
  - IP address and port for network printers
  - Auto-open cash drawer toggle
- **Test Functions**:
  - Test print button
  - Test cash drawer button
- **Settings Persistence**: Configuration saved to electron-store

## 📁 Files Created/Modified

### New Files:
- `src/main/printer-service.ts` - Core printer service with ESC/POS support
- `src/renderer/components/PrinterSettings.tsx` - Settings UI component
- `src/renderer/printer-settings.css` - Styles for printer settings

### Modified Files:
- `src/main/main.ts` - Added printer handlers and auto-open cash drawer logic
- `src/main/preload.ts` - Exposed new IPC handlers
- `src/renderer/components/Receipt.tsx` - Added cash drawer button
- `src/renderer/components/ProductSelection.tsx` - Added settings button and modal
- `src/renderer/declarations.d.ts` - Added TypeScript definitions

## 🔧 How It Works

### Receipt Printing Flow:
1. User completes sale → Receipt screen appears
2. User clicks "Print" button
3. `printReceipt` IPC handler called
4. `PrinterService` generates ESC/POS commands
5. Commands sent to printer based on configured type:
   - **USB**: Direct device communication
   - **Network**: TCP/IP socket connection (port 9100)
   - **File**: Saved to Desktop/POS_Receipts folder

### Cash Drawer Flow:
1. **Auto-open**: 
   - Sale completed with cash payment
   - Checks if auto-open is enabled
   - Sends ESC/POS cash drawer command
   
2. **Manual open**:
   - User clicks "💰 Open Drawer" button on receipt screen
   - Sends cash drawer command immediately

## 🖨️ Printer Configuration

### USB Printers:
- **Windows**: Use COM port (e.g., COM1, COM2)
- **Linux**: Use device path (e.g., /dev/usb/lp0, /dev/usb/lp1)
- **macOS**: Leave empty for auto-detect or specify device path

### Network Printers:
- **IP Address**: Printer's IP address on local network
- **Port**: Usually 9100 (raw printing port)

### File Mode:
- Receipts saved as `.txt` files
- Location: `Desktop/POS_Receipts/`
- Can be printed manually or used for testing

## 🔌 ESC/POS Commands Used

### Cash Drawer:
```
ESC p 0 25 255
```
- ESC p: Cash drawer command
- 0: Pin 2 (most common)
- 25: Pulse time (50ms)
- 255: Pulse interval (510ms)

### Receipt Formatting:
- `ESC @` - Initialize printer
- `ESC a n` - Set alignment (0=left, 1=center, 2=right)
- `GS ! n` - Set character size
- `GS V A n` - Cut paper

## 🚀 Usage Instructions

### Initial Setup:
1. Click **⚙️ Settings** button in POS header
2. Select printer type (USB/Network/File)
3. Configure connection details:
   - USB: Enter device path
   - Network: Enter IP and port
4. Enable/disable auto-open cash drawer
5. Click **💾 Save Settings**
6. Test with **🖨️ Test Print** button

### During Sales:
- Receipts print automatically when "Print" is clicked
- Cash drawer opens automatically on cash payments (if enabled)
- Manual cash drawer button available on receipt screen

## ⚠️ Important Notes

### USB Printer Requirements:
- Printer must be connected and powered on
- Drivers must be installed
- Device path must be correct for your OS

### Network Printer Requirements:
- Printer must be on same network
- Port 9100 must be open (firewall)
- IP address must be static or reserved

### Cash Drawer Requirements:
- Cash drawer must be connected to printer
- Connection via RJ-11 cable (most common) or USB
- Printer must support cash drawer commands

## 🐛 Troubleshooting

### Printer Not Printing:
1. Check printer connection (USB/Network)
2. Verify printer configuration in settings
3. Test with "Test Print" button
4. Check logs in `logs/combined.log`
5. Try file mode to verify receipt generation

### Cash Drawer Not Opening:
1. Verify cash drawer is connected to printer
2. Check auto-open setting is enabled
3. Test with "Test Cash Drawer" button
4. Verify printer supports cash drawer commands
5. Check cable connections

### Network Printer Issues:
1. Ping printer IP address
2. Verify port 9100 is accessible
3. Check firewall settings
4. Try telnet to printer IP:port

## 📝 Future Enhancements

Potential improvements:
- USB device auto-detection
- Printer driver integration
- Multiple printer support
- Receipt template customization
- Print preview
- Print queue management
- Receipt reprint from history

## 🔒 Security Notes

- Printer settings stored locally in electron-store
- No sensitive data sent to external services
- Network printing uses local network only
- File mode saves locally only

---

**Implementation Date**: $(date)
**Status**: ✅ Complete and Ready for Testing

