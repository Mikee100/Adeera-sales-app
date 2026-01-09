import log from 'electron-log';
import winston from 'winston';

// Configure electron-log for file output
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

// Configure winston for structured logging
const winstonLogger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'saas-pos' },
  transports: [
    // Write all logs with importance level of `error` or less to `error.log`
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // Write all logs with importance level of `info` or less to `combined.log`
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// If we're not in production then log to the console with a simple format
if (process.env.NODE_ENV !== 'production') {
  winstonLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

export interface LogContext {
  userId?: string;
  sessionId?: string;
  component?: string;
  operation?: string;
  duration?: number;
  error?: Error;
  metadata?: Record<string, any>;
  event?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  key?: string;
  hit?: boolean;
  [key: string]: any; // Allow additional properties
}

class Logger {
  private context: LogContext = {};

  // Set global context for all subsequent logs
  setContext(context: Partial<LogContext>): void {
    this.context = { ...this.context, ...context };
  }

  // Clear global context
  clearContext(): void {
    this.context = {};
  }

  // Create a child logger with additional context
  child(extraContext: Partial<LogContext>): Logger {
    const childLogger = new Logger();
    childLogger.context = { ...this.context, ...extraContext };
    return childLogger;
  }

  // Error level logging
  error(message: string, context?: Partial<LogContext>): void {
    const fullContext = { ...this.context, ...context };
    const logEntry = {
      level: 'error',
      message,
      ...fullContext,
      timestamp: new Date().toISOString(),
    };

    // Log to both winston and electron-log
    winstonLogger.error(message, fullContext);
    log.error(`[${fullContext.component || 'unknown'}] ${message}`, fullContext.error?.stack);
  }

  // Warning level logging
  warn(message: string, context?: Partial<LogContext>): void {
    const fullContext = { ...this.context, ...context };
    const logEntry = {
      level: 'warn',
      message,
      ...fullContext,
      timestamp: new Date().toISOString(),
    };

    winstonLogger.warn(message, fullContext);
    log.warn(`[${fullContext.component || 'unknown'}] ${message}`);
  }

  // Info level logging
  info(message: string, context?: Partial<LogContext>): void {
    const fullContext = { ...this.context, ...context };
    const logEntry = {
      level: 'info',
      message,
      ...fullContext,
      timestamp: new Date().toISOString(),
    };

    winstonLogger.info(message, fullContext);
    log.info(`[${fullContext.component || 'unknown'}] ${message}`);
  }

  // Debug level logging
  debug(message: string, context?: Partial<LogContext>): void {
    const fullContext = { ...this.context, ...context };
    const logEntry = {
      level: 'debug',
      message,
      ...fullContext,
      timestamp: new Date().toISOString(),
    };

    winstonLogger.debug(message, fullContext);
    if (process.env.NODE_ENV === 'development') {
      log.debug(`[${fullContext.component || 'unknown'}] ${message}`);
    }
  }

  // Performance logging
  performance(operation: string, duration: number, context?: Partial<LogContext>): void {
    this.info(`Performance: ${operation} completed in ${duration}ms`, {
      ...context,
      operation,
      duration,
      component: 'performance'
    });
  }

  // Business event logging
  business(event: string, data: Record<string, any>, context?: Partial<LogContext>): void {
    this.info(`Business Event: ${event}`, {
      ...context,
      event,
      ...data,
      component: 'business'
    });
  }

  // Security event logging
  security(event: string, details: Record<string, any>, context?: Partial<LogContext>): void {
    this.warn(`Security Event: ${event}`, {
      ...context,
      event,
      ...details,
      component: 'security'
    });
  }

  // API request logging
  apiRequest(method: string, url: string, statusCode?: number, duration?: number, context?: Partial<LogContext>): void {
    const level = statusCode && statusCode >= 400 ? 'warn' : 'info';
    const message = `API ${method} ${url} ${statusCode ? `- ${statusCode}` : ''} ${duration ? `(${duration}ms)` : ''}`;

    if (level === 'warn') {
      this.warn(message, { ...context, method, url, statusCode, duration, component: 'api' });
    } else {
      this.info(message, { ...context, method, url, statusCode, duration, component: 'api' });
    }
  }

  // Cache operation logging
  cache(operation: string, key: string, hit: boolean, context?: Partial<LogContext>): void {
    this.debug(`Cache ${operation}: ${key} (${hit ? 'HIT' : 'MISS'})`, {
      ...context,
      operation,
      key,
      hit,
      component: 'cache'
    });
  }

  // Get recent logs (for debugging UI)
  getRecentLogs(count: number = 100): any[] {
    // This would need to be implemented to read from log files
    // For now, return empty array
    return [];
  }

  // Flush logs (ensure all logs are written)
  flush(): Promise<void> {
    return new Promise((resolve) => {
      winstonLogger.on('finish', resolve);
      winstonLogger.end();
    });
  }
}

// Singleton instance
export const logger = new Logger();

// Convenience functions for quick logging
export const logError = (message: string, context?: Partial<LogContext>) => logger.error(message, context);
export const logWarn = (message: string, context?: Partial<LogContext>) => logger.warn(message, context);
export const logInfo = (message: string, context?: Partial<LogContext>) => logger.info(message, context);
export const logDebug = (message: string, context?: Partial<LogContext>) => logger.debug(message, context);

export default logger;
