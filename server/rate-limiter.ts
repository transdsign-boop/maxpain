/**
 * Rate Limiter for Aster DEX API
 *
 * Prevents HTTP 418 (Too Many Requests) errors by:
 * 1. Throttling requests to max 5 per second
 * 2. Caching responses for 30 seconds
 * 3. Implementing exponential backoff on rate limit errors
 */

import { wsBroadcaster } from './websocket-broadcaster';

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
  private minDelay = 500; // 500ms between requests = max 2 requests/second (conservative to prevent 429)
  private cache = new Map<string, CacheEntry>();
  private cacheTTL = 30000; // 30 seconds
  private backoffUntil = 0; // Timestamp when we can resume requests
  private consecutiveErrors = 0; // Track consecutive rate limit errors

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
      const waitSec = Math.ceil(waitMs / 1000);
      console.log(`⏳ Rate limited - waiting ${waitSec}s before retry`);

      // Broadcast warning to connected clients
      wsBroadcaster.broadcastApiWarning(`Rate limited - ${waitSec}s backoff remaining`, {
        backoffUntil: this.backoffUntil,
        remainingSeconds: waitSec
      });

      throw new Error(`Rate limited - retry after ${waitSec}s`);
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
            // Handle 418/429 rate limit errors
            if (error.message?.includes('418') || error.message?.includes('429') || error.message?.includes('rate limit')) {
              this.consecutiveErrors++;
              const backoffSeconds = Math.min(60, 10 * this.consecutiveErrors); // Exponential backoff, max 60s
              this.backoffUntil = Date.now() + (backoffSeconds * 1000);

              console.error(`⚠️ Rate limit detected (${this.consecutiveErrors} consecutive) - entering ${backoffSeconds}s backoff`);

              // Broadcast rate limit error to connected clients
              wsBroadcaster.broadcastApiError(`Rate limit detected - entering ${backoffSeconds}s backoff`, {
                backoffUntil: this.backoffUntil,
                error: error.message,
                consecutiveErrors: this.consecutiveErrors
              });
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
        this.consecutiveErrors = 0; // Reset on success
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }

      // Small additional delay for safety
      await this.sleep(100);
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

  /**
   * Rate-limited fetch wrapper
   * Note: Response objects are NOT cached because their bodies can only be read once.
   * This method only provides rate limiting/throttling.
   */
  async fetch(url: string, options?: RequestInit): Promise<Response> {
    return this.enqueue(
      null, // Don't cache Response objects - they can't be reused
      async () => {
        const response = await fetch(url, options);

        // Check for rate limit errors
        if (response.status === 429 || response.status === 418) {
          const errorText = await response.text();
          throw new Error(`${response.status} rate limit: ${errorText}`);
        }

        return response;
      }
    );
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Export a standalone function for easier dynamic importing
export async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
  return rateLimiter.fetch(url, options);
}
