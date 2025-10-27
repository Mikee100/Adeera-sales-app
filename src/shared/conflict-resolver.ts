interface ConflictData {
  localData: any;
  serverData: any;
  conflictType: 'version' | 'data' | 'deletion';
  entityType: string;
  entityId: string;
  timestamp: number;
}

interface ConflictResolution {
  strategy: 'local' | 'server' | 'merge' | 'manual';
  resolvedData?: any;
  requiresManualReview: boolean;
  reason: string;
}

class ConflictResolver {
  private static instance: ConflictResolver;
  private conflictQueue: ConflictData[] = [];
  private resolutionStrategies: Map<string, (conflict: ConflictData) => ConflictResolution> = new Map();

  private constructor() {
    this.setupDefaultStrategies();
  }

  static getInstance(): ConflictResolver {
    if (!ConflictResolver.instance) {
      ConflictResolver.instance = new ConflictResolver();
    }
    return ConflictResolver.instance;
  }

  private setupDefaultStrategies(): void {
    // Sales conflict resolution
    this.resolutionStrategies.set('sale', (conflict: ConflictData) => {
      // For sales, server data takes precedence unless it's a deletion conflict
      if (conflict.conflictType === 'deletion') {
        return {
          strategy: 'manual',
          requiresManualReview: true,
          reason: 'Sale deletion conflicts require manual review'
        };
      }

      // Check if local sale is more recent
      const localTimestamp = conflict.localData.updatedAt || conflict.localData.createdAt;
      const serverTimestamp = conflict.serverData.updatedAt || conflict.serverData.createdAt;

      if (localTimestamp > serverTimestamp) {
        return {
          strategy: 'local',
          resolvedData: conflict.localData,
          requiresManualReview: false,
          reason: 'Local sale data is more recent'
        };
      }

      return {
        strategy: 'server',
        resolvedData: conflict.serverData,
        requiresManualReview: false,
        reason: 'Server data takes precedence for sales'
      };
    });

    // Product conflict resolution
    this.resolutionStrategies.set('product', (conflict: ConflictData) => {
      // For products, merge strategy is preferred
      const merged = this.mergeProductData(conflict.localData, conflict.serverData);

      if (merged.hasConflicts) {
        return {
          strategy: 'manual',
          requiresManualReview: true,
          reason: 'Product data has conflicting changes that require manual review'
        };
      }

      return {
        strategy: 'merge',
        resolvedData: merged.data,
        requiresManualReview: false,
        reason: 'Product data merged successfully'
      };
    });

    // Inventory conflict resolution
    this.resolutionStrategies.set('inventory', (conflict: ConflictData) => {
      // For inventory, server data takes precedence
      return {
        strategy: 'server',
        resolvedData: conflict.serverData,
        requiresManualReview: false,
        reason: 'Inventory data should always use server values'
      };
    });
  }

  // Add a conflict to the queue
  addConflict(conflict: ConflictData): void {
    this.conflictQueue.push(conflict);
    console.log(`⚠️ Conflict added to queue: ${conflict.entityType}:${conflict.entityId} (${conflict.conflictType})`);
  }

  // Resolve a specific conflict
  resolveConflict(conflict: ConflictData): ConflictResolution {
    const strategy = this.resolutionStrategies.get(conflict.entityType);

    if (strategy) {
      return strategy(conflict);
    }

    // Default strategy: manual review
    return {
      strategy: 'manual',
      requiresManualReview: true,
      reason: `No resolution strategy defined for ${conflict.entityType}`
    };
  }

  // Process all conflicts in queue
  async processConflicts(): Promise<{
    resolved: ConflictResolution[];
    manualReview: ConflictData[];
    errors: string[];
  }> {
    const resolved: ConflictResolution[] = [];
    const manualReview: ConflictData[] = [];
    const errors: string[] = [];

    console.log(`🔄 Processing ${this.conflictQueue.length} conflicts`);

    for (const conflict of this.conflictQueue) {
      try {
        const resolution = this.resolveConflict(conflict);

        if (resolution.requiresManualReview) {
          manualReview.push(conflict);
        } else {
          resolved.push(resolution);
        }
      } catch (error: any) {
        errors.push(`Failed to resolve conflict ${conflict.entityId}: ${error.message}`);
      }
    }

    // Clear processed conflicts
    this.conflictQueue = manualReview;

    console.log(`✅ Conflict resolution complete: ${resolved.length} resolved, ${manualReview.length} need manual review`);

    return { resolved, manualReview, errors };
  }

  // Manually resolve a conflict
  manualResolve(conflictId: string, resolution: ConflictResolution): boolean {
    const index = this.conflictQueue.findIndex(c => `${c.entityType}:${c.entityId}` === conflictId);

    if (index !== -1) {
      this.conflictQueue.splice(index, 1);
      console.log(`✅ Manually resolved conflict: ${conflictId}`);
      return true;
    }

    return false;
  }

  // Get all pending conflicts
  getPendingConflicts(): ConflictData[] {
    return [...this.conflictQueue];
  }

  // Get conflicts by type
  getConflictsByType(entityType: string): ConflictData[] {
    return this.conflictQueue.filter(c => c.entityType === entityType);
  }

  // Register custom resolution strategy
  registerStrategy(entityType: string, strategy: (conflict: ConflictData) => ConflictResolution): void {
    this.resolutionStrategies.set(entityType, strategy);
    console.log(`📝 Registered custom conflict resolution strategy for ${entityType}`);
  }

  // Merge product data intelligently
  private mergeProductData(local: any, server: any): { data: any; hasConflicts: boolean } {
    const merged = { ...server }; // Start with server data
    let hasConflicts = false;

    // Merge fields that can be safely combined
    const mergeableFields = ['name', 'description', 'cost'];

    for (const field of mergeableFields) {
      if (local[field] && server[field] && local[field] !== server[field]) {
        // If both have different values, mark as conflict
        hasConflicts = true;
        // Keep server value but log the conflict
        console.warn(`⚠️ Product ${local.id} has conflicting ${field}: local="${local[field]}", server="${server[field]}"`);
      } else if (local[field] && !server[field]) {
        // Use local value if server doesn't have it
        merged[field] = local[field];
      }
    }

    // For stock, use the most recent update
    const localStockTime = local.stockUpdatedAt || local.updatedAt || 0;
    const serverStockTime = server.stockUpdatedAt || server.updatedAt || 0;

    if (localStockTime > serverStockTime) {
      merged.stock = local.stock;
      merged.stockUpdatedAt = localStockTime;
    }

    // For price, prefer server unless local is explicitly marked as pending approval
    if (local.price !== server.price) {
      if (local.pricePendingApproval) {
        merged.price = server.price;
        merged.pricePendingApproval = local.price;
      } else {
        hasConflicts = true;
      }
    }

    return { data: merged, hasConflicts };
  }

  // Detect conflicts between local and server data
  detectConflicts(localData: any, serverData: any, entityType: string, entityId: string): ConflictData | null {
    // Check for version conflicts
    if (localData.version && serverData.version && localData.version !== serverData.version) {
      return {
        localData,
        serverData,
        conflictType: 'version',
        entityType,
        entityId,
        timestamp: Date.now(),
      };
    }

    // Check for data conflicts (simplified - would need more sophisticated logic)
    const localHash = this.simpleHash(JSON.stringify(localData));
    const serverHash = this.simpleHash(JSON.stringify(serverData));

    if (localHash !== serverHash) {
      return {
        localData,
        serverData,
        conflictType: 'data',
        entityType,
        entityId,
        timestamp: Date.now(),
      };
    }

    // Check for deletion conflicts
    if (localData.deleted && !serverData.deleted) {
      return {
        localData,
        serverData,
        conflictType: 'deletion',
        entityType,
        entityId,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  // Simple hash function for change detection
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  // Get conflict statistics
  getStats() {
    const stats = {
      total: this.conflictQueue.length,
      byType: {} as Record<string, number>,
      byConflictType: {} as Record<string, number>,
    };

    for (const conflict of this.conflictQueue) {
      stats.byType[conflict.entityType] = (stats.byType[conflict.entityType] || 0) + 1;
      stats.byConflictType[conflict.conflictType] = (stats.byConflictType[conflict.conflictType] || 0) + 1;
    }

    return stats;
  }

  // Clear all conflicts (use with caution)
  clearConflicts(): void {
    const count = this.conflictQueue.length;
    this.conflictQueue = [];
    console.log(`🗑️ Cleared ${count} conflicts`);
  }
}

// Singleton instance
export const conflictResolver = ConflictResolver.getInstance();
export default conflictResolver;
