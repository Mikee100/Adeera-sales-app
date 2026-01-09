import { useState, useEffect, useRef, useCallback } from 'react';

export interface BarcodeScanResult {
  code: string;
  format?: string;
  timestamp: number;
}

export interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  minLength?: number;
  maxLength?: number;
  timeout?: number;
  enabled?: boolean;
}

/**
 * Hook for detecting barcode scanner input
 * Barcode scanners typically act as keyboard input devices
 * They send characters rapidly followed by Enter key
 */
export const useBarcodeScanner = (options: UseBarcodeScannerOptions) => {
  const {
    onScan,
    minLength = 3,
    maxLength = 50,
    timeout = 100, // Time between characters (ms) to detect barcode scan
    enabled = true,
  } = options;

  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const bufferRef = useRef<string>('');
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastKeyTimeRef = useRef<number>(0);

  const detectBarcodeFormat = (code: string): string => {
    // UPC-A: 12 digits
    if (/^\d{12}$/.test(code)) {
      return 'UPC-A';
    }
    // UPC-E: 8 digits
    if (/^\d{8}$/.test(code)) {
      return 'UPC-E';
    }
    // EAN-13: 13 digits
    if (/^\d{13}$/.test(code)) {
      return 'EAN-13';
    }
    // EAN-8: 8 digits
    if (/^\d{8}$/.test(code)) {
      return 'EAN-8';
    }
    // Code128: Alphanumeric, variable length
    if (/^[A-Z0-9\-\.\s]+$/.test(code) && code.length >= 4) {
      return 'Code128';
    }
    // Code39: Alphanumeric with asterisks
    if (/^[A-Z0-9\-\s\$\%\.\/\+\*]+$/.test(code)) {
      return 'Code39';
    }
    // Generic barcode
    return 'Generic';
  };

  const processBarcode = useCallback((code: string) => {
    if (code.length < minLength || code.length > maxLength) {
      return;
    }

    const format = detectBarcodeFormat(code);
    setLastScannedCode(code);
    setIsScanning(false);
    bufferRef.current = '';

    // Call the callback
    onScan(code);
  }, [onScan, minLength, maxLength]);

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Ignore if user is typing in an input field
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      // Only process if it's a barcode scanner pattern (very fast input)
      const timeSinceLastKey = Date.now() - lastKeyTimeRef.current;
      if (timeSinceLastKey > 50) {
        // User is typing manually, ignore
        return;
      }
    }

    const currentTime = Date.now();
    const timeSinceLastKey = currentTime - lastKeyTimeRef.current;

    // If too much time passed since last key, reset buffer (user typing manually)
    if (timeSinceLastKey > timeout * 2 && bufferRef.current.length > 0) {
      bufferRef.current = '';
      setIsScanning(false);
    }

    // Handle Enter key (barcode scanner sends Enter at the end)
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();

      if (bufferRef.current.length >= minLength) {
        processBarcode(bufferRef.current.trim());
      }
      bufferRef.current = '';
      setIsScanning(false);
      return;
    }

    // Handle Escape key (cancel scan)
    if (event.key === 'Escape') {
      bufferRef.current = '';
      setIsScanning(false);
      return;
    }

    // Handle printable characters
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      setIsScanning(true);
      bufferRef.current += event.key;
      lastKeyTimeRef.current = currentTime;

      // Clear existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Set timer to process barcode if no more input comes
      timerRef.current = setTimeout(() => {
        if (bufferRef.current.length >= minLength) {
          processBarcode(bufferRef.current.trim());
        } else {
          bufferRef.current = '';
          setIsScanning(false);
        }
      }, timeout);
    }
  }, [enabled, timeout, minLength, processBarcode]);

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyPress);

    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [handleKeyPress, enabled]);

  return {
    isScanning,
    lastScannedCode,
    clearScan: () => {
      bufferRef.current = '';
      setIsScanning(false);
    },
  };
};

