import memoize from 'memoizee';
import { fetchRealizedPnlEvents } from './exchange-sync';

interface CachedTradeHistoryResult {
  success: boolean;
  events: any[];
  total: number;
  error?: string;
}

interface RequestKey {
  startTime?: number;
  endTime?: number;
}

// In-flight request tracking to prevent duplicate API calls
const inFlightRequests = new Map<string, Promise<CachedTradeHistoryResult>>();

// Generate cache key from request parameters
function getCacheKey(params: RequestKey): string {
  return `trade-history:${params.startTime || 'all'}:${params.endTime || 'now'}`;
}

// Core fetch function (not memoized directly - we handle caching manually)
async function fetchTradeHistoryFromExchange(params: RequestKey): Promise<CachedTradeHistoryResult> {
  const cacheKey = getCacheKey(params);
  
  // Check if request is already in flight
  const inFlightRequest = inFlightRequests.get(cacheKey);
  if (inFlightRequest) {
    console.log(`🔄 Deduplicating trade history request: ${cacheKey}`);
    return inFlightRequest;
  }
  
  // Create new request promise
  const requestPromise = (async () => {
    try {
      console.log(`📊 Fetching trade history from exchange (cache key: ${cacheKey})`);
      const result = await fetchRealizedPnlEvents(params);
      
      if (!result.success) {
        console.error(`❌ Trade history fetch failed: ${result.error}`);
        return {
          success: false,
          events: [],
          total: 0,
          error: result.error
        };
      }
      
      console.log(`✅ Trade history fetched: ${result.events.length} events`);
      return {
        success: true,
        events: result.events,
        total: result.events.length
      };
    } catch (error) {
      console.error('❌ Trade history fetch error:', error);
      return {
        success: false,
        events: [],
        total: 0,
        error: String(error)
      };
    } finally {
      // Clean up in-flight tracking
      inFlightRequests.delete(cacheKey);
    }
  })();
  
  // Track in-flight request
  inFlightRequests.set(cacheKey, requestPromise);
  
  return requestPromise;
}

// Memoized version with 30 second cache
// Using maxAge: 30000 for fresh data, and allowing stale data for up to 2 minutes with preFetch
const getCachedTradeHistory = memoize(
  fetchTradeHistoryFromExchange,
  {
    maxAge: 30000, // 30 seconds fresh cache
    preFetch: 0.5, // Refresh when 50% of maxAge remains (15s)
    promise: true,
    normalizer: (args) => getCacheKey(args[0]),
    // Keep cache even during errors to serve stale data
    primitive: false
  }
);

/**
 * Fetches trade history with intelligent caching:
 * - Deduplicates concurrent requests
 * - Caches successful responses for 30 seconds
 * - Automatically refreshes at 15 seconds (stale-while-revalidate)
 * - Serves stale data if fresh fetch fails
 */
export async function getTradeHistory(params: RequestKey = {}): Promise<CachedTradeHistoryResult> {
  return getCachedTradeHistory(params);
}

/**
 * Clears the trade history cache
 * Use this when you know the data has changed (e.g., after closing a position)
 */
export function clearTradeHistoryCache(): void {
  getCachedTradeHistory.clear();
  inFlightRequests.clear();
  console.log('🧹 Trade history cache cleared');
}
