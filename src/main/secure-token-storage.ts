import { safeStorage } from 'electron';
import { logger } from '../shared/logger';

// Logger is imported from shared/logger

/**
 * Secure token storage using Electron's safeStorage API
 * This encrypts tokens using the OS keychain/keyring
 */
export class SecureTokenStorage {
  private static readonly TOKEN_KEY = 'authToken';
  private static readonly REFRESH_TOKEN_KEY = 'refreshToken';
  private static readonly TOKEN_EXPIRY_KEY = 'tokenExpiry';

  /**
   * Check if safeStorage is available (requires user to have logged in at least once)
   */
  static isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch (error) {
      logger.warn('safeStorage not available', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  /**
   * Encrypt and store token securely
   */
  static setToken(token: string, expiry?: number): boolean {
    try {
      if (!this.isAvailable()) {
        logger.warn('safeStorage not available, falling back to plain storage (less secure)', { component: 'token-storage' });
        // Fallback: store in plain text if encryption not available
        // This can happen if user hasn't logged into OS keychain yet
        return false;
      }

      const encrypted = safeStorage.encryptString(token);
      // Store encrypted token as base64 string
      const encryptedBase64 = encrypted.toString('base64');
      
      // Use ElectronStore to persist encrypted token
      const ElectronStore = require('electron-store');
      const store = new ElectronStore();
      store.set(this.TOKEN_KEY, encryptedBase64);
      
      if (expiry) {
        store.set(this.TOKEN_EXPIRY_KEY, expiry);
      }

      logger.info('Token stored securely', { component: 'token-storage', hasExpiry: !!expiry });
      return true;
    } catch (error) {
      logger.error('Failed to encrypt token', { 
        component: 'token-storage', 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  /**
   * Retrieve and decrypt token
   */
  static getToken(): string | null {
    try {
      const ElectronStore = require('electron-store');
      const store = new ElectronStore();
      const encryptedBase64 = store.get(this.TOKEN_KEY) as string | undefined;

      if (!encryptedBase64) {
        return null;
      }

      // Check if it's encrypted (base64) or plain text (for migration)
      try {
        if (this.isAvailable()) {
          const encrypted = Buffer.from(encryptedBase64, 'base64');
          const decrypted = safeStorage.decryptString(encrypted);
          return decrypted;
        } else {
          // Fallback: might be plain text from before encryption was available
          logger.warn('safeStorage not available, attempting plain text read', { component: 'token-storage' });
          return encryptedBase64; // Might be plain text
        }
      } catch (decryptError) {
        // If decryption fails, might be plain text (migration scenario)
        logger.warn('Decryption failed, treating as plain text', { component: 'token-storage' });
        return encryptedBase64;
      }
    } catch (error) {
      logger.error('Failed to retrieve token', { 
        component: 'token-storage', 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  /**
   * Delete stored token
   */
  static deleteToken(): void {
    try {
      const ElectronStore = require('electron-store');
      const store = new ElectronStore();
      store.delete(this.TOKEN_KEY);
      store.delete(this.REFRESH_TOKEN_KEY);
      store.delete(this.TOKEN_EXPIRY_KEY);
      logger.info('Token deleted', { component: 'token-storage' });
    } catch (error) {
      logger.error('Failed to delete token', { 
        component: 'token-storage', 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  /**
   * Store refresh token securely
   */
  static setRefreshToken(refreshToken: string): boolean {
    try {
      if (!this.isAvailable()) {
        return false;
      }

      const encrypted = safeStorage.encryptString(refreshToken);
      const encryptedBase64 = encrypted.toString('base64');
      
      const ElectronStore = require('electron-store');
      const store = new ElectronStore();
      store.set(this.REFRESH_TOKEN_KEY, encryptedBase64);

      logger.info('Refresh token stored securely', { component: 'token-storage' });
      return true;
    } catch (error) {
      logger.error('Failed to encrypt refresh token', { 
        component: 'token-storage', 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  /**
   * Get refresh token
   */
  static getRefreshToken(): string | null {
    try {
      const ElectronStore = require('electron-store');
      const store = new ElectronStore();
      const encryptedBase64 = store.get(this.REFRESH_TOKEN_KEY) as string | undefined;

      if (!encryptedBase64) {
        return null;
      }

      if (this.isAvailable()) {
        const encrypted = Buffer.from(encryptedBase64, 'base64');
        return safeStorage.decryptString(encrypted);
      }

      return encryptedBase64; // Fallback
    } catch (error) {
      logger.error('Failed to retrieve refresh token', { 
        component: 'token-storage', 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  /**
   * Check if token is expired
   */
  static isTokenExpired(): boolean {
    try {
      const ElectronStore = require('electron-store');
      const store = new ElectronStore();
      const expiry = store.get(this.TOKEN_EXPIRY_KEY) as number | undefined;

      if (!expiry) {
        return false; // No expiry info, assume valid
      }

      return Date.now() >= expiry;
    } catch (error) {
      logger.warn('Failed to check token expiry', { 
        component: 'token-storage', 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  /**
   * Migrate plain text token to encrypted storage
   */
  static migratePlainTextToken(plainToken: string): boolean {
    try {
      logger.info('Migrating plain text token to encrypted storage', { component: 'token-storage' });
      const success = this.setToken(plainToken);
      if (success) {
        logger.info('Token migration successful', { component: 'token-storage' });
      }
      return success;
    } catch (error) {
      logger.error('Token migration failed', { 
        component: 'token-storage', 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }
}
