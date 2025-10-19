/**
 * Exchange Registry
 * 
 * Central factory for managing exchange adapters and WebSocket streams.
 * Handles credentials, lifecycle, and provides exchange-agnostic access.
 */

import { ExchangeType, ExchangeConfig, IExchangeAdapter, IExchangeStream } from './types';
import { AsterExchangeAdapter } from './aster-adapter';
import { AsterWebSocketStream } from './aster-stream';

export class ExchangeRegistry {
  private adapters: Map<ExchangeType, IExchangeAdapter> = new Map();
  // Changed: Per-strategy streams to prevent connection conflicts
  private streams: Map<string, IExchangeStream> = new Map(); // key: `${strategyId}:${exchangeType}`
  private configs: Map<ExchangeType, ExchangeConfig> = new Map();

  constructor() {
    this.initializeFromEnv();
  }

  /**
   * Initialize exchange configurations from environment variables
   */
  private initializeFromEnv(): void {
    // Aster DEX configuration
    const asterApiKey = process.env.ASTER_API_KEY;
    const asterSecretKey = process.env.ASTER_SECRET_KEY;
    
    if (asterApiKey && asterSecretKey) {
      this.configs.set('aster', {
        apiKey: asterApiKey,
        secretKey: asterSecretKey,
        baseURL: 'https://fapi.asterdex.com',
        wsURL: 'wss://fstream.asterdex.com',
      });
      console.log('✅ Aster DEX credentials loaded');
    } else {
      console.warn('⚠️ Aster DEX credentials not found in environment');
    }
  }

  /**
   * Get or create exchange adapter for a given exchange type
   */
  getAdapter(exchangeType: ExchangeType): IExchangeAdapter {
    // Return existing adapter if available
    if (this.adapters.has(exchangeType)) {
      return this.adapters.get(exchangeType)!;
    }

    // Get configuration
    const config = this.configs.get(exchangeType);
    if (!config) {
      throw new Error(`No configuration found for exchange: ${exchangeType}`);
    }

    // Create new adapter (currently only supports Aster DEX)
    const adapter = new AsterExchangeAdapter(config);

    // Cache and return
    this.adapters.set(exchangeType, adapter);
    console.log(`✅ Created ${exchangeType} adapter`);
    return adapter;
  }

  /**
   * Get or create exchange WebSocket stream for a given strategy and exchange type
   * Each strategy gets its own stream instance to prevent connection conflicts
   */
  getStream(strategyId: string, exchangeType: ExchangeType): IExchangeStream {
    const streamKey = `${strategyId}:${exchangeType}`;
    
    // Return existing stream if available
    if (this.streams.has(streamKey)) {
      return this.streams.get(streamKey)!;
    }

    // Get configuration
    const config = this.configs.get(exchangeType);
    if (!config) {
      throw new Error(`No configuration found for exchange: ${exchangeType}`);
    }

    // Create new stream (currently only supports Aster DEX)
    const stream = new AsterWebSocketStream(config);

    // Cache and return
    this.streams.set(streamKey, stream);
    console.log(`✅ Created ${exchangeType} stream for strategy ${strategyId}`);
    return stream;
  }

  /**
   * Check if an exchange has valid credentials configured
   */
  isConfigured(exchangeType: ExchangeType): boolean {
    return this.configs.has(exchangeType);
  }

  /**
   * Get list of all configured exchanges
   */
  getConfiguredExchanges(): ExchangeType[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Disconnect and clean up all streams
   */
  async disconnectAll(): Promise<void> {
    console.log('🔌 Disconnecting all exchange streams...');
    
    const disconnectPromises = Array.from(this.streams.values()).map(stream => 
      stream.disconnect().catch(err => 
        console.error(`Error disconnecting stream:`, err)
      )
    );
    
    await Promise.all(disconnectPromises);
    this.streams.clear();
    
    console.log('✅ All exchange streams disconnected');
  }

  /**
   * Disconnect specific exchange stream for a strategy
   */
  async disconnectExchange(strategyId: string, exchangeType: ExchangeType): Promise<void> {
    const streamKey = `${strategyId}:${exchangeType}`;
    const stream = this.streams.get(streamKey);
    if (stream) {
      console.log(`🔌 Disconnecting ${exchangeType} stream for strategy ${strategyId}...`);
      await stream.disconnect();
      this.streams.delete(streamKey);
      console.log(`✅ ${exchangeType} stream disconnected for strategy ${strategyId}`);
    }
  }

  /**
   * Disconnect all streams for a specific strategy
   */
  async disconnectStrategy(strategyId: string): Promise<void> {
    console.log(`🔌 Disconnecting all streams for strategy ${strategyId}...`);
    
    const strategyStreams = Array.from(this.streams.entries())
      .filter(([key]) => key.startsWith(`${strategyId}:`))
      .map(([key, stream]) => ({ key, stream }));
    
    const disconnectPromises = strategyStreams.map(({ key, stream }) => 
      stream.disconnect()
        .then(() => this.streams.delete(key))
        .catch(err => console.error(`Error disconnecting stream ${key}:`, err))
    );
    
    await Promise.all(disconnectPromises);
    console.log(`✅ All streams disconnected for strategy ${strategyId}`);
  }

  /**
   * Update credentials for an exchange (useful for runtime credential changes)
   */
  updateCredentials(exchangeType: ExchangeType, apiKey: string, secretKey: string): void {
    const existingConfig = this.configs.get(exchangeType) || {};
    
    this.configs.set(exchangeType, {
      ...existingConfig,
      apiKey,
      secretKey,
    });

    // Clear cached adapter/stream to force recreation with new credentials
    this.adapters.delete(exchangeType);
    this.streams.delete(exchangeType);
    
    console.log(`✅ Updated credentials for ${exchangeType}`);
  }
}

// Singleton instance
export const exchangeRegistry = new ExchangeRegistry();
