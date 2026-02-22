/**
 * Rate limiting utility to prevent DoS attacks and API spam
 * Tracks requests per endpoint and enforces throttling
 */

interface RequestRecord {
  timestamp: number;
  endpoint: string;
}

class RateLimiter {
  private requestHistory: RequestRecord[] = [];
  private readonly maxRequests: number;
  private readonly timeWindow: number; // in milliseconds
  private readonly cleanupInterval: number = 60000; // Clean up old records every minute

  constructor(maxRequests: number = 30, timeWindowMs: number = 60000) {
    this.maxRequests = maxRequests; // Default: 30 requests per minute
    this.timeWindow = timeWindowMs;
    
    // Clean up old records periodically
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  /**
   * Check if a request is allowed based on rate limits
   */
  isAllowed(endpoint: string): { allowed: boolean; waitTime?: number } {
    const now = Date.now();
    const windowStart = now - this.timeWindow;

    // Clean up old requests outside the time window
    this.requestHistory = this.requestHistory.filter(
      (record) => record.timestamp > windowStart
    );

    // Count requests for this endpoint in the current window
    const endpointRequests = this.requestHistory.filter(
      (record) => record.endpoint === endpoint && record.timestamp > windowStart
    ).length;

    if (endpointRequests >= this.maxRequests) {
      // Calculate wait time until oldest request expires
      const oldestRequest = this.requestHistory
        .filter((record) => record.endpoint === endpoint)
        .sort((a, b) => a.timestamp - b.timestamp)[0];

      if (oldestRequest) {
        const waitTime = oldestRequest.timestamp + this.timeWindow - now;
        return { allowed: false, waitTime: Math.max(0, waitTime) };
      }

      return { allowed: false, waitTime: this.timeWindow };
    }

    return { allowed: true };
  }

  /**
   * Record a request
   */
  recordRequest(endpoint: string): void {
    this.requestHistory.push({
      timestamp: Date.now(),
      endpoint,
    });
  }

  /**
   * Wait if rate limit is exceeded
   */
  async waitIfNeeded(endpoint: string): Promise<void> {
    const check = this.isAllowed(endpoint);
    
    if (!check.allowed && check.waitTime) {
      const waitTime = Math.min(check.waitTime, 5000); // Cap wait at 5 seconds
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Clean up old request records
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.timeWindow * 2; // Keep records for 2x time window
    this.requestHistory = this.requestHistory.filter(
      (record) => record.timestamp > cutoff
    );
  }

  /**
   * Get current request count for an endpoint
   */
  getRequestCount(endpoint: string): number {
    const now = Date.now();
    const windowStart = now - this.timeWindow;
    return this.requestHistory.filter(
      (record) => record.endpoint === endpoint && record.timestamp > windowStart
    ).length;
  }

  /**
   * Reset rate limiter (useful for testing or manual reset)
   */
  reset(): void {
    this.requestHistory = [];
  }
}

// Create singleton instances for different rate limit configurations
export const apiRateLimiter = new RateLimiter(30, 60000); // 30 requests per minute
export const authRateLimiter = new RateLimiter(5, 60000); // 5 auth requests per minute (stricter)
export const syncRateLimiter = new RateLimiter(10, 60000); // 10 sync requests per minute

/**
 * Extract endpoint from URL for rate limiting
 */
export function extractEndpoint(url: string): string {
  try {
    const urlObj = new URL(url);
    // Use pathname as endpoint identifier (e.g., /sales, /products, /auth/login)
    return urlObj.pathname;
  } catch {
    // If URL parsing fails, use the full URL
    return url;
  }
}

/**
 * Rate-limited fetch wrapper
 */
export async function rateLimitedFetch(
  url: string,
  options: RequestInit = {},
  limiter: RateLimiter = apiRateLimiter
): Promise<Response> {
  const endpoint = extractEndpoint(url);

  // Wait if rate limit is exceeded
  await limiter.waitIfNeeded(endpoint);

  // Record the request
  limiter.recordRequest(endpoint);

  // Make the actual request
  return fetch(url, options);
}

/**
 * Rate-limited axios wrapper (for main process)
 */
export async function rateLimitedAxios(
  axiosCall: () => Promise<any>,
  endpoint: string,
  limiter: RateLimiter = apiRateLimiter
): Promise<any> {
  // Wait if rate limit is exceeded
  await limiter.waitIfNeeded(endpoint);

  // Record the request
  limiter.recordRequest(endpoint);

  // Make the actual request
  return axiosCall();
}
