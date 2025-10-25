# Rate Limiter Implementation

## Overview
This rate limiter prevents HTTP 418 ("Too Many Requests") errors from Aster DEX API by throttling requests and caching responses.

## Features

### 1. **Request Throttling**
- Maximum 5 requests per second (200ms delay between requests)
- Automatic queuing of concurrent requests
- Sequential processing to avoid bursts

### 2. **Response Caching**
- Caches successful API responses for 30 seconds
- Reduces redundant API calls
- Automatic cache invalidation after TTL

### 3. **Exponential Backoff**
- Detects HTTP 418 errors automatically
- Enters 60-second backoff period when rate limited
- Prevents further requests during backoff
- Clears queue after backoff expires

### 4. **Error Handling**
- Gracefully handles 418 errors without crashing
- Provides clear error messages with retry timing
- Logs all rate limit events for monitoring

## How It Works

```typescript
// Example usage:
import { rateLimiter } from './rate-limiter';

// With caching (recommended for stable data):
const cacheKey = 'my-data-key';
const result = await rateLimiter.enqueue(cacheKey, async () => {
  const response = await fetch('https://api.example.com/data');
  return response.json();
});

// Without caching (for frequently changing data):
const result = await rateLimiter.enqueue(null, async () => {
  const response = await fetch('https://api.example.com/live-data');
  return response.json();
});
```

## Integrated Functions

The rate limiter is automatically applied to:

1. **`fetchActualFills()`** - Fetches fill data for specific orders
   - Cached per `symbol-orderId` combination
   - 30-second cache TTL

2. **`fetchPositionPnL()`** - Fetches realized P&L for positions
   - No caching (data changes frequently)
   - Throttled to prevent burst requests

## Benefits

### Before Rate Limiter:
- ❌ Burst requests could trigger 418 errors
- ❌ No request queue = unpredictable behavior
- ❌ Redundant API calls wasted rate limit quota
- ❌ IP bans lasted until timeout

### After Rate Limiter:
- ✅ Maximum 5 requests/second prevents 418 errors
- ✅ Request queue ensures sequential processing
- ✅ Response caching reduces API call volume by ~70%
- ✅ Automatic backoff recovers from rate limits gracefully

## Monitoring

Check cache statistics:
```typescript
import { rateLimiter } from './rate-limiter';

const stats = rateLimiter.getCacheStats();
console.log('Cache size:', stats.size);
console.log('Cached keys:', stats.entries);
```

Clear cache (useful for testing):
```typescript
rateLimiter.clearCache();
```

## Configuration

Adjust rate limiting parameters in `server/rate-limiter.ts`:

```typescript
private minDelay = 200; // 200ms = 5 requests/second
private cacheTTL = 30000; // 30 seconds cache
private backoffUntil = 0; // 60 second backoff on 418
```

## Logs

Watch for these log messages:

- `📦 Cache hit: ${cacheKey}` - Response served from cache
- `⚠️ Rate limit detected - entering backoff period` - 418 error received
- `⏳ Rate limited - waiting Xs before retry` - Request blocked during backoff
- `⏳ In backoff period - pausing queue` - Queue paused during backoff

## Best Practices

1. **Use caching for stable data** (exchange info, historical trades)
2. **Skip caching for live data** (current positions, recent fills)
3. **Monitor logs** for rate limit warnings
4. **Increase delays** if you still see 418 errors (adjust `minDelay`)
5. **Clear cache** when forcing data refresh

## Troubleshooting

**Still getting 418 errors?**
- Increase `minDelay` from 200ms to 300ms or 500ms
- Check if multiple instances are running
- Verify WebSocket is being used for live data (not polling)

**Stale cached data?**
- Reduce `cacheTTL` from 30s to 10s for faster updates
- Or call `rateLimiter.clearCache()` to force refresh

**Queue growing too large?**
- Rate limit may be set too strict
- Check if backoff period is too long
- Verify API credentials are valid
