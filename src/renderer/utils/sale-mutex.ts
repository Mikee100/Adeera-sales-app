/**
 * Mutex/Lock utility for sale processing
 * Prevents concurrent sale processing to avoid stock overselling and duplicate transactions
 */

interface QueuedSale {
  paymentData: any;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

class SaleMutex {
  private isProcessing: boolean = false;
  private queue: QueuedSale[] = [];
  private maxQueueSize: number = 10; // Maximum number of queued sales

  /**
   * Acquire the mutex and process the sale
   * If a sale is already processing, queue this sale
   */
  async acquire<T>(
    paymentData: any,
    saleProcessor: (paymentData: any) => Promise<T>
  ): Promise<T> {
    // If mutex is free, acquire it immediately
    if (!this.isProcessing) {
      return this.processSale(paymentData, saleProcessor);
    }

    // Otherwise, queue the sale
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(
        `Sale queue is full (${this.maxQueueSize} sales). Please wait for current sale to complete.`
      );
    }

    // Queue the sale
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        paymentData,
        resolve,
        reject,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Process a sale while holding the mutex
   */
  private async processSale<T>(
    paymentData: any,
    saleProcessor: (paymentData: any) => Promise<T>
  ): Promise<T> {
    this.isProcessing = true;

    try {
      const result = await saleProcessor(paymentData);
      return result;
    } finally {
      // Release mutex
      this.isProcessing = false;

      // Process next queued sale if any
      if (this.queue.length > 0) {
        const nextSale = this.queue.shift()!;
        // Process next sale asynchronously (don't await to avoid blocking)
        this.processSale(nextSale.paymentData, saleProcessor)
          .then(nextSale.resolve)
          .catch(nextSale.reject);
      }
    }
  }

  /**
   * Check if a sale is currently being processed
   */
  isLocked(): boolean {
    return this.isProcessing;
  }

  /**
   * Get the number of queued sales
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue (useful for error recovery)
   */
  clearQueue(): void {
    // Reject all queued sales
    this.queue.forEach((sale) => {
      sale.reject(
        new Error('Sale queue was cleared. Please try again.')
      );
    });
    this.queue = [];
  }

  /**
   * Get queue status
   */
  getStatus(): {
    isProcessing: boolean;
    queueSize: number;
    maxQueueSize: number;
  } {
    return {
      isProcessing: this.isProcessing,
      queueSize: this.queue.length,
      maxQueueSize: this.maxQueueSize,
    };
  }
}

// Singleton instance
export const saleMutex = new SaleMutex();
