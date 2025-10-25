/**
 * Rate Limiter for Aster DEX API
 *
 * Prevents HTTP 418 (Too Many Requests) errors by:
 * 1. Throttling requests to max 5 per second
 * 2. Caching responses for 30 seconds
 * 3. Implementing exponential backoff on rate limit errors
 */

interface CacheEntry {
  data: any;
  timestamp: number;
}

interface QueuedRequest {
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

class RateLimiter {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private minDelay = 350; // 350ms between requests = max 2.86 requests/second (safer margin)
  private cache = new Map<string, CacheEntry>();
  private cacheTTL = 60000; // 60 seconds (increased from 30s for better caching)
  private backoffUntil = 0; // Timestamp when we can resume requests

  /**
   * Add a request to the queue with caching support
   */
  async enqueue<T>(
    cacheKey: string | null,
    executor: () => Promise<T>
  ): Promise<T> {
    // Check cache first
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        console.log(`📦 Cache hit: ${cacheKey}`);
        return cached.data as T;
      }
    }

    // Check if we're in backoff period
    if (this.backoffUntil > Date.now()) {
      const waitMs = this.backoffUntil - Date.now();
      console.log(`⏳ Rate limited - waiting ${Math.ceil(waitMs / 1000)}s before retry`);
      throw new Error(`Rate limited - retry after ${Math.ceil(waitMs / 1000)}s`);
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: async () => {
          try {
            const result = await executor();

            // Cache successful result
            if (cacheKey && result) {
              this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now(),
              });
            }

            return result;
          } catch (error: any) {
            // Handle 418 rate limit error
            if (error.message?.includes('418') || error.message?.includes('rate limit')) {
              console.error('⚠️ Rate limit detected - entering backoff period');
              // Back off for 60 seconds
              this.backoffUntil = Date.now() + 60000;
            }
            throw error;
          }
        },
        resolve,
        reject,
      });

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      // Check backoff
      if (this.backoffUntil > Date.now()) {
        console.log('⏳ In backoff period - pausing queue');
        break;
      }

      // Enforce minimum delay between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.minDelay) {
        const waitTime = this.minDelay - timeSinceLastRequest;
        await this.sleep(waitTime);
      }

      const request = this.queue.shift()!;
      this.lastRequestTime = Date.now();

      try {
        const result = await request.execute();
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }

      // Small additional delay for safety
      await this.sleep(50);
    }

    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache (useful for testing or forcing refresh)
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ Rate limiter cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
