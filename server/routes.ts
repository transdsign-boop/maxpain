import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { tradingEngine } from "./tradingEngine";
import { 
  insertLiquidationSchema, insertUserSettingsSchema, insertRiskSettingsSchema,
  insertTradingStrategySchema, insertPositionSchema, insertTradingFeesSchema, userSettings
} from "@shared/schema";
import { db } from "./db";
import { sql, desc } from "drizzle-orm";
import { getRealTradingFeesDisplay } from "./tradingApiService";

export async function registerRoutes(app: Express): Promise<Server> {
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
  app.get("/api/settings/:sessionId", async (req, res) => {
    try {
      const sessionId = req.params.sessionId;
      const settings = await storage.getUserSettings(sessionId);
      res.json(settings || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user settings" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const validatedSettings = insertUserSettingsSchema.parse(req.body);
      const settings = await storage.saveUserSettings(validatedSettings);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Failed to save user settings" });
    }
  });

  // Migrate any previous session data to permanent session for forever persistence
  app.post("/api/settings/migrate-demo-session", async (req, res) => {
    try {
      const { newSessionId } = req.body;
      
      if (!newSessionId) {
        return res.status(400).json({ error: "newSessionId is required" });
      }

      // Check if the new session already has settings to avoid overwriting
      const existingSettings = await storage.getUserSettings(newSessionId);
      if (existingSettings && existingSettings.selectedAssets && existingSettings.selectedAssets.length > 0) {
        console.log(`⏭️ Session ${newSessionId} already has asset selections, skipping migration`);
        return res.json({ success: true, message: "Session already has settings" });
      }

      // First try demo-session
      let sourceSettings = await storage.getUserSettings('demo-session');
      let sourceSessionId = 'demo-session';
      
      // If demo-session doesn't have selections, find the most recent session with selections
      if (!sourceSettings || !sourceSettings.selectedAssets || sourceSettings.selectedAssets.length === 0) {
        // Get all user settings sorted by lastUpdated DESC to find most recent with selections
        const allSettings = await db.select()
          .from(userSettings)
          .where(sql`array_length(selected_assets, 1) > 0`)
          .orderBy(desc(userSettings.lastUpdated))
          .limit(1);
        
        if (allSettings.length > 0) {
          sourceSettings = allSettings[0];
          sourceSessionId = allSettings[0].sessionId;
        }
      }
      
      if (sourceSettings && sourceSettings.selectedAssets && sourceSettings.selectedAssets.length > 0) {
        // Copy source session settings to new permanent session
        const migratedSettings = {
          sessionId: newSessionId,
          selectedAssets: sourceSettings.selectedAssets,
          sideFilter: sourceSettings.sideFilter,
          minValue: sourceSettings.minValue,
          timeRange: sourceSettings.timeRange,
        };
        
        await storage.saveUserSettings(migratedSettings);
        console.log(`✅ Migrated settings from ${sourceSessionId} to permanent session: ${newSessionId}`);
        console.log(`📊 Migrated assets: [${sourceSettings.selectedAssets.join(', ')}]`);
        
        res.json({ success: true, migratedSettings, sourceSessionId });
      } else {
        // No session data with asset selections found to migrate
        console.log(`📭 No previous session found with asset selections for migration to ${newSessionId}`);
        res.json({ success: true, message: "No previous session data found with asset selections" });
      }
    } catch (error) {
      console.error('Failed to migrate session data:', error);
      res.status(500).json({ error: "Failed to migrate settings" });
    }
  });
  
  // Risk settings API routes
  app.get("/api/risk-settings/:sessionId", async (req, res) => {
    try {
      const sessionId = req.params.sessionId;
      const riskSettings = await storage.getRiskSettings(sessionId);
      res.json(riskSettings || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch risk settings" });
    }
  });

  app.put("/api/risk-settings", async (req, res) => {
    try {
      console.log('📝 PUT /api/risk-settings request body:', JSON.stringify(req.body, null, 2));
      const validatedSettings = insertRiskSettingsSchema.parse(req.body);
      console.log('✅ Validation passed, saving settings:', JSON.stringify(validatedSettings, null, 2));
      const settings = await storage.saveRiskSettings(validatedSettings);
      res.json(settings);
    } catch (error) {
      console.error('❌ Risk settings save error:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
      }
      res.status(500).json({ error: "Failed to save risk settings" });
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

  // Current price endpoint for real-time price data
  app.get("/api/prices/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      
      if (!symbol) {
        return res.status(400).json({ error: "symbol parameter required" });
      }
      
      // Fetch latest price from 1-minute klines (most recent data)
      const klinesResponse = await fetch(`https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1`, {
        headers: {
          'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
        }
      });
      
      if (!klinesResponse.ok) {
        throw new Error(`Failed to fetch price: ${klinesResponse.status}`);
      }
      
      const klinesData = await klinesResponse.json();
      
      if (klinesData.length === 0) {
        return res.status(404).json({ error: "No price data available for symbol" });
      }
      
      const latestKline = klinesData[0];
      const currentPrice = parseFloat(latestKline[4]); // Close price
      
      res.json({
        symbol,
        price: currentPrice.toString(),
        timestamp: latestKline[0],
        date: new Date(latestKline[0]).toISOString()
      });
    } catch (error) {
      console.error(`Failed to fetch price for ${req.params.symbol}:`, error);
      res.status(500).json({ error: "Failed to fetch current price" });
    }
  });

  // Bulk prices endpoint for multiple symbols
  app.post("/api/prices/bulk", async (req, res) => {
    try {
      const { symbols } = req.body;
      
      if (!Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ error: "symbols array required" });
      }
      
      const prices: Record<string, any> = {};
      
      // Fetch prices for all symbols in parallel
      const pricePromises = symbols.map(async (symbol: string) => {
        try {
          const klinesResponse = await fetch(`https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1`, {
            headers: {
              'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
            }
          });
          
          if (klinesResponse.ok) {
            const klinesData = await klinesResponse.json();
            if (klinesData.length > 0) {
              const latestKline = klinesData[0];
              return {
                symbol,
                price: parseFloat(latestKline[4]).toString(),
                timestamp: latestKline[0],
                date: new Date(latestKline[0]).toISOString()
              };
            }
          }
          return null;
        } catch (error) {
          console.error(`Error fetching price for ${symbol}:`, error);
          return null;
        }
      });
      
      const results = await Promise.all(pricePromises);
      
      // Build response object
      results.forEach(result => {
        if (result) {
          prices[result.symbol] = result;
        }
      });
      
      res.json({ prices, count: Object.keys(prices).length });
    } catch (error) {
      console.error('Bulk prices fetch error:', error);
      res.status(500).json({ error: "Failed to fetch bulk prices" });
    }
  });

  // ===== TRADING SYSTEM API ROUTES =====

  // Trading Strategy routes
  app.get("/api/trading/strategies", async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId parameter required" });
      }
      
      const strategies = await storage.getTradingStrategies(sessionId);
      res.json(strategies);
    } catch (error) {
      console.error('Get strategies error:', error);
      res.status(500).json({ error: "Failed to fetch trading strategies" });
    }
  });

  app.post("/api/trading/strategies", async (req, res) => {
    try {
      const validatedData = insertTradingStrategySchema.parse(req.body);
      const strategy = await storage.createTradingStrategy(validatedData);
      res.json(strategy);
    } catch (error) {
      console.error('Create strategy error:', error);
      res.status(500).json({ error: "Failed to create trading strategy" });
    }
  });

  app.put("/api/trading/strategies/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const strategy = await storage.updateTradingStrategy(id, updates);
      res.json(strategy);
    } catch (error) {
      console.error('Update strategy error:', error);
      res.status(500).json({ error: "Failed to update trading strategy" });
    }
  });

  app.delete("/api/trading/strategies/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteTradingStrategy(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Delete strategy error:', error);
      res.status(500).json({ error: "Failed to delete trading strategy" });
    }
  });

  // Portfolio routes
  app.get("/api/trading/portfolio", async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId parameter required" });
      }
      
      const portfolio = await storage.getOrCreatePortfolio(sessionId);
      res.json(portfolio);
    } catch (error) {
      console.error('Get portfolio error:', error);
      res.status(500).json({ error: "Failed to fetch portfolio" });
    }
  });

  app.put("/api/trading/portfolio/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const portfolio = await storage.updatePortfolio(id, updates);
      res.json(portfolio);
    } catch (error) {
      console.error('Update portfolio error:', error);
      res.status(500).json({ error: "Failed to update portfolio" });
    }
  });

  app.post("/api/trading/portfolio/:id/reset-paper-balance", async (req, res) => {
    try {
      const { id } = req.params;
      // Reset paper balance to default $10,000
      const portfolio = await storage.updatePortfolio(id, { 
        paperBalance: '10000.00',
        paperPnl: '0.00'
      });
      res.json(portfolio);
    } catch (error) {
      console.error('Reset paper balance error:', error);
      res.status(500).json({ error: "Failed to reset paper balance" });
    }
  });

  app.post("/api/trading/portfolio/:id/set-paper-balance", async (req, res) => {
    try {
      const { id } = req.params;
      const { amount } = req.body;
      
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) < 0) {
        return res.status(400).json({ error: "Valid amount is required" });
      }
      
      // Set custom paper balance amount
      const portfolio = await storage.updatePortfolio(id, { 
        paperBalance: parseFloat(amount).toFixed(2),
      });
      res.json(portfolio);
    } catch (error) {
      console.error('Set paper balance error:', error);
      res.status(500).json({ error: "Failed to set paper balance" });
    }
  });

  // Financial metrics endpoint
  app.get("/api/trading/portfolio/:sessionId/financial-metrics", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const tradingMode = req.query.mode as 'paper' | 'real' || 'paper';
      
      const portfolio = await storage.getOrCreatePortfolio(sessionId);
      
      const accountBalance = parseFloat(
        tradingMode === 'paper' ? portfolio.paperBalance : (portfolio.realBalance || '0.00')
      );
      const usedMargin = await storage.getUsedMargin(portfolio.id, tradingMode);
      const availableBalance = await storage.getAvailableBalance(portfolio.id, tradingMode);
      
      res.json({
        accountBalance,
        availableBalance,
        usedMargin,
        tradingMode
      });
    } catch (error) {
      console.error('Error fetching financial metrics:', error);
      res.status(500).json({ error: 'Failed to fetch financial metrics' });
    }
  });

  // Trading fees routes
  app.get("/api/trading/fees/:sessionId", async (req, res) => {
    try {
      const sessionId = req.params.sessionId;
      
      // Get stored paper trading fees
      const storedFees = await storage.getTradingFees(sessionId);
      
      // Get real trading fees from API
      const realFeesDisplay = await getRealTradingFeesDisplay();
      
      // Combine stored paper fees with real fees from API
      const combinedFees = {
        id: storedFees?.id,
        sessionId: sessionId,
        paperMarketOrderFeePercent: storedFees?.paperMarketOrderFeePercent || '0.1000',
        paperLimitOrderFeePercent: storedFees?.paperLimitOrderFeePercent || '0.0750',
        realMarketOrderFeePercent: realFeesDisplay.marketOrderFee,
        realLimitOrderFeePercent: realFeesDisplay.limitOrderFee,
        simulateRealisticFees: storedFees?.simulateRealisticFees ?? true,
        tradingApiStatus: realFeesDisplay.status,
        createdAt: storedFees?.createdAt,
        updatedAt: storedFees?.updatedAt,
      };
      
      res.json(combinedFees);
    } catch (error) {
      console.error('Get trading fees error:', error);
      res.status(500).json({ error: "Failed to fetch trading fees" });
    }
  });

  app.put("/api/trading/fees", async (req, res) => {
    try {
      const validatedFees = insertTradingFeesSchema.parse(req.body);
      const fees = await storage.saveTradingFees(validatedFees);
      res.json(fees);
    } catch (error) {
      console.error('Save trading fees error:', error);
      res.status(500).json({ error: "Failed to save trading fees" });
    }
  });

  // Position routes
  app.get("/api/trading/positions", async (req, res) => {
    try {
      const portfolioId = req.query.portfolioId as string;
      if (!portfolioId) {
        return res.status(400).json({ error: "portfolioId parameter required" });
      }
      
      // Update unrealized PNL with current market prices first
      await storage.updateUnrealizedPnl(portfolioId);
      
      // Then get positions with liquidation data
      const positions = await storage.getOpenPositionsWithLiquidation(portfolioId);
      res.json(positions);
    } catch (error) {
      console.error('Get positions error:', error);
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  app.post("/api/trading/positions", async (req, res) => {
    try {
      const validatedData = insertPositionSchema.parse(req.body);
      const position = await storage.createPosition(validatedData);
      res.json(position);
    } catch (error) {
      console.error('Create position error:', error);
      res.status(500).json({ error: "Failed to create position" });
    }
  });

  app.put("/api/trading/positions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const position = await storage.updatePosition(id, updates);
      res.json(position);
    } catch (error) {
      console.error('Update position error:', error);
      res.status(500).json({ error: "Failed to update position" });
    }
  });

  app.post("/api/trading/positions/:id/close", async (req, res) => {
    try {
      const { id } = req.params;
      const { exitPrice, exitReason } = req.body;
      
      if (!exitPrice || !exitReason) {
        return res.status(400).json({ error: "exitPrice and exitReason required" });
      }
      
      const trade = await storage.closePosition(id, exitPrice, exitReason);
      res.json(trade);
    } catch (error) {
      console.error('Close position error:', error);
      res.status(500).json({ error: "Failed to close position" });
    }
  });

  // Trade history routes
  app.get("/api/trading/trades", async (req, res) => {
    try {
      const portfolioId = req.query.portfolioId as string;
      const limit = parseInt(req.query.limit as string) || 100;
      
      if (!portfolioId) {
        return res.status(400).json({ error: "portfolioId parameter required" });
      }
      
      const trades = await storage.getTrades(portfolioId, limit);
      res.json(trades);
    } catch (error) {
      console.error('Get trades error:', error);
      res.status(500).json({ error: "Failed to fetch trades" });
    }
  });

  app.get("/api/trading/trades/strategy/:strategyId", async (req, res) => {
    try {
      const { strategyId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const trades = await storage.getTradesByStrategy(strategyId, limit);
      res.json(trades);
    } catch (error) {
      console.error('Get trades by strategy error:', error);
      res.status(500).json({ error: "Failed to fetch trades by strategy" });
    }
  });

  // Trading Engine Control routes
  app.post("/api/trading/execute-signal", async (req, res) => {
    try {
      const { signal, sessionId, tradingMode } = req.body;
      
      if (!signal || !sessionId || !tradingMode) {
        return res.status(400).json({ error: "signal, sessionId, and tradingMode required" });
      }
      
      const position = await tradingEngine.executeSignal(signal, sessionId, tradingMode);
      res.json(position);
    } catch (error) {
      console.error('Execute signal error:', error);
      res.status(500).json({ error: "Failed to execute trading signal" });
    }
  });

  app.post("/api/trading/monitor-positions", async (req, res) => {
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId required" });
      }
      
      await tradingEngine.monitorPositions(sessionId);
      res.json({ success: true });
    } catch (error) {
      console.error('Monitor positions error:', error);
      res.status(500).json({ error: "Failed to monitor positions" });
    }
  });

  // Emergency Controls API Endpoints
  app.post("/api/trading/emergency-stop", async (req, res) => {
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId required" });
      }
      
      // Pause all strategies for this session
      const strategies = await storage.getTradingStrategies(sessionId);
      await Promise.all(strategies.map(strategy => 
        storage.updateTradingStrategy(strategy.id, { isActive: false })
      ));
      
      res.json({ success: true, message: "All trading stopped" });
    } catch (error) {
      console.error('Emergency stop error:', error);
      res.status(500).json({ error: "Failed to stop trading" });
    }
  });

  app.post("/api/trading/close-all-positions", async (req, res) => {
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId required" });
      }
      
      // Get portfolio to find positions
      const portfolio = await storage.getOrCreatePortfolio(sessionId);
      const positions = await storage.getOpenPositions(portfolio.id);
      
      // Close all open positions
      const closedTrades = await Promise.all(
        positions.map(position => 
          storage.closePosition(position.id, position.currentPrice, "emergency_close")
        )
      );
      
      res.json({ 
        success: true, 
        message: `Closed ${closedTrades.length} positions`,
        closedPositions: closedTrades.length 
      });
    } catch (error) {
      console.error('Close all positions error:', error);
      res.status(500).json({ error: "Failed to close positions" });
    }
  });

  app.post("/api/trading/pause-all-strategies", async (req, res) => {
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId required" });
      }
      
      // Pause all strategies for this session
      const strategies = await storage.getTradingStrategies(sessionId);
      const updatedStrategies = await Promise.all(strategies.map(strategy => 
        storage.updateTradingStrategy(strategy.id, { isActive: false })
      ));
      
      res.json({ 
        success: true, 
        message: `Paused ${updatedStrategies.length} strategies`,
        pausedStrategies: updatedStrategies.length 
      });
    } catch (error) {
      console.error('Pause all strategies error:', error);
      res.status(500).json({ error: "Failed to pause strategies" });
    }
  });

  app.get("/api/trading/volatility/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const hours = parseInt(req.query.hours as string) || 1;
      
      const volatility = await storage.calculateVolatility(symbol, hours);
      res.json({ symbol, hours, volatility });
    } catch (error) {
      console.error('Calculate volatility error:', error);
      res.status(500).json({ error: "Failed to calculate volatility" });
    }
  });

  app.get("/api/trading/cascade-risk/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const risk = await tradingEngine.calculateCascadeRisk(symbol);
      res.json({ symbol, cascadeRisk: risk });
    } catch (error) {
      console.error('Calculate cascade risk error:', error);
      res.status(500).json({ error: "Failed to calculate cascade risk" });
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

  // Connect to Aster DEX WebSocket and relay data
  connectToAsterDEX(clients);

  return httpServer;
}

async function connectToAsterDEX(clients: Set<WebSocket>) {
  try {
    console.log('Connecting to Aster DEX WebSocket...');
    
    // Connect to real Aster DEX liquidation stream
    const asterWs = new WebSocket('wss://fstream.asterdex.com/ws/!forceOrder@arr');
    
    asterWs.on('open', () => {
      console.log('✅ Successfully connected to Aster DEX liquidation stream');
      console.log('🔊 Listening for real liquidation events...');
    });
    
    asterWs.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 Received Aster DEX message:', JSON.stringify(message, null, 2));
        
        // Handle liquidation order events
        if (message.e === 'forceOrder') {
          // Map BUY/SELL from Aster DEX to our side representation
          // BUY liquidations = long positions being liquidated
          // SELL liquidations = short positions being liquidated  
          const side = message.o.S.toLowerCase() === 'buy' ? 'long' : 'short';
          
          const liquidationData = {
            symbol: message.o.s,
            side: side,
            size: message.o.q,
            price: message.o.p,
            value: (parseFloat(message.o.q) * parseFloat(message.o.p)).toFixed(8),
          };
          
          // Validate and store in database
          const validatedData = insertLiquidationSchema.parse(liquidationData);
          const storedLiquidation = await storage.insertLiquidation(validatedData);
          
          // Process liquidation through trading engine
          try {
            // Get all user sessions for asset filtering
            const signals = await tradingEngine.processLiquidation(storedLiquidation);
            
            if (signals.length > 0) {
              console.log(`📊 Generated ${signals.length} trading signals for ${storedLiquidation.symbol}`);
              
              // Get all active portfolios to execute signals for all users
              const allPortfolios = await storage.getAllPaperTradingPortfolios();
              
              // Auto-execute signals for all active paper trading sessions
              for (const signal of signals) {
                for (const portfolio of allPortfolios) {
                  await tradingEngine.executeSignal(signal, portfolio.sessionId, portfolio.tradingMode as 'paper' | 'real');
                }
              }
            }
          } catch (error) {
            console.error('❌ Trading engine error:', error);
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

          console.log(`🚨 REAL Liquidation: ${liquidationData.symbol} ${liquidationData.side} $${(parseFloat(liquidationData.value)).toFixed(2)}`);
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

