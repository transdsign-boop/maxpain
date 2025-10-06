/**
 * Cloudflare Worker: Bybit API Relay (v5 Compatible)
 * 
 * This worker acts as a secure proxy to bypass Bybit's geo-blocking.
 * It receives requests from the Replit backend, signs them with HMAC per v5 spec,
 * and forwards them to Bybit's API with proper headers.
 */

const BYBIT_BASE_URL = 'https://api.bybit.com';
const RECV_WINDOW = '5000'; // 5 second window

// Allowed paths (whitelist to prevent open proxy abuse)
const ALLOWED_PATHS = [
  '/v5/market/time',
  '/v5/account/wallet-balance',
  '/v5/order/create',
  '/v5/order/amend',
  '/v5/order/cancel',
  '/v5/order/cancel-all',
  '/v5/position/list',
  '/v5/position/set-leverage',
  '/v5/execution/list',
  '/v5/market/tickers',
  '/v5/market/orderbook',
  '/v5/market/kline',
  '/v5/market/instruments-info',
  '/v5/market/funding/history',
  '/v5/account/fee-rate',
];

// CORS headers - restrict to Replit origin in production
const getCorsHeaders = (origin) => {
  // In production, restrict to specific Replit domain
  // For now, allow any origin but this should be locked down
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
};

/**
 * Generate HMAC SHA256 signature for Bybit v5 API
 * Signature = HMAC_SHA256(timestamp + apiKey + recvWindow + queryString + body)
 */
async function generateBybitSignature(timestamp, apiKey, recvWindow, queryString, body, apiSecret) {
  const message = timestamp + apiKey + recvWindow + queryString + (body || '');
  
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiSecret);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Health check endpoint
 */
async function handleHealth(corsHeaders) {
  try {
    const response = await fetch(`${BYBIT_BASE_URL}/v5/market/time`);
    const data = await response.json();
    
    if (data.retCode === 0) {
      return new Response(JSON.stringify({ 
        status: 'healthy',
        bybit: 'reachable',
        timestamp: data.result?.timeSecond
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({ 
      status: 'unhealthy',
      error: 'Bybit unreachable'
    }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      status: 'error',
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Proxy request to Bybit API with proper v5 HMAC signing
 */
async function proxyBybitRequest(request, env, corsHeaders) {
  let requestData;
  
  try {
    // Validate auth BEFORE parsing body
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader !== `Bearer ${env.RELAY_AUTH_TOKEN}`) {
      console.error('Unauthorized request - invalid auth token');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Now parse the request body
    requestData = await request.json();
    const { method = 'GET', path, params = {} } = requestData;
    
    // Validate path is in whitelist
    if (!ALLOWED_PATHS.includes(path)) {
      console.error('Blocked request to unauthorized path:', path);
      return new Response(JSON.stringify({ error: 'Path not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get Bybit credentials from Worker secrets
    const apiKey = env.BYBIT_API_KEY;
    const apiSecret = env.BYBIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.error('Worker not configured - missing Bybit credentials');
      return new Response(JSON.stringify({ error: 'Worker not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build query string and request body per Bybit v5 spec
    const queryString = new URLSearchParams(params).toString();
    const requestBody = requestData.body ? JSON.stringify(requestData.body) : '';
    
    // Generate timestamp and signature
    const timestamp = Date.now().toString();
    const signature = await generateBybitSignature(
      timestamp,
      apiKey,
      RECV_WINDOW,
      queryString,
      requestBody,
      apiSecret
    );

    // Build final URL
    const url = queryString 
      ? `${BYBIT_BASE_URL}${path}?${queryString}`
      : `${BYBIT_BASE_URL}${path}`;

    // Make request to Bybit with v5 headers
    const bybitResponse = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      },
      body: requestBody || undefined,
    });

    const responseData = await bybitResponse.json();

    // Log errors for monitoring
    if (responseData.retCode !== 0) {
      console.error('Bybit API error:', {
        retCode: responseData.retCode,
        retMsg: responseData.retMsg,
        path,
        method
      });
    }

    return new Response(JSON.stringify(responseData), {
      status: bybitResponse.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Worker error:', error.message, error.stack);
    return new Response(JSON.stringify({ 
      error: error.message,
      type: 'worker_error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Main worker handler
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      return handleHealth(corsHeaders);
    }

    // Proxy endpoint
    if (url.pathname === '/proxy' && request.method === 'POST') {
      return proxyBybitRequest(request, env, corsHeaders);
    }

    return new Response('Not Found', { status: 404 });
  }
};
