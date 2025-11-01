/**
 * Centralized Aster DEX API client with HMAC signature authentication
 * Eliminates 86+ instances of duplicated signature creation code across the codebase
 *
 * Features:
 * - Automatic HMAC-SHA256 signature generation
 * - Built-in rate limiting integration
 * - Consistent error handling
 * - Type-safe API methods
 */

import { createHmac } from 'crypto';
import { rateLimiter } from '../rate-limiter';

export interface ExchangeAPIConfig {
  apiKey: string;
  secretKey: string;
  baseUrl?: string;
}

export class ExchangeAPIClient {
  private apiKey: string;
  private secretKey: string;
  private baseUrl: string;

  constructor(config: ExchangeAPIConfig) {
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.baseUrl = config.baseUrl || 'https://fapi.asterdex.com';
  }

  /**
   * Create HMAC-SHA256 signature for API request
   * @param params Query parameters as object or string
   * @returns Hex-encoded signature
   */
  createSignature(params: Record<string, any> | string): string {
    const queryString = typeof params === 'string'
      ? params
      : this.buildQueryString(params);

    return createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Build query string from parameters object
   * Sorts parameters alphabetically for consistent signature generation
   */
  private buildQueryString(params: Record<string, any>): string {
    return Object.entries(params)
      .filter(([_, value]) => value !== undefined && value !== null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
  }

  /**
   * Build signed request parameters
   * Automatically adds timestamp and signature
   */
  buildSignedParams(params: Record<string, any> = {}): string {
    const timestamp = Date.now();
    const allParams = { ...params, timestamp };
    const queryString = this.buildQueryString(allParams);
    const signature = this.createSignature(queryString);

    return `${queryString}&signature=${signature}`;
  }

  /**
   * GET request to Aster DEX API with automatic signing
   * @param endpoint API endpoint (e.g., '/fapi/v2/balance')
   * @param params Query parameters
   * @param options Additional fetch options
   */
  async get(
    endpoint: string,
    params: Record<string, any> = {},
    options: RequestInit = {}
  ): Promise<Response> {
    const signedParams = this.buildSignedParams(params);
    const url = `${this.baseUrl}${endpoint}?${signedParams}`;

    return rateLimiter.fetch(url, {
      ...options,
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        ...options.headers
      }
    });
  }

  /**
   * POST request to Aster DEX API with automatic signing
   * @param endpoint API endpoint
   * @param params Request parameters
   * @param options Additional fetch options
   */
  async post(
    endpoint: string,
    params: Record<string, any> = {},
    options: RequestInit = {}
  ): Promise<Response> {
    const signedParams = this.buildSignedParams(params);
    const url = `${this.baseUrl}${endpoint}?${signedParams}`;

    return rateLimiter.fetch(url, {
      ...options,
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        ...options.headers
      }
    });
  }

  /**
   * DELETE request to Aster DEX API with automatic signing
   * @param endpoint API endpoint
   * @param params Request parameters
   * @param options Additional fetch options
   */
  async delete(
    endpoint: string,
    params: Record<string, any> = {},
    options: RequestInit = {}
  ): Promise<Response> {
    const signedParams = this.buildSignedParams(params);
    const url = `${this.baseUrl}${endpoint}?${signedParams}`;

    return rateLimiter.fetch(url, {
      ...options,
      method: 'DELETE',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        ...options.headers
      }
    });
  }

  /**
   * GET request without signature (for public endpoints)
   */
  async getPublic(endpoint: string, params: Record<string, any> = {}): Promise<Response> {
    const queryString = this.buildQueryString(params);
    const url = queryString
      ? `${this.baseUrl}${endpoint}?${queryString}`
      : `${this.baseUrl}${endpoint}`;

    return rateLimiter.fetch(url);
  }

  /**
   * Helper method to parse JSON response with error handling
   */
  async parseResponse<T = any>(response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API request failed (${response.status}): ${text}`);
    }
    return response.json();
  }
}

/**
 * Default client instance using environment variables
 * Import this directly for convenience
 */
export const defaultExchangeClient = new ExchangeAPIClient({
  apiKey: process.env.ASTER_API_KEY || process.env.ASTER_DEX_API_KEY || '',
  secretKey: process.env.ASTER_SECRET_KEY || ''
});

/**
 * Legacy helper for backward compatibility
 * Creates a signed query string with timestamp
 */
export function createSignedParams(
  params: Record<string, any>,
  apiKey: string,
  secretKey: string
): string {
  const client = new ExchangeAPIClient({ apiKey, secretKey });
  return client.buildSignedParams(params);
}
