import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { storage } from "./storage";
import { strategyEngine } from "./strategy-engine";
import { insertLiquidationSchema, insertUserSettingsSchema, frontendStrategySchema, updateStrategySchema, type Position, type Liquidation, positions } from "@shared/schema";
import { db } from "./db";
import { desc } from "drizzle-orm";

// Fixed liquidation window - always 60 seconds regardless of user input
const LIQUIDATION_WINDOW_SECONDS = 60;

// Fixed user ID for personal app (no authentication needed)
const DEFAULT_USER_ID = "personal_user";

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
      const signature = createHmac('sha256', secretKey)
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

  // Trading Strategy API routes
  app.get("/api/strategies", async (req, res) => {
    try {
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      res.json(strategies);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch strategies" });
    }
  });

  // Get live account balance from Aster DEX
  app.get("/api/live/account", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: "Aster DEX API keys not configured" });
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
        const errorText = await response.text();
        console.error('Failed to fetch Aster DEX account:', errorText);
        return res.status(response.status).json({ error: `Aster DEX API error: ${errorText}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('Error fetching live account data:', error);
      res.status(500).json({ error: "Failed to fetch live account data" });
    }
  });

  // Get live open positions from Aster DEX
  app.get("/api/live/positions", async (req, res) => {
    try {
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
      res.json(openPositions);
    } catch (error) {
      console.error('Error fetching live positions:', error);
      res.status(500).json({ error: "Failed to fetch live positions" });
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
          averageTradeTimeMs: 0,
          maxDrawdown: 0,
          maxDrawdownPercent: 0
        };
        console.log("📊 Performance Overview (no session):", JSON.stringify(responseData));
        return res.json(responseData);
      }

      // Get positions ONLY for the current active session
      const allPositions = await storage.getPositionsBySession(activeSession.id);

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
          averageTradeTimeMs: 0,
          maxDrawdown: 0,
          maxDrawdownPercent: 0
        });
      }

      // Calculate metrics
      const openPositions = allPositions.filter(p => p.isOpen === true);
      const closedPositions = allPositions.filter(p => p.isOpen === false);
      
      // Convert realizedPnl percentages to dollar amounts for all closed positions
      const closedPnlDollars = closedPositions.map(p => {
        const pnlPercent = parseFloat(p.realizedPnl || '0');
        const totalCost = parseFloat(p.totalCost || '0');
        return (pnlPercent / 100) * totalCost;
      });
      
      const winningTrades = closedPnlDollars.filter(pnl => pnl > 0);
      const losingTrades = closedPnlDollars.filter(pnl => pnl < 0);
      
      const totalRealizedPnl = closedPnlDollars.reduce((sum, pnl) => sum + pnl, 0);
      
      // Convert unrealized P&L percentages to dollar amounts for open positions
      const totalUnrealizedPnl = openPositions.reduce((sum, p) => {
        const pnlPercent = parseFloat(p.unrealizedPnl || '0');
        const totalCost = parseFloat(p.totalCost || '0');
        const pnlDollar = (pnlPercent / 100) * totalCost;
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

      // Calculate total fees from fills
      const sessionFills = await storage.getFillsBySession(activeSession.id);
      const totalFees = sessionFills.reduce((sum, fill) => sum + parseFloat(fill.fee || '0'), 0);

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
          const pnlPercent = parseFloat(p.realizedPnl || '0');
          const totalCost = parseFloat(p.totalCost || '0');
          const pnlDollar = (pnlPercent / 100) * totalCost;
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
        totalTrades: closedPositions.length, // Only closed positions are completed trades
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

      const activeSession = await storage.getActiveTradeSession(activeStrategy.id);
      if (!activeSession) {
        return res.json([]);
      }

      // Get all closed positions for the active session, sorted by close time
      const allPositions = await storage.getPositionsBySession(activeSession.id);
      const closedPositions = allPositions
        .filter(p => p.isOpen === false && p.closedAt)
        .sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

      if (closedPositions.length === 0) {
        return res.json([]);
      }

      // Build chart data with cumulative P&L (net of fees)
      // Get all fills to calculate fees per position
      const sessionFills = await storage.getFillsBySession(activeSession.id);
      
      let cumulativePnl = 0;
      const chartData = closedPositions.map((position, index) => {
        const pnlPercent = parseFloat(position.realizedPnl || '0');
        const totalCost = parseFloat(position.totalCost || '0');
        const grossPnlDollar = (pnlPercent / 100) * totalCost;
        
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
        positionSizePercent: validatedData.positionSizePercent,
        profitTargetPercent: validatedData.profitTargetPercent,
        stopLossPercent: validatedData.stopLossPercent,
        marginMode: validatedData.marginMode,
        leverage: validatedData.leverage,
        orderDelayMs: validatedData.orderDelayMs,
        slippageTolerancePercent: validatedData.slippageTolerancePercent,
        orderType: validatedData.orderType,
        maxRetryDurationMs: validatedData.maxRetryDurationMs,
        marginAmount: validatedData.marginAmount,
        tradingMode: validatedData.tradingMode,
        paperAccountSize: validatedData.paperAccountSize,
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
        'percentileThreshold', 'maxLayers', 'positionSizePercent', 'profitTargetPercent',
        'stopLossPercent', 'marginMode', 'leverage', 'orderDelayMs', 'slippageTolerancePercent',
        'orderType', 'maxRetryDurationMs', 'marginAmount', 'tradingMode', 'selectedAssets'
      ];
      
      fieldsToTrack.forEach(field => {
        const oldValue = existingStrategy[field as keyof typeof existingStrategy];
        const newValue = validatedUpdates[field as keyof typeof validatedUpdates];
        
        if (newValue !== undefined && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes[field] = { old: oldValue, new: newValue };
        }
      });
      
      // Check if paperAccountSize changed
      const paperAccountSizeChanged = validatedUpdates.paperAccountSize !== undefined && 
        existingStrategy.paperAccountSize !== validatedUpdates.paperAccountSize;
      
      // Normalize data - liquidation window is always 60 seconds regardless of input
      const updateData = {
        ...validatedUpdates
      };
      
      console.log('💾 Sending to database:', JSON.stringify(updateData, null, 2));
      await storage.updateStrategy(strategyId, updateData);
      
      // If paper account size changed, update the existing session balance in-place
      if (paperAccountSizeChanged) {
        const activeSession = await storage.getActiveTradeSession(strategyId);
        if (activeSession) {
          const newBalance = parseFloat(validatedUpdates.paperAccountSize!);
          console.log(`💰 Paper account size changed from ${existingStrategy.paperAccountSize} to ${newBalance} - updating session balance in-place`);
          
          // Cancel any pending orders
          const pendingOrders = (await storage.getOrdersBySession(activeSession.id))
            .filter(o => o.status === 'pending');
          
          for (const order of pendingOrders) {
            await storage.updateOrderStatus(order.id, 'cancelled');
            strategyEngine.removePendingOrder(order.id);
          }
          
          if (pendingOrders.length > 0) {
            console.log(`🚫 Cancelled ${pendingOrders.length} pending orders before balance update`);
          }
          
          // Update the session balance in-place
          await storage.updateSessionBalance(activeSession.id, newBalance);
          console.log(`✅ Updated session ${activeSession.id} balance to ${newBalance} (positions and history preserved)`);
        }
      }
      
      // CRITICAL: Reload strategy in engine whenever ANY settings change
      // This ensures position sizing and all other settings are applied immediately
      if (Object.keys(changes).length > 0 || paperAccountSizeChanged) {
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
      
      const isPaperTrading = session.mode === 'paper';
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
          const totalCost = parseFloat(position.totalCost);
          const dollarPnl = (unrealizedPnl / 100) * totalCost;

          // Emergency close = limit order (manual close style) = 0.01% maker fee for paper trading
          const quantity = parseFloat(position.totalQuantity);
          const exitValue = currentPrice * quantity;
          const exitFee = isPaperTrading ? (exitValue * 0.01) / 100 : 0;
          
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

          // Close the position
          await storage.closePosition(position.id, new Date(), unrealizedPnl);
          
          // Accumulate P&L (deduct exit fee for paper trading)
          const netDollarPnl = isPaperTrading ? dollarPnl - exitFee : dollarPnl;
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
  
  // Connect to Aster DEX WebSocket and relay data
  connectToAsterDEX(clients);

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

  // Get position summary by strategy ID (finds active trade session automatically)
  app.get('/api/strategies/:strategyId/positions/summary', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Find the active trade session for this strategy
      const session = await storage.getActiveTradeSession(strategyId);
      
      if (!session) {
        return res.status(404).json({ error: 'No active trade session found for this strategy' });
      }

      const positions = await storage.getOpenPositions(session.id);
      const closedPositions = await storage.getClosedPositions(session.id);

      // Calculate unrealized P&L from open positions
      // Convert unrealized P&L percentages to dollar values before summing
      const totalUnrealizedPnl = positions.reduce((sum, pos) => {
        const pnlPercent = parseFloat(pos.unrealizedPnl || '0');
        const totalCost = parseFloat(pos.totalCost || '0');
        const pnlDollar = (pnlPercent / 100) * totalCost;
        return sum + pnlDollar;
      }, 0);

      // Calculate realized P&L from closed positions
      // This ensures accuracy even if session updates fail
      // Get all fills to calculate total fees
      const sessionFills = await storage.getFillsBySession(session.id);
      
      const totalRealizedPnl = closedPositions.reduce((sum, pos) => {
        const pnlPercent = parseFloat(pos.unrealizedPnl || '0'); // Contains final P&L at close
        const totalCost = parseFloat(pos.totalCost || '0');
        const pnlDollar = (pnlPercent / 100) * totalCost;
        
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
      
      const totalExposure = positions.reduce((sum, pos) => 
        sum + parseFloat(pos.totalCost || '0'), 0);
      const activePositions = positions.length;
      const totalTrades = closedPositions.length;

      const summary = {
        sessionId: session.id,
        strategyId,
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
      const totalUnrealizedPnl = positions.reduce((sum, pos) => {
        const pnlPercent = parseFloat(pos.unrealizedPnl || '0');
        const totalCost = parseFloat(pos.totalCost || '0');
        const pnlDollar = (pnlPercent / 100) * totalCost;
        return sum + pnlDollar;
      }, 0);

      // Calculate realized P&L from closed positions
      // This ensures accuracy even if session updates fail
      // Get all fills to calculate total fees
      const sessionFills = await storage.getFillsBySession(sessionId);
      
      const totalRealizedPnl = closedPositions.reduce((sum, pos) => {
        const pnlPercent = parseFloat(pos.unrealizedPnl || '0'); // Contains final P&L at close
        const totalCost = parseFloat(pos.totalCost || '0');
        const pnlDollar = (pnlPercent / 100) * totalCost;
        
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
      
      const totalExposure = positions.reduce((sum, pos) => 
        sum + parseFloat(pos.totalCost || '0'), 0);
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
      
      // Find the active trade session for this strategy
      const session = await storage.getActiveTradeSession(strategyId);
      
      if (!session) {
        return res.status(404).json({ error: 'No active trade session found for this strategy' });
      }

      const closedPositions = await storage.getClosedPositions(session.id);
      
      // Fetch fills for all closed positions to calculate total fees
      const sessionFills = await storage.getFillsBySession(session.id);
      
      // Enhance closed positions with fee information
      const closedPositionsWithFees = closedPositions.map(position => {
        // Get fills for this specific position:
        // 1. Exit fill has synthetic orderId = `exit-${position.id}`
        // 2. Entry fills match by symbol AND fall within position's time window
        const exitFill = sessionFills.find(fill => fill.orderId === `exit-${position.id}`);
        
        // For entry fills, match by symbol and timestamp within position lifetime
        const positionOpenTime = new Date(position.openedAt).getTime();
        const positionCloseTime = position.closedAt ? new Date(position.closedAt).getTime() : Date.now();
        
        const entryFills = sessionFills.filter(fill => {
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
      
      const position = await storage.getPosition(positionId);
      if (!position) {
        return res.status(404).json({ error: 'Position not found' });
      }

      // Get all fills directly linked to this position via position_id
      // New fills will have position_id set; legacy fills will use time-range fallback
      const sessionFills = await storage.getFillsBySession(position.sessionId);
      
      const positionFills = sessionFills.filter(fill => {
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
      });

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
      
      // Get the position
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
      const totalCost = parseFloat(position.totalCost);
      const dollarPnl = (unrealizedPnl / 100) * totalCost;

      // Get session to check trading mode
      const session = await storage.getTradeSession(position.sessionId);
      const isPaperTrading = session?.mode === 'paper';
      
      // Manual close = limit order (take profit style) = 0.01% maker fee for paper trading
      const quantity = parseFloat(position.totalQuantity);
      const exitValue = currentPrice * quantity;
      const exitFee = isPaperTrading ? (exitValue * 0.01) / 100 : 0;
      
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

      // Close the position
      await storage.closePosition(position.id, new Date(), unrealizedPnl);

      // Update session balance and stats (deduct exit fee from P&L)
      if (session) {
        const newTotalTrades = session.totalTrades + 1;
        const oldTotalPnl = parseFloat(session.totalPnl);
        const netDollarPnl = isPaperTrading ? dollarPnl - exitFee : dollarPnl;
        const newTotalPnl = oldTotalPnl + netDollarPnl;
        const oldBalance = parseFloat(session.currentBalance);
        const newBalance = oldBalance + netDollarPnl;

        await storage.updateTradeSession(session.id, {
          totalTrades: newTotalTrades,
          totalPnl: newTotalPnl.toString(),
          currentBalance: newBalance.toString(),
        });
        
        if (isPaperTrading) {
          console.log(`💸 Manual exit fee applied: $${exitFee.toFixed(4)} (0.01% maker fee - limit order)`);
        }
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

  // Clear all paper trading data for a strategy
  app.delete('/api/strategies/:strategyId/clear-paper-trades', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Get the strategy to verify it exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: 'Strategy not found' });
      }

      // Get the active session for this strategy
      const sessions = await storage.getSessionsByStrategy(strategyId);
      
      if (sessions.length === 0) {
        return res.json({ 
          success: true, 
          message: 'No paper trade data to clear',
          cleared: { positions: 0, fills: 0 }
        });
      }

      let totalPositionsCleared = 0;
      let totalFillsCleared = 0;

      // Clear data for each session
      for (const session of sessions) {
        // Delete all fills for this session
        const fills = await storage.getFillsBySession(session.id);
        totalFillsCleared += fills.length;
        await storage.clearFillsBySession(session.id);
        
        // Delete all positions for this session
        const positions = await storage.getPositionsBySession(session.id);
        totalPositionsCleared += positions.length;
        await storage.clearPositionsBySession(session.id);
        
        // Reset session to starting state
        await storage.updateTradeSession(session.id, {
          currentBalance: session.startingBalance.toString(),
          totalPnl: '0',
          totalTrades: 0,
        });
      }

      console.log(`🗑️ Cleared ${totalPositionsCleared} positions and ${totalFillsCleared} fills for strategy ${strategyId}`);

      res.json({ 
        success: true, 
        message: 'Paper trade data cleared successfully',
        cleared: {
          positions: totalPositionsCleared,
          fills: totalFillsCleared
        }
      });
    } catch (error) {
      console.error('Error clearing paper trades:', error);
      res.status(500).json({ error: 'Failed to clear paper trade data' });
    }
  });

  return httpServer;
}

// Global deduplication cache using Aster DEX event timestamps (persists across reconnections)
const recentLiquidations = new Map<string, number>(); // Maps eventTimestamp -> last seen time
const processingQueue = new Map<string, Promise<void>>(); // Maps eventTimestamp -> processing promise
const DEDUP_WINDOW_MS = 5000; // 5 second window for in-memory cache cleanup

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
