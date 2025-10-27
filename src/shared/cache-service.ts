import LRU from 'lru-cache';
import * as pako from 'pako';

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

class EnhancedCacheService {
  private memoryCache: LRU<string, CacheEntry>;
  private diskCache: Map<string, CacheEntry> = new Map();
  private options: CacheOptions;
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    compressed: 0,
    decompressed: 0,
  };

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = {
      maxSize: 50 * 1024 * 1024, // 50MB default
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      compressionThreshold: 1024, // 1KB
      enableCompression: true,
      ...options,
    };

    this.memoryCache = new LRU({
      max: this.options.maxSize,
      ttl: this.options.ttl,
      sizeCalculation: (value: CacheEntry) => value.size,
      dispose: (key: string, value: CacheEntry) => {
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
      console.log('🗄️ Disk cache initialized');
    } catch (error) {
      console.warn('Failed to load disk cache:', error);
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
    console.log(`🔥 Warming cache for ${keys.length} keys`);
    for (const key of keys) {
      // Prefetch data in background
      this.get(key).catch(() => {
        // Ignore errors during warming
      });
    }
  }

  // Get cache statistics
  getStats() {
    const memoryStats = this.memoryCache.stats();
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

    if (expiredKeys.length > 0) {
      console.log(`🧹 Cleaned up ${expiredKeys.length} expired cache entries`);
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
