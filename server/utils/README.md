# Exchange API Client Usage Guide

## Overview

The `ExchangeAPIClient` centralizes HMAC signature creation and API request handling for Aster DEX. This eliminates 86+ instances of duplicated signature code across the codebase.

## Quick Start

```typescript
import { defaultExchangeClient } from './utils/exchange-api-client';

// GET request (automatically signed)
const response = await defaultExchangeClient.get('/fapi/v2/balance', {
  recvWindow: 30000
});

// POST request (automatically signed)
const orderResponse = await defaultExchangeClient.post('/fapi/v1/order', {
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 0.001
});

// Parse response with error handling
const data = await defaultExchangeClient.parseResponse(response);
```

## Migration Pattern

### Before (Old Pattern - 86 instances to migrate)
```typescript
import { createHmac } from 'crypto';
import { rateLimiter } from './rate-limiter';

const apiKey = process.env.ASTER_API_KEY;
const secretKey = process.env.ASTER_SECRET_KEY;

const timestamp = Date.now();
const params = `symbol=BTCUSDT&timestamp=${timestamp}`;
const signature = createHmac('sha256', secretKey)
  .update(params)
  .digest('hex');

const response = await rateLimiter.fetch(
  `https://fapi.asterdex.com/fapi/v2/balance?${params}&signature=${signature}`,
  {
    headers: { 'X-MBX-APIKEY': apiKey }
  }
);
```

### After (New Pattern)
```typescript
import { defaultExchangeClient } from './utils/exchange-api-client';

const response = await defaultExchangeClient.get('/fapi/v2/balance', {
  symbol: 'BTCUSDT'
});
```

**Benefits**: 70% less code, automatic signing, automatic rate limiting, centralized error handling

## Credentials Management

Use the centralized `credentials` manager instead of `process.env`:

```typescript
import { credentials } from './config/credentials';

// Check if configured
if (!credentials.isConfigured()) {
  throw new Error('API keys not configured');
}

// Get keys (with validation)
const apiKey = credentials.getApiKey();
const secretKey = credentials.getSecretKey();
```

## Custom Client Instance

For testing or multiple accounts:

```typescript
import { ExchangeAPIClient } from './utils/exchange-api-client';

const testClient = new ExchangeAPIClient({
  apiKey: 'test_key',
  secretKey: 'test_secret',
  baseUrl: 'https://testnet.asterdex.com' // optional
});
```

## Remaining Work

**Status**: 3 files refactored, ~83 instances remaining across:
- `server/routes.ts` (~19 instances)
- `server/strategy-engine.ts` (~8 instances)
- `server/order-protection-service.ts` (~3 instances)
- `server/exchange-sync.ts` (~2 instances)
- `server/live-data-orchestrator.ts` (~2 instances)
- Various other files

**Recommendation**: Refactor gradually as you touch each file. The old pattern still works, but new code should use `defaultExchangeClient`.
