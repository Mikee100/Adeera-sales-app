import { EventEmitter } from 'events';

interface SyncConfig {
  enabled: boolean;
  interval: number; // milliseconds
  retryAttempts: number;
  retryDelay: number; // milliseconds
  batchSize: number;
  autoSync: boolean;
  backgroundSync: boolean;
}

interface SyncJob {
  id: string;
  type: 'full' | 'incremental' | 'selective';
  priority: 'low' | 'normal' | 'high' | 'critical';
  data?: any;
  createdAt: number;
  executeAt: number;
  retries: number;
  maxRetries: number;
}

class BackgroundSyncScheduler extends EventEmitter {
  private config: SyncConfig;
  private jobs: Map<string, SyncJob> = new Map();
  private activeJobs: Set<string> = new Set();
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config: Partial<SyncConfig> = {}) {
    super();

    this.config = {
      enabled: true,
      interval: 5 * 60 * 1000, // 5 minutes
      retryAttempts: 3,
      retryDelay: 30 * 1000, // 30 seconds
      batchSize: 10,
      autoSync: true,
      backgroundSync: true,
      ...config,
    };

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle app lifecycle events
    process.on('beforeExit', () => this.stop());
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  start(): void {
    if (this.isRunning || !this.config.enabled) return;

    console.log('🔄 Starting background sync scheduler');
    this.isRunning = true;

    if (this.config.autoSync) {
      this.intervalId = setInterval(() => {
        this.processJobs();
      }, this.config.interval);
    }

    this.emit('started');
  }

  stop(): void {
    if (!this.isRunning) return;

    console.log('🛑 Stopping background sync scheduler');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.emit('stopped');
  }

  // Schedule a sync job
  scheduleSync(
    type: SyncJob['type'] = 'incremental',
    priority: SyncJob['priority'] = 'normal',
    data?: any,
    delay: number = 0
  ): string {
    const jobId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const job: SyncJob = {
      id: jobId,
      type,
      priority,
      data,
      createdAt: Date.now(),
      executeAt: Date.now() + delay,
      retries: 0,
      maxRetries: this.config.retryAttempts,
    };

    this.jobs.set(jobId, job);
    console.log(`📅 Scheduled ${type} sync job: ${jobId} (priority: ${priority})`);

    this.emit('jobScheduled', job);

    // Process immediately if high priority or no delay
    if (priority === 'high' || priority === 'critical' || delay === 0) {
      setTimeout(() => this.processJob(job), 100);
    }

    return jobId;
  }

  // Cancel a scheduled job
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job && !this.activeJobs.has(jobId)) {
      this.jobs.delete(jobId);
      console.log(`❌ Cancelled sync job: ${jobId}`);
      this.emit('jobCancelled', job);
      return true;
    }
    return false;
  }

  // Get job status
  getJobStatus(jobId: string): SyncJob | null {
    return this.jobs.get(jobId) || null;
  }

  // Get all jobs
  getAllJobs(): SyncJob[] {
    return Array.from(this.jobs.values());
  }

  // Get active jobs
  getActiveJobs(): string[] {
    return Array.from(this.activeJobs);
  }

  // Force immediate sync
  async forceSync(type: SyncJob['type'] = 'full'): Promise<void> {
    console.log(`⚡ Forcing immediate ${type} sync`);
    const jobId = this.scheduleSync(type, 'critical', null, 0);

    return new Promise((resolve, reject) => {
      const onComplete = (completedJob: SyncJob) => {
        if (completedJob.id === jobId) {
          this.removeListener('jobCompleted', onComplete);
          this.removeListener('jobFailed', onFailed);
          resolve();
        }
      };

      const onFailed = (failedJob: SyncJob) => {
        if (failedJob.id === jobId) {
          this.removeListener('jobCompleted', onComplete);
          this.removeListener('jobFailed', onFailed);
          reject(new Error(`Sync job ${jobId} failed`));
        }
      };

      this.on('jobCompleted', onComplete);
      this.on('jobFailed', onFailed);
    });
  }

  private async processJobs(): Promise<void> {
    if (!this.isRunning || this.activeJobs.size >= this.config.batchSize) return;

    const now = Date.now();
    const pendingJobs = Array.from(this.jobs.values())
      .filter(job => !this.activeJobs.has(job.id) && job.executeAt <= now)
      .sort((a, b) => {
        // Sort by priority first, then by creation time
        const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return priorityDiff !== 0 ? priorityDiff : a.createdAt - b.createdAt;
      });

    const jobsToProcess = pendingJobs.slice(0, this.config.batchSize - this.activeJobs.size);

    for (const job of jobsToProcess) {
      this.processJob(job);
    }
  }

  private async processJob(job: SyncJob): Promise<void> {
    if (this.activeJobs.has(job.id)) return;

    this.activeJobs.add(job.id);
    console.log(`🚀 Processing sync job: ${job.id} (${job.type})`);

    try {
      const result = await this.executeSyncJob(job);
      job.retries = 0; // Reset retries on success

      console.log(`✅ Sync job completed: ${job.id}`);
      this.emit('jobCompleted', job, result);

      // Clean up completed job
      this.jobs.delete(job.id);

    } catch (error: any) {
      console.error(`❌ Sync job failed: ${job.id}`, error.message);

      job.retries++;

      if (job.retries < job.maxRetries) {
        // Schedule retry with exponential backoff
        const retryDelay = this.config.retryDelay * Math.pow(2, job.retries - 1);
        job.executeAt = Date.now() + retryDelay;
        console.log(`🔄 Retrying sync job ${job.id} in ${retryDelay}ms (attempt ${job.retries}/${job.maxRetries})`);
      } else {
        console.error(`💀 Sync job permanently failed: ${job.id}`);
        this.emit('jobFailed', job, error);
        this.jobs.delete(job.id);
      }
    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  private async executeSyncJob(job: SyncJob): Promise<any> {
    // This would integrate with the actual sync logic
    // For now, we'll simulate different sync operations

    switch (job.type) {
      case 'full':
        return await this.performFullSync(job.data);
      case 'incremental':
        return await this.performIncrementalSync(job.data);
      case 'selective':
        return await this.performSelectiveSync(job.data);
      default:
        throw new Error(`Unknown sync type: ${job.type}`);
    }
  }

  private async performFullSync(data?: any): Promise<any> {
    // Simulate full sync operation
    console.log('🔄 Performing full sync...');

    // Call the actual sync function from main process
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      return await (window as any).electronAPI.syncOfflineSales();
    }

    // Fallback for main process
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
    return { syncedCount: Math.floor(Math.random() * 50), type: 'full' };
  }

  private async performIncrementalSync(data?: any): Promise<any> {
    // Simulate incremental sync
    console.log('🔄 Performing incremental sync...');

    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      return await (window as any).electronAPI.syncOfflineSales();
    }

    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate work
    return { syncedCount: Math.floor(Math.random() * 20), type: 'incremental' };
  }

  private async performSelectiveSync(data?: any): Promise<any> {
    // Simulate selective sync based on provided criteria
    console.log('🔄 Performing selective sync...', data);

    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      // This would need a new IPC handler for selective sync
      return await (window as any).electronAPI.syncOfflineSales();
    }

    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate work
    return { syncedCount: Math.floor(Math.random() * 10), type: 'selective', criteria: data };
  }

  // Update configuration
  updateConfig(newConfig: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...newConfig };

    if (this.config.enabled && !this.isRunning) {
      this.start();
    } else if (!this.config.enabled && this.isRunning) {
      this.stop();
    }

    console.log('⚙️ Sync scheduler config updated:', this.config);
  }

  // Get current configuration
  getConfig(): SyncConfig {
    return { ...this.config };
  }

  // Get scheduler statistics
  getStats() {
    return {
      isRunning: this.isRunning,
      totalJobs: this.jobs.size,
      activeJobs: this.activeJobs.size,
      config: this.config,
    };
  }
}

// Singleton instance
export const syncScheduler = new BackgroundSyncScheduler();
export default syncScheduler;
