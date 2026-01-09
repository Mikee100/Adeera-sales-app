/**
 * Audit logging system for sensitive operations
 */

export enum AuditEventType {
  SALE_CREATED = 'SALE_CREATED',
  SALE_COMPLETED = 'SALE_COMPLETED',
  SALE_CANCELLED = 'SALE_CANCELLED',
  TRANSACTION_HELD = 'TRANSACTION_HELD',
  TRANSACTION_RESUMED = 'TRANSACTION_RESUMED',
  TRANSACTION_DELETED = 'TRANSACTION_DELETED',
  RECEIPT_PRINTED = 'RECEIPT_PRINTED',
  PAYMENT_PROCESSED = 'PAYMENT_PROCESSED',
  PRICE_OVERRIDE = 'PRICE_OVERRIDE',
  STOCK_ADJUSTMENT = 'STOCK_ADJUSTMENT',
  REFUND_PROCESSED = 'REFUND_PROCESSED',
  USER_LOGIN = 'USER_LOGIN',
  USER_LOGOUT = 'USER_LOGOUT',
  SETTINGS_CHANGED = 'SETTINGS_CHANGED',
  DATA_VALIDATION_FAILED = 'DATA_VALIDATION_FAILED',
  SECURITY_VIOLATION = 'SECURITY_VIOLATION',
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  userId?: string;
  userName?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs in memory
  private readonly STORAGE_KEY = 'pos-audit-logs';

  constructor() {
    this.loadLogs();
  }

  private loadLogs(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.logs = parsed.slice(-this.maxLogs); // Keep only recent logs
      }
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    }
  }

  private saveLogs(): void {
    try {
      // Keep only recent logs in localStorage
      const logsToSave = this.logs.slice(-this.maxLogs);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(logsToSave));
    } catch (error) {
      console.error('Failed to save audit logs:', error);
    }
  }

  /**
   * Log an audit event
   */
  log(
    eventType: AuditEventType,
    details: Record<string, any>,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    userId?: string,
    userName?: string
  ): void {
    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType,
      userId,
      userName,
      details,
      severity,
      userAgent: navigator.userAgent,
    };

    this.logs.push(entry);

    // Keep only recent logs in memory
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    this.saveLogs();

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[AUDIT] ${eventType}`, entry);
    }

    // For critical events, also log to main process (if available)
    if (severity === 'critical' && (window as any).electronAPI?.logAuditEvent) {
      (window as any).electronAPI.logAuditEvent(entry).catch((error: any) => {
        console.error('Failed to send audit log to main process:', error);
      });
    }
  }

  /**
   * Get audit logs
   */
  getLogs(limit?: number): AuditLogEntry[] {
    const logs = [...this.logs].reverse(); // Most recent first
    return limit ? logs.slice(0, limit) : logs;
  }

  /**
   * Get audit logs by event type
   */
  getLogsByType(eventType: AuditEventType, limit?: number): AuditLogEntry[] {
    const filtered = this.logs.filter(log => log.eventType === eventType).reverse();
    return limit ? filtered.slice(0, limit) : filtered;
  }

  /**
   * Get audit logs by severity
   */
  getLogsBySeverity(severity: AuditLogEntry['severity'], limit?: number): AuditLogEntry[] {
    const filtered = this.logs.filter(log => log.severity === severity).reverse();
    return limit ? filtered.slice(0, limit) : filtered;
  }

  /**
   * Clear old logs (keep only recent ones)
   */
  clearOldLogs(keepDays: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - keepDays);

    this.logs = this.logs.filter(log => new Date(log.timestamp) >= cutoffDate);
    this.saveLogs();
  }

  /**
   * Export logs for reporting
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const auditLogger = new AuditLogger();

