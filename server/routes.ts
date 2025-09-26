import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertLiquidationSchema, insertUserSettingsSchema } from "@shared/schema";

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
          const liquidationData = {
            symbol: message.o.s,
            side: message.o.S.toLowerCase(),
            size: message.o.q,
            price: message.o.p,
            value: (parseFloat(message.o.q) * parseFloat(message.o.p)).toFixed(8),
          };
          
          // Validate and store in database
          const validatedData = insertLiquidationSchema.parse(liquidationData);
          const storedLiquidation = await storage.insertLiquidation(validatedData);
          
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

