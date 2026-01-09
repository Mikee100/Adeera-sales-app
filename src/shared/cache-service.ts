import { LRUCache } from 'lru-cache';
import * as pako from 'pako';
import { logger } from './logger';

interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt?: number;
  compressed: boolean;
  size: number;
}

interface CacheOptions {
  maxSize: number;
  ttl: number; // Time to live in milliseconds
  compressionThreshold: number; // Compress data larger than this (bytes)
  enableCompression: boolean;
}

interface CacheMetrics {
  totalRequests: number;
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  compressed: number;
  decompressed: number;
  averageAccessTime: number;
  memoryUsage: number;
  diskUsage: number;
  hitRate: number;
  compressionRatio: number;
}

class EnhancedCacheService {
  private memoryCache: LRUCache<string, CacheEntry>;
  private diskCache: Map<string, CacheEntry> = new Map();
  private options: CacheOptions;
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    compressed: 0,
    decompressed: 0,
    totalRequests: 0,
    accessTimes: [] as number[],
    lastCleanup: Date.now(),
  };

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = {
      maxSize: 50 * 1024 * 1024, // 50MB default
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      compressionThreshold: 1024, // 1KB
      enableCompression: true,
      ...options,
    };

    this.memoryCache = new LRUCache<string, CacheEntry>({
      max: this.options.maxSize,
      ttl: this.options.ttl,
      sizeCalculation: (value: CacheEntry, key: string) => value.size,
      dispose: (value: CacheEntry, key: string) => {
        // Move to disk cache if still valid
        if (this.shouldKeepInDisk(value)) {
          this.diskCache.set(key, value);
        }
      },
    });

    // Load disk cache on startup
    this.loadDiskCache();
  }

  private shouldKeepInDisk(entry: CacheEntry): boolean {
    return !entry.expiresAt || entry.expiresAt > Date.now();
  }

  private loadDiskCache(): void {
    try {
      // In a real implementation, this would load from persistent storage
      // For now, we'll start with an empty disk cache
      logger.info('Disk cache initialized', { component: 'cache' });
    } catch (error) {
      logger.error('Failed to load disk cache', { component: 'cache', error: error as Error });
    }
  }

  private compressData(data: any): Uint8Array {
    const jsonString = JSON.stringify(data);
    const compressed = pako.deflate(jsonString);
    this.stats.compressed++;
    return compressed;
  }

  private decompressData(compressedData: Uint8Array): any {
    const decompressed = pako.inflate(compressedData, { to: 'string' });
    this.stats.decompressed++;
    return JSON.parse(decompressed);
  }

  private calculateSize(data: any, compressed: boolean): number {
    if (compressed && data instanceof Uint8Array) {
      return data.length;
    }
    return JSON.stringify(data).length;
  }

  async set(key: string, data: any, options: Partial<CacheOptions> = {}): Promise<void> {
    const opts = { ...this.options, ...options };
    const timestamp = Date.now();
    const expiresAt = opts.ttl ? timestamp + opts.ttl : undefined;

    let processedData = data;
    let compressed = false;
    let size = this.calculateSize(data, false);

    // Compress if enabled and data is large enough
    if (opts.enableCompression && size > opts.compressionThreshold) {
      processedData = this.compressData(data);
      compressed = true;
      size = processedData.length;
    }

    const entry: CacheEntry = {
      data: processedData,
      timestamp,
      expiresAt,
      compressed,
      size,
    };

    this.memoryCache.set(key, entry);
    this.stats.sets++;

    // Also store in disk cache for persistence
    this.diskCache.set(key, entry);
  }

  async get(key: string): Promise<any | null> {
    // Try memory cache first
    let entry = this.memoryCache.get(key);

    if (!entry) {
      // Try disk cache
      entry = this.diskCache.get(key);
      if (entry) {
        // Move back to memory cache
        this.memoryCache.set(key, entry);
      }
    }

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;

    // Decompress if needed
    if (entry.compressed) {
      return this.decompressData(entry.data);
    }

    return entry.data;
  }

  async delete(key: string): Promise<boolean> {
    const memoryDeleted = this.memoryCache.delete(key);
    const diskDeleted = this.diskCache.delete(key);

    if (memoryDeleted || diskDeleted) {
      this.stats.deletes++;
      return true;
    }

    return false;
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    this.diskCache.clear();
    this.resetStats();
  }

  async has(key: string): Promise<boolean> {
    return this.memoryCache.has(key) || this.diskCache.has(key);
  }

  async keys(): Promise<string[]> {
    const memoryKeys = this.memoryCache.keys();
    const diskKeys = Array.from(this.diskCache.keys());
    return [...new Set([...memoryKeys, ...diskKeys])];
  }

  // Usage-based cache warming
  async warmCache(keys: string[]): Promise<void> {
    logger.info(`Warming cache for ${keys.length} keys`, { component: 'cache', keysCount: keys.length });
    for (const key of keys) {
      // Prefetch data in background
      this.get(key).catch((error) => {
        logger.debug(`Failed to warm cache for key: ${key}`, { component: 'cache', key, error });
      });
    }
  }

  // Get cache statistics
  getStats() {
    return {
      ...this.stats,
      memory: {
        size: this.memoryCache.size,
        count: this.memoryCache.size,
        maxSize: this.options.maxSize,
      },
      disk: {
        count: this.diskCache.size,
      },
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
    };
  }

  private resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      compressed: 0,
      decompressed: 0,
      totalRequests: 0,
      accessTimes: [],
      lastCleanup: Date.now(),
    };
  }

  // Enhanced metrics and monitoring
  getMetrics(): CacheMetrics {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;
    const averageAccessTime = this.stats.accessTimes.length > 0
      ? this.stats.accessTimes.reduce((a, b) => a + b, 0) / this.stats.accessTimes.length
      : 0;

    // Calculate compression ratio (original size / compressed size)
    const compressionRatio = this.stats.compressed > 0
      ? (this.stats.compressed / Math.max(this.stats.decompressed, 1))
      : 1;

    return {
      totalRequests,
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      compressed: this.stats.compressed,
      decompressed: this.stats.decompressed,
      averageAccessTime,
      memoryUsage: this.memoryCache.size,
      diskUsage: this.diskCache.size,
      hitRate,
      compressionRatio,
    };
  }

  // Performance monitoring
  async getWithTiming(key: string): Promise<{ data: any | null; timing: number }> {
    const startTime = performance.now();
    const data = await this.get(key);
    const timing = performance.now() - startTime;

    // Track access time for metrics
    this.stats.accessTimes.push(timing);
    if (this.stats.accessTimes.length > 1000) {
      this.stats.accessTimes = this.stats.accessTimes.slice(-500); // Keep last 500
    }

    return { data, timing };
  }

  // Cache health check
  async healthCheck(): Promise<{
    healthy: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    const metrics = this.getMetrics();

    // Check hit rate
    if (metrics.hitRate < 0.5) {
      issues.push(`Low cache hit rate: ${(metrics.hitRate * 100).toFixed(1)}%`);
      recommendations.push('Consider increasing cache TTL or pre-warming frequently accessed data');
    }

    // Check memory usage
    const memoryUsagePercent = (metrics.memoryUsage / this.options.maxSize) * 100;
    if (memoryUsagePercent > 90) {
      issues.push(`High memory usage: ${memoryUsagePercent.toFixed(1)}%`);
      recommendations.push('Consider increasing maxSize or implementing more aggressive cleanup');
    }

    // Check for old data
    const now = Date.now();
    if (now - this.stats.lastCleanup > 24 * 60 * 60 * 1000) { // 24 hours
      issues.push('Cache cleanup overdue');
      recommendations.push('Run cleanup to remove expired entries');
    }

    // Log health check results
    logger.info('Cache health check completed', {
      component: 'cache',
      healthy: issues.length === 0,
      hitRate: metrics.hitRate,
      memoryUsagePercent,
      issuesCount: issues.length
    });

    return {
      healthy: issues.length === 0,
      issues,
      recommendations,
    };
  }

  // Export metrics for external monitoring
  exportMetrics(): Record<string, any> {
    const metrics = this.getMetrics();
    return {
      cache: {
        hits: metrics.hits,
        misses: metrics.misses,
        hitRate: metrics.hitRate,
        memoryUsage: metrics.memoryUsage,
        diskUsage: metrics.diskUsage,
        compressionRatio: metrics.compressionRatio,
        averageAccessTime: metrics.averageAccessTime,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Cleanup expired entries
  async cleanup(): Promise<void> {
    const now = Date.now();
    const expiredKeys: string[] = [];

    // Check disk cache for expired entries
    for (const [key, entry] of this.diskCache.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.diskCache.delete(key));
    this.stats.lastCleanup = now;

    if (expiredKeys.length > 0) {
      logger.info(`Cleaned up ${expiredKeys.length} expired cache entries`, {
        component: 'cache',
        expiredCount: expiredKeys.length
      });
    }
  }
}

// Singleton instance
export const cacheService = new EnhancedCacheService({
  maxSize: 100 * 1024 * 1024, // 100MB
  ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
  compressionThreshold: 2048, // 2KB
  enableCompression: true,
});

export default cacheService;
