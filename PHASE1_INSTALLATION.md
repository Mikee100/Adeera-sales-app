# Phase 1 Installation Guide

## Prerequisites

Before installing Phase 1 updates, ensure you have:
- Node.js 16+ installed
- npm or yarn package manager
- Electron development environment set up

## Installation Steps

### 1. Install New Dependencies

```bash
cd sales-app
npm install
```

This will install the new `serialport` package required for USB/Serial printer support.

### 2. Rebuild Native Modules (if needed)

If you encounter issues with `serialport`, you may need to rebuild native modules:

```bash
npm rebuild
```

Or for Electron specifically:

```bash
npm install --build-from-source
```

### 3. Build the Application

```bash
npm run build
```

### 4. Test Printer Configuration

1. Start the application:
   ```bash
   npm run dev
   ```

2. Navigate to Printer Settings (if available in UI) or configure via code

3. Configure your printer:
   - **USB Printer**: Set COM port (Windows) or device path (Linux)
   - **Network Printer**: Set IP address and port (default: 9100)
   - **File Fallback**: No configuration needed (automatic)

### 5. Test Cash Drawer

1. Complete a cash sale
2. Verify cash drawer opens automatically
3. Test manual open button on receipt screen

### 6. Test Barcode Scanner

1. Connect USB barcode scanner (HID keyboard mode)
2. Scan a product barcode
3. Verify product is added to cart

## Platform-Specific Notes

### Windows
- USB printers typically use COM ports (COM1, COM2, etc.)
- May need to check Device Manager for correct COM port
- Administrator rights may be required for some COM ports

### Linux
- USB printers typically at `/dev/usb/lp0`, `/dev/usb/lp1`, etc.
- May need to add user to `lp` group: `sudo usermod -a -G lp $USER`
- May need udev rules for USB device access

### macOS
- May require CUPS configuration
- USB device paths may vary
- Check System Preferences > Printers & Scanners

## Troubleshooting

### Printer Not Detected
- Check device connection
- Verify COM port/device path
- Check permissions (Linux/macOS)
- Try file fallback mode first

### Cash Drawer Not Opening
- Verify printer is connected (drawer usually connected to printer)
- Check printer configuration
- Verify `autoOpenCashDrawer` is enabled
- Test manual open button

### Barcode Scanner Not Working
- Verify scanner is in HID keyboard mode
- Check scanner is connected and powered
- Test scanner in Notepad first
- Adjust timeout settings if needed

### SerialPort Build Errors
- Ensure Node.js version matches Electron version
- Try: `npm rebuild serialport`
- On Windows: May need Visual Studio Build Tools
- On Linux: May need `build-essential` package

## Verification Checklist

- [ ] Dependencies installed successfully
- [ ] Application builds without errors
- [ ] Printer configuration accessible
- [ ] USB printer detected/configured
- [ ] Receipt prints successfully
- [ ] Cash drawer opens automatically
- [ ] Cash drawer opens manually
- [ ] Barcode scanner detected
- [ ] Products added via barcode scan
- [ ] File fallback works (if printer unavailable)

## Next Steps

After successful installation:
1. Configure your specific printer hardware
2. Test all Phase 1 features
3. Proceed to Phase 2 implementation (if desired)

---

*Installation Guide - Phase 1*
*Last Updated: February 18, 2026*
