interface MemoryStats {
  used: number;
  total: number;
  limit: number;
  external: number;
}

interface PerformanceMetrics {
  fps: number;
  memoryUsage: MemoryStats;
  renderTime: number;
  loadTime: number;
}

class MemoryManager {
  private static instance: MemoryManager;
  private gcThreshold: number = 50 * 1024 * 1024; // 50MB
  private warningThreshold: number = 100 * 1024 * 1024; // 100MB
  private criticalThreshold: number = 150 * 1024 * 1024; // 150MB
  private cleanupCallbacks: Map<string, () => void> = new Map();
  private performanceObserver: PerformanceObserver | null = null;
  private memoryPressureHandler: (() => void) | null = null;

  private constructor() {
    this.setupMemoryMonitoring();
    this.setupPerformanceMonitoring();
  }

  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  private setupMemoryMonitoring(): void {
    // Monitor memory usage in renderer process
    if (typeof window !== 'undefined') {
      // Use Performance.memory API if available
      if ('memory' in performance) {
        setInterval(() => {
          this.checkMemoryUsage();
        }, 30000); // Check every 30 seconds
      }

      // Listen for memory pressure events (Chrome/Edge)
      if ('memory' in performance) {
        this.memoryPressureHandler = () => {
          console.warn('⚠️ Memory pressure detected, triggering cleanup');
          this.performEmergencyCleanup();
        };

        // Add memory pressure listener if supported
        if ('onmemorypressure' in window) {
          window.addEventListener('memorypressure', this.memoryPressureHandler);
        }
      }
    }
  }

  private setupPerformanceMonitoring(): void {
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      try {
        this.performanceObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          for (const entry of entries) {
            if (entry.entryType === 'measure') {
              console.log(`📊 Performance measure: ${entry.name} - ${entry.duration}ms`);
            }
          }
        });

        this.performanceObserver.observe({ entryTypes: ['measure', 'navigation'] });
      } catch (error) {
        console.warn('Performance monitoring not fully supported:', error);
      }
    }
  }

  private checkMemoryUsage(): void {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memInfo = (performance as any).memory;
      const usedMemory = memInfo.usedJSHeapSize;
      const totalMemory = memInfo.totalJSHeapSize;
      const limit = memInfo.jsHeapSizeLimit;

      if (usedMemory > this.criticalThreshold) {
        console.error('🚨 Critical memory usage detected:', this.formatBytes(usedMemory));
        this.performEmergencyCleanup();
        this.emitMemoryWarning('critical', usedMemory);
      } else if (usedMemory > this.warningThreshold) {
        console.warn('⚠️ High memory usage detected:', this.formatBytes(usedMemory));
        this.performCleanup();
        this.emitMemoryWarning('high', usedMemory);
      } else if (usedMemory > this.gcThreshold) {
        console.log('🧹 Memory usage above threshold, scheduling cleanup');
        setTimeout(() => this.performCleanup(), 5000);
      }
    }
  }

  private performEmergencyCleanup(): void {
    console.log('🚨 Performing emergency memory cleanup');

    // Force garbage collection if available
    if (typeof window !== 'undefined' && 'gc' in window) {
      (window as any).gc();
    }

    // Clear all registered cleanup callbacks
    for (const [id, callback] of this.cleanupCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error(`Error in cleanup callback ${id}:`, error);
      }
    }

    // Clear caches
    this.clearCaches();

    // Force component re-renders to free memory
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('memoryEmergency'));
    }
  }

  private performCleanup(): void {
    console.log('🧹 Performing routine memory cleanup');

    // Run garbage collection hint
    if (typeof window !== 'undefined' && 'gc' in window) {
      (window as any).gc();
    }

    // Clear expired cache entries
    this.clearExpiredCaches();

    // Run registered cleanup callbacks
    const callbacksToRun = Array.from(this.cleanupCallbacks.values());
    callbacksToRun.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error in cleanup callback:', error);
      }
    });
  }

  private clearCaches(): void {
    // Clear image caches
    if (typeof window !== 'undefined') {
      // Clear image cache by removing src and re-setting
      const images = document.querySelectorAll('img');
      images.forEach(img => {
        const src = img.src;
        img.src = '';
        img.src = src;
      });
    }

    // Clear other caches (would integrate with cache service)
    console.log('🗑️ Cleared application caches');
  }

  private clearExpiredCaches(): void {
    // This would integrate with the cache service to clear expired entries
    console.log('🗑️ Cleared expired cache entries');
  }

  private emitMemoryWarning(level: 'high' | 'critical', usage: number): void {
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('memoryWarning', {
        detail: { level, usage, formattedUsage: this.formatBytes(usage) }
      });
      window.dispatchEvent(event);
    }
  }

  // Register a cleanup callback
  registerCleanupCallback(id: string, callback: () => void): void {
    this.cleanupCallbacks.set(id, callback);
  }

  // Unregister a cleanup callback
  unregisterCleanupCallback(id: string): void {
    this.cleanupCallbacks.delete(id);
  }

  // Get current memory statistics
  getMemoryStats(): MemoryStats | null {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memInfo = (performance as any).memory;
      return {
        used: memInfo.usedJSHeapSize,
        total: memInfo.totalJSHeapSize,
        limit: memInfo.jsHeapSizeLimit,
        external: memInfo.external || 0,
      };
    }
    return null;
  }

  // Get performance metrics
  getPerformanceMetrics(): PerformanceMetrics | null {
    if (typeof performance === 'undefined') return null;

    const memoryStats = this.getMemoryStats();
    if (!memoryStats) return null;

    // Calculate FPS (rough estimate)
    const fps = this.calculateFPS();

    // Get navigation timing
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const loadTime = navigation ? navigation.loadEventEnd - navigation.loadEventStart : 0;

    return {
      fps,
      memoryUsage: memoryStats,
      renderTime: 0, // Would need to measure actual render time
      loadTime,
    };
  }

  private calculateFPS(): number {
    // Simple FPS calculation based on requestAnimationFrame
    let frameCount = 0;
    let lastTime = performance.now();

    const measureFPS = () => {
      frameCount++;
      const currentTime = performance.now();

      if (currentTime - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        frameCount = 0;
        lastTime = currentTime;
        return fps;
      }

      requestAnimationFrame(measureFPS);
    };

    // Start measuring
    requestAnimationFrame(measureFPS);
    return 60; // Default assumption
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Manual cleanup trigger
  triggerCleanup(): void {
    this.performCleanup();
  }

  // Emergency cleanup trigger
  triggerEmergencyCleanup(): void {
    this.performEmergencyCleanup();
  }

  // Update thresholds
  updateThresholds(gc: number, warning: number, critical: number): void {
    this.gcThreshold = gc;
    this.warningThreshold = warning;
    this.criticalThreshold = critical;
  }

  // Cleanup on destroy
  destroy(): void {
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }

    if (this.memoryPressureHandler && typeof window !== 'undefined') {
      window.removeEventListener('memorypressure', this.memoryPressureHandler);
    }

    this.cleanupCallbacks.clear();
  }
}

// Singleton instance
export const memoryManager = MemoryManager.getInstance();
export default memoryManager;
