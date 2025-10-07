import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { z } from "zod";
import { storage } from "./storage";
import { strategyEngine } from "./strategy-engine";
import { cascadeDetectorService } from "./cascade-detector-service";
import { wsBroadcaster } from "./websocket-broadcaster";
import { insertLiquidationSchema, insertUserSettingsSchema, frontendStrategySchema, updateStrategySchema, type Position, type Liquidation, type InsertFill, positions } from "@shared/schema";
import { db } from "./db";
import { desc } from "drizzle-orm";

// Fixed liquidation window - always 60 seconds regardless of user input
const LIQUIDATION_WINDOW_SECONDS = 60;

// Fixed user ID for personal app (no authentication needed)
const DEFAULT_USER_ID = "personal_user";

// Simple cache to prevent excessive API calls to Aster DEX
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const apiCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 10000; // 10 second default cache TTL
const ACCOUNT_CACHE_TTL_MS = 30000; // 30 second cache for account data (less frequent changes)

function getCached<T>(key: string, customTTL?: number): T | null {
  const entry = apiCache.get(key);
  if (!entry) return null;
  
  const ttl = customTTL || CACHE_TTL_MS;
  const age = Date.now() - entry.timestamp;
  if (age > ttl) {
    apiCache.delete(key);
    return null;
  }
  
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  apiCache.set(key, {
    data,
    timestamp: Date.now()
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Ensure default user exists
  await storage.upsertUser({
    id: DEFAULT_USER_ID,
    email: "user@personal.app",
    firstName: "Personal",
    lastName: "User",
    profileImageUrl: null,
  });
  
  // Start the strategy engine
  await strategyEngine.start();
  
  // Liquidation API routes
  app.get("/api/liquidations", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const liquidations = await storage.getLiquidations(limit);
      res.json(liquidations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch liquidations" });
    }
  });

  app.get("/api/liquidations/since/:timestamp", async (req, res) => {
    try {
      const timestamp = new Date(req.params.timestamp);
      const limit = parseInt(req.query.limit as string) || 100;
      const liquidations = await storage.getLiquidationsSince(timestamp, limit);
      res.json(liquidations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch liquidations since timestamp" });
    }
  });

  app.get("/api/liquidations/largest/:timestamp", async (req, res) => {
    try {
      const timestamp = new Date(req.params.timestamp);
      const largest = await storage.getLargestLiquidationSince(timestamp);
      res.json(largest || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch largest liquidation" });
    }
  });

  app.get("/api/liquidations/by-symbol", async (req, res) => {
    try {
      const symbols = req.query.symbols as string;
      const limit = parseInt(req.query.limit as string) || 100;
      
      if (!symbols) {
        return res.status(400).json({ error: "symbols parameter required" });
      }
      
      const symbolArray = symbols.split(',').map(s => s.trim());
      const liquidations = await storage.getLiquidationsBySymbol(symbolArray, limit);
      res.json(liquidations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch liquidations by symbol" });
    }
  });

  app.get("/api/stats/summary", async (req, res) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const [recent, largest] = await Promise.all([
        storage.getLiquidationsSince(since, 1000),
        storage.getLargestLiquidationSince(since)
      ]);

      const totalVolume = recent.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
      const longCount = recent.filter(liq => liq.side === "long").length;
      const shortCount = recent.filter(liq => liq.side === "short").length;

      res.json({
        totalLiquidations: recent.length,
        totalVolume: totalVolume.toFixed(2),
        longLiquidations: longCount,
        shortLiquidations: shortCount,
        largestLiquidation: largest ? {
          value: largest.value,
          symbol: largest.symbol,
          timestamp: largest.timestamp
        } : null,
        timeRange: `${hours}h`
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch statistics summary" });
    }
  });

  // User settings API routes
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getUserSettings(DEFAULT_USER_ID);
      res.json(settings || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user settings" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const validatedSettings = insertUserSettingsSchema.parse({
        ...req.body,
        userId: DEFAULT_USER_ID
      });
      const settings = await storage.saveUserSettings(validatedSettings);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to save user settings" });
    }
  });

  // Test API connection
  app.post("/api/settings/test-connection", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ 
          success: false, 
          error: "API credentials not configured. Please set ASTER_API_KEY and ASTER_SECRET_KEY in your secrets." 
        });
      }

      // Test the connection by getting account information
      const timestamp = Date.now();
      const recvWindow = 60000; // 60 seconds receive window
      
      // Create query string for signature
      const params = new URLSearchParams({
        timestamp: timestamp.toString(),
        recvWindow: recvWindow.toString()
      });
      const queryString = params.toString();
      
      // Generate HMAC-SHA256 signature
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      // Add signature to parameters
      const signedParams = `${queryString}&signature=${signature}`;
      
      console.log('🧪 Testing Aster DEX API connection...');
      
      // Make request to Aster DEX API (futures endpoint)
      const response = await fetch(`https://fapi.asterdex.com/fapi/v2/account?${signedParams}`, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ API test failed: ${response.status} ${errorText}`);
        return res.json({ 
          success: false, 
          error: `API returned ${response.status}: ${errorText}`,
          statusCode: response.status
        });
      }

      const accountData = await response.json();
      console.log('✅ API connection successful');
      
      res.json({ 
        success: true, 
        message: "API connection successful",
        accountInfo: {
          canTrade: accountData.canTrade || false,
          canDeposit: accountData.canDeposit || false,
          canWithdraw: accountData.canWithdraw || false,
          updateTime: accountData.updateTime || timestamp
        }
      });
    } catch (error: any) {
      console.error('❌ API test error:', error);
      res.json({ 
        success: false, 
        error: error?.message || "Unknown error occurred while testing API connection" 
      });
    }
  });

  // Export settings and strategy configuration
  app.get("/api/settings/export", async (req, res) => {
    try {
      const settings = await storage.getUserSettings(DEFAULT_USER_ID);
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      
      const exportData = {
        version: "1.0",
        exportDate: new Date().toISOString(),
        settings: settings || null,
        strategies: strategies.map((s: any) => ({
          name: s.name,
          selectedAssets: s.selectedAssets,
          percentileThreshold: Number(s.percentileThreshold),
          maxLayers: Number(s.maxLayers),
          profitTargetPercent: String(s.profitTargetPercent),
          stopLossPercent: String(s.stopLossPercent),
          marginMode: s.marginMode,
          marginAmount: String(s.marginAmount),
          leverage: Number(s.leverage),
          orderType: s.orderType,
          orderDelayMs: Number(s.orderDelayMs),
          maxRetryDurationMs: Number(s.maxRetryDurationMs),
          slippageTolerancePercent: String(s.slippageTolerancePercent),
          liquidationLookbackHours: Number(s.liquidationLookbackHours),
          hedgeMode: Boolean(s.hedgeMode),
          // DCA Settings
          dcaStartStepPercent: String(s.dcaStartStepPercent),
          dcaSpacingConvexity: String(s.dcaSpacingConvexity),
          dcaSizeGrowth: String(s.dcaSizeGrowth),
          dcaMaxRiskPercent: String(s.dcaMaxRiskPercent),
          dcaVolatilityRef: String(s.dcaVolatilityRef),
          dcaExitCushionMultiplier: String(s.dcaExitCushionMultiplier),
          // RET Thresholds
          retHighThreshold: String(s.retHighThreshold),
          retMediumThreshold: String(s.retMediumThreshold),
          // Portfolio Risk
          maxOpenPositions: Number(s.maxOpenPositions),
          maxPortfolioRiskPercent: String(s.maxPortfolioRiskPercent),
        }))
      };
      
      res.json(exportData);
    } catch (error) {
      console.error('❌ Export settings error:', error);
      res.status(500).json({ error: "Failed to export settings" });
    }
  });

  // Import settings and strategy configuration
  app.post("/api/settings/import", async (req, res) => {
    try {
      const importData = req.body;
      
      if (!importData.version || !importData.strategies) {
        return res.status(400).json({ error: "Invalid import data format" });
      }
      
      // Import user settings (skip if null)
      if (importData.settings) {
        try {
          const validatedSettings = insertUserSettingsSchema.parse({
            ...importData.settings,
            userId: DEFAULT_USER_ID
          });
          await storage.saveUserSettings(validatedSettings);
        } catch (error: any) {
          return res.status(400).json({ 
            error: "Invalid settings data", 
            details: error.message 
          });
        }
      }
      
      // Import strategies (create new or update existing)
      if (importData.strategies && importData.strategies.length > 0) {
        // Get existing strategies (will refresh after each create)
        let existingStrategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
        
        for (const strategyData of importData.strategies) {
          try {
            const existingStrategy = existingStrategies.find((s: any) => s.name === strategyData.name);
            
            if (existingStrategy) {
              // Validate and update existing strategy with imported settings
              const validatedData = updateStrategySchema.parse(strategyData);
              await storage.updateStrategy(existingStrategy.id, validatedData);
            } else {
              // Validate and create new strategy from imported data
              const validatedData = frontendStrategySchema.parse({
                ...strategyData,
                userId: DEFAULT_USER_ID,
              });
              await storage.createStrategy(validatedData);
              
              // Refresh the list so newly created strategies are visible for subsequent iterations
              existingStrategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
            }
          } catch (error: any) {
            return res.status(400).json({ 
              error: `Invalid strategy data for "${strategyData.name}"`, 
              details: error.message 
            });
          }
        }
      }
      
      res.json({ 
        success: true, 
        message: "Settings imported successfully" 
      });
    } catch (error) {
      console.error('❌ Import settings error:', error);
      res.status(500).json({ error: "Failed to import settings" });
    }
  });

  // Analytics API routes
  app.get("/api/analytics/assets", async (req, res) => {
    try {
      const assets = await storage.getAvailableAssets();
      res.json(assets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch available assets for analytics" });
    }
  });

  app.get("/api/analytics/asset-performance", async (req, res) => {
    try {
      const performance = await storage.getAssetPerformance();
      res.json(performance);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch asset performance" });
    }
  });

  app.get("/api/analytics/percentiles", async (req, res) => {
    try {
      const symbol = req.query.symbol as string;
      const hours = parseInt(req.query.hours as string) || 24;
      
      if (!symbol) {
        return res.status(400).json({ error: "symbol parameter required" });
      }
      
      const sinceTimestamp = new Date(Date.now() - hours * 60 * 60 * 1000);
      const liquidations = await storage.getLiquidationAnalytics(symbol, sinceTimestamp);
      
      if (liquidations.length === 0) {
        return res.json({
          symbol,
          hours,
          totalLiquidations: 0,
          percentiles: null,
          message: "No liquidation data found for this asset and time period"
        });
      }
      
      // Calculate percentiles based on liquidation values with proper interpolation
      const values = liquidations.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
      const calculatePercentile = (percentile: number) => {
        if (values.length === 0) return 0;
        if (values.length === 1) return values[0];
        
        const index = (percentile / 100) * (values.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        
        if (lower === upper) {
          return values[lower];
        }
        
        // Linear interpolation between the two nearest values
        const weight = index - lower;
        return values[lower] * (1 - weight) + values[upper] * weight;
      };
      
      const longLiquidations = liquidations.filter(liq => liq.side === "long");
      const shortLiquidations = liquidations.filter(liq => liq.side === "short");
      
      res.json({
        symbol,
        hours,
        totalLiquidations: liquidations.length,
        percentiles: {
          p50: calculatePercentile(50),
          p75: calculatePercentile(75),
          p90: calculatePercentile(90),
          p95: calculatePercentile(95),
          p99: calculatePercentile(99)
        },
        breakdown: {
          longCount: longLiquidations.length,
          shortCount: shortLiquidations.length,
          averageValue: values.reduce((sum, val) => sum + val, 0) / values.length,
          maxValue: Math.max(...values),
          minValue: Math.min(...values)
        },
        latestLiquidation: liquidations[0] // Most recent (highest value due to sorting)
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to calculate liquidation percentiles" });
    }
  });

  // Order book and funding rate API routes for dominant direction analysis
  app.get("/api/analytics/orderbook", async (req, res) => {
    try {
      const symbol = req.query.symbol as string;
      
      if (!symbol) {
        return res.status(400).json({ error: "symbol parameter required" });
      }
      
      // Fetch order book data from Aster DEX
      const orderBookResponse = await fetch(`https://fapi.asterdex.com/fapi/v1/depth?symbol=${symbol}&limit=100`, {
        headers: {
          'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
        }
      });
      
      if (!orderBookResponse.ok) {
        throw new Error(`Failed to fetch order book: ${orderBookResponse.status}`);
      }
      
      const orderBook = await orderBookResponse.json();
      
      // Calculate order book pressure (bid vs ask depth)
      const bids = orderBook.bids || [];
      const asks = orderBook.asks || [];
      
      const bidDepth = bids.reduce((sum: number, [price, quantity]: [string, string]) => 
        sum + parseFloat(price) * parseFloat(quantity), 0);
      const askDepth = asks.reduce((sum: number, [price, quantity]: [string, string]) => 
        sum + parseFloat(price) * parseFloat(quantity), 0);
      
      const totalDepth = bidDepth + askDepth;
      const bidRatio = totalDepth > 0 ? bidDepth / totalDepth : 0.5;
      const askRatio = totalDepth > 0 ? askDepth / totalDepth : 0.5;
      
      res.json({
        symbol,
        bidDepth: bidDepth.toFixed(2),
        askDepth: askDepth.toFixed(2),
        bidRatio: bidRatio.toFixed(4),
        askRatio: askRatio.toFixed(4),
        pressure: bidRatio > 0.55 ? 'bullish' : askRatio > 0.55 ? 'bearish' : 'neutral',
        lastUpdateId: orderBook.lastUpdateId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Order book fetch error:', error);
      res.status(500).json({ error: "Failed to fetch order book data" });
    }
  });

  // Batch liquidity endpoint - fetch order book depth for multiple symbols
  app.post("/api/analytics/liquidity/batch", async (req, res) => {
    try {
      const { symbols, tradeSize, accountBalance } = req.body as { symbols: string[]; tradeSize?: number; accountBalance?: number };
      
      if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: "symbols array required" });
      }

      const liquidityData = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            // Fetch order book data and 24hr stats in parallel
            const [orderBookResponse, tickerResponse] = await Promise.all([
              fetch(
                `https://fapi.asterdex.com/fapi/v1/depth?symbol=${symbol}&limit=20`,
                {
                  headers: {
                    'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
                  }
                }
              ),
              fetch(
                `https://fapi.asterdex.com/fapi/v1/ticker/24hr?symbol=${symbol}`,
                {
                  headers: {
                    'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
                  }
                }
              )
            ]);

            if (!orderBookResponse.ok) {
              return {
                symbol,
                error: true,
                totalLiquidity: 0,
                canHandleTradeSize: false
              };
            }

            const orderBook = await orderBookResponse.json();
            const ticker = tickerResponse.ok ? await tickerResponse.json() : null;
            
            const bids = orderBook.bids || [];
            const asks = orderBook.asks || [];

            // Calculate order book depth (in USD value)
            const bidDepth = bids.reduce((sum: number, [price, quantity]: [string, string]) => 
              sum + parseFloat(price) * parseFloat(quantity), 0);
            const askDepth = asks.reduce((sum: number, [price, quantity]: [string, string]) => 
              sum + parseFloat(price) * parseFloat(quantity), 0);
            
            const totalLiquidity = bidDepth + askDepth;
            const minSideLiquidity = Math.min(bidDepth, askDepth);
            
            // Get 24hr volume (in quote currency, usually USD)
            const volume24h = ticker?.quoteVolume ? parseFloat(ticker.quoteVolume) : 0;
            const volumePerMinute = volume24h / (24 * 60); // Estimate 1-min volume
            
            // MICROSTRUCTURE-BASED PARTICIPATION CAP RULES
            // Rule 1: 2-5% of instant liquidity (order book depth)
            const maxByBook = minSideLiquidity * 0.05; // 5% of limiting side
            const minByBook = minSideLiquidity * 0.02; // 2% of limiting side
            
            // Rule 2: <10% of 1-minute traded volume
            const maxByVolume = volumePerMinute * 0.10; // 10% of 1-min volume
            
            // Take the more conservative limit
            let maxSafeOrderSize: number;
            let liquidityType: string;
            let participationRate: number;
            
            if (volume24h > 0 && maxByVolume < maxByBook) {
              // Volume is the constraint
              maxSafeOrderSize = maxByVolume;
              liquidityType = 'volume-limited';
              participationRate = (maxSafeOrderSize / volumePerMinute) * 100;
            } else {
              // Book depth is the constraint (or no volume data)
              maxSafeOrderSize = maxByBook;
              liquidityType = minSideLiquidity < 50000 ? 'thin-book' : minSideLiquidity < 200000 ? 'moderate-book' : 'deep-book';
              participationRate = (maxSafeOrderSize / minSideLiquidity) * 100;
            }
            
            maxSafeOrderSize = parseFloat(maxSafeOrderSize.toFixed(2));
            
            // Calculate recommended clip size (child orders)
            // For thin markets: $500-$1k clips
            // For moderate: $1k-$2k clips
            // For deep: $2k-$5k clips
            let clipSize: number;
            if (minSideLiquidity < 50000) {
              clipSize = Math.min(maxSafeOrderSize / 3, 1000); // Small clips for thin books
            } else if (minSideLiquidity < 200000) {
              clipSize = Math.min(maxSafeOrderSize / 2, 2000); // Medium clips
            } else {
              clipSize = Math.min(maxSafeOrderSize / 2, 5000); // Larger clips for deep books
            }
            clipSize = parseFloat(clipSize.toFixed(2));
            
            // Determine if current trade size is safe
            const canHandleTradeSize = tradeSize ? tradeSize <= maxSafeOrderSize : true;
            
            // Risk assessment
            let riskLevel: 'safe' | 'caution' | 'high-risk';
            if (tradeSize) {
              const impactPct = (tradeSize / minSideLiquidity) * 100;
              if (impactPct <= 5) riskLevel = 'safe';
              else if (impactPct <= 10) riskLevel = 'caution';
              else riskLevel = 'high-risk';
            } else {
              riskLevel = 'safe';
            }
            
            // Determine account size tier and suitability
            let recommended = false;
            if (accountBalance) {
              const tier = accountBalance < 1000 ? 'micro' : 
                          accountBalance < 10000 ? 'small' : 
                          accountBalance < 50000 ? 'mid' : 'large';
              const tierMultiplier = tier === 'micro' ? 5 : tier === 'small' ? 10 : tier === 'mid' ? 15 : 25;
              recommended = tradeSize ? minSideLiquidity >= tradeSize * tierMultiplier : false;
            }

            return {
              symbol,
              totalLiquidity: parseFloat(totalLiquidity.toFixed(2)),
              bidDepth: parseFloat(bidDepth.toFixed(2)),
              askDepth: parseFloat(askDepth.toFixed(2)),
              minSideLiquidity: parseFloat(minSideLiquidity.toFixed(2)),
              volume24h: parseFloat(volume24h.toFixed(2)),
              volumePerMinute: parseFloat(volumePerMinute.toFixed(2)),
              canHandleTradeSize,
              limitingSide: bidDepth < askDepth ? 'bid' : 'ask',
              liquidityRatio: tradeSize ? parseFloat((minSideLiquidity / tradeSize).toFixed(2)) : 0,
              maxSafeOrderSize,
              clipSize,
              liquidityType,
              participationRate: parseFloat(participationRate.toFixed(2)),
              riskLevel,
              recommended,
              error: false
            };
          } catch (error) {
            return {
              symbol,
              error: true,
              totalLiquidity: 0,
              canHandleTradeSize: false
            };
          }
        })
      );

      res.json(liquidityData);
    } catch (error) {
      console.error('Batch liquidity fetch error:', error);
      res.status(500).json({ error: "Failed to fetch liquidity data" });
    }
  });

  app.get("/api/analytics/funding", async (req, res) => {
    try {
      const symbol = req.query.symbol as string;
      
      if (!symbol) {
        return res.status(400).json({ error: "symbol parameter required" });
      }
      
      // Fetch funding rate data from Aster DEX
      const fundingResponse = await fetch(`https://fapi.asterdex.com/fapi/v1/fundingRate?symbol=${symbol}&limit=24`, {
        headers: {
          'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
        }
      });
      
      if (!fundingResponse.ok) {
        throw new Error(`Failed to fetch funding rate: ${fundingResponse.status}`);
      }
      
      const fundingData = await fundingResponse.json();
      
      if (!Array.isArray(fundingData) || fundingData.length === 0) {
        return res.json({
          symbol,
          currentRate: 0,
          averageRate: 0,
          sentiment: 'neutral',
          message: 'No funding rate data available'
        });
      }
      
      // Get current (latest) funding rate
      const currentRate = parseFloat(fundingData[fundingData.length - 1]?.fundingRate || '0');
      
      // Calculate average funding rate over the period
      const rates = fundingData.map((item: any) => parseFloat(item.fundingRate || '0'));
      const averageRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
      
      // Determine funding sentiment
      let sentiment = 'neutral';
      if (currentRate > 0.0001) sentiment = 'bullish'; // Positive funding = longs pay shorts = bullish sentiment
      else if (currentRate < -0.0001) sentiment = 'bearish'; // Negative funding = shorts pay longs = bearish sentiment
      
      res.json({
        symbol,
        currentRate: (currentRate * 100).toFixed(6), // Convert to percentage
        averageRate: (averageRate * 100).toFixed(6), // Convert to percentage  
        sentiment,
        dataPoints: fundingData.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Funding rate fetch error:', error);
      res.status(500).json({ error: "Failed to fetch funding rate data" });
    }
  });

  app.get("/api/analytics/dominant-direction", async (req, res) => {
    try {
      const symbol = req.query.symbol as string;
      
      if (!symbol) {
        return res.status(400).json({ error: "symbol parameter required" });
      }
      
      // Fetch both order book and funding data in parallel
      const [orderBookResponse, fundingResponse] = await Promise.all([
        fetch(`https://fapi.asterdex.com/fapi/v1/depth?symbol=${symbol}&limit=100`, {
          headers: { 'X-MBX-APIKEY': process.env.ASTER_API_KEY || '' }
        }),
        fetch(`https://fapi.asterdex.com/fapi/v1/fundingRate?symbol=${symbol}&limit=8`, {
          headers: { 'X-MBX-APIKEY': process.env.ASTER_API_KEY || '' }
        })
      ]);
      
      if (!orderBookResponse.ok || !fundingResponse.ok) {
        throw new Error('Failed to fetch market data');
      }
      
      const [orderBook, fundingData] = await Promise.all([
        orderBookResponse.json(),
        fundingResponse.json()
      ]);
      
      // Calculate order book pressure
      const bids = orderBook.bids || [];
      const asks = orderBook.asks || [];
      
      const bidDepth = bids.reduce((sum: number, [price, quantity]: [string, string]) => 
        sum + parseFloat(price) * parseFloat(quantity), 0);
      const askDepth = asks.reduce((sum: number, [price, quantity]: [string, string]) => 
        sum + parseFloat(price) * parseFloat(quantity), 0);
      
      const totalDepth = bidDepth + askDepth;
      const bidRatio = totalDepth > 0 ? bidDepth / totalDepth : 0.5;
      
      // Calculate funding sentiment
      const currentRate = Array.isArray(fundingData) && fundingData.length > 0 
        ? parseFloat(fundingData[fundingData.length - 1]?.fundingRate || '0') 
        : 0;
      
      // Combine signals for dominant direction
      let direction = 'neutral';
      let confidence = 0;
      
      // Order book weight (60%) + Funding weight (40%)
      const bookWeight = 0.6;
      const fundingWeight = 0.4;
      
      let bookScore = 0;
      if (bidRatio > 0.55) bookScore = 1; // Bullish
      else if (bidRatio < 0.45) bookScore = -1; // Bearish
      
      let fundingScore = 0;
      if (currentRate > 0.0001) fundingScore = 1; // Bullish (longs pay shorts)
      else if (currentRate < -0.0001) fundingScore = -1; // Bearish (shorts pay longs)
      
      const combinedScore = (bookScore * bookWeight) + (fundingScore * fundingWeight);
      
      if (combinedScore > 0.3) {
        direction = 'bullish';
        confidence = Math.min(100, Math.abs(combinedScore) * 100);
      } else if (combinedScore < -0.3) {
        direction = 'bearish';
        confidence = Math.min(100, Math.abs(combinedScore) * 100);
      } else {
        direction = 'neutral';
        confidence = Math.abs(combinedScore) * 100;
      }
      
      res.json({
        symbol,
        direction,
        confidence: Math.round(confidence),
        analysis: {
          orderBook: {
            bidRatio: bidRatio.toFixed(4),
            pressure: bidRatio > 0.55 ? 'bullish' : bidRatio < 0.45 ? 'bearish' : 'neutral'
          },
          funding: {
            currentRate: (currentRate * 100).toFixed(6), // As percentage
            sentiment: currentRate > 0.0001 ? 'bullish' : currentRate < -0.0001 ? 'bearish' : 'neutral'
          }
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Dominant direction analysis error:', error);
      res.status(500).json({ error: "Failed to analyze dominant direction" });
    }
  });

  // Price data endpoint for liquidation charts
  app.get("/api/analytics/klines", async (req, res) => {
    try {
      const symbol = req.query.symbol as string;
      const interval = req.query.interval as string || '15m'; // Default to 15 minute intervals
      const hours = parseInt(req.query.hours as string) || 24;
      
      if (!symbol) {
        return res.status(400).json({ error: "symbol parameter required" });
      }
      
      // Calculate time range
      const endTime = Date.now();
      const startTime = endTime - (hours * 60 * 60 * 1000);
      
      // Fetch klines data from Aster DEX
      const klinesResponse = await fetch(`https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`, {
        headers: {
          'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
        }
      });
      
      if (!klinesResponse.ok) {
        throw new Error(`Failed to fetch klines: ${klinesResponse.status}`);
      }
      
      const klinesData = await klinesResponse.json();
      
      // Transform klines data to readable format
      const formattedKlines = klinesData.map((kline: any[]) => ({
        timestamp: kline[0], // Open time
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        closeTime: kline[6],
        date: new Date(kline[0]).toISOString()
      }));
      
      res.json({
        symbol,
        interval,
        hours,
        data: formattedKlines,
        count: formattedKlines.length,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString()
      });
    } catch (error) {
      console.error('Klines fetch error:', error);
      res.status(500).json({ error: "Failed to fetch price data" });
    }
  });

  // Combined analytics endpoint with liquidations and price data for charting
  app.get("/api/analytics/liquidation-chart", async (req, res) => {
    try {
      const symbol = req.query.symbol as string;
      const hours = parseInt(req.query.hours as string) || 24;
      const interval = req.query.interval as string || '15m';
      
      if (!symbol) {
        return res.status(400).json({ error: "symbol parameter required" });
      }
      
      const sinceTimestamp = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      // Fetch liquidations and price data in parallel
      const [liquidations, klinesResponse] = await Promise.all([
        storage.getLiquidationAnalytics(symbol, sinceTimestamp),
        fetch(`https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${sinceTimestamp.getTime()}&endTime=${Date.now()}&limit=1000`, {
          headers: { 'X-MBX-APIKEY': process.env.ASTER_API_KEY || '' }
        })
      ]);
      
      if (!klinesResponse.ok) {
        throw new Error(`Failed to fetch price data: ${klinesResponse.status}`);
      }
      
      const klinesData = await klinesResponse.json();
      
      // Transform klines data
      const priceData = klinesData.map((kline: any[]) => ({
        timestamp: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        date: new Date(kline[0]).toISOString()
      }));
      
      // Transform liquidations for charting
      const liquidationPoints = liquidations.map(liq => ({
        timestamp: new Date(liq.timestamp).getTime(),
        price: parseFloat(liq.price),
        value: parseFloat(liq.value),
        size: parseFloat(liq.size),
        side: liq.side,
        date: liq.timestamp,
        id: liq.id
      }));
      
      res.json({
        symbol,
        hours,
        interval,
        priceData,
        liquidations: liquidationPoints,
        priceDataCount: priceData.length,
        liquidationCount: liquidationPoints.length,
        timeRange: {
          start: sinceTimestamp.toISOString(),
          end: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Liquidation chart data error:', error);
      res.status(500).json({ error: "Failed to fetch chart data" });
    }
  });

  // Aster DEX symbols API
  app.get("/api/symbols", async (req, res) => {
    try {
      const response = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
      if (!response.ok) {
        throw new Error(`Failed to fetch from Aster DEX: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Extract and format symbol information
      const symbols = data.symbols?.map((symbol: any) => ({
        symbol: symbol.symbol,
        baseAsset: symbol.baseAsset,
        quoteAsset: symbol.quoteAsset,
        status: symbol.status,
        contractType: symbol.contractType || 'PERPETUAL',
        marginAsset: symbol.marginAsset || symbol.quoteAsset,
        pricePrecision: symbol.pricePrecision,
        quantityPrecision: symbol.quantityPrecision,
        // Extract filters for additional info
        filters: symbol.filters || []
      })) || [];
      
      res.json({
        symbols,
        exchangeInfo: {
          timezone: data.timezone,
          serverTime: data.serverTime
        }
      });
    } catch (error) {
      console.error('Failed to fetch Aster DEX symbols:', error);
      res.status(500).json({ error: "Failed to fetch symbols from Aster DEX" });
    }
  });

  // Trading Strategy API routes
  app.get("/api/strategies", async (req, res) => {
    try {
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      res.json(strategies);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategies" });
    }
  });

  // Sync running strategy to database
  app.post("/api/strategies/sync", async (req, res) => {
    try {
      const runningStrategy = strategyEngine.getRunningStrategy();
      
      if (!runningStrategy) {
        return res.status(404).json({ error: "No strategy is currently running" });
      }

      console.log('🔄 Syncing running strategy to database...');
      console.log('  Strategy ID:', runningStrategy.id);
      console.log('  Max Open Positions:', runningStrategy.maxOpenPositions);
      console.log('  Max Portfolio Risk %:', runningStrategy.maxPortfolioRiskPercent);

      // Find the database strategy for this user (there should only be one)
      const existingStrategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      
      if (existingStrategies.length > 0) {
        // Update the first strategy (should only be one) with running strategy's settings
        const dbStrategy = existingStrategies[0];
        console.log(`📝 Updating database strategy ${dbStrategy.id} with running strategy settings...`);
        
        const updated = await storage.updateStrategy(dbStrategy.id, {
          name: runningStrategy.name,
          selectedAssets: runningStrategy.selectedAssets,
          percentileThreshold: runningStrategy.percentileThreshold,
          liquidationLookbackHours: runningStrategy.liquidationLookbackHours,
          maxLayers: runningStrategy.maxLayers,
          profitTargetPercent: runningStrategy.profitTargetPercent,
          stopLossPercent: runningStrategy.stopLossPercent,
          marginMode: runningStrategy.marginMode,
          leverage: runningStrategy.leverage,
          orderDelayMs: runningStrategy.orderDelayMs,
          slippageTolerancePercent: runningStrategy.slippageTolerancePercent,
          orderType: runningStrategy.orderType,
          maxRetryDurationMs: runningStrategy.maxRetryDurationMs,
          marginAmount: runningStrategy.marginAmount,
          hedgeMode: runningStrategy.hedgeMode,
          isActive: runningStrategy.isActive,
          dcaStartStepPercent: runningStrategy.dcaStartStepPercent,
          dcaSpacingConvexity: runningStrategy.dcaSpacingConvexity,
          dcaSizeGrowth: runningStrategy.dcaSizeGrowth,
          dcaMaxRiskPercent: runningStrategy.dcaMaxRiskPercent,
          dcaVolatilityRef: runningStrategy.dcaVolatilityRef,
          dcaExitCushionMultiplier: runningStrategy.dcaExitCushionMultiplier,
          retHighThreshold: runningStrategy.retHighThreshold,
          retMediumThreshold: runningStrategy.retMediumThreshold,
          maxOpenPositions: runningStrategy.maxOpenPositions,
          maxPortfolioRiskPercent: runningStrategy.maxPortfolioRiskPercent,
          priceChaseMode: runningStrategy.priceChaseMode
        });
        console.log('✅ Database strategy updated successfully');
        res.json({ success: true, strategy: updated });
      } else {
        console.log('⚠️ No database strategy found - creating a new one with running strategy settings...');
        
        const created = await storage.createStrategy({
          userId: runningStrategy.userId,
          name: runningStrategy.name,
          selectedAssets: runningStrategy.selectedAssets,
          percentileThreshold: runningStrategy.percentileThreshold,
          liquidationLookbackHours: runningStrategy.liquidationLookbackHours,
          maxLayers: runningStrategy.maxLayers,
          profitTargetPercent: runningStrategy.profitTargetPercent,
          stopLossPercent: runningStrategy.stopLossPercent,
          marginMode: runningStrategy.marginMode,
          leverage: runningStrategy.leverage,
          orderDelayMs: runningStrategy.orderDelayMs,
          slippageTolerancePercent: runningStrategy.slippageTolerancePercent,
          orderType: runningStrategy.orderType,
          maxRetryDurationMs: runningStrategy.maxRetryDurationMs,
          marginAmount: runningStrategy.marginAmount,
          hedgeMode: runningStrategy.hedgeMode,
          isActive: runningStrategy.isActive,
          dcaStartStepPercent: runningStrategy.dcaStartStepPercent,
          dcaSpacingConvexity: runningStrategy.dcaSpacingConvexity,
          dcaSizeGrowth: runningStrategy.dcaSizeGrowth,
          dcaMaxRiskPercent: runningStrategy.dcaMaxRiskPercent,
          dcaVolatilityRef: runningStrategy.dcaVolatilityRef,
          dcaExitCushionMultiplier: runningStrategy.dcaExitCushionMultiplier,
          retHighThreshold: runningStrategy.retHighThreshold,
          retMediumThreshold: runningStrategy.retMediumThreshold,
          maxOpenPositions: runningStrategy.maxOpenPositions,
          maxPortfolioRiskPercent: runningStrategy.maxPortfolioRiskPercent,
          priceChaseMode: runningStrategy.priceChaseMode
        });
        console.log('✅ Created new database strategy with running strategy settings');
        res.json({ success: true, strategy: created });
      }
    } catch (error) {
      console.error('❌ Error syncing strategy:', error);
      res.status(500).json({ error: "Failed to sync strategy to database" });
    }
  });

  // Get live account balance from Aster DEX
  app.get("/api/live/account", async (req, res) => {
    try {
      // Check cache first to prevent rate limiting (longer TTL for account data)
      const cached = getCached<any>('live_account', ACCOUNT_CACHE_TTL_MS);
      if (cached) {
        return res.json(cached);
      }

      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "Aster DEX API keys not configured. Please set ASTER_API_KEY and ASTER_SECRET_KEY in your environment variables." });
      }

      // Create signed request to get account information
      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/account?${params}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        let errorMessage = '';
        try {
          const errorText = await response.text();
          errorMessage = errorText || response.statusText;
        } catch {
          errorMessage = response.statusText;
        }
        
        // Special handling for rate limiting
        if (response.status === 429) {
          console.error('⚠️ Rate limit exceeded for Aster DEX account endpoint');
          return res.status(429).json({ 
            error: `Rate limit exceeded. Please wait before trying again. ${errorMessage}` 
          });
        }
        
        // Special handling for authentication errors
        if (response.status === 401 || response.status === 403) {
          console.error('🔑 Authentication failed for Aster DEX:', errorMessage);
          return res.status(response.status).json({ 
            error: `Authentication failed. Please check your API keys are correct and have proper permissions. ${errorMessage}` 
          });
        }
        
        console.error(`❌ Failed to fetch Aster DEX account (${response.status}):`, errorMessage);
        return res.status(response.status).json({ error: `Aster DEX API error (${response.status}): ${errorMessage}` });
      }

      const data = await response.json();
      
      // Extract USDT balance from assets array (most common trading asset)
      const usdtAsset = data.assets?.find((asset: any) => asset.asset === 'USDT');
      const usdtBalance = usdtAsset ? parseFloat(usdtAsset.walletBalance) : 0;
      
      // Also check for USDC as fallback
      const usdcAsset = data.assets?.find((asset: any) => asset.asset === 'USDC');
      const usdcBalance = usdcAsset ? parseFloat(usdcAsset.walletBalance) : 0;
      
      // Use USDT if available, otherwise USDC, otherwise fall back to availableBalance from top-level response
      const balance = usdtBalance || usdcBalance || parseFloat(data.availableBalance || '0');
      
      // Add balance to response
      const result = {
        ...data,
        usdcBalance: balance.toString(), // Keep field name for backwards compatibility
        usdtBalance: usdtBalance.toString()
      };

      // Cache the result
      setCache('live_account', result);
      
      res.json(result);
    } catch (error) {
      console.error('Error fetching live account data:', error);
      res.status(500).json({ error: "Failed to fetch live account data" });
    }
  });

  // Get live open positions from Aster DEX
  app.get("/api/live/positions", async (req, res) => {
    try {
      // Check cache first to prevent rate limiting
      const cached = getCached<any[]>('live_positions');
      if (cached) {
        return res.json(cached);
      }

      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "Aster DEX API keys not configured" });
      }

      // Create signed request to get position information
      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v2/positionRisk?${params}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch Aster DEX positions:', errorText);
        return res.status(response.status).json({ error: `Aster DEX API error: ${errorText}` });
      }

      const data = await response.json();
      // Filter out positions with zero quantity
      const openPositions = data.filter((pos: any) => parseFloat(pos.positionAmt) !== 0);

      // Cache the result
      setCache('live_positions', openPositions);

      res.json(openPositions);
    } catch (error) {
      console.error('Error fetching live positions:', error);
      res.status(500).json({ error: "Failed to fetch live positions" });
    }
  });

  // Manual cleanup trigger - run all cleanup tasks immediately
  app.post("/api/cleanup/manual", async (req, res) => {
    try {
      console.log('🧹 Manual cleanup requested via API');
      const result = await strategyEngine.runManualCleanup();
      res.json({
        success: true,
        ...result,
        message: result.totalActions > 0 
          ? `Cleanup complete: ${result.totalActions} actions taken`
          : 'All systems healthy, no cleanup needed'
      });
    } catch (error: any) {
      console.error('Error running manual cleanup:', error);
      res.status(500).json({ 
        success: false,
        error: error.message || "Failed to run cleanup" 
      });
    }
  });

  // Get open orders from Aster DEX
  app.get("/api/live/open-orders", async (req, res) => {
    try {
      // Check cache first to prevent rate limiting
      const cached = getCached<any[]>('live_open_orders');
      if (cached) {
        return res.json(cached);
      }

      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "Aster DEX API keys not configured" });
      }

      // Optional query parameter for symbol filtering
      const symbol = req.query.symbol as string | undefined;

      // Create signed request to get open orders
      const timestamp = Date.now();
      let params = `timestamp=${timestamp}`;
      if (symbol) {
        params += `&symbol=${symbol}`;
      }
      
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/openOrders?${params}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch Aster DEX open orders:', errorText);
        return res.status(response.status).json({ error: `Aster DEX API error: ${errorText}` });
      }

      const data = await response.json();

      // Cache the result (same TTL as positions)
      setCache('live_open_orders', data);

      res.json(data);
    } catch (error) {
      console.error('Error fetching live open orders:', error);
      res.status(500).json({ error: "Failed to fetch live open orders" });
    }
  });

  // One-time cleanup: Cancel all open TP/SL orders on the exchange
  app.post("/api/live/cleanup-orders", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "Aster DEX API keys not configured" });
      }

      console.log('🧹 Starting manual cleanup of all open TP/SL orders...');

      // Fetch all open orders from exchange
      const timestamp = Date.now();
      const params = `timestamp=${timestamp}&recvWindow=5000`;
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/openOrders?${params}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to fetch open orders:', errorText);
        return res.status(response.status).json({ error: `Failed to fetch orders: ${errorText}` });
      }

      const orders = await response.json();
      console.log(`📋 Found ${orders.length} total open orders`);

      // Filter for TP/SL orders only
      const tpslOrders = orders.filter((order: any) => 
        order.type === 'LIMIT' || 
        order.type === 'STOP_MARKET' || 
        order.type === 'TAKE_PROFIT_MARKET'
      );

      console.log(`🎯 Found ${tpslOrders.length} TP/SL orders to cancel`);

      let cancelledCount = 0;
      let failedCount = 0;

      // Cancel each TP/SL order
      for (const order of tpslOrders) {
        try {
          const cancelTimestamp = Date.now();
          const cancelParams = `symbol=${order.symbol}&orderId=${order.orderId}&timestamp=${cancelTimestamp}&recvWindow=5000`;
          const cancelSignature = crypto
            .createHmac('sha256', secretKey)
            .update(cancelParams)
            .digest('hex');

          const cancelResponse = await fetch(
            `https://fapi.asterdex.com/fapi/v1/order?${cancelParams}&signature=${cancelSignature}`,
            {
              method: 'DELETE',
              headers: {
                'X-MBX-APIKEY': apiKey,
              },
            }
          );

          if (cancelResponse.ok) {
            cancelledCount++;
            console.log(`✅ Cancelled ${order.type} order for ${order.symbol} (ID: ${order.orderId})`);
          } else {
            failedCount++;
            const errorText = await cancelResponse.text();
            console.error(`❌ Failed to cancel order ${order.orderId}: ${errorText}`);
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          failedCount++;
          console.error(`❌ Error cancelling order ${order.orderId}:`, error);
        }
      }

      console.log(`🎉 Cleanup complete: ${cancelledCount} cancelled, ${failedCount} failed`);

      res.json({
        success: true,
        totalOrders: orders.length,
        tpslOrders: tpslOrders.length,
        cancelled: cancelledCount,
        failed: failedCount,
        message: `Cancelled ${cancelledCount} TP/SL orders. The system will recreate proper exit orders automatically.`
      });

    } catch (error) {
      console.error('❌ Error during order cleanup:', error);
      res.status(500).json({ error: "Failed to cleanup orders" });
    }
  });

  // Ensure all open positions have TP/SL orders
  app.post("/api/live/ensure-tpsl", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "Aster DEX API keys not configured" });
      }

      console.log('🛡️ Ensuring all open positions have TP/SL orders...');

      // Get the active strategy to get TP/SL percentages
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      const activeStrategy = strategies.find(s => s.isActive);

      if (!activeStrategy) {
        return res.status(400).json({ error: "No active strategy found" });
      }

      // Get active session
      const session = await storage.getActiveTradeSession(activeStrategy.id);
      if (!session) {
        return res.status(400).json({ error: "No active session found" });
      }

      // Get all open positions for this session
      const openPositions = await storage.getOpenPositions(session.id);
      console.log(`📊 Found ${openPositions.length} open positions to check`);

      // Fetch exchange precision info once for all symbols
      const precisionResponse = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
      const precisionData = await precisionResponse.json();
      const symbolPrecisionMap = new Map();
      
      for (const symbolInfo of precisionData.symbols) {
        const tickSize = parseFloat(symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER')?.tickSize || '0.01');
        const stepSize = parseFloat(symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE')?.stepSize || '0.01');
        symbolPrecisionMap.set(symbolInfo.symbol, { tickSize, stepSize });
      }
      
      // Helper function to round to tick size
      const roundToTickSize = (price: number, tickSize: number): number => {
        return Math.round(price / tickSize) * tickSize;
      };
      
      // Helper function to round to step size
      const roundToStepSize = (qty: number, stepSize: number): number => {
        return Math.floor(qty / stepSize) * stepSize;
      };

      let placedTP = 0;
      let placedSL = 0;
      let alreadyProtected = 0;

      for (const position of openPositions) {
        try {
          // Fetch existing orders for this symbol
          const timestamp = Date.now();
          const params = `symbol=${position.symbol}&timestamp=${timestamp}&recvWindow=5000`;
          const signature = crypto
            .createHmac('sha256', secretKey)
            .update(params)
            .digest('hex');

          const response = await fetch(
            `https://fapi.asterdex.com/fapi/v1/openOrders?${params}&signature=${signature}`,
            {
              headers: {
                'X-MBX-APIKEY': apiKey,
              },
            }
          );

          if (!response.ok) {
            console.error(`❌ Failed to fetch orders for ${position.symbol}`);
            continue;
          }

          const orders = await response.json();

          // Get precision info from map
          const precisionInfo = symbolPrecisionMap.get(position.symbol);
          if (!precisionInfo) {
            console.error(`❌ No precision info for ${position.symbol}`);
            continue;
          }

          const { tickSize, stepSize } = precisionInfo;

          // Get precision for formatting
          const pricePrecision = tickSize.toString().split('.')[1]?.length || 0;
          const qtyPrecision = stepSize.toString().split('.')[1]?.length || 0;

          // Calculate TP and SL prices
          const entryPrice = parseFloat(position.avgEntryPrice);
          let quantity = parseFloat(position.totalQuantity);
          const tpPercent = parseFloat(activeStrategy.profitTargetPercent);
          const slPercent = parseFloat(activeStrategy.stopLossPercent);

          let tpPrice: number;
          let slPrice: number;

          if (position.side === 'long') {
            tpPrice = roundToTickSize(entryPrice * (1 + tpPercent / 100), tickSize);
            slPrice = roundToTickSize(entryPrice * (1 - slPercent / 100), tickSize);
          } else {
            tpPrice = roundToTickSize(entryPrice * (1 - tpPercent / 100), tickSize);
            slPrice = roundToTickSize(entryPrice * (1 + slPercent / 100), tickSize);
          }
          
          // Round quantity to step size
          quantity = roundToStepSize(quantity, stepSize);

          // Check for existing TP order
          const hasTPOrder = orders.some((o: any) => 
            o.positionSide?.toLowerCase() === position.side &&
            (o.type === 'TAKE_PROFIT_MARKET' || 
             (o.type === 'LIMIT' && Math.abs(parseFloat(o.price || '0') - tpPrice) < tpPrice * 0.01))
          );

          // Check for existing SL order
          const hasSLOrder = orders.some((o: any) => 
            o.positionSide?.toLowerCase() === position.side &&
            o.type === 'STOP_MARKET'
          );

          if (hasTPOrder && hasSLOrder) {
            alreadyProtected++;
            console.log(`✅ ${position.symbol} ${position.side} already has TP/SL orders`);
            continue;
          }

          // Place missing TP order (LIMIT order)
          if (!hasTPOrder) {
            console.log(`📤 Placing TP order for ${position.symbol} ${position.side} at $${tpPrice.toFixed(4)}`);
            
            const tpSide = position.side === 'long' ? 'SELL' : 'BUY';
            const tpTimestamp = Date.now();
            const tpParams = {
              symbol: position.symbol,
              side: tpSide,
              type: 'LIMIT',
              quantity: quantity.toFixed(qtyPrecision),
              price: tpPrice.toFixed(pricePrecision),
              timeInForce: 'GTC',
              timestamp: tpTimestamp,
              recvWindow: 5000,
            };
            
            const tpQueryString = Object.entries(tpParams)
              .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
              .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
              .join('&');
            
            const tpSignature = crypto
              .createHmac('sha256', secretKey)
              .update(tpQueryString)
              .digest('hex');
            
            const tpResponse = await fetch(
              `https://fapi.asterdex.com/fapi/v1/order?${tpQueryString}&signature=${tpSignature}`,
              {
                method: 'POST',
                headers: {
                  'X-MBX-APIKEY': apiKey,
                },
              }
            );
            
            if (tpResponse.ok) {
              placedTP++;
              console.log(`✅ TP order placed for ${position.symbol} ${position.side}`);
            } else {
              const errorText = await tpResponse.text();
              console.error(`❌ Failed to place TP order: ${errorText}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 200)); // Delay to avoid rate limits
          }

          // Place missing SL order (STOP_MARKET order)
          if (!hasSLOrder) {
            console.log(`📤 Placing SL order for ${position.symbol} ${position.side} at $${slPrice.toFixed(4)}`);
            
            const slSide = position.side === 'long' ? 'SELL' : 'BUY';
            const slTimestamp = Date.now();
            const slParams = {
              symbol: position.symbol,
              side: slSide,
              type: 'STOP_MARKET',
              quantity: quantity.toFixed(qtyPrecision),
              stopPrice: slPrice.toFixed(pricePrecision),
              timestamp: slTimestamp,
              recvWindow: 5000,
            };
            
            const slQueryString = Object.entries(slParams)
              .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
              .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
              .join('&');
            
            const slSignature = crypto
              .createHmac('sha256', secretKey)
              .update(slQueryString)
              .digest('hex');
            
            const slResponse = await fetch(
              `https://fapi.asterdex.com/fapi/v1/order?${slQueryString}&signature=${slSignature}`,
              {
                method: 'POST',
                headers: {
                  'X-MBX-APIKEY': apiKey,
                },
              }
            );
            
            if (slResponse.ok) {
              placedSL++;
              console.log(`✅ SL order placed for ${position.symbol} ${position.side}`);
            } else {
              const errorText = await slResponse.text();
              console.error(`❌ Failed to place SL order: ${errorText}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 200)); // Delay to avoid rate limits
          }

        } catch (error) {
          console.error(`❌ Error ensuring TP/SL for ${position.symbol}:`, error);
        }
      }

      console.log(`✅ TP/SL check complete: ${placedTP} TP orders placed, ${placedSL} SL orders placed, ${alreadyProtected} already protected`);

      res.json({
        success: true,
        totalPositions: openPositions.length,
        placedTP,
        placedSL,
        alreadyProtected,
        message: `Placed ${placedTP} TP and ${placedSL} SL orders. ${alreadyProtected} positions already protected.`
      });

    } catch (error) {
      console.error('❌ Error ensuring TP/SL orders:', error);
      res.status(500).json({ error: "Failed to ensure TP/SL orders" });
    }
  });

  // Get account trade history from Aster DEX (filtered by live session start time)
  app.get("/api/live/trades", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "Aster DEX API keys not configured" });
      }

      // Get the active strategy to check session start time
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      const activeStrategy = strategies.find(s => s.isActive);

      // If no active strategy, return empty array
      if (!activeStrategy) {
        return res.json([]);
      }

      // Use live session start time to filter trades (only show current session trades)
      let sessionStartTime: number | undefined;
      if (activeStrategy.liveSessionStartedAt) {
        sessionStartTime = new Date(activeStrategy.liveSessionStartedAt).getTime();
        console.log(`📊 Filtering live trades from session start: ${new Date(sessionStartTime).toISOString()}`);
      }

      // Optional query parameters
      const symbol = req.query.symbol as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 1000, 1000); // Max 1000
      const startTime = sessionStartTime?.toString() || req.query.startTime as string | undefined;

      // Create signed request to get trade history
      const timestamp = Date.now();
      let params = `timestamp=${timestamp}&limit=${limit}`;
      if (symbol) params += `&symbol=${symbol}`;
      if (startTime) params += `&startTime=${startTime}`;

      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/userTrades?${params}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch Aster DEX trades:', errorText);
        return res.status(response.status).json({ error: `Aster DEX API error: ${errorText}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Error fetching live trade history:', error);
      res.status(500).json({ error: "Failed to fetch live trade history" });
    }
  });

  // Get overall trading performance metrics
  app.get("/api/performance/overview", async (req, res) => {
    try {
      // Get the active strategy
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      const activeStrategy = strategies.find(s => s.isActive);

      // If no active strategy, return zeros
      if (!activeStrategy) {
        return res.json({
          totalTrades: 0,
          openTrades: 0,
          closedTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          totalRealizedPnl: 0,
          totalUnrealizedPnl: 0,
          totalPnl: 0,
          averageWin: 0,
          averageLoss: 0,
          bestTrade: 0,
          worstTrade: 0,
          profitFactor: 0,
          totalFees: 0,
          fundingCost: 0,
          averageTradeTimeMs: 0
        });
      }

      // Get the active session for this strategy
      const activeSession = await storage.getActiveTradeSession(activeStrategy.id);

      // If no active session, return zeros
      if (!activeSession) {
        const responseData = {
          totalTrades: 0,
          openTrades: 0,
          closedTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          totalRealizedPnl: 0,
          totalUnrealizedPnl: 0,
          totalPnl: 0,
          totalPnlPercent: 0,
          averageWin: 0,
          averageLoss: 0,
          bestTrade: 0,
          worstTrade: 0,
          profitFactor: 0,
          totalFees: 0,
          fundingCost: 0,
          averageTradeTimeMs: 0,
          maxDrawdown: 0,
          maxDrawdownPercent: 0
        };
        console.log("📊 Performance Overview (no session):", JSON.stringify(responseData));
        return res.json(responseData);
      }

      // Get ONLY ACTIVE sessions for this strategy (excludes archived)
      const allSessions = await storage.getSessionsByStrategy(activeStrategy.id);
      const activeSessions = allSessions.filter(s => s.isActive === true);
      
      // Get positions from ACTIVE sessions only
      const allPositions: any[] = [];
      const allSessionFills: any[] = [];
      
      for (const session of activeSessions) {
        const sessionPositions = await storage.getPositionsBySession(session.id);
        const sessionFills = await storage.getFillsBySession(session.id);
        allPositions.push(...sessionPositions);
        allSessionFills.push(...sessionFills);
      }

      if (!allPositions || allPositions.length === 0) {
        return res.json({
          totalTrades: 0,
          openTrades: 0,
          closedTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          totalRealizedPnl: 0,
          totalUnrealizedPnl: 0,
          totalPnl: 0,
          totalPnlPercent: 0,
          averageWin: 0,
          averageLoss: 0,
          bestTrade: 0,
          worstTrade: 0,
          profitFactor: 0,
          totalFees: 0,
          fundingCost: 0,
          averageTradeTimeMs: 0,
          maxDrawdown: 0,
          maxDrawdownPercent: 0
        });
      }

      // Calculate metrics
      const openPositions = allPositions.filter(p => p.isOpen === true);
      const closedPositions = allPositions.filter(p => p.isOpen === false);
      
      // CRITICAL: realizedPnl is ALREADY in DOLLARS (not percentage!)
      const closedPnlDollars = closedPositions.map(p => {
        return parseFloat(p.realizedPnl || '0');
      });
      
      const winningTrades = closedPnlDollars.filter(pnl => pnl > 0);
      const losingTrades = closedPnlDollars.filter(pnl => pnl < 0);
      
      const totalRealizedPnl = closedPnlDollars.reduce((sum, pnl) => sum + pnl, 0);
      
      // Convert unrealized P&L percentages to dollar amounts for open positions
      // CRITICAL: totalCost stores MARGIN, multiply by leverage to get notional value
      const totalUnrealizedPnl = openPositions.reduce((sum, p) => {
        const pnlPercent = parseFloat(p.unrealizedPnl || '0');
        const totalCost = parseFloat(p.totalCost || '0');
        const leverage = (p as any).leverage || 1;
        const notionalValue = totalCost * leverage;
        const pnlDollar = (pnlPercent / 100) * notionalValue;
        return sum + pnlDollar;
      }, 0);
      
      const totalPnl = totalRealizedPnl + totalUnrealizedPnl;
      
      const winRate = closedPositions.length > 0 ? (winningTrades.length / closedPositions.length) * 100 : 0;
      
      const averageWin = winningTrades.length > 0
        ? winningTrades.reduce((sum, pnl) => sum + pnl, 0) / winningTrades.length
        : 0;
      
      const averageLoss = losingTrades.length > 0
        ? losingTrades.reduce((sum, pnl) => sum + pnl, 0) / losingTrades.length
        : 0;
      
      const bestTrade = closedPnlDollars.length > 0 ? Math.max(...closedPnlDollars) : 0;
      const worstTrade = closedPnlDollars.length > 0 ? Math.min(...closedPnlDollars) : 0;
      
      const totalWins = winningTrades.reduce((sum, pnl) => sum + pnl, 0);
      const totalLosses = Math.abs(losingTrades.reduce((sum, pnl) => sum + pnl, 0));
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

      // Calculate total fees from all fills across all sessions
      const totalFees = allSessionFills.reduce((sum, fill) => sum + parseFloat(fill.fee || '0'), 0);

      // Calculate total funding costs for all positions across all sessions
      let totalFundingCost = 0;
      
      // Fetch funding costs with API credentials
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (apiKey && secretKey) {
        try {
          // Get the earliest session start time to fetch all funding fees
          const sessionStartTimes = allSessions.map(s => new Date(s.startedAt).getTime());
          const earliestStartTime = Math.min(...sessionStartTimes);

          // Fetch funding fee income history from Aster DEX
          const timestamp = Date.now();
          const params = `incomeType=FUNDING_FEE&startTime=${earliestStartTime}&limit=1000&timestamp=${timestamp}`;
          
          const signature = crypto
            .createHmac('sha256', secretKey)
            .update(params)
            .digest('hex');

          const fundingResponse = await fetch(
            `https://fapi.asterdex.com/fapi/v1/income?${params}&signature=${signature}`,
            {
              headers: {
                'X-MBX-APIKEY': apiKey,
              },
            }
          );

          if (fundingResponse.ok) {
            const fundingData = await fundingResponse.json();
            
            // Sum up all funding fees (negative means we paid, positive means we received)
            // We want to show total cost as a positive number
            totalFundingCost = fundingData.reduce((sum: number, entry: any) => {
              const income = parseFloat(entry.income || '0');
              return sum + Math.abs(income); // Always show as cost (positive)
            }, 0);
            
            console.log(`📊 Calculated total funding cost: $${totalFundingCost.toFixed(2)} from ${fundingData.length} funding events`);
          } else {
            console.warn('⚠️ Failed to fetch funding fee history:', await fundingResponse.text());
          }
        } catch (error) {
          console.error('❌ Error fetching funding costs:', error);
        }
      }

      // Calculate average trade time from closed positions (in milliseconds)
      const tradeTimesMs = closedPositions
        .filter(p => p.openedAt && p.closedAt)
        .map(p => new Date(p.closedAt!).getTime() - new Date(p.openedAt!).getTime());
      
      const averageTradeTimeMs = tradeTimesMs.length > 0
        ? tradeTimesMs.reduce((sum, time) => sum + time, 0) / tradeTimesMs.length
        : 0;

      // Calculate percentage P&L based on starting balance
      const startingBalance = parseFloat(activeSession.startingBalance);
      const totalPnlPercent = startingBalance > 0 ? (totalPnl / startingBalance) * 100 : 0;

      // Calculate maximum drawdown from cumulative P&L
      let maxDrawdown = 0;
      if (closedPositions.length > 0) {
        let peakPnl = 0;
        let cumulativePnl = 0;
        
        for (const p of closedPositions) {
          // CRITICAL: realizedPnl is ALREADY in DOLLARS (not percentage!)
          const pnlDollar = parseFloat(p.realizedPnl || '0');
          cumulativePnl += pnlDollar;
          
          // Update peak if we reached a new high
          if (cumulativePnl > peakPnl) {
            peakPnl = cumulativePnl;
          }
          
          // Calculate drawdown from peak
          const currentDrawdown = peakPnl - cumulativePnl;
          if (currentDrawdown > maxDrawdown) {
            maxDrawdown = currentDrawdown;
          }
        }
      }
      
      // Calculate drawdown as percentage of starting balance
      const maxDrawdownPercent = startingBalance > 0 ? (maxDrawdown / startingBalance) * 100 : 0;

      res.json({
        totalTrades: allPositions.length, // Total trades includes both open and closed positions
        openTrades: openPositions.length,
        closedTrades: closedPositions.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        totalRealizedPnl,
        totalUnrealizedPnl,
        totalPnl,
        totalPnlPercent,
        averageWin,
        averageLoss,
        bestTrade,
        worstTrade,
        profitFactor,
        totalFees,
        fundingCost: totalFundingCost,
        averageTradeTimeMs,
        maxDrawdown,
        maxDrawdownPercent
      });
    } catch (error) {
      console.error('Error fetching performance overview:', error);
      res.status(500).json({ error: "Failed to fetch performance overview" });
    }
  });

  app.get("/api/performance/chart", async (req, res) => {
    try {
      // Get active strategy and session
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      const activeStrategy = strategies.find((s: any) => s.isActive === true);
      
      if (!activeStrategy) {
        return res.json([]);
      }

      // Get ONLY ACTIVE sessions for this strategy (excludes archived)
      const allSessions = await storage.getSessionsByStrategy(activeStrategy.id);
      const activeSessions = allSessions.filter(s => s.isActive === true);
      
      if (activeSessions.length === 0) {
        return res.json([]);
      }

      // Get all positions and fills from ACTIVE sessions only
      const allPositions: any[] = [];
      const sessionFills: any[] = [];
      
      for (const session of activeSessions) {
        const sessionPositions = await storage.getPositionsBySession(session.id);
        const fills = await storage.getFillsBySession(session.id);
        allPositions.push(...sessionPositions);
        sessionFills.push(...fills);
      }
      
      // Filter for closed positions only
      let closedPositions = allPositions.filter(p => p.isOpen === false && p.closedAt);
      
      closedPositions = closedPositions.sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

      if (closedPositions.length === 0) {
        return res.json([]);
      }
      
      let cumulativePnl = 0;
      const chartData = closedPositions.map((position, index) => {
        // CRITICAL: realizedPnl is ALREADY in DOLLARS (not percentage!)
        const grossPnlDollar = parseFloat(position.realizedPnl || '0');
        
        // Calculate fees for this position
        const positionOpenTime = new Date(position.openedAt).getTime();
        const positionCloseTime = position.closedAt ? new Date(position.closedAt).getTime() : Date.now();
        
        const exitFill = sessionFills.find(fill => fill.orderId === `exit-${position.id}`);
        const entryFills = sessionFills.filter(fill => {
          if (fill.symbol !== position.symbol) return false;
          if (fill.orderId.startsWith('exit-')) return false;
          const fillTime = new Date(fill.filledAt).getTime();
          const correctSide = (position.side === 'long' && fill.side === 'buy') || 
                             (position.side === 'short' && fill.side === 'sell');
          return correctSide && fillTime >= positionOpenTime && fillTime <= positionCloseTime;
        });
        
        const totalFees = [...entryFills, ...(exitFill ? [exitFill] : [])].reduce((sum, fill) => {
          return sum + parseFloat(fill.fee || '0');
        }, 0);
        
        // Net P&L = Gross P&L - Fees
        const netPnlDollar = grossPnlDollar - totalFees;
        cumulativePnl += netPnlDollar;
        
        return {
          tradeNumber: index + 1,
          timestamp: new Date(position.closedAt!).getTime(),
          symbol: position.symbol,
          side: position.side,
          pnl: netPnlDollar,
          cumulativePnl: cumulativePnl,
          entryPrice: parseFloat(position.avgEntryPrice),
          quantity: parseFloat(position.totalQuantity),
        };
      });

      res.json(chartData);
    } catch (error) {
      console.error('Error fetching performance chart data:', error);
      res.status(500).json({ error: "Failed to fetch performance chart data" });
    }
  });

  app.post("/api/strategies", async (req, res) => {
    try {
      const validatedData = frontendStrategySchema.parse({
        ...req.body,
        userId: DEFAULT_USER_ID
      });
      
      // Convert frontend data to database format with hardcoded 60-second liquidation window
      const strategyData = {
        name: validatedData.name,
        userId: validatedData.userId,
        selectedAssets: validatedData.selectedAssets,
        percentileThreshold: validatedData.percentileThreshold,
        maxLayers: validatedData.maxLayers,
        profitTargetPercent: validatedData.profitTargetPercent,
        stopLossPercent: validatedData.stopLossPercent,
        marginMode: validatedData.marginMode,
        leverage: validatedData.leverage,
        orderDelayMs: validatedData.orderDelayMs,
        slippageTolerancePercent: validatedData.slippageTolerancePercent,
        orderType: validatedData.orderType,
        maxRetryDurationMs: validatedData.maxRetryDurationMs,
        marginAmount: validatedData.marginAmount,
        isActive: validatedData.isActive || false,
      };
      
      const strategy = await storage.createStrategy(strategyData);
      res.status(201).json(strategy);
    } catch (error) {
      console.error('Error creating strategy:', error);
      if (error instanceof Error && 'issues' in error) {
        return res.status(400).json({ error: "Invalid data", details: error.message });
      }
      res.status(500).json({ error: "Failed to create strategy" });
    }
  });

  app.put("/api/strategies/:id", async (req, res) => {
    try {
      const strategyId = req.params.id;
      console.log('📝 Update strategy request:', JSON.stringify(req.body, null, 2));
      const validatedUpdates = updateStrategySchema.parse(req.body);
      console.log('✅ Validated updates:', JSON.stringify(validatedUpdates, null, 2));
      
      // Verify strategy exists
      const existingStrategy = await storage.getStrategy(strategyId);
      if (!existingStrategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Track changes for active sessions
      const changes: Record<string, { old: any; new: any }> = {};
      const fieldsToTrack = [
        'percentileThreshold', 'maxLayers', 'profitTargetPercent',
        'stopLossPercent', 'marginMode', 'leverage', 'orderDelayMs', 'slippageTolerancePercent',
        'orderType', 'maxRetryDurationMs', 'marginAmount', 'selectedAssets'
      ];
      
      fieldsToTrack.forEach(field => {
        const oldValue = existingStrategy[field as keyof typeof existingStrategy];
        const newValue = validatedUpdates[field as keyof typeof validatedUpdates];
        
        if (newValue !== undefined && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes[field] = { old: oldValue, new: newValue };
        }
      });
      
      // Normalize data - liquidation window is always 60 seconds regardless of input
      const updateData: any = {
        ...validatedUpdates
      };
      
      console.log('💾 Sending to database:', JSON.stringify(updateData, null, 2));
      await storage.updateStrategy(strategyId, updateData);
      
      // CRITICAL: Reload strategy in engine whenever ANY settings change
      // This ensures position sizing and all other settings are applied immediately
      if (Object.keys(changes).length > 0) {
        console.log(`🔄 Reloading strategy in engine to apply updated settings...`);
        await strategyEngine.reloadStrategy(strategyId);
      }
      
      // If there are changes and strategy has an active session, record the change
      if (Object.keys(changes).length > 0) {
        const activeSession = await storage.getActiveTradeSession(strategyId);
        if (activeSession) {
          await storage.recordStrategyChange({
            strategyId,
            sessionId: activeSession.id,
            changes: changes as any,
          });
          console.log(`📋 Recorded ${Object.keys(changes).length} strategy changes for session ${activeSession.id}`);
        }
      }
      
      // Fetch and return refreshed strategy
      const updatedStrategy = await storage.getStrategy(strategyId);
      console.log('📊 Updated strategy from DB:', JSON.stringify(updatedStrategy, null, 2));
      
      // Notify strategy engine to reload the strategy
      strategyEngine.reloadStrategy(strategyId);
      
      res.status(200).json(updatedStrategy);
    } catch (error) {
      console.error('Error updating strategy:', error);
      if (error instanceof Error && 'issues' in error) {
        return res.status(400).json({ error: "Invalid data", details: error.message });
      }
      res.status(500).json({ error: "Failed to update strategy" });
    }
  });

  // DCA Settings API Endpoints
  app.get("/api/strategies/:id/dca", async (req, res) => {
    try {
      const strategyId = req.params.id;
      const { getStrategyWithDCA } = await import('./dca-sql');
      const strategy = await getStrategyWithDCA(strategyId);
      
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      res.json({
        dcaStartStepPercent: strategy.dca_start_step_percent,
        dcaSpacingConvexity: strategy.dca_spacing_convexity,
        dcaSizeGrowth: strategy.dca_size_growth,
        dcaMaxRiskPercent: strategy.dca_max_risk_percent,
        dcaVolatilityRef: strategy.dca_volatility_ref,
        dcaExitCushionMultiplier: strategy.dca_exit_cushion_multiplier,
        retHighThreshold: strategy.ret_high_threshold,
        retMediumThreshold: strategy.ret_medium_threshold
      });
    } catch (error) {
      console.error('Error fetching DCA settings:', error);
      res.status(500).json({ error: "Failed to fetch DCA settings" });
    }
  });

  app.put("/api/strategies/:id/dca", async (req, res) => {
    try {
      const strategyId = req.params.id;
      
      // Validate using Zod schema - handle both undefined and null values
      const dcaUpdateSchema = z.object({
        dcaStartStepPercent: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0.1 && num <= 5.0;
        }, "Must be between 0.1 and 5.0").nullable().optional(),
        dcaSpacingConvexity: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 1.0 && num <= 2.0;
        }, "Must be between 1.0 and 2.0").nullable().optional(),
        dcaSizeGrowth: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 1.0 && num <= 3.0;
        }, "Must be between 1.0 and 3.0").nullable().optional(),
        dcaMaxRiskPercent: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0.1 && num <= 10.0;
        }, "Must be between 0.1 and 10.0").nullable().optional(),
        dcaVolatilityRef: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0.1 && num <= 10.0;
        }, "Must be between 0.1 and 10.0").nullable().optional(),
        dcaExitCushionMultiplier: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0.1 && num <= 2.0;
        }, "Must be between 0.1 and 2.0").nullable().optional(),
        retHighThreshold: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 10 && num <= 100;
        }, "Must be between 10 and 100").nullable().optional(),
        retMediumThreshold: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 5 && num <= 100;
        }, "Must be between 5 and 100").nullable().optional(),
      });
      
      const validatedData = dcaUpdateSchema.parse(req.body);
      
      // Filter out null and undefined values
      const filteredData = Object.fromEntries(
        Object.entries(validatedData).filter(([_, value]) => value != null && value !== '')
      );
      
      if (Object.keys(filteredData).length === 0) {
        return res.status(400).json({ error: "No DCA parameters provided" });
      }
      
      const { updateStrategyDCAParams } = await import('./dca-sql');
      const updated = await updateStrategyDCAParams(strategyId, filteredData);
      
      if (!updated) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      await strategyEngine.reloadStrategy(strategyId);
      console.log(`🔄 Reloaded strategy ${strategyId} with updated DCA settings`);
      
      res.json({
        dcaStartStepPercent: updated.dca_start_step_percent,
        dcaSpacingConvexity: updated.dca_spacing_convexity,
        dcaSizeGrowth: updated.dca_size_growth,
        dcaMaxRiskPercent: updated.dca_max_risk_percent,
        dcaVolatilityRef: updated.dca_volatility_ref,
        dcaExitCushionMultiplier: updated.dca_exit_cushion_multiplier,
        retHighThreshold: updated.ret_high_threshold,
        retMediumThreshold: updated.ret_medium_threshold
      });
    } catch (error) {
      console.error('Error updating DCA settings:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid DCA parameters", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update DCA settings" });
    }
  });

  app.post("/api/strategies/:id/start", async (req, res) => {
    try {
      const strategyId = req.params.id;
      
      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Update strategy to active status (using fixed 60-second liquidation window)
      await storage.updateStrategy(strategyId, { 
        isActive: true
      });
      
      // Register with strategy engine to create trade session
      await strategyEngine.registerStrategy(strategy);
      
      // Return updated strategy for easier frontend sync
      const updatedStrategy = await storage.getStrategy(strategyId);
      res.status(200).json(updatedStrategy);
    } catch (error) {
      console.error('Error starting strategy:', error);
      res.status(500).json({ error: "Failed to start strategy" });
    }
  });

  app.post("/api/strategies/:id/stop", async (req, res) => {
    try {
      const strategyId = req.params.id;
      
      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Update strategy to inactive status 
      await storage.updateStrategy(strategyId, { 
        isActive: false
      });
      
      // Unregister from strategy engine and end trade session
      await strategyEngine.unregisterStrategy(strategyId);
      
      // Return updated strategy for easier frontend sync
      const updatedStrategy = await storage.getStrategy(strategyId);
      res.status(200).json(updatedStrategy);
    } catch (error) {
      console.error('Error stopping strategy:', error);
      res.status(500).json({ error: "Failed to stop strategy" });
    }
  });

  // Pause strategy route (temporarily stop processing without deactivating)
  app.post("/api/strategies/:id/pause", async (req, res) => {
    try {
      const strategyId = req.params.id;
      
      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Update strategy to paused status
      await storage.updateStrategy(strategyId, { 
        paused: true
      });
      
      // Reload strategy in engine to pick up paused status
      const updatedStrategy = await storage.getStrategy(strategyId);
      if (updatedStrategy && updatedStrategy.isActive) {
        await strategyEngine.registerStrategy(updatedStrategy);
      }
      
      res.status(200).json(updatedStrategy);
    } catch (error) {
      console.error('Error pausing strategy:', error);
      res.status(500).json({ error: "Failed to pause strategy" });
    }
  });

  // Resume strategy route (unpause trading)
  app.post("/api/strategies/:id/resume", async (req, res) => {
    try {
      const strategyId = req.params.id;
      
      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Update strategy to unpaused status
      await storage.updateStrategy(strategyId, { 
        paused: false
      });
      
      // Reload strategy in engine to pick up resumed status
      const updatedStrategy = await storage.getStrategy(strategyId);
      if (updatedStrategy && updatedStrategy.isActive) {
        await strategyEngine.registerStrategy(updatedStrategy);
      }
      
      res.status(200).json(updatedStrategy);
    } catch (error) {
      console.error('Error resuming strategy:', error);
      res.status(500).json({ error: "Failed to resume strategy" });
    }
  });

  // Emergency stop route (close all open positions)
  app.post("/api/strategies/:id/emergency-stop", async (req, res) => {
    try {
      const strategyId = req.params.id;
      const { pin } = req.body;
      
      // Verify PIN
      if (pin !== "2233") {
        return res.status(401).json({ error: "Invalid PIN" });
      }
      
      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Find the active trade session for this strategy
      const session = await storage.getActiveTradeSession(strategyId);
      if (!session) {
        return res.status(404).json({ error: "No active trade session found" });
      }
      
      // Get all open positions
      const openPositions = await storage.getOpenPositions(session.id);
      
      const closedPositions = [];
      let totalPnl = 0;
      
      // Close all positions
      for (const position of openPositions) {
        try {
          // ALWAYS fetch real-time current price from Aster DEX API
          let currentPrice: number | null = null;
          try {
            const asterApiUrl = `https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${position.symbol}`;
            const priceResponse = await fetch(asterApiUrl);
            
            if (priceResponse.ok) {
              const priceData = await priceResponse.json();
              currentPrice = parseFloat(priceData.price);
            }
          } catch (apiError) {
            console.error(`Failed to fetch price for ${position.symbol}:`, apiError);
            continue; // Skip this position if we can't get price
          }
          
          if (!currentPrice) {
            console.error(`Unable to get price for ${position.symbol}, skipping`);
            continue;
          }

          // Calculate P&L
          const avgEntryPrice = parseFloat(position.avgEntryPrice);
          let unrealizedPnl = 0;
          if (position.side === 'long') {
            unrealizedPnl = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;
          } else {
            unrealizedPnl = ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100;
          }

          // Calculate dollar P&L
          // CRITICAL: totalCost stores MARGIN, multiply by leverage to get notional value
          const totalCost = parseFloat(position.totalCost);
          const leverage = (position as any).leverage || 1;
          const notionalValue = totalCost * leverage;
          const dollarPnl = (unrealizedPnl / 100) * notionalValue;

          // Emergency close = limit order (manual close style) = 0.01% maker fee (SAME FOR BOTH PAPER AND LIVE)
          const quantity = parseFloat(position.totalQuantity);
          const exitValue = currentPrice * quantity;
          const exitFee = (exitValue * 0.01) / 100; // Apply fee for BOTH paper and live
          
          // Create exit fill record
          await storage.applyFill({
            orderId: `emergency-exit-${position.id}`,
            sessionId: position.sessionId,
            positionId: position.id,
            symbol: position.symbol,
            side: position.side === 'long' ? 'sell' : 'buy',
            quantity: position.totalQuantity,
            price: currentPrice.toString(),
            value: exitValue.toString(),
            fee: exitFee.toString(),
            layerNumber: 0,
          });

          // Close the position with dollar P&L and percentage (preserve percentage for display)
          await storage.closePosition(position.id, new Date(), dollarPnl, unrealizedPnl);
          
          // Accumulate P&L (deduct exit fee for BOTH paper and live)
          const netDollarPnl = dollarPnl - exitFee;
          totalPnl += netDollarPnl;
          
          closedPositions.push({
            id: position.id,
            symbol: position.symbol,
            side: position.side,
            pnlPercent: unrealizedPnl,
            pnlDollar: netDollarPnl,
          });
          
          console.log(`🚨 Emergency closed position ${position.symbol} at $${currentPrice} with ${unrealizedPnl.toFixed(2)}% P&L ($${netDollarPnl.toFixed(2)})`);
        } catch (error) {
          console.error(`Error closing position ${position.id}:`, error);
        }
      }
      
      // Update session balance and stats
      if (closedPositions.length > 0) {
        const newTotalTrades = session.totalTrades + closedPositions.length;
        const oldTotalPnl = parseFloat(session.totalPnl);
        const newTotalPnl = oldTotalPnl + totalPnl;
        const oldBalance = parseFloat(session.currentBalance);
        const newBalance = oldBalance + totalPnl;

        await storage.updateTradeSession(session.id, {
          totalTrades: newTotalTrades,
          totalPnl: newTotalPnl.toString(),
          currentBalance: newBalance.toString(),
        });
      }
      
      res.status(200).json({ 
        message: `Emergency stop completed. Closed ${closedPositions.length} of ${openPositions.length} positions.`,
        closedPositions,
        totalPnl
      });
    } catch (error) {
      console.error('Error executing emergency stop:', error);
      res.status(500).json({ error: "Failed to execute emergency stop" });
    }
  });

  // Delete strategy route
  app.delete("/api/strategies/:id", async (req, res) => {
    try {
      const strategyId = req.params.id;
      
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Delete strategy from storage
      await storage.deleteStrategy(strategyId);
      
      res.status(204).send(); // No content response
    } catch (error) {
      console.error('Error deleting strategy:', error);
      res.status(500).json({ error: "Failed to delete strategy" });
    }
  });

  // Cascade Detector API routes
  app.get("/api/cascade/status", async (req, res) => {
    try {
      const statuses = cascadeDetectorService.getAllStatuses();
      res.json(statuses);
    } catch (error) {
      console.error('Error fetching cascade status:', error);
      res.status(500).json({ error: "Failed to fetch cascade status" });
    }
  });

  app.post("/api/cascade/auto", async (req, res) => {
    try {
      const { autoEnabled } = req.body;
      
      if (typeof autoEnabled !== 'boolean') {
        return res.status(400).json({ error: "autoEnabled must be a boolean" });
      }
      
      cascadeDetectorService.setAutoEnabled(autoEnabled);
      
      res.json({ 
        success: true, 
        autoEnabled: cascadeDetectorService.getAutoEnabled() 
      });
    } catch (error) {
      console.error('Error setting cascade auto mode:', error);
      res.status(500).json({ error: "Failed to set cascade auto mode" });
    }
  });

  const httpServer = createServer(app);

  // WebSocket server for real-time liquidation updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Store connected clients
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    clients.add(ws);
    
    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
      clients.delete(ws);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
    });
  });

  // Connect strategy engine with WebSocket clients for trade notifications
  strategyEngine.setWebSocketClients(clients);
  
  // Connect WebSocket broadcaster for real-time event broadcasting
  wsBroadcaster.setClients(clients);
  
  // Initialize cascade detector service
  cascadeDetectorService.setClients(clients);
  cascadeDetectorService.start();
  
  // Connect to Aster DEX WebSocket and relay data
  connectToAsterDEX(clients);
  
  // Connect to User Data Stream for real-time position/balance updates
  connectToUserDataStream();

  // Positions API Routes
  app.get('/api/positions/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const positions = await storage.getOpenPositions(sessionId);
      res.json(positions);
    } catch (error) {
      console.error('Error fetching positions:', error);
      res.status(500).json({ error: 'Failed to fetch positions' });
    }
  });

  // Helper function to sync live fills from exchange to database
  async function syncLiveFills(strategyId: string, sessionId: string): Promise<void> {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;

    if (!apiKey || !secretKey) {
      return;
    }

    const strategy = await storage.getStrategy(strategyId);
    if (!strategy || !strategy.liveSessionStartedAt) {
      return;
    }

    const sessionStartTime = new Date(strategy.liveSessionStartedAt).getTime();

    // Fetch fills from exchange
    const timestamp = Date.now();
    const params = `timestamp=${timestamp}&limit=1000&startTime=${sessionStartTime}`;
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(params)
      .digest('hex');

    try {
      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/userTrades?${params}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey },
        }
      );

      if (!response.ok) {
        return;
      }

      const exchangeFills = await response.json();

      // Get existing fills to avoid duplicates
      const existingFills = await storage.getFillsBySession(sessionId);
      const existingTradeIds = new Set(
        existingFills
          .map(f => f.orderId.startsWith('trade-') ? f.orderId.substring(6) : null)
          .filter(Boolean)
      );

      // Track max layer number per symbol-side to ensure sequential numbering
      const maxLayerNumbers = new Map<string, number>();
      existingFills.forEach(f => {
        const key = `${f.symbol}-${f.side}`;
        const currentMax = maxLayerNumbers.get(key) || 0;
        maxLayerNumbers.set(key, Math.max(currentMax, f.layerNumber));
      });

      // Process and store new fills
      for (const trade of exchangeFills) {
        const tradeId = trade.id.toString();
        
        if (existingTradeIds.has(tradeId)) {
          continue;
        }

        const side = trade.side === 'BUY' ? 'buy' : 'sell';
        const key = `${trade.symbol}-${side}`;
        const layerNumber = (maxLayerNumbers.get(key) || 0) + 1;
        maxLayerNumbers.set(key, layerNumber);

        const fillData: InsertFill = {
          orderId: `trade-${tradeId}`,
          sessionId,
          positionId: null,
          symbol: trade.symbol,
          side,
          quantity: trade.qty,
          price: trade.price,
          value: trade.quoteQty,
          fee: trade.commission || '0',
          layerNumber,
        };

        try {
          await storage.applyFill(fillData);
          existingTradeIds.add(tradeId);
        } catch (fillError: any) {
          // Ignore unique constraint violations (duplicate fills from race conditions)
          if (fillError?.code === '23505') { // PostgreSQL unique violation error code
            continue;
          }
          throw fillError;
        }
      }
    } catch (error) {
      console.error('Error syncing live fills:', error);
    }
  }

  // Get position summary by strategy ID (finds active trade session automatically)
  app.get('/api/strategies/:strategyId/positions/summary', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Check cache first to prevent rate limiting (2 minute cache)
      const cacheKey = `position_summary_${strategyId}`;
      const cached = getCached<any>(cacheKey, 120000); // 2 minute TTL
      if (cached) {
        return res.json(cached);
      }
      
      // Get the strategy to check trading mode
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: 'Strategy not found' });
      }

      // Fetch positions from exchange
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "Aster DEX API keys not configured" });
      }

      // Get the active session (create if missing)
      let liveSession = await storage.getActiveTradeSession(strategyId);
      if (!liveSession) {
        // Session doesn't exist - create new session
        liveSession = await storage.createTradeSession({
          strategyId,
          startingBalance: '0', // Will be set from exchange
          currentBalance: '0',
          isActive: true
        });
        console.log(`✅ Created fallback live session: ${liveSession.id}`);
      }

        // Sync fills from exchange to database
        await syncLiveFills(strategyId, liveSession.id);

        // Get positions from exchange to check which database positions should be closed
        const posCheckTimestamp = Date.now();
        const posCheckParams = `timestamp=${posCheckTimestamp}`;
        const posCheckSignature = crypto
          .createHmac('sha256', secretKey)
          .update(posCheckParams)
          .digest('hex');

        const posCheckResponse = await fetch(
          `https://fapi.asterdex.com/fapi/v2/positionRisk?${posCheckParams}&signature=${posCheckSignature}`,
          {
            headers: { 'X-MBX-APIKEY': apiKey },
          }
        );

        if (posCheckResponse.ok) {
          const exchangePositions = await posCheckResponse.json();
          
          // Get all open database positions for this session
          const dbOpenPositions = await storage.getOpenPositions(liveSession.id);
          
          // Build a set of symbols+sides that are still open on the exchange
          const exchangeOpenSymbols = new Set<string>();
          for (const exPos of exchangePositions) {
            const posAmt = parseFloat(exPos.positionAmt);
            if (posAmt !== 0) {
              const side = posAmt > 0 ? 'long' : 'short';
              exchangeOpenSymbols.add(`${exPos.symbol}-${side}`);
            }
          }
          
          // Close any database positions that are no longer open on the exchange
          for (const dbPos of dbOpenPositions) {
            const key = `${dbPos.symbol}-${dbPos.side}`;
            if (!exchangeOpenSymbols.has(key)) {
              // Position closed on exchange, close it in database
              // Calculate realized P&L (dollar amount) from fills
              let realizedPnlPercent = 0;
              
              try {
                // Get all fills for this position from the database (entry + exit)
                const positionFills = await storage.getFillsBySession(liveSession.id);
                const symbolFills = positionFills.filter(f => 
                  f.symbol === dbPos.symbol && 
                  new Date(f.filledAt) >= new Date(dbPos.openedAt)
                );
                
                if (symbolFills.length > 0) {
                  // Separate entry and exit fills
                  const entrySide = dbPos.side === 'long' ? 'buy' : 'sell';
                  const exitSide = dbPos.side === 'long' ? 'sell' : 'buy';
                  
                  const entryFills = symbolFills.filter(f => f.side === entrySide);
                  const exitFills = symbolFills.filter(f => f.side === exitSide);
                  
                  // Use the existing avgEntryPrice from the position
                  const avgEntryPrice = parseFloat(dbPos.avgEntryPrice);
                  
                  // Calculate weighted average exit price from exit fills
                  if (exitFills.length > 0) {
                    const totalExitValue = exitFills.reduce((sum, f) => sum + parseFloat(f.value), 0);
                    const totalExitQty = exitFills.reduce((sum, f) => sum + parseFloat(f.quantity), 0);
                    const avgExitPrice = totalExitQty > 0 ? totalExitValue / totalExitQty : avgEntryPrice;
                    
                    // Calculate P&L percentage based on position side
                    if (dbPos.side === 'long') {
                      realizedPnlPercent = ((avgExitPrice - avgEntryPrice) / avgEntryPrice) * 100;
                    } else {
                      realizedPnlPercent = ((avgEntryPrice - avgExitPrice) / avgEntryPrice) * 100;
                    }
                    
                    console.log(`📊 Calculated P&L for ${dbPos.symbol} ${dbPos.side}: ${realizedPnlPercent.toFixed(2)}% (Entry: $${avgEntryPrice}, Exit: $${avgExitPrice})`);
                  } else {
                    // No exit fills found, fetch current price to estimate P&L
                    try {
                      const priceResponse = await fetch(`https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${dbPos.symbol}`);
                      if (priceResponse.ok) {
                        const priceData = await priceResponse.json();
                        const currentPrice = parseFloat(priceData.price);
                        
                        if (dbPos.side === 'long') {
                          realizedPnlPercent = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;
                        } else {
                          realizedPnlPercent = ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100;
                        }
                        
                        console.log(`📊 Estimated P&L for ${dbPos.symbol} ${dbPos.side}: ${realizedPnlPercent.toFixed(2)}% (Entry: $${avgEntryPrice}, Current: $${currentPrice})`);
                      }
                    } catch (priceError) {
                      console.error(`Failed to fetch price for P&L calculation:`, priceError);
                    }
                  }
                }
              } catch (error) {
                console.error(`Error calculating realized P&L for ${dbPos.symbol}:`, error);
              }
              
              // Convert percentage to dollar amount
              // CRITICAL: totalCost stores MARGIN, multiply by leverage to get notional value
              const totalCost = parseFloat(dbPos.totalCost);
              const leverage = (dbPos as any).leverage || 1;
              const notionalValue = totalCost * leverage;
              const realizedPnlDollar = (realizedPnlPercent / 100) * notionalValue;
              
              console.log(`🔒 Closing database position ${dbPos.symbol} ${dbPos.side} with ${realizedPnlPercent.toFixed(2)}% P&L ($${realizedPnlDollar.toFixed(2)}) (closed on exchange)`);
              
              await storage.closePosition(dbPos.id, new Date(), realizedPnlDollar, realizedPnlPercent);
            }
          }
          
          // Create DB entries for orphaned exchange positions (positions on exchange but not in DB)
          for (const exPos of exchangePositions) {
            const posAmt = parseFloat(exPos.positionAmt);
            if (posAmt !== 0) {
              const side = posAmt > 0 ? 'long' : 'short';
              const key = `${exPos.symbol}-${side}`;
              
              // Check if this exchange position has a corresponding DB entry
              const dbPos = dbOpenPositions.find(p => `${p.symbol}-${p.side}` === key);
              
              if (!dbPos) {
                // Orphaned exchange position found - create DB entry for monitoring
                console.warn(`⚠️ ORPHANED POSITION DETECTED: ${exPos.symbol} ${side} with ${Math.abs(posAmt)} units on exchange but NOT in database`);
                console.warn(`   This position will now be tracked and monitored for stop-loss`);
                
                const entryPrice = parseFloat(exPos.entryPrice);
                const quantity = Math.abs(posAmt);
                const leverage = parseInt(exPos.leverage) || strategy.leverage || 1;
                // Calculate actual margin used (notional / leverage)
                const notionalValue = entryPrice * quantity;
                const actualMargin = notionalValue / leverage;
                
                // Create position in database so it will be monitored for stop-loss
                const orphanedPosition = await storage.createPosition({
                  sessionId: liveSession.id,
                  symbol: exPos.symbol,
                  side,
                  totalQuantity: quantity.toString(),
                  avgEntryPrice: entryPrice.toString(),
                  initialEntryPrice: entryPrice.toString(), // P0: Set initial entry for DCA calculations
                  dcaBaseSize: quantity.toString(), // q1: Use current quantity as base size (best guess for orphaned)
                  totalCost: actualMargin.toString(), // Actual margin = notional / leverage
                  layersFilled: 1,
                  maxLayers: strategy.maxLayers,
                  leverage,
                  lastLayerPrice: entryPrice.toString(),
                });
                
                console.log(`✅ Created DB entry for orphaned position: ${exPos.symbol} ${side} (ID: ${orphanedPosition.id})`);
                console.log(`   Entry: $${entryPrice}, Quantity: ${quantity}, Margin: $${actualMargin.toFixed(2)} (${leverage}x leverage)`);
              }
            }
          }
        }

        // Get account info for balance and unrealized P&L
        const accountTimestamp = Date.now();
        const accountParams = `timestamp=${accountTimestamp}`;
        const accountSignature = crypto
          .createHmac('sha256', secretKey)
          .update(accountParams)
          .digest('hex');

        const accountResponse = await fetch(
          `https://fapi.asterdex.com/fapi/v2/account?${accountParams}&signature=${accountSignature}`,
          {
            headers: { 'X-MBX-APIKEY': apiKey },
          }
        );

        if (!accountResponse.ok) {
          let errorMessage = '';
          try {
            const errorText = await accountResponse.text();
            errorMessage = errorText || accountResponse.statusText;
          } catch {
            errorMessage = accountResponse.statusText;
          }
          
          if (accountResponse.status === 429) {
            console.error('⚠️ Rate limit exceeded for Aster DEX account endpoint');
            return res.status(429).json({ error: `Rate limit exceeded. Please wait before trying again. ${errorMessage}` });
          } else if (accountResponse.status === 401 || accountResponse.status === 403) {
            console.error('🔑 Authentication failed for Aster DEX:', errorMessage);
            return res.status(accountResponse.status).json({ error: `Authentication failed. Check your API keys. ${errorMessage}` });
          }
          
          console.error(`❌ Failed to fetch Aster DEX account (${accountResponse.status}):`, errorMessage);
          return res.status(accountResponse.status).json({ error: `Aster DEX API error (${accountResponse.status}): ${errorMessage}` });
        }

        const account = await accountResponse.json();

        // Get positions from exchange
        const posTimestamp = Date.now();
        const posParams = `timestamp=${posTimestamp}`;
        const posSignature = crypto
          .createHmac('sha256', secretKey)
          .update(posParams)
          .digest('hex');

        const posResponse = await fetch(
          `https://fapi.asterdex.com/fapi/v2/positionRisk?${posParams}&signature=${posSignature}`,
          {
            headers: { 'X-MBX-APIKEY': apiKey },
          }
        );

        if (!posResponse.ok) {
          const errorText = await posResponse.text();
          console.error('Failed to fetch Aster DEX positions:', errorText);
          return res.status(posResponse.status).json({ error: `Aster DEX API error: ${errorText}` });
        }

        const exchangePositions = await posResponse.json();
        
        // Fetch actual fills from exchange for all symbols since session start
        const sessionStartTime = strategy.liveSessionStartedAt ? new Date(strategy.liveSessionStartedAt).getTime() : Date.now();
        const fillsTimestamp = Date.now();
        const fillsParams = `timestamp=${fillsTimestamp}&limit=1000&startTime=${sessionStartTime}`;
        const fillsSignature = crypto
          .createHmac('sha256', secretKey)
          .update(fillsParams)
          .digest('hex');

        let allExchangeFills: any[] = [];
        try {
          const fillsResponse = await fetch(
            `https://fapi.asterdex.com/fapi/v1/userTrades?${fillsParams}&signature=${fillsSignature}`,
            {
              headers: { 'X-MBX-APIKEY': apiKey },
            }
          );

          if (fillsResponse.ok) {
            allExchangeFills = await fillsResponse.json();
          }
        } catch (fillsError) {
          console.error('Failed to fetch exchange fills for positions:', fillsError);
        }
        
        // Filter out positions with zero quantity and map to our format
        const positions = exchangePositions
          .filter((pos: any) => parseFloat(pos.positionAmt) !== 0)
          .map((pos: any) => {
            const side = parseFloat(pos.positionAmt) > 0 ? 'long' : 'short';
            const targetSide = side === 'long' ? 'BUY' : 'SELL';
            
            // Get fills for this position symbol/side, sorted chronologically
            const allSymbolFills = allExchangeFills
              .filter((trade: any) => trade.symbol === pos.symbol && trade.side === targetSide)
              .sort((a, b) => a.time - b.time);
            
            // Current position quantity
            const currentQty = Math.abs(parseFloat(pos.positionAmt));
            
            // Work backwards from most recent fills to find which fills built this position
            const reversedFills = [...allSymbolFills].reverse();
            const currentPositionFills: any[] = [];
            let accumulatedQty = 0;
            
            for (const fill of reversedFills) {
              currentPositionFills.unshift(fill);
              accumulatedQty += parseFloat(fill.qty);
              
              // Once we've accumulated enough quantity to match current position, we found all fills
              if (accumulatedQty >= currentQty) {
                break;
              }
            }
            
            // Map to our format with sequential layer numbers
            const positionFills = currentPositionFills.map((trade: any, index: number) => ({
              id: `exchange-${trade.id}`,
              orderId: trade.orderId.toString(),
              sessionId: 'live-session',
              positionId: null,
              symbol: trade.symbol,
              side: trade.side === 'BUY' ? 'buy' : 'sell',
              quantity: trade.qty,
              price: trade.price,
              value: trade.quoteQty,
              fee: trade.commission || '0',
              layerNumber: index + 1,
              filledAt: new Date(trade.time),
            }));

            // Calculate unrealized P&L percentage from exchange-provided dollar amount
            // Exchange already handles long/short logic correctly
            const totalCost = Math.abs(parseFloat(pos.positionAmt)) * parseFloat(pos.entryPrice);
            const unrealizedPnlDollar = parseFloat(pos.unRealizedProfit);
            const unrealizedPnlPercent = totalCost > 0 
              ? (unrealizedPnlDollar / totalCost * 100)
              : 0;

            return {
              id: `live-${pos.symbol}-${pos.positionSide}`,
              symbol: pos.symbol,
              side,
              totalQuantity: Math.abs(parseFloat(pos.positionAmt)).toString(),
              avgEntryPrice: pos.entryPrice,
              unrealizedPnl: unrealizedPnlPercent.toString(),
              totalCost: totalCost.toString(),
              leverage: parseInt(pos.leverage),
              positionSide: pos.positionSide,
              isOpen: true,
              openedAt: positionFills.length > 0 ? positionFills[0].filledAt.toISOString() : new Date().toISOString(),
              fills: positionFills, // Include only fills from current position instance
            };
          });

        // Calculate totals from exchange data
        const totalUnrealizedPnl = parseFloat(account.totalUnrealizedProfit || '0');
        const startingBalance = parseFloat(account.totalWalletBalance || '0') - totalUnrealizedPnl;
        const currentBalance = parseFloat(account.totalWalletBalance || '0');
        const totalExposure = positions.reduce((sum: number, pos: any) => sum + parseFloat(pos.totalCost), 0);

        const sessionId = liveSession ? liveSession.id : 'live-session';

        const summary = {
          sessionId,
          strategyId,
          startingBalance,
          currentBalance,
          totalPnl: totalUnrealizedPnl, // In live mode, we only show current P&L
          realizedPnl: 0, // Exchange doesn't provide session-based realized P&L
          unrealizedPnl: totalUnrealizedPnl,
          totalExposure,
          activePositions: positions.length,
          totalTrades: 0, // Exchange doesn't track session trades
          winRate: 0,
          positions
        };

        // Cache the result to prevent rate limiting
        setCache(cacheKey, summary);
        
        return res.json(summary);
    } catch (error) {
      console.error('Error fetching strategy position summary:', error);
      res.status(500).json({ error: 'Failed to fetch position summary' });
    }
  });

  app.get('/api/positions/:sessionId/summary', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const positions = await storage.getOpenPositions(sessionId);
      const closedPositions = await storage.getClosedPositions(sessionId);
      const session = await storage.getTradeSession(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: 'Trade session not found' });
      }

      // Calculate unrealized P&L from open positions
      // Convert unrealized P&L percentages to dollar values before summing
      // CRITICAL: totalCost stores MARGIN, multiply by leverage to get notional value
      const totalUnrealizedPnl = positions.reduce((sum, pos) => {
        const pnlPercent = parseFloat(pos.unrealizedPnl || '0');
        const totalCost = parseFloat(pos.totalCost || '0');
        const leverage = (pos as any).leverage || 1;
        const notionalValue = totalCost * leverage;
        const pnlDollar = (pnlPercent / 100) * notionalValue;
        return sum + pnlDollar;
      }, 0);

      // Calculate realized P&L from closed positions
      // This ensures accuracy even if session updates fail
      // Get all fills to calculate total fees
      const sessionFills = await storage.getFillsBySession(sessionId);
      
      const totalRealizedPnl = closedPositions.reduce((sum, pos) => {
        // CRITICAL: realizedPnl is ALREADY in DOLLARS (not percentage!)
        const pnlDollar = parseFloat(pos.realizedPnl || '0');
        
        // Calculate total fees for this position (all fills for this symbol)
        // This includes entry and exit fees
        const positionFills = sessionFills.filter(f => 
          f.symbol === pos.symbol && 
          new Date(f.filledAt) >= new Date(pos.openedAt) &&
          (!pos.closedAt || new Date(f.filledAt) <= new Date(pos.closedAt))
        );
        const totalFees = positionFills.reduce((feeSum, fill) => 
          feeSum + parseFloat(fill.fee || '0'), 0);
        
        // Net P&L = Gross P&L - Fees
        return sum + (pnlDollar - totalFees);
      }, 0);

      // Calculate current balance from starting balance + realized P&L (net of fees)
      const startingBalance = parseFloat(session.startingBalance);
      const currentBalance = startingBalance + totalRealizedPnl;
      
      // Calculate total NOTIONAL exposure (margin × leverage)
      const totalExposure = positions.reduce((sum, pos) => {
        const margin = parseFloat(pos.totalCost || '0');
        const leverage = pos.leverage || 1;
        return sum + (margin * leverage); // Notional = margin × leverage
      }, 0);
      const activePositions = positions.length;
      const totalTrades = closedPositions.length;

      const summary = {
        sessionId,
        startingBalance,
        currentBalance,
        totalPnl: totalRealizedPnl + totalUnrealizedPnl,
        realizedPnl: totalRealizedPnl,
        unrealizedPnl: totalUnrealizedPnl,
        totalExposure,
        activePositions,
        totalTrades,
        winRate: totalTrades > 0 
          ? (closedPositions.filter(p => parseFloat(p.unrealizedPnl || '0') > 0).length / totalTrades) * 100 
          : 0,
        positions
      };

      res.json(summary);
    } catch (error) {
      console.error('Error fetching position summary:', error);
      res.status(500).json({ error: 'Failed to fetch position summary' });
    }
  });

  // Get closed positions (completed trades) for a strategy
  app.get('/api/strategies/:strategyId/positions/closed', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Get the strategy to check trading mode
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: 'Strategy not found' });
      }

      // Get only ACTIVE (non-archived) sessions for this strategy
      const allSessions = await storage.getSessionsByStrategy(strategyId);
      const activeSessions = allSessions.filter(session => session.isActive);
      
      if (activeSessions.length === 0) {
        return res.json([]);
      }

      // Get closed positions from active sessions only
      const allClosedPositions: any[] = [];
      const allFills: any[] = [];
      
      for (const session of activeSessions) {
        const sessionClosedPositions = await storage.getClosedPositions(session.id);
        const sessionFills = await storage.getFillsBySession(session.id);
        allClosedPositions.push(...sessionClosedPositions);
        allFills.push(...sessionFills);
      }
      
      // Enhance closed positions with fee information
      const closedPositionsWithFees = allClosedPositions.map(position => {
        // Get fills for this specific position:
        // 1. Exit fill has synthetic orderId = `exit-${position.id}`
        // 2. Entry fills match by symbol AND fall within position's time window
        const exitFill = allFills.find(fill => fill.orderId === `exit-${position.id}`);
        
        // For entry fills, match by symbol and timestamp within position lifetime
        const positionOpenTime = new Date(position.openedAt).getTime();
        const positionCloseTime = position.closedAt ? new Date(position.closedAt).getTime() : Date.now();
        
        const entryFills = allFills.filter(fill => {
          if (fill.symbol !== position.symbol) return false;
          if (fill.orderId.startsWith('exit-')) return false; // Exclude exit fills
          
          const fillTime = new Date(fill.filledAt).getTime();
          // Entry fills should be between position open and close, with side matching position direction
          const correctSide = (position.side === 'long' && fill.side === 'buy') || 
                             (position.side === 'short' && fill.side === 'sell');
          return correctSide && fillTime >= positionOpenTime && fillTime <= positionCloseTime;
        });
        
        // Calculate total fees from entry fills + exit fill
        const totalFees = [...entryFills, ...(exitFill ? [exitFill] : [])].reduce((sum, fill) => {
          return sum + parseFloat(fill.fee || '0');
        }, 0);
        
        return {
          ...position,
          totalFees: totalFees.toFixed(4), // Include total fees for display
        };
      });
      
      // Prevent caching to ensure fresh data on each request
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      res.json(closedPositionsWithFees);
    } catch (error) {
      console.error('Error fetching closed positions:', error);
      res.status(500).json({ error: 'Failed to fetch closed positions' });
    }
  });

  // Get strategy changes for a session
  app.get('/api/strategies/:strategyId/changes', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Find the active trade session for this strategy
      const session = await storage.getActiveTradeSession(strategyId);
      
      if (!session) {
        return res.status(404).json({ error: 'No active trade session found for this strategy' });
      }

      const changes = await storage.getStrategyChanges(session.id);
      res.json(changes);
    } catch (error) {
      console.error('Error fetching strategy changes:', error);
      res.status(500).json({ error: 'Failed to fetch strategy changes' });
    }
  });

  // Get fills for a position (for layer details)
  app.get('/api/positions/:positionId/fills', async (req, res) => {
    try {
      const { positionId } = req.params;
      
      // Handle live positions (IDs like: live-HYPEUSDT-LONG)
      if (positionId.startsWith('live-')) {
        // Extract symbol from live position ID
        const parts = positionId.substring(5).split('-'); // Remove "live-" prefix
        const positionSide = parts.pop() || 'BOTH'; // Last part is position side (LONG/SHORT/BOTH)
        const symbol = parts.join('-'); // Rest is symbol (handles symbols with dashes)
        
        // Get active strategy to find session start time
        const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
        const activeStrategy = strategies.find(s => s.isActive);
        
        if (!activeStrategy || !activeStrategy.liveSessionStartedAt) {
          return res.json([]);
        }

        // Fetch actual fills from exchange
        const apiKey = process.env.ASTER_API_KEY;
        const secretKey = process.env.ASTER_SECRET_KEY;

        if (!apiKey || !secretKey) {
          return res.status(400).json({ error: 'Aster DEX API keys not configured' });
        }

        const sessionStartTime = new Date(activeStrategy.liveSessionStartedAt as unknown as string).getTime();

        // Fetch trade history from exchange for this symbol
        const timestamp = Date.now();
        const params = `symbol=${symbol}&timestamp=${timestamp}&limit=1000&startTime=${sessionStartTime}`;
        const signature = crypto
          .createHmac('sha256', secretKey)
          .update(params)
          .digest('hex');

        try {
          const response = await fetch(
            `https://fapi.asterdex.com/fapi/v1/userTrades?${params}&signature=${signature}`,
            {
              headers: { 'X-MBX-APIKEY': apiKey },
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to fetch exchange fills:', errorText);
            return res.json([]);
          }

          const exchangeFills = await response.json();

          // Determine fill side based on position side
          let targetSide: string;
          if (positionSide === 'LONG' || positionSide.includes('LONG')) {
            targetSide = 'BUY';
          } else if (positionSide === 'SHORT' || positionSide.includes('SHORT')) {
            targetSide = 'SELL';
          } else {
            // For BOTH or unknown, return all fills (rare case)
            const fills = exchangeFills.map((trade: any, index: number) => ({
              id: `exchange-${trade.id}`,
              orderId: trade.orderId.toString(),
              sessionId: 'live-session',
              positionId: null,
              symbol: trade.symbol,
              side: trade.side === 'BUY' ? 'buy' : 'sell',
              quantity: trade.qty,
              price: trade.price,
              value: trade.quoteQty,
              fee: trade.commission || '0',
              layerNumber: index + 1,
              filledAt: new Date(trade.time),
            }));
            return res.json(fills);
          }

          // Get current position quantity from exchange
          const posTimestamp = Date.now();
          const posParams = `timestamp=${posTimestamp}`;
          const posSignature = crypto
            .createHmac('sha256', secretKey)
            .update(posParams)
            .digest('hex');

          const posResponse = await fetch(
            `https://fapi.asterdex.com/fapi/v2/positionRisk?${posParams}&signature=${posSignature}`,
            {
              headers: { 'X-MBX-APIKEY': apiKey },
            }
          );

          if (!posResponse.ok) {
            return res.json([]);
          }

          const positions = await posResponse.json();
          
          // In one-way mode, positionSide is 'BOTH' but we identify direction by positionAmt sign
          // In hedge mode, positionSide is 'LONG' or 'SHORT'
          let currentPosition = positions.find((p: any) => p.symbol === symbol);
          
          if (!currentPosition || parseFloat(currentPosition.positionAmt) === 0) {
            return res.json([]);
          }
          
          // Verify the position direction matches what we're looking for
          const posAmt = parseFloat(currentPosition.positionAmt);
          const isLongPosition = posAmt > 0;
          const isShortPosition = posAmt < 0;
          
          if ((positionSide === 'LONG' && !isLongPosition) || (positionSide === 'SHORT' && !isShortPosition)) {
            return res.json([]);
          }

          const currentQty = Math.abs(parseFloat(currentPosition.positionAmt));

          // Filter to target side and sort chronologically
          const allSymbolFills = exchangeFills
            .filter((trade: any) => trade.side === targetSide)
            .sort((a: any, b: any) => a.time - b.time);

          // Work backwards from most recent fills to find which fills built this position
          const reversedFills = [...allSymbolFills].reverse();
          const currentPositionFills: any[] = [];
          let accumulatedQty = 0;

          for (const fill of reversedFills) {
            currentPositionFills.unshift(fill);
            accumulatedQty += parseFloat(fill.qty);

            // Once we've accumulated enough quantity to match current position, we found all fills
            if (accumulatedQty >= currentQty) {
              break;
            }
          }

          // Map to our format with sequential layer numbers
          const fills = currentPositionFills.map((trade: any, index: number) => ({
            id: `exchange-${trade.id}`,
            orderId: trade.orderId.toString(),
            sessionId: 'live-session',
            positionId: null,
            symbol: trade.symbol,
            side: trade.side === 'BUY' ? 'buy' : 'sell',
            quantity: trade.qty,
            price: trade.price,
            value: trade.quoteQty,
            fee: trade.commission || '0',
            layerNumber: index + 1,
            filledAt: new Date(trade.time),
          }));

          return res.json(fills);
        } catch (error) {
          console.error('Error fetching exchange fills:', error);
          return res.json([]);
        }
      }
      
      // Handle database positions
      const position = await storage.getPosition(positionId);
      if (!position) {
        return res.status(404).json({ error: 'Position not found' });
      }

      // Get all fills directly linked to this position via position_id
      // New fills will have position_id set; legacy fills will use time-range fallback
      const sessionFills = await storage.getFillsBySession(position.sessionId);
      
      const positionFills = sessionFills
        .filter(fill => {
          // Primary: Use position_id if available (new data model)
          if (fill.positionId) {
            return fill.positionId === positionId;
          }
          
          // Fallback: Use time-range filtering for legacy fills without position_id
          const positionOpenTime = new Date(position.openedAt).getTime();
          const positionCloseTime = position.closedAt ? new Date(position.closedAt).getTime() : Date.now();
          
          return fill.symbol === position.symbol && 
            new Date(fill.filledAt).getTime() >= positionOpenTime &&
            new Date(fill.filledAt).getTime() <= positionCloseTime;
        })
        .sort((a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime());

      res.json(positionFills);
    } catch (error) {
      console.error('Error fetching position fills:', error);
      res.status(500).json({ error: 'Failed to fetch position fills' });
    }
  });

  // Manual close position endpoint
  app.post('/api/positions/:positionId/close', async (req, res) => {
    try {
      const { positionId } = req.params;
      
      // Handle LIVE positions (from exchange, not database)
      if (positionId.startsWith('live-')) {
        console.log(`🔴 Attempting to close LIVE position: ${positionId}`);
        
        const apiKey = process.env.ASTER_API_KEY;
        const secretKey = process.env.ASTER_SECRET_KEY;

        if (!apiKey || !secretKey) {
          return res.status(400).json({ error: 'Aster DEX API keys not configured' });
        }

        // Extract symbol from live position ID (format: live-ETHUSDT-SHORT)
        const parts = positionId.substring(5).split('-');
        const positionSide = parts.pop() || 'BOTH';
        const symbol = parts.join('-');
        
        console.log(`📊 Extracted symbol: ${symbol}, side: ${positionSide}`);

        // Get current position from exchange
        const posTimestamp = Date.now();
        const posParams = `timestamp=${posTimestamp}`;
        const posSignature = crypto
          .createHmac('sha256', secretKey)
          .update(posParams)
          .digest('hex');

        const posResponse = await fetch(
          `https://fapi.asterdex.com/fapi/v2/positionRisk?${posParams}&signature=${posSignature}`,
          {
            headers: { 'X-MBX-APIKEY': apiKey },
          }
        );

        if (!posResponse.ok) {
          const errorText = await posResponse.text();
          console.error('❌ Failed to fetch position from exchange:', errorText);
          return res.status(posResponse.status).json({ error: 'Failed to fetch position from exchange' });
        }

        const positions = await posResponse.json();
        console.log(`📋 Found ${positions.length} positions on exchange:`, positions.map((p: any) => `${p.symbol}: ${p.positionAmt}`).join(', '));
        
        const targetPosition = positions.find((p: any) => p.symbol === symbol);

        if (!targetPosition || parseFloat(targetPosition.positionAmt) === 0) {
          console.log(`❌ Position ${symbol} not found or has zero quantity on exchange`);
          return res.status(404).json({ 
            error: `Position ${symbol} not found on exchange or already closed. This position may have been closed manually or no longer exists.` 
          });
        }
        
        console.log(`✅ Found target position: ${symbol} with amount ${targetPosition.positionAmt}`);

        const quantity = Math.abs(parseFloat(targetPosition.positionAmt));
        const side = parseFloat(targetPosition.positionAmt) > 0 ? 'SELL' : 'BUY'; // Opposite side to close

        // Place market order to close the position
        const orderTimestamp = Date.now();
        const orderParams = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${orderTimestamp}`;
        const orderSignature = crypto
          .createHmac('sha256', secretKey)
          .update(orderParams)
          .digest('hex');

        const orderResponse = await fetch(
          `https://fapi.asterdex.com/fapi/v1/order?${orderParams}&signature=${orderSignature}`,
          {
            method: 'POST',
            headers: { 'X-MBX-APIKEY': apiKey },
          }
        );

        if (!orderResponse.ok) {
          const errorText = await orderResponse.text();
          console.error('Failed to place close order:', errorText);
          return res.status(orderResponse.status).json({ error: `Failed to close position: ${errorText}` });
        }

        const orderResult = await orderResponse.json();
        console.log(`✅ Live position ${symbol} closed on exchange: ${side} ${quantity} (Order ID: ${orderResult.orderId})`);

        // Broadcast position closed event
        wsBroadcaster.broadcastPositionClosed({
          symbol,
          side: positionSide,
          quantity: quantity.toString(),
          orderId: orderResult.orderId,
        });

        return res.json({
          success: true,
          message: `Position ${symbol} closed on exchange`,
          orderId: orderResult.orderId,
          symbol,
          side,
          quantity: quantity.toString(),
        });
      }

      // Handle PAPER TRADING positions (from database)
      const position = await storage.getPosition(positionId);
      if (!position) {
        return res.status(404).json({ error: 'Position not found' });
      }

      if (!position.isOpen) {
        return res.status(400).json({ error: 'Position is already closed' });
      }

      // ALWAYS fetch real-time current price from Aster DEX API (no cache)
      let currentPrice: number | null = null;
      try {
        const asterApiUrl = `https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${position.symbol}`;
        const priceResponse = await fetch(asterApiUrl);
        
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          currentPrice = parseFloat(priceData.price);
          console.log(`📊 Fetched real-time price for ${position.symbol} from Aster API: $${currentPrice}`);
        }
      } catch (apiError) {
        console.error('Failed to fetch price from Aster API:', apiError);
      }
      
      if (!currentPrice) {
        return res.status(400).json({ error: 'Unable to get current market price. Please try again.' });
      }

      // Calculate P&L
      const avgEntryPrice = parseFloat(position.avgEntryPrice);
      let unrealizedPnl = 0;
      if (position.side === 'long') {
        unrealizedPnl = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;
      } else {
        unrealizedPnl = ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100;
      }

      // Calculate dollar P&L
      // CRITICAL: totalCost stores MARGIN, multiply by leverage to get notional value
      const totalCost = parseFloat(position.totalCost);
      const leverage = (position as any).leverage || 1;
      const notionalValue = totalCost * leverage;
      const dollarPnl = (unrealizedPnl / 100) * notionalValue;

      // Get session
      const session = await storage.getTradeSession(position.sessionId);
      
      // Manual close = limit order (take profit style) = 0.01% maker fee
      const quantity = parseFloat(position.totalQuantity);
      const exitValue = currentPrice * quantity;
      const exitFee = (exitValue * 0.01) / 100; // Apply fee for BOTH paper and live
      
      // Create exit fill record
      await storage.applyFill({
        orderId: `exit-${position.id}`,
        sessionId: position.sessionId,
        positionId: position.id,
        symbol: position.symbol,
        side: position.side === 'long' ? 'sell' : 'buy',
        quantity: position.totalQuantity,
        price: currentPrice.toString(),
        value: exitValue.toString(),
        fee: exitFee.toString(),
        layerNumber: 0,
      });

      // Close the position with dollar P&L and percentage (preserve percentage for display)
      await storage.closePosition(position.id, new Date(), dollarPnl, unrealizedPnl);

      // Update session balance and stats (deduct exit fee for BOTH paper and live)
      if (session) {
        const newTotalTrades = session.totalTrades + 1;
        const oldTotalPnl = parseFloat(session.totalPnl);
        const netDollarPnl = dollarPnl - exitFee; // Deduct fee for both modes
        const newTotalPnl = oldTotalPnl + netDollarPnl;
        const oldBalance = parseFloat(session.currentBalance);
        const newBalance = oldBalance + netDollarPnl;

        await storage.updateTradeSession(session.id, {
          totalTrades: newTotalTrades,
          totalPnl: newTotalPnl.toString(),
          currentBalance: newBalance.toString(),
        });
        
        console.log(`💸 Manual exit fee applied: $${exitFee.toFixed(4)} (0.01% maker fee - limit order)`)
      }

      console.log(`✋ Manually closed position ${position.symbol} at $${currentPrice} via LIMIT (manual/take profit) with ${unrealizedPnl.toFixed(2)}% P&L ($${dollarPnl.toFixed(2)})`);

      res.json({ 
        success: true, 
        position: {
          ...position,
          isOpen: false,
          closedAt: new Date(),
        },
        exitPrice: currentPrice,
        pnlPercent: unrealizedPnl,
        pnlDollar: dollarPnl,
        exitFee: exitFee
      });
    } catch (error) {
      console.error('Error closing position:', error);
      res.status(500).json({ error: 'Failed to close position' });
    }
  });

  // Archive current session and start fresh (NEVER deletes historical data)
  app.post('/api/strategies/:strategyId/reset-session', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Get the strategy to verify it exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: 'Strategy not found' });
      }

      // Get all active sessions for this strategy
      const activeSessions = await storage.getSessionsByStrategy(strategyId);
      const activeSessionsFiltered = activeSessions.filter(s => s.isActive);
      
      let archivedSessionCount = 0;
      let totalPositionsArchived = 0;
      let totalFillsArchived = 0;

      // Archive (mark inactive) all active sessions - NEVER delete data
      for (const session of activeSessionsFiltered) {
        // Count positions and fills for reporting (but don't delete them)
        const positions = await storage.getPositionsBySession(session.id);
        const fills = await storage.getFillsBySession(session.id);
        totalPositionsArchived += positions.length;
        totalFillsArchived += fills.length;
        
        // Mark session as archived (inactive) with end timestamp
        await storage.endTradeSession(session.id);
        
        archivedSessionCount++;
      }

      // Create a brand new session with fresh starting balance
      const newSession = await storage.createTradeSession({
        strategyId,
        startingBalance: '10000.0',
        currentBalance: '10000.0',
        totalPnl: '0.0',
        totalTrades: 0,
        winRate: '0.0',
        isActive: true,
      });

      console.log(`📦 Archived ${archivedSessionCount} session(s) with ${totalPositionsArchived} positions and ${totalFillsArchived} fills for strategy ${strategyId}`);
      console.log(`✨ Created new session ${newSession.id} - ALL HISTORICAL DATA PRESERVED`);

      res.json({ 
        success: true, 
        message: 'Started fresh session - all historical data preserved',
        archived: {
          sessions: archivedSessionCount,
          positions: totalPositionsArchived,
          fills: totalFillsArchived
        },
        newSessionId: newSession.id
      });
    } catch (error) {
      console.error('Error resetting session:', error);
      res.status(500).json({ error: 'Failed to reset session' });
    }
  });

  // Archive all empty sessions (sessions with no closed positions)
  app.post('/api/strategies/:strategyId/archive-empty-sessions', async (req, res) => {
    try {
      const { strategyId } = req.params;
      console.log(`🧹 Archiving empty sessions for strategy ${strategyId}`);
      
      // Get all sessions for this strategy
      const allSessions = await storage.getSessionsByStrategy(strategyId);
      
      let archivedCount = 0;
      
      for (const session of allSessions) {
        // Skip already archived sessions
        if (!session.isActive) continue;
        
        // Get positions for this session
        const positions = await storage.getPositionsBySession(session.id);
        const closedPositions = positions.filter(p => !p.isOpen && p.closedAt);
        
        // If no closed positions, archive it
        if (closedPositions.length === 0) {
          await storage.endTradeSession(session.id);
          console.log(`🧹 Archived empty session ${session.id}`);
          archivedCount++;
        }
      }
      
      res.json({
        success: true,
        message: `Archived ${archivedCount} empty session(s)`,
        archivedSessions: archivedCount
      });
    } catch (error) {
      console.error('Error archiving empty sessions:', error);
      res.status(500).json({ error: 'Failed to archive empty sessions' });
    }
  });

  // Archive sessions with positions before a specific date
  app.post('/api/strategies/:strategyId/archive-before-date', async (req, res) => {
    try {
      const { strategyId } = req.params;
      const { cutoffDate } = req.body; // ISO date string, e.g., "2024-10-04T00:00:00.000Z"
      
      if (!cutoffDate) {
        return res.status(400).json({ error: 'cutoffDate is required' });
      }
      
      const cutoff = new Date(cutoffDate);
      console.log(`📦 Archiving sessions with all positions before ${cutoff.toISOString()}`);
      
      // Get all sessions for this strategy
      const allSessions = await storage.getSessionsByStrategy(strategyId);
      
      let archivedCount = 0;
      let keptCount = 0;
      
      for (const session of allSessions) {
        // Skip already archived sessions
        if (!session.isActive) {
          console.log(`⏭️ Session ${session.id} already archived, skipping`);
          continue;
        }
        
        // Get all positions for this session
        const positions = await storage.getPositionsBySession(session.id);
        const closedPositions = positions.filter(p => !p.isOpen && p.closedAt);
        
        // If no closed positions, skip
        if (closedPositions.length === 0) {
          console.log(`⏭️ Session ${session.id} has no closed positions, keeping active`);
          keptCount++;
          continue;
        }
        
        // Check if ANY position closed on or after the cutoff date
        const hasRecentTrades = closedPositions.some(p => 
          new Date(p.closedAt!).getTime() >= cutoff.getTime()
        );
        
        if (hasRecentTrades) {
          console.log(`✅ Session ${session.id} has positions on/after ${cutoff.toISOString()}, keeping active`);
          keptCount++;
        } else {
          // All positions are before cutoff - archive this session
          await storage.endTradeSession(session.id);
          console.log(`📦 Archived session ${session.id} (${closedPositions.length} positions, all before cutoff)`);
          archivedCount++;
        }
      }
      
      res.json({
        success: true,
        message: `Archived ${archivedCount} session(s) with trades before ${cutoffDate}`,
        archivedSessions: archivedCount,
        activeSessions: keptCount
      });
    } catch (error) {
      console.error('Error archiving sessions by date:', error);
      res.status(500).json({ error: 'Failed to archive sessions' });
    }
  });

  // Reactivate an archived session
  app.patch('/api/sessions/:sessionId/reactivate', async (req, res) => {
    try {
      const { sessionId } = req.params;
      console.log(`🔄 Reactivating session ${sessionId}`);
      
      // Set this session as active and clear ended_at
      await storage.updateTradeSession(sessionId, {
        isActive: true
      } as any);
      
      res.json({ success: true, message: 'Session reactivated' });
    } catch (error) {
      console.error('Error reactivating session:', error);
      res.status(500).json({ error: 'Failed to reactivate session' });
    }
  });

  // Get all historical sessions for a strategy (including archived)
  app.get('/api/strategies/:strategyId/sessions/history', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Get all sessions (active and archived) for this strategy
      const sessions = await storage.getSessionsByStrategy(strategyId);
      
      // Get position counts for each session
      const sessionsWithDetails = await Promise.all(
        sessions.map(async (session) => {
          const positions = await storage.getPositionsBySession(session.id);
          const fills = await storage.getFillsBySession(session.id);
          
          return {
            ...session,
            positionCount: positions.length,
            fillCount: fills.length,
            openPositions: positions.filter(p => p.isOpen).length,
            closedPositions: positions.filter(p => !p.isOpen).length,
          };
        })
      );

      // Sort by most recent first
      sessionsWithDetails.sort((a, b) => {
        const aDate = a.endedAt || a.startedAt;
        const bDate = b.endedAt || b.startedAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });

      res.json(sessionsWithDetails);
    } catch (error) {
      console.error('Error fetching session history:', error);
      res.status(500).json({ error: 'Failed to fetch session history' });
    }
  });

  // Strategy Snapshot endpoints
  
  // Create a snapshot of the current strategy configuration
  app.post('/api/strategies/:strategyId/snapshots', async (req, res) => {
    try {
      const { strategyId } = req.params;
      const { description } = req.body;
      
      // Get the current strategy
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: 'Strategy not found' });
      }

      // Create snapshot with full strategy data
      const snapshot = await storage.createStrategySnapshot({
        strategyId,
        userId: strategy.userId,
        snapshotData: strategy as any, // Store entire strategy as JSON
        description: description || 'Manual snapshot',
      });

      console.log(`📸 Created snapshot ${snapshot.id} for strategy ${strategyId}`);

      res.json(snapshot);
    } catch (error) {
      console.error('Error creating snapshot:', error);
      res.status(500).json({ error: 'Failed to create snapshot' });
    }
  });

  // Get all snapshots for a strategy
  app.get('/api/strategies/:strategyId/snapshots', async (req, res) => {
    try {
      const { strategyId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      
      const snapshots = await storage.getStrategySnapshots(strategyId, limit);
      
      res.json(snapshots);
    } catch (error) {
      console.error('Error fetching snapshots:', error);
      res.status(500).json({ error: 'Failed to fetch snapshots' });
    }
  });

  // Restore a strategy from a snapshot
  app.post('/api/strategies/snapshots/:snapshotId/restore', async (req, res) => {
    try {
      const { snapshotId } = req.params;
      
      const restoredStrategy = await storage.restoreStrategyFromSnapshot(snapshotId);
      
      // Reload the strategy in the engine if it's active
      if (strategyEngine && restoredStrategy.isActive) {
        await strategyEngine.reloadStrategy(restoredStrategy.id);
      }

      console.log(`🔄 Restored strategy ${restoredStrategy.id} from snapshot ${snapshotId}`);

      res.json(restoredStrategy);
    } catch (error) {
      console.error('Error restoring snapshot:', error);
      res.status(500).json({ error: 'Failed to restore snapshot' });
    }
  });

  return httpServer;
}

// Global deduplication cache using Aster DEX event timestamps (persists across reconnections)
const recentLiquidations = new Map<string, number>(); // Maps eventTimestamp -> last seen time
const processingQueue = new Map<string, Promise<void>>(); // Maps eventTimestamp -> processing promise
const DEDUP_WINDOW_MS = 5000; // 5 second window for in-memory cache cleanup

// User Data Stream management
let currentListenKey: string | null = null;
let listenKeyExpiry: number = 0;
let userDataWs: WebSocket | null = null;
let keepaliveInterval: NodeJS.Timeout | null = null;

async function connectToAsterDEX(clients: Set<WebSocket>) {
  try {
    console.log('Connecting to Aster DEX WebSocket...');
    
    // Connect to Aster DEX liquidation stream using proper stream API
    const asterWs = new WebSocket('wss://fstream.asterdex.com/stream?streams=!forceOrder@arr');
    
    asterWs.on('open', () => {
      console.log('✅ Successfully connected to Aster DEX liquidation stream');
      
      // Send subscription message as per Aster DEX API
      const subscribeMsg = {
        method: "SUBSCRIBE",
        params: ["!forceOrder@arr"],
        id: 1
      };
      asterWs.send(JSON.stringify(subscribeMsg));
      console.log('📤 Sent subscription request:', JSON.stringify(subscribeMsg));
      console.log('🔊 Listening for real liquidation events...');
    });
    
    asterWs.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 Received Aster DEX message:', JSON.stringify(message, null, 2));
        
        // Handle subscription confirmation
        if (message.result === null && message.id === 1) {
          console.log('✅ Subscription confirmed');
          return;
        }
        
        // Extract liquidation data from stream format
        const payload = message.data;
        if (!payload) return;
        
        // Handle liquidation order events
        if (payload.e === 'forceOrder') {
          // Extract Aster DEX event timestamp (E field) - this is the unique identifier per event
          const eventTimestamp = payload.E.toString();
          
          // Check in-memory cache first - fastest deduplication
          if (recentLiquidations.has(eventTimestamp)) {
            console.log(`🔄 Skipping duplicate (Aster event ${eventTimestamp} already processed)`);
            return;
          }
          
          // Check if already processing this event - wait and skip if so
          const existingProcess = processingQueue.get(eventTimestamp);
          if (existingProcess) {
            console.log(`🔄 Skipping duplicate (Aster event ${eventTimestamp} already processing)`);
            await existingProcess; // Wait for it to finish
            return; // Skip this duplicate
          }
          
          // ATOMIC: Create and set lock IMMEDIATELY before any async operations
          let resolveProcessing: () => void;
          const processingPromise = new Promise<void>((resolve) => {
            resolveProcessing = resolve;
          });
          processingQueue.set(eventTimestamp, processingPromise);
          
          // Mark as seen IMMEDIATELY
          const now = Date.now();
          recentLiquidations.set(eventTimestamp, now);
          
          try {
            // Clean up old entries periodically (keep map size bounded)
            if (recentLiquidations.size > 100) {
              const cutoff = now - DEDUP_WINDOW_MS;
              const entries = Array.from(recentLiquidations.entries());
              for (const [key, timestamp] of entries) {
                if (timestamp < cutoff) {
                  recentLiquidations.delete(key);
                }
              }
            }
            
            // Map BUY/SELL from Aster DEX to our side representation
            // When exchange SELLS = long position being liquidated (price dropped)
            // When exchange BUYS = short position being liquidated (price rose)
            const side = payload.o.S.toLowerCase() === 'buy' ? 'short' : 'long';
            
            const liquidationData = {
              symbol: payload.o.s,
              side: side,
              size: payload.o.q,
              price: payload.o.p,
              value: (parseFloat(payload.o.q) * parseFloat(payload.o.p)).toFixed(8),
              eventTimestamp: eventTimestamp, // Store Aster DEX event timestamp
            };
            
            // Validate and store in database
            const validatedData = insertLiquidationSchema.parse(liquidationData);
            let storedLiquidation;
            let wasAlreadyInDatabase = false;
            try {
              storedLiquidation = await storage.insertLiquidation(validatedData);
              console.log(`✅ New liquidation stored: ${liquidationData.symbol} ${liquidationData.side} $${(parseFloat(liquidationData.value)).toFixed(2)} [Event: ${eventTimestamp}]`);
            } catch (dbError: any) {
              // If this fails due to unique constraint, fetch existing row from database
              // This liquidation already exists in DB (from previous session), but this is
              // the FIRST time we're seeing it in the current session (passed the memory check)
              if (dbError.code === '23505' || dbError.constraint?.includes('event_timestamp')) {
                wasAlreadyInDatabase = true;
                // Fetch the existing liquidation from database so we can process it
                const existing = await storage.getLiquidationsByEventTimestamp(eventTimestamp);
                if (existing.length > 0) {
                  storedLiquidation = existing[0];
                  console.log(`📦 Fetched existing liquidation from DB (first time in current session): ${liquidationData.symbol} ${liquidationData.side} $${(parseFloat(liquidationData.value)).toFixed(2)} [Event: ${eventTimestamp}]`);
                } else {
                  console.error('❌ Unique constraint error but no existing row found');
                }
              } else {
                console.error('❌ Database insert error:', dbError);
              }
            }
            
            // ALWAYS process liquidations that pass the memory check (recentLiquidations)
            // because this is the FIRST time seeing them in the current session
            if (storedLiquidation) {
              // Emit to strategy engine for trade execution
              try {
                strategyEngine.emit('liquidation', storedLiquidation);
              } catch (error) {
                console.error('❌ Error emitting liquidation to strategy engine:', error);
              }
              
              // Broadcast to all connected clients
              const broadcastMessage = JSON.stringify({
                type: 'liquidation',
                data: storedLiquidation
              });

              clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(broadcastMessage);
                }
              });

              console.log(`🚨 REAL Liquidation processed: ${liquidationData.symbol} ${liquidationData.side} $${(parseFloat(liquidationData.value)).toFixed(2)} [Event: ${eventTimestamp}] ${wasAlreadyInDatabase ? '(from previous session)' : '(new)'}`);
            }
          } finally {
            // ALWAYS resolve the processing promise and clean up
            resolveProcessing!();
            // Clean up after a short delay to allow waiting duplicates to finish
            setTimeout(() => processingQueue.delete(eventTimestamp), 100);
          }
        }
      } catch (error) {
        console.error('Failed to process Aster DEX message:', error);
      }
    });
    
    asterWs.on('error', (error) => {
      console.error('❌ Aster DEX WebSocket error:', error);
      console.log('❌ Real-time liquidation data unavailable');
    });
    
    asterWs.on('close', (code, reason) => {
      console.log(`❌ Aster DEX WebSocket closed - Code: ${code}, Reason: ${reason}`);
      console.log('🔄 Attempting to reconnect in 5 seconds...');
      setTimeout(() => connectToAsterDEX(clients), 5000);
    });
    
    // Add connection timeout
    setTimeout(() => {
      if (asterWs.readyState === WebSocket.CONNECTING) {
        console.log('⏰ Connection timeout - no liquidation data available');
        asterWs.terminate();
      }
    }, 10000);
    
  } catch (error) {
    console.error('❌ Failed to connect to Aster DEX:', error);
    console.log('❌ Real-time liquidation data unavailable');
  }
}

// Get or create a listen key for User Data Stream
async function getOrCreateListenKey(): Promise<string | null> {
  const apiKey = process.env.ASTER_API_KEY;
  
  if (!apiKey) {
    console.error('❌ ASTER_API_KEY not configured - cannot create User Data Stream');
    return null;
  }

  // Return existing key if still valid (with 5 minute buffer)
  const now = Date.now();
  if (currentListenKey && listenKeyExpiry > now + 5 * 60 * 1000) {
    console.log('♻️ Reusing existing listen key (expires in', Math.floor((listenKeyExpiry - now) / 60000), 'minutes)');
    return currentListenKey;
  }

  try {
    console.log('🔑 Creating new User Data Stream listen key...');
    const response = await fetch('https://fapi.asterdex.com/fapi/v1/listenKey', {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to create listen key:', errorText);
      return null;
    }

    const data = await response.json();
    currentListenKey = data.listenKey;
    listenKeyExpiry = Date.now() + 60 * 60 * 1000; // Expires in 60 minutes
    
    console.log('✅ Listen key created successfully (expires in 60 minutes)');
    return currentListenKey;
  } catch (error) {
    console.error('❌ Error creating listen key:', error);
    return null;
  }
}

// Send keepalive to extend listen key validity
async function sendKeepalive(): Promise<boolean> {
  const apiKey = process.env.ASTER_API_KEY;
  
  if (!apiKey || !currentListenKey) {
    return false;
  }

  try {
    console.log('💓 Sending User Data Stream keepalive...');
    const response = await fetch('https://fapi.asterdex.com/fapi/v1/listenKey', {
      method: 'PUT',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `listenKey=${currentListenKey}`,
    });

    if (!response.ok) {
      console.error('❌ Keepalive failed:', await response.text());
      return false;
    }

    listenKeyExpiry = Date.now() + 60 * 60 * 1000; // Extended by 60 minutes
    console.log('✅ Keepalive sent successfully (extended for 60 minutes)');
    return true;
  } catch (error) {
    console.error('❌ Error sending keepalive:', error);
    return false;
  }
}

// Start keepalive interval (every 30 minutes)
function startKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
  }

  keepaliveInterval = setInterval(async () => {
    const success = await sendKeepalive();
    if (!success) {
      console.error('❌ Keepalive failed - reconnecting User Data Stream...');
      connectToUserDataStream();
    }
  }, 30 * 60 * 1000); // Every 30 minutes

  console.log('⏰ Keepalive scheduled every 30 minutes');
}

// Connect to User Data Stream for real-time account/position updates
async function connectToUserDataStream() {
  try {
    // Close existing connection
    if (userDataWs) {
      userDataWs.close();
      userDataWs = null;
    }

    // Get listen key
    const listenKey = await getOrCreateListenKey();
    if (!listenKey) {
      console.error('❌ Cannot connect to User Data Stream without listen key');
      return;
    }

    console.log('🔌 Connecting to User Data Stream WebSocket...');
    userDataWs = new WebSocket(`wss://fstream.asterdex.com/ws/${listenKey}`);

    userDataWs.on('open', () => {
      console.log('✅ Connected to User Data Stream - real-time position/balance updates enabled');
      startKeepalive();
    });

    userDataWs.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        
        // Handle account updates (position/balance changes)
        if (event.e === 'ACCOUNT_UPDATE') {
          console.log('📊 Account Update from WebSocket');
          
          // Extract balance data from WebSocket update
          if (event.a?.B) {
            const balances = event.a.B;
            const usdtBalance = balances.find((b: any) => b.a === 'USDT');
            const usdcBalance = balances.find((b: any) => b.a === 'USDC');
            
            const balance = usdtBalance ? parseFloat(usdtBalance.wb) : 
                          (usdcBalance ? parseFloat(usdcBalance.wb) : 0);
            
            // Update account cache with WebSocket data (no REST call needed!)
            const accountData = {
              feeTier: 0,
              canTrade: true,
              canDeposit: true,
              canWithdraw: true,
              updateTime: event.E,
              usdcBalance: balance.toString(),
              usdtBalance: usdtBalance ? parseFloat(usdtBalance.wb).toString() : '0',
              assets: balances
            };
            setCache('live_account', accountData);
            console.log('✅ Updated account cache from WebSocket (balance: $' + balance.toFixed(2) + ')');
            
            // Broadcast account update to frontend clients
            wsBroadcaster.broadcastAccountUpdated(accountData);
          }
          
          // Extract position data from WebSocket update
          if (event.a?.P) {
            const positions = event.a.P.map((p: any) => ({
              symbol: p.s,
              positionAmt: p.pa,
              entryPrice: p.ep,
              unrealizedProfit: p.up,
              marginType: p.mt,
              isolatedWallet: p.iw,
              positionSide: p.ps
            }));
            
            // Update positions cache with WebSocket data (no REST call needed!)
            setCache('live_positions', positions);
            console.log('✅ Updated positions cache from WebSocket (' + positions.length + ' positions)');
            
            // Broadcast position update to frontend clients
            wsBroadcaster.broadcastPositionUpdated(positions);
          }
        }
        
        // Handle order updates
        else if (event.e === 'ORDER_TRADE_UPDATE') {
          console.log('📋 Order Update:', JSON.stringify(event.o, null, 2));
          
          // Clear order cache to get fresh data on next request
          apiCache.delete('live_open_orders');
        }
        
        // Handle listen key expiration
        else if (event.e === 'listenKeyExpired') {
          console.error('⚠️ Listen key expired - reconnecting...');
          currentListenKey = null;
          connectToUserDataStream();
        }
      } catch (error) {
        console.error('❌ Error processing User Data Stream message:', error);
      }
    });

    userDataWs.on('error', (error) => {
      console.error('❌ User Data Stream error:', error);
    });

    userDataWs.on('close', (code, reason) => {
      console.log(`❌ User Data Stream closed - Code: ${code}, Reason: ${reason}`);
      console.log('🔄 Reconnecting in 5 seconds...');
      setTimeout(() => connectToUserDataStream(), 5000);
    });

  } catch (error) {
    console.error('❌ Failed to connect to User Data Stream:', error);
  }
}
