/**
 * Rate limit aware HTTP client with exponential backoff
 * Handles 418, 429, and 5xx errors gracefully
 */

interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterFactor?: number;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000, // Start with 1 second
  maxDelayMs: 30000, // Cap at 30 seconds
  jitterFactor: 0.3 // 30% jitter to avoid thundering herd
};

/**
 * Sleep with jittered exponential backoff
 */
function calculateDelay(attemptNumber: number, config: Required<RetryConfig>): number {
  // Exponential: 2^attemptNumber * baseDelay
  const exponentialDelay = Math.pow(2, attemptNumber) * config.baseDelayMs;
  
  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  
  // Add jitter: random value between (1-jitter) and (1+jitter)
  const jitterMultiplier = 1 + (Math.random() * 2 - 1) * config.jitterFactor;
  
  return Math.floor(cappedDelay * jitterMultiplier);
}

/**
 * Determine if error is retryable
 */
function isRetryableError(status: number): boolean {
  // Rate limit errors (418, 429) and server errors (500+)
  return status === 418 || status === 429 || status >= 500;
}

/**
 * Parse retry-after header if present
 */
function getRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;
  
  // Try parsing as seconds
  const seconds = parseInt(retryAfter);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }
  
  // Try parsing as date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  
  return null;
}

/**
 * Execute fetch with exponential backoff on rate limit errors
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = {}
): Promise<Response> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      // Success - return immediately
      if (response.ok) {
        if (attempt > 0) {
          console.log(`✅ Request succeeded after ${attempt} retries`);
        }
        return response;
      }
      
      // Check if error is retryable
      if (!isRetryableError(response.status)) {
        // Non-retryable error (4xx except 418/429) - return immediately
        return response;
      }
      
      // Rate limit or server error - retry with backoff
      const errorText = await response.text();
      console.warn(`⚠️ Rate limit/server error (attempt ${attempt + 1}/${fullConfig.maxRetries + 1}): ${response.status} ${errorText}`);
      
      // Don't retry if this was our last attempt
      if (attempt === fullConfig.maxRetries) {
        console.error(`❌ Max retries (${fullConfig.maxRetries}) exceeded`);
        return new Response(errorText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
      
      // Calculate delay with backoff
      const retryAfterMs = getRetryAfterMs(response);
      const backoffDelay = calculateDelay(attempt, fullConfig);
      const delayMs = retryAfterMs || backoffDelay;
      
      console.log(`⏳ Retrying in ${(delayMs / 1000).toFixed(1)}s... (${retryAfterMs ? 'from Retry-After header' : 'exponential backoff'})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`❌ Network error (attempt ${attempt + 1}/${fullConfig.maxRetries + 1}):`, lastError.message);
      
      // Don't retry if this was our last attempt
      if (attempt === fullConfig.maxRetries) {
        throw lastError;
      }
      
      // Retry with backoff
      const delayMs = calculateDelay(attempt, fullConfig);
      console.log(`⏳ Retrying in ${(delayMs / 1000).toFixed(1)}s...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // Should never reach here, but TypeScript needs a return
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Track and report API usage metrics
 */
class RateLimitMonitor {
  private requestCounts = new Map<string, number>();
  private windowStartTime = Date.now();
  private readonly windowMs = 60000; // 1 minute window
  
  logRequest(endpoint: string): void {
    const now = Date.now();
    
    // Reset window if needed
    if (now - this.windowStartTime >= this.windowMs) {
      this.requestCounts.clear();
      this.windowStartTime = now;
    }
    
    const count = (this.requestCounts.get(endpoint) || 0) + 1;
    this.requestCounts.set(endpoint, count);
  }
  
  getStats(): Record<string, number> {
    return Object.fromEntries(this.requestCounts);
  }
  
  getTotalRequests(): number {
    return Array.from(this.requestCounts.values()).reduce((sum, count) => sum + count, 0);
  }
}

export const rateLimitMonitor = new RateLimitMonitor();
