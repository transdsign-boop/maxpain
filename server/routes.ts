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
import { liveDataOrchestrator } from "./live-data-orchestrator";
import { insertLiquidationSchema, insertUserSettingsSchema, frontendStrategySchema, updateStrategySchema, type Position, type Fill, type Liquidation, type InsertFill, positions, strategies, transfers, fills, tradeSessions, accountLedger, investorReportArchive } from "@shared/schema";
import { db } from "./db";
import { desc, eq, sql, gte, lte, and, asc } from "drizzle-orm";
import { fetchRealizedPnlEvents, fetchAllAccountTrades } from "./exchange-sync";
import { fetchPositionPnL } from "./exchange-utils";
import { getConsoleLogs } from "./console-logger";

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
  
  // Auto-register active strategies on server startup
  console.log('🔄 Checking for active strategies to auto-register...');
  const activeStrategies = await storage.getAllActiveStrategies();
  
  if (activeStrategies.length > 0) {
    console.log(`📋 Found ${activeStrategies.length} active strategy(ies) - registering with strategy engine...`);
    for (const strategy of activeStrategies) {
      console.log(`   - Registering: ${strategy.name} (paused: ${strategy.paused})`);
      await strategyEngine.registerStrategy(strategy);
      liveDataOrchestrator.start(strategy.id);
    }
    console.log('✅ Active strategies auto-registered successfully');
  } else {
    console.log('ℹ️  No active strategies found - ready for manual activation');
  }
  
  // ONE-TIME FIX: Repair corrupted avgEntryPrice positions
  app.post("/api/admin/repair-positions", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        return res.status(500).json({ error: "API keys not configured" });
      }
      
      // Find all positions with avgEntryPrice = 0
      const sessionId = req.body.sessionId;
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId required" });
      }
      
      const allPositions = await storage.getOpenPositions(sessionId);
      const corruptedPositions = allPositions.filter(p => parseFloat(p.avgEntryPrice) === 0);
      
      if (corruptedPositions.length === 0) {
        return res.json({ message: "No corrupted positions found", repaired: [] });
      }
      
      console.log(`🔧 Found ${corruptedPositions.length} corrupted positions - fetching from exchange...`);
      
      // Fetch live exchange positions
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey }
        }
      );
      
      if (!response.ok) {
        return res.status(500).json({ error: "Failed to fetch exchange positions" });
      }
      
      const exchangePositions = await response.json();
      const repaired: Array<{ id: string; symbol: string; side: string; action: string; details: string }> = [];
      const zombies: Array<{ id: string; symbol: string; side: string }> = [];
      
      // Update each corrupted position with correct avgEntryPrice from exchange
      for (const position of corruptedPositions) {
        const livePosition = exchangePositions.find((p: any) => {
          if (p.symbol !== position.symbol || parseFloat(p.positionAmt) === 0) return false;
          const isShort = parseFloat(p.positionAmt) < 0;
          return (position.side === 'short' && isShort) || (position.side === 'long' && !isShort);
        });
        
        if (livePosition && parseFloat(livePosition.entryPrice) > 0) {
          // Position exists on exchange - repair avgEntryPrice
          const newEntry = parseFloat(livePosition.entryPrice);
          await storage.updatePosition(position.id, {
            avgEntryPrice: newEntry.toString()
          });
          
          repaired.push({
            id: position.id,
            symbol: position.symbol,
            side: position.side,
            action: 'repaired',
            details: `Updated avgEntryPrice: $0 → $${newEntry.toFixed(6)}`
          });
          
          console.log(`✅ Repaired ${position.symbol} ${position.side}: $0 → $${newEntry.toFixed(6)}`);
        } else {
          // Position doesn't exist on exchange - it's a zombie, mark as closed
          console.warn(`⚠️ Zombie position found: ${position.symbol} ${position.side} (not on exchange)`);
          
          await storage.closePosition(position.id, new Date(), 0, 0);
          
          zombies.push({
            id: position.id,
            symbol: position.symbol,
            side: position.side
          });
          
          repaired.push({
            id: position.id,
            symbol: position.symbol,
            side: position.side,
            action: 'closed_zombie',
            details: 'Position marked as closed (not found on exchange)'
          });
          
          console.log(`✅ Closed zombie position: ${position.symbol} ${position.side}`);
        }
      }
      
      res.json({
        message: `Repaired ${repaired.length} of ${corruptedPositions.length} corrupted positions`,
        repaired,
        skipped: corruptedPositions.length - repaired.length
      });
      
    } catch (error) {
      console.error('❌ Failed to repair positions:', error);
      res.status(500).json({ error: "Repair failed" });
    }
  });
  
  // ONE-TIME FIX: Remove duplicate position records (caused by hedge mode bug)
  app.post("/api/admin/dedupe-positions", async (req, res) => {
    try {
      const sessionId = req.body.sessionId;
      if (!sessionId) {
        return res.status(400).json({ error: "sessionId required" });
      }
      
      // Get all open positions for this session
      const openPositions = await storage.getOpenPositions(sessionId);
      
      // Group by symbol+side to find duplicates
      const positionGroups = new Map<string, Position[]>();
      for (const pos of openPositions) {
        const key = `${pos.symbol}-${pos.side}`;
        const group = positionGroups.get(key) || [];
        group.push(pos);
        positionGroups.set(key, group);
      }
      
      const removed: Array<{ symbol: string; side: string; count: number; keptId: string }> = [];
      
      // For each group with duplicates, keep the most recent one and close others
      for (const [key, group] of positionGroups.entries()) {
        if (group.length > 1) {
          // Sort by updatedAt descending (most recent first)
          group.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          
          const keeper = group[0]; // Keep most recent
          const duplicates = group.slice(1); // Remove others
          
          console.log(`🔧 Found ${group.length} positions for ${key}, keeping ${keeper.id}, removing ${duplicates.length} duplicates`);
          
          // Close duplicate positions
          for (const dup of duplicates) {
            await storage.closePosition(dup.id, new Date(), 0, 0);
            console.log(`   ❌ Closed duplicate: ${dup.id} (qty=${dup.totalQuantity}, updated=${dup.updatedAt})`);
          }
          
          removed.push({
            symbol: keeper.symbol,
            side: keeper.side,
            count: duplicates.length,
            keptId: keeper.id
          });
        }
      }
      
      if (removed.length === 0) {
        res.json({ message: "No duplicate positions found", removed: [] });
      } else {
        res.json({
          message: `Removed ${removed.reduce((sum, r) => sum + r.count, 0)} duplicate position records`,
          removed
        });
      }
      
    } catch (error) {
      console.error('❌ Failed to dedupe positions:', error);
      res.status(500).json({ error: "Deduplication failed" });
    }
  });

  // ONE-TIME FIX: Backfill layersFilled for all closed positions based on actual fills
  app.post("/api/admin/backfill-layers", async (req, res) => {
    try {
      console.log('🔧 Starting layersFilled backfill for all closed positions...');
      
      // Get all sessions
      const allSessions = await storage.getAllTradeSessions(DEFAULT_USER_ID);
      
      let totalProcessed = 0;
      let totalUpdated = 0;
      const sampleUpdates: Array<{
        symbol: string;
        side: string;
        oldLayers: number;
        newLayers: number;
      }> = [];
      
      // Process each session
      for (const session of allSessions) {
        const closedPositions = await storage.getClosedPositions(session.id);
        
        for (const position of closedPositions) {
          totalProcessed++;
          
          // Get fills directly linked to this position
          const allFills = await storage.getFillsByPosition(position.id);
          
          // Count entry fills
          let entryFills: Fill[] = [];
          
          // Try counting entry fills with layerNumber > 0 first
          entryFills = allFills.filter(f => f.layerNumber > 0);
          
          // FALLBACK: If no layerNumber data, count by fill side
          if (entryFills.length === 0 && allFills.length > 0) {
            const entrySide = position.side === 'long' ? 'buy' : 'sell';
            entryFills = allFills.filter(f => f.side === entrySide);
          }
          
          const actualLayersFilled = entryFills.length || 1; // Default to 1 if no fills data
          
          // Only update if different from current value
          if (actualLayersFilled !== position.layersFilled) {
            await storage.updatePosition(position.id, {
              layersFilled: actualLayersFilled
            });
            
            totalUpdated++;
            
            // Collect sample for response (max 20)
            if (sampleUpdates.length < 20) {
              sampleUpdates.push({
                symbol: position.symbol,
                side: position.side,
                oldLayers: position.layersFilled,
                newLayers: actualLayersFilled,
                totalFills: allFills.length,
                entryFills: entryFills.length
              });
            }
            
            if (totalUpdated % 100 === 0) {
              console.log(`   ✅ Updated ${totalUpdated} positions...`);
            }
          }
        }
      }
      
      console.log(`✅ Backfill complete: Updated ${totalUpdated} of ${totalProcessed} closed positions`);
      
      res.json({
        message: `Updated layersFilled for ${totalUpdated} of ${totalProcessed} closed positions`,
        totalProcessed,
        totalUpdated,
        sampleUpdates: sampleUpdates.length > 0 ? sampleUpdates : undefined
      });
      
    } catch (error) {
      console.error('❌ Failed to backfill layers:', error);
      res.status(500).json({ error: "Backfill failed" });
    }
  });

  // Repair P&L and fees for all closed positions using corrected logic
  app.post("/api/admin/repair-pnl-and-fees", async (req, res) => {
    try {
      console.log('🔧 Starting P&L and fees repair for all closed positions...');
      
      // Get all sessions
      const allSessions = await storage.getAllTradeSessions(DEFAULT_USER_ID);
      
      let totalProcessed = 0;
      let totalRepaired = 0;
      let totalSkipped = 0;
      const sampleDiscrepancies: Array<{
        symbol: string;
        side: string;
        oldPnl: string;
        newPnl: string;
        oldFees: string;
        newFees: string;
        difference: string;
      }> = [];
      
      // Process each session
      for (const session of allSessions) {
        const closedPositions = await storage.getClosedPositions(session.id);
        
        for (const position of closedPositions) {
          totalProcessed++;
          
          // Fetch entry and exit fills
          // Try by orderId pattern first (for live trading positions)
          let entryFills = await storage.getFillsByOrder(`entry-${position.id}`);
          let exitFills = await storage.getFillsByOrder(`exit-${position.id}`);
          
          // If not found, try by positionId (for synced positions)
          if (entryFills.length === 0 || exitFills.length === 0) {
            const allFills = await storage.getFillsByPosition(position.id);
            if (allFills.length > 0) {
              entryFills = allFills.filter(f => f.side === (position.side === 'long' ? 'buy' : 'sell'));
              exitFills = allFills.filter(f => f.side === (position.side === 'long' ? 'sell' : 'buy'));
            }
          }
          
          // Skip if missing critical data
          if (entryFills.length === 0) {
            console.log(`⚠️  Skipping ${position.symbol} ${position.side}: No entry fills found`);
            totalSkipped++;
            continue;
          }
          
          if (exitFills.length === 0) {
            console.log(`⚠️  Skipping ${position.symbol} ${position.side}: No exit fills found`);
            totalSkipped++;
            continue;
          }
          
          // Calculate totals from fills
          let totalEntryValue = 0;
          let totalEntryFees = 0;
          let totalExitValue = 0;
          let totalExitFees = 0;
          
          for (const fill of entryFills) {
            totalEntryValue += parseFloat(fill.value);
            totalEntryFees += parseFloat(fill.fee);
          }
          
          for (const fill of exitFills) {
            totalExitValue += parseFloat(fill.value);
            totalExitFees += parseFloat(fill.fee);
          }
          
          // Calculate gross P&L (price difference only)
          const grossPnl = position.side === 'long' 
            ? totalExitValue - totalEntryValue  // Long: profit when exit > entry
            : totalEntryValue - totalExitValue; // Short: profit when entry > exit
          
          // Calculate net P&L (gross - all fees)
          const totalFees = totalEntryFees + totalExitFees;
          const netPnl = grossPnl - totalFees;
          const pnlPercent = (grossPnl / totalEntryValue) * 100; // Use gross for % (before fees)
          
          // Get old values
          const oldPnl = parseFloat(position.realizedPnl || '0');
          const oldFees = parseFloat(position.totalFees || '0');
          
          // Calculate difference
          const pnlDifference = netPnl - oldPnl;
          const feesDifference = totalFees - oldFees;
          
          // Update position with corrected values
          await storage.updatePosition(position.id, {
            realizedPnl: netPnl.toString(),
            totalFees: totalFees.toString()
          });
          
          totalRepaired++;
          
          // Store sample discrepancies (first 10 with significant differences)
          if (sampleDiscrepancies.length < 10 && (Math.abs(pnlDifference) > 0.01 || Math.abs(feesDifference) > 0.01)) {
            sampleDiscrepancies.push({
              symbol: position.symbol,
              side: position.side,
              oldPnl: oldPnl.toFixed(4),
              newPnl: netPnl.toFixed(4),
              oldFees: oldFees.toFixed(4),
              newFees: totalFees.toFixed(4),
              difference: pnlDifference.toFixed(4)
            });
          }
          
          if (totalProcessed % 100 === 0) {
            console.log(`📊 Progress: ${totalProcessed} processed, ${totalRepaired} repaired, ${totalSkipped} skipped`);
          }
        }
      }
      
      console.log(`✅ Repair complete: ${totalRepaired} positions repaired, ${totalSkipped} skipped`);
      
      res.json({
        success: true,
        totalProcessed,
        totalRepaired,
        totalSkipped,
        sampleDiscrepancies,
        message: `Successfully repaired ${totalRepaired} positions. ${totalSkipped} positions skipped due to missing data.`
      });
      
    } catch (error: any) {
      console.error('❌ Failed to repair P&L and fees:', error);
      res.status(500).json({ error: `Repair failed: ${error.message}` });
    }
  });

  // CONSOLIDATE: Rebuild database with real exchange data (fills + P&L)
  app.post("/api/admin/consolidate-exchange-data", async (req, res) => {
    try {
      console.log('🔄 Starting database consolidation with real exchange data...');
      
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        return res.status(500).json({ error: 'API keys not configured' });
      }

      // Get active session
      const session = await storage.getOrCreateActiveSession(DEFAULT_USER_ID);
      if (!session) {
        return res.status(500).json({ error: 'No active session' });
      }

      // Step 1: Fetch ALL P&L events from income API (these = closed positions)
      console.log('📥 Step 1: Fetching P&L events from exchange...');
      
      // Add delay to avoid rate limiting (exchange has 2400 req/min limit)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const pnlResult = await fetchRealizedPnlEvents({
        startTime: new Date('2025-10-01T00:00:00Z').getTime(),
        endTime: Date.now(),
      });

      if (!pnlResult.success) {
        return res.status(500).json({ error: `Failed to fetch P&L events: ${pnlResult.error}` });
      }

      console.log(`✅ Found ${pnlResult.count} P&L events`);

      // Step 2: Fetch ALL fills from userTrades API
      console.log('📥 Step 2: Fetching fills from exchange...');
      const fillsResult = await fetchAllAccountTrades({
        startTime: new Date('2025-10-01T00:00:00Z').getTime(),
        endTime: Date.now(),
      });

      if (!fillsResult.success) {
        return res.status(500).json({ error: 'Failed to fetch fills' });
      }

      console.log(`✅ Found ${fillsResult.trades.length} fills`);

      // Step 3: Delete ALL old P&L sync positions (with synthetic fills)
      console.log('🗑️  Step 3: Removing old P&L sync positions...');
      const allPositions = await storage.getPositionsBySession(session.id);
      const syncPositions: string[] = [];
      
      for (const pos of allPositions) {
        const positionFills = await storage.getFillsByPosition(pos.id);
        const hasSyncFill = positionFills.some(f => f.orderId.startsWith('sync-pnl-'));
        if (hasSyncFill) {
          syncPositions.push(pos.id);
          // Delete synthetic fills first
          for (const fill of positionFills) {
            if (fill.orderId.startsWith('sync-pnl-')) {
              await db.delete(fills).where(eq(fills.id, fill.id));
            }
          }
          // Delete position
          await db.delete(positions).where(eq(positions.id, pos.id));
        }
      }
      
      console.log(`✅ Deleted ${syncPositions.length} old P&L sync positions`);

      // Step 4: Create consolidated positions with real fills + P&L
      console.log('🔨 Step 4: Creating consolidated positions...');
      let created = 0;

      for (const pnlEvent of pnlResult.events) {
        // Find fills for this P&L event (same symbol, before P&L time)
        const positionFills = fillsResult.trades.filter(fill => 
          fill.symbol === pnlEvent.symbol &&
          fill.time <= pnlEvent.time &&
          fill.time >= (pnlEvent.time - (24 * 60 * 60 * 1000)) // Within 24 hours before
        );

        if (positionFills.length === 0) {
          console.log(`⚠️  No fills found for ${pnlEvent.symbol} P&L event at ${new Date(pnlEvent.time).toISOString()}`);
          continue;
        }

        // Determine position side from fills
        const buyFills = positionFills.filter(f => f.buyer);
        const sellFills = positionFills.filter(f => !f.buyer);
        const side = buyFills.length > sellFills.length ? 'long' : 'short';
        
        // Calculate position metrics from fills
        const entryFills = side === 'long' ? buyFills : sellFills;
        const totalQty = entryFills.reduce((sum, f) => sum + parseFloat(f.qty), 0);
        const totalCost = entryFills.reduce((sum, f) => sum + (parseFloat(f.qty) * parseFloat(f.price)), 0);
        const avgPrice = totalCost / totalQty;
        const totalCommission = positionFills.reduce((sum, f) => sum + parseFloat(f.commission), 0);

        // Get strategy for leverage and maxLayers
        const strategy = await storage.getStrategyBySession(session.id);
        const leverage = strategy?.leverage || 1;
        const maxLayers = strategy?.maxLayers || 333;

        // Create consolidated position
        const position = await storage.createPosition({
          sessionId: session.id,
          symbol: pnlEvent.symbol,
          side,
          totalQuantity: totalQty.toString(),
          avgEntryPrice: avgPrice.toString(),
          totalCost: (totalCost / leverage).toString(), // Actual margin used
          unrealizedPnl: '0',
          realizedPnl: pnlEvent.income, // Real P&L from exchange
          layersFilled: entryFills.length,
          maxLayers,
          leverage,
          isOpen: false,
          totalFees: totalCommission.toString(),
        });

        // Set timestamps
        await db.update(positions)
          .set({
            openedAt: new Date(positionFills[0].time),
            closedAt: new Date(pnlEvent.time),
          })
          .where(eq(positions.id, position.id));

        // Create real fill records
        for (let i = 0; i < positionFills.length; i++) {
          const fill = positionFills[i];
          await storage.applyFill({
            orderId: fill.orderId.toString(),
            sessionId: session.id,
            positionId: position.id,
            symbol: fill.symbol,
            side: fill.buyer ? 'buy' : 'sell',
            quantity: fill.qty,
            price: fill.price,
            value: fill.quoteQty,
            fee: fill.commission,
            layerNumber: fill.buyer === (side === 'long') ? (entryFills.indexOf(fill) + 1) : 0,
            filledAt: new Date(fill.time),
          });
        }

        created++;
        
        if (created % 50 === 0) {
          console.log(`   ✅ Created ${created} consolidated positions...`);
        }
      }

      console.log(`✅ Consolidation complete: Created ${created} positions with real exchange data`);

      res.json({
        success: true,
        pnlEvents: pnlResult.count,
        fills: fillsResult.trades.length,
        deletedSyncPositions: syncPositions.length,
        createdPositions: created,
        message: `Successfully consolidated ${created} positions with real fills and P&L data`
      });

    } catch (error: any) {
      console.error('❌ Consolidation failed:', error);
      res.status(500).json({ error: `Consolidation failed: ${error.message}` });
    }
  });
  
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

  // Unified Market News API - aggregates from Alpha Vantage, CryptoNews-API, and Truth Social
  app.get("/api/sentiment/news", async (req, res) => {
    try {
      const category = (req.query.category as string) || 'all';
      const cacheKey = `news_${category}`;
      const cached = getCached<any>(cacheKey, 300000); // 5-minute cache
      
      if (cached) {
        return res.json(cached);
      }

      const allArticles: any[] = [];
      
      // Fetch from Alpha Vantage (market/economic news)
      if (category === 'all' || category === 'economic') {
        try {
          const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
          if (alphaVantageKey) {
            const topics = category === 'economic' 
              ? 'economy_monetary,economy_fiscal,earnings,ipo,financial_markets'
              : 'technology,finance,earnings';
            
            const avUrl = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=${topics}&limit=10&apikey=${alphaVantageKey}`;
            const avResponse = await fetch(avUrl);
            
            if (avResponse.ok) {
              const avData = await avResponse.json();
              if (avData.feed) {
                avData.feed.forEach((item: any) => {
                  allArticles.push({
                    title: item.title,
                    description: item.summary || '',
                    url: item.url,
                    source: { name: item.source || 'Alpha Vantage' },
                    publishedAt: item.time_published,
                    sourceType: 'market',
                    sentiment: item.overall_sentiment_label?.toLowerCase() || null,
                    sentimentScore: item.overall_sentiment_score || null
                  });
                });
              }
            }
          }
        } catch (error) {
          console.error('Alpha Vantage fetch failed:', error);
        }
      }
      
      // Fetch from CryptoNews-API (crypto-specific news)
      if (category === 'all' || category === 'crypto') {
        try {
          const cryptoNewsKey = process.env.CRYPTO_NEWS_API_KEY;
          if (cryptoNewsKey) {
            const cnUrl = `https://cryptonews-api.com/api/v1?tickers=BTC,ETH,ASTER&items=10&token=${cryptoNewsKey}`;
            const cnResponse = await fetch(cnUrl);
            
            if (cnResponse.ok) {
              const cnData = await cnResponse.json();
              if (cnData.data) {
                cnData.data.forEach((item: any) => {
                  allArticles.push({
                    title: item.title || item.news_title,
                    description: item.text || item.news_text || '',
                    url: item.news_url || item.url,
                    source: { name: item.source_name || 'CryptoNews' },
                    publishedAt: item.date || item.published_at,
                    sourceType: 'crypto',
                    sentiment: item.sentiment?.toLowerCase() || null,
                    sentimentScore: null
                  });
                });
              }
            }
          }
        } catch (error) {
          console.error('CryptoNews-API fetch failed:', error);
        }
      }
      
      // Fetch from Truth Social (Trump posts - political category)
      if (category === 'all' || category === 'political') {
        try {
          const truthSocialKey = process.env.TRUTH_SOCIAL_API_KEY;
          if (truthSocialKey) {
            const tsUrl = `https://api.scrapecreators.com/v1/truthsocial/profile?handle=realDonaldTrump`;
            const tsResponse = await fetch(tsUrl, {
              headers: { 'x-api-key': truthSocialKey }
            });
            
            if (tsResponse.ok) {
              const tsData = await tsResponse.json();
              if (tsData.posts) {
                tsData.posts.slice(0, 5).forEach((post: any) => {
                  allArticles.push({
                    title: `Trump: ${post.content?.substring(0, 100)}${post.content?.length > 100 ? '...' : ''}`,
                    description: post.content || '',
                    url: post.url || `https://truthsocial.com/@realDonaldTrump`,
                    source: { name: 'Truth Social' },
                    publishedAt: post.timestamp || post.created_at,
                    sourceType: 'political',
                    sentiment: null,
                    sentimentScore: null,
                    engagement: {
                      likes: post.likes || post.favourites_count || 0,
                      reposts: post.reposts || post.reblogs_count || 0
                    }
                  });
                });
              }
            }
          }
        } catch (error) {
          console.error('Truth Social API fetch failed:', error);
        }
      }
      
      // Sort by date (newest first)
      allArticles.sort((a, b) => {
        const dateA = new Date(a.publishedAt).getTime();
        const dateB = new Date(b.publishedAt).getTime();
        return dateB - dateA;
      });
      
      const result = {
        articles: allArticles,
        totalResults: allArticles.length,
        sources: {
          market: allArticles.filter(a => a.sourceType === 'market').length,
          crypto: allArticles.filter(a => a.sourceType === 'crypto').length,
          political: allArticles.filter(a => a.sourceType === 'political').length
        }
      };
      
      setCache(cacheKey, result);
      res.json(result);
    } catch (error: any) {
      console.error('Failed to fetch aggregated news:', error);
      res.status(500).json({ 
        error: error.message || "Failed to fetch news", 
        articles: [],
        totalResults: 0
      });
    }
  });

  app.get("/api/sentiment/social", async (req, res) => {
    try {
      // Mock social sentiment data
      // In production, integrate with LunarCrush, Reddit API, or Twitter API
      const mockSentiment = {
        score: Math.floor(Math.random() * 40) + 40, // 40-80 range
        trending: ['bitcoin', 'ethereum', 'altseason', 'FOMC', 'rate-cuts'],
        volume24h: Math.floor(Math.random() * 1000000) + 500000,
        sources: ['twitter', 'reddit', 'telegram'],
        lastUpdate: new Date().toISOString()
      };
      
      res.json(mockSentiment);
    } catch (error) {
      console.error('Failed to fetch social sentiment:', error);
      res.status(500).json({ error: "Failed to fetch social sentiment" });
    }
  });

  // Comprehensive market sentiment endpoint (combines order book + liquidation data)
  app.get("/api/sentiment/market", async (req, res) => {
    try {
      const cacheKey = 'market_sentiment';
      const cached = getCached<any>(cacheKey, 30000); // 30 second cache
      
      if (cached) {
        return res.json(cached);
      }

      // Fetch recent liquidations (last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const liquidations = await storage.getLiquidationsSince(oneHourAgo, 1000);
      
      // Get top symbols - if no liquidations, use default top symbols
      let topSymbols: string[] = [];
      
      if (liquidations.length > 0) {
        const symbolCounts = new Map<string, number>();
        liquidations.forEach(liq => {
          symbolCounts.set(liq.symbol, (symbolCounts.get(liq.symbol) || 0) + 1);
        });
        
        topSymbols = Array.from(symbolCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([symbol]) => symbol);
      } else {
        // Default to top 5 symbols when no liquidations
        topSymbols = ['BTCUSDT', 'ASTERUSDT', 'HYPEUSDT', 'BNBUSDT', 'AIAUSDT'];
      }
      
      // Fetch order book data for top symbols (in parallel with limit)
      const orderBookPromises = topSymbols.slice(0, 5).map(async (symbol) => {
        try {
          const response = await fetch(
            `https://fapi.asterdex.com/fapi/v1/depth?symbol=${symbol}&limit=100`,
            {
              headers: {
                'X-MBX-APIKEY': process.env.ASTER_API_KEY || ''
              }
            }
          );
          
          if (!response.ok) {
            console.warn(`Failed to fetch order book for ${symbol}: ${response.status}`);
            return null;
          }
          
          const orderBook = await response.json();
          const bids = orderBook.bids || [];
          const asks = orderBook.asks || [];
          
          // Calculate order book metrics
          const bidDepth = bids.reduce((sum: number, [price, quantity]: [string, string]) => 
            sum + parseFloat(price) * parseFloat(quantity), 0);
          const askDepth = asks.reduce((sum: number, [price, quantity]: [string, string]) => 
            sum + parseFloat(price) * parseFloat(quantity), 0);
          
          const totalDepth = bidDepth + askDepth;
          const bidRatio = totalDepth > 0 ? bidDepth / totalDepth : 0.5;
          
          return {
            symbol,
            bidDepth,
            askDepth,
            bidRatio,
            pressure: bidRatio > 0.55 ? 'bullish' : bidRatio < 0.45 ? 'bearish' : 'neutral'
          };
        } catch (error) {
          console.error(`Error fetching order book for ${symbol}:`, error);
          return null;
        }
      });
      
      const orderBookData = (await Promise.all(orderBookPromises)).filter(Boolean);
      
      // Calculate aggregate order book sentiment
      let aggregateBidDepth = 0;
      let aggregateAskDepth = 0;
      let bullishCount = 0;
      let bearishCount = 0;
      let neutralCount = 0;
      
      orderBookData.forEach(data => {
        if (data) {
          aggregateBidDepth += data.bidDepth;
          aggregateAskDepth += data.askDepth;
          if (data.pressure === 'bullish') bullishCount++;
          else if (data.pressure === 'bearish') bearishCount++;
          else neutralCount++;
        }
      });
      
      const totalOrderBookDepth = aggregateBidDepth + aggregateAskDepth;
      const overallBidRatio = totalOrderBookDepth > 0 ? aggregateBidDepth / totalOrderBookDepth : 0.5;
      
      // Calculate liquidation metrics
      const longLiqs = liquidations.filter(l => l.side === 'long');
      const shortLiqs = liquidations.filter(l => l.side === 'short');
      
      const longValue = longLiqs.reduce((sum, l) => sum + parseFloat(l.value), 0);
      const shortValue = shortLiqs.reduce((sum, l) => sum + parseFloat(l.value), 0);
      const totalLiqValue = longValue + shortValue;
      
      const longLiqRatio = totalLiqValue > 0 ? longValue / totalLiqValue : 0.5;
      
      // Combined sentiment logic:
      // - Order book bidRatio > 0.55 = bullish pressure
      // - Liquidations: more longs liquidated (longLiqRatio > 0.65) = bearish (longs getting rekt)
      // - Combine both signals with weighting
      const orderBookWeight = 0.6; // Order book is more predictive
      const liquidationWeight = 0.4;
      
      // Invert liquidation ratio (more long liqs = bearish signal)
      const liquidationBullishSignal = 1 - longLiqRatio;
      
      const combinedScore = (overallBidRatio * orderBookWeight) + (liquidationBullishSignal * liquidationWeight);
      
      let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      if (combinedScore > 0.58) sentiment = 'bullish';
      else if (combinedScore < 0.42) sentiment = 'bearish';
      
      const result = {
        sentiment,
        combinedScore: parseFloat(combinedScore.toFixed(4)),
        orderBook: {
          bidDepth: aggregateBidDepth.toFixed(2),
          askDepth: aggregateAskDepth.toFixed(2),
          bidRatio: overallBidRatio.toFixed(4),
          pressure: overallBidRatio > 0.55 ? 'bullish' : overallBidRatio < 0.45 ? 'bearish' : 'neutral',
          symbolsAnalyzed: orderBookData.length,
          distribution: {
            bullish: bullishCount,
            bearish: bearishCount,
            neutral: neutralCount
          }
        },
        liquidations: {
          totalValue: totalLiqValue.toFixed(2),
          longValue: longValue.toFixed(2),
          shortValue: shortValue.toFixed(2),
          longRatio: longLiqRatio.toFixed(4),
          count: liquidations.length,
          longCount: longLiqs.length,
          shortCount: shortLiqs.length
        },
        topSymbols,
        timestamp: new Date().toISOString()
      };
      
      setCache(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error('Failed to fetch market sentiment:', error);
      res.status(500).json({ error: "Failed to fetch market sentiment" });
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

      // Create cache key from sorted symbols list (order-independent)
      const sortedSymbols = [...symbols].sort().join(',');
      const cacheKey = `liquidity_batch:${sortedSymbols}`;
      
      // Check cache first (20 second TTL to prevent rate limiting)
      const cached = getCached<any[]>(cacheKey, 20000);
      if (cached) {
        console.log(`✅ Cache hit for liquidity batch (${symbols.length} symbols)`);
        return res.json(cached);
      }

      console.log(`🔄 Cache miss, fetching liquidity for ${symbols.length} symbols from exchange`);

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

      // Cache the result for 20 seconds to prevent rate limiting
      setCache(cacheKey, liquidityData);
      console.log(`✅ Cached liquidity batch for ${symbols.length} symbols (20s TTL)`);

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
        // NEVER auto-create strategies - user will create them via UI
        console.log('❌ No database strategy found - cannot sync without an existing strategy');
        return res.status(404).json({ 
          error: "No strategy exists in database. Please create a strategy first using the UI." 
        });
      }
    } catch (error) {
      console.error('❌ Error syncing strategy:', error);
      res.status(500).json({ error: "Failed to sync strategy to database" });
    }
  });

  // Sync completed trades from exchange to database
  app.post("/api/sessions/:sessionId/sync-trades", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { syncCompletedTrades } = await import('./exchange-sync');
      
      console.log(`🔄 Syncing completed trades from exchange for session ${sessionId}...`);
      const result = await syncCompletedTrades(sessionId);
      
      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }
      
      res.json({ 
        success: true, 
        addedCount: result.addedCount,
        message: `Successfully synced ${result.addedCount} missing position(s) from exchange`
      });
    } catch (error: any) {
      console.error('❌ Error syncing trades:', error);
      res.status(500).json({ error: `Failed to sync trades: ${error.message}` });
    }
  });

  // Sync transfers from exchange to database
  app.post("/api/sync/transfers", async (req, res) => {
    try {
      const { syncTransfers } = await import('./exchange-sync');
      
      console.log(`🔄 Syncing transfers from exchange...`);
      const result = await syncTransfers(DEFAULT_USER_ID);
      
      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }
      
      res.json({ 
        success: true, 
        addedCount: result.addedCount,
        message: `Successfully synced ${result.addedCount} new transfer(s) from exchange`
      });
    } catch (error: any) {
      console.error('❌ Error syncing transfers:', error);
      res.status(500).json({ error: `Failed to sync transfers: ${error.message}` });
    }
  });

  // Get total commissions (just the sum)
  app.get("/api/fees/commissions/total", async (req, res) => {
    try {
      const { getTotalCommissions } = await import('./exchange-sync');
      
      const result = await getTotalCommissions();
      
      if (!result.success) {
        return res.status(500).json({ error: result.error, total: 0 });
      }
      
      res.json({ total: result.total });
    } catch (error: any) {
      console.error('❌ Error fetching total commissions:', error);
      res.status(500).json({ error: `Failed to fetch commissions: ${error.message}`, total: 0 });
    }
  });

  // Get total funding fees (just the sum)
  app.get("/api/fees/funding/total", async (req, res) => {
    try {
      const { getTotalFundingFees } = await import('./exchange-sync');
      
      const result = await getTotalFundingFees();
      
      if (!result.success) {
        return res.status(500).json({ error: result.error, total: 0 });
      }
      
      res.json({ total: result.total });
    } catch (error: any) {
      console.error('❌ Error fetching total funding fees:', error);
      res.status(500).json({ error: `Failed to fetch funding fees: ${error.message}`, total: 0 });
    }
  });

  // Get transfers (deposits/withdrawals) - returns database transfers with exclusion status
  app.get("/api/transfers", async (req, res) => {
    try {
      // Fetch all transfers from database (primary source of truth for historical data)
      const allTransfers = await db.query.transfers.findMany({
        where: eq(transfers.userId, DEFAULT_USER_ID),
        orderBy: (transfers, { asc }) => [asc(transfers.timestamp)],
      });
      
      // Transform to match the frontend's expected format
      const transformedRecords = allTransfers.map(transfer => ({
        id: transfer.transactionId || transfer.id,
        userId: transfer.userId,
        amount: transfer.amount,
        asset: transfer.asset,
        transactionId: transfer.transactionId,
        timestamp: transfer.timestamp,
        excluded: transfer.excluded,
      }));
      
      res.json(transformedRecords);
    } catch (error: any) {
      console.error('❌ Error fetching transfers:', error);
      res.status(500).json({ error: `Failed to fetch transfers: ${error.message}`, records: [] });
    }
  });

  // Delete a specific transfer by ID
  app.delete("/api/transfers/:id", async (req, res) => {
    try {
      const { id } = req.params;

      // Delete from database
      await db.delete(transfers).where(eq(transfers.id, id));

      console.log(`✅ Deleted transfer: ${id}`);
      res.json({ success: true, id });
    } catch (error: any) {
      console.error('❌ Error deleting transfer:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clear all exclusions from transfers
  app.post("/api/transfers/clear-exclusions", async (req, res) => {
    try {
      const result = await db.update(transfers)
        .set({ excluded: false })
        .where(eq(transfers.excluded, true))
        .returning({ id: transfers.id, transactionId: transfers.transactionId, amount: transfers.amount });

      console.log(`✅ Cleared exclusions from ${result.length} transfer(s)`);
      res.json({ success: true, count: result.length, transfers: result });
    } catch (error: any) {
      console.error('❌ Error clearing exclusions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Manually add a transfer (for transfers not available via API)
  app.post("/api/transfers/manual", async (req, res) => {
    try {
      const { amount, asset, timestamp, transactionId, description } = req.body;

      if (!amount || !asset || !timestamp) {
        return res.status(400).json({ error: 'Missing required fields: amount, asset, timestamp' });
      }

      const transfer = await db.insert(transfers)
        .values({
          userId: DEFAULT_USER_ID,
          amount: amount.toString(),
          asset: asset,
          timestamp: new Date(timestamp),
          transactionId: transactionId || null,
          excluded: false,
        })
        .returning();

      console.log(`✅ Manually added transfer: ${asset} $${amount} at ${new Date(timestamp).toISOString()}`);
      res.json({ success: true, transfer: transfer[0] });
    } catch (error: any) {
      console.error('❌ Error adding manual transfer:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get commissions from exchange with optional date range
  app.get("/api/commissions", async (req, res) => {
    try {
      const { fetchCommissions, getGlobalCommissionCutoff } = await import('./exchange-sync');
      
      const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
      const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;
      
      const result = await fetchCommissions({ startTime, endTime });
      
      if (!result.success) {
        return res.status(500).json({ error: result.error, records: [], total: 0 });
      }
      
      // Get active strategy for manual adjustment
      const activeStrategy = await db.query.strategies.findFirst({
        where: eq(strategies.isActive, true)
      });
      
      // Get the GLOBAL API cutoff date (cached, fetched once)
      const globalCutoffDate = await getGlobalCommissionCutoff();
      
      // Only apply manual adjustment if viewing date range extends before GLOBAL API cutoff date
      // This prevents double-counting when viewing recent complete data
      const requestedStartTime = startTime || 0;
      const shouldApplyAdjustment = globalCutoffDate && requestedStartTime < globalCutoffDate;
      
      const manualAdjustment = (shouldApplyAdjustment && activeStrategy?.manualCommissionAdjustment)
        ? parseFloat(activeStrategy.manualCommissionAdjustment) 
        : 0;
      const adjustedTotal = result.total + manualAdjustment;
      
      res.json({ 
        records: result.records, 
        total: adjustedTotal,
        apiTotal: result.total,
        manualAdjustment,
        cutoffDate: globalCutoffDate,
        adjustmentApplied: shouldApplyAdjustment
      });
    } catch (error: any) {
      console.error('❌ Error fetching commissions:', error);
      res.status(500).json({ error: `Failed to fetch commissions: ${error.message}`, records: [], total: 0 });
    }
  });

  // Get funding fees from exchange with optional date range
  app.get("/api/funding-fees", async (req, res) => {
    try {
      const { fetchFundingFees, getGlobalFundingCutoff } = await import('./exchange-sync');
      
      const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
      const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;
      
      const result = await fetchFundingFees({ startTime, endTime });
      
      if (!result.success) {
        return res.status(500).json({ error: result.error, records: [], total: 0 });
      }
      
      // Get active strategy for manual adjustment
      const activeStrategy = await db.query.strategies.findFirst({
        where: eq(strategies.isActive, true)
      });
      
      // Get the GLOBAL API cutoff date (cached, fetched once)
      const globalCutoffDate = await getGlobalFundingCutoff();
      
      // Only apply manual adjustment if viewing date range extends before GLOBAL API cutoff date
      // This prevents double-counting when viewing recent complete data
      const requestedStartTime = startTime || 0;
      const shouldApplyAdjustment = globalCutoffDate && requestedStartTime < globalCutoffDate;
      
      const manualAdjustment = (shouldApplyAdjustment && activeStrategy?.manualFundingAdjustment)
        ? parseFloat(activeStrategy.manualFundingAdjustment) 
        : 0;
      const adjustedTotal = result.total + manualAdjustment;
      
      res.json({ 
        records: result.records, 
        total: adjustedTotal,
        apiTotal: result.total,
        manualAdjustment,
        cutoffDate: globalCutoffDate,
        adjustmentApplied: shouldApplyAdjustment
      });
    } catch (error: any) {
      console.error('❌ Error fetching funding fees:', error);
      res.status(500).json({ error: `Failed to fetch funding fees: ${error.message}`, records: [], total: 0 });
    }
  });

  // Get consolidated live data snapshot (account + positions + summary)
  app.get("/api/live/snapshot", async (req, res) => {
    try {
      const { liveDataOrchestrator } = await import('./live-data-orchestrator');
      
      // Get active strategy
      const activeStrategy = await db.query.strategies.findFirst({
        where: eq(strategies.isActive, true)
      });

      if (!activeStrategy) {
        return res.status(404).json({ error: "No active strategy found" });
      }

      // Get snapshot from orchestrator cache
      const snapshot = liveDataOrchestrator.getSnapshot(activeStrategy.id);
      
      res.json(snapshot);
    } catch (error: any) {
      console.error('❌ Error fetching live snapshot:', error);
      res.status(500).json({ error: `Failed to fetch live snapshot: ${error.message}` });
    }
  });

  // 🔍 DEBUG: Direct REST API account balance check (bypass WebSocket cache)
  app.get('/api/debug/account-balance', async (req, res) => {
    try {
      const { AsterExchangeAdapter } = await import('./exchanges/aster-adapter');
      const { liveDataOrchestrator } = await import('./live-data-orchestrator');
      
      const activeStrategy = await db.query.strategies.findFirst({
        where: eq(strategies.isActive, true)
      });
      
      if (!activeStrategy) {
        return res.status(404).json({ error: 'No active strategy found' });
      }

      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        return res.status(500).json({ error: 'Aster API keys not configured' });
      }

      const adapter = new AsterExchangeAdapter({
        apiKey,
        secretKey,
        baseURL: 'https://fapi.asterdex.com'
      });
      const accountInfo = await adapter.getAccountInfo();
      
      // Also get WebSocket cached data for comparison
      const wsSnapshot = liveDataOrchestrator.getSnapshot(activeStrategy.id);
      
      const balanceDiff = parseFloat(accountInfo.totalBalance || '0') - parseFloat(wsSnapshot.account?.totalWalletBalance || '0');
      const result = {
        restAPI: {
          totalBalance: accountInfo.totalBalance,
          availableBalance: accountInfo.availableBalance,
          totalUnrealizedPnl: accountInfo.totalUnrealizedPnl,
          assets: accountInfo.assets,
        },
        webSocket: {
          totalBalance: wsSnapshot.account?.totalWalletBalance,
          availableBalance: wsSnapshot.account?.availableBalance,
          totalUnrealizedPnl: wsSnapshot.account?.totalUnrealizedProfit,
          assets: wsSnapshot.account?.assets,
          lastUpdate: wsSnapshot.timestamp,
        },
        comparison: {
          balanceDiff,
          message: accountInfo.totalBalance === wsSnapshot.account?.totalWalletBalance 
            ? 'REST API and WebSocket match ✅' 
            : 'REST API and WebSocket differ ⚠️'
        }
      };
      
      // Log comparison results
      console.log('🔍 BALANCE COMPARISON:');
      console.log(`  REST API Balance: $${accountInfo.totalBalance}`);
      console.log(`  WebSocket Balance: $${wsSnapshot.account?.totalWalletBalance}`);
      console.log(`  Difference: $${balanceDiff.toFixed(2)}`);
      console.log(`  ${result.comparison.message}`);
      
      res.json(result);
    } catch (error: any) {
      console.error('❌ Failed to fetch account balance:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get live account balance from Aster DEX
  app.get("/api/live/account", async (req, res) => {
    try {
      // Get active strategy
      const activeStrategy = await db.query.strategies.findFirst({
        where: (strategies, { eq }) => eq(strategies.isActive, true)
      });
      
      if (!activeStrategy) {
        return res.status(404).json({ error: "No active strategy found" });
      }
      
      // ONLY use WebSocket cache (NO API fallback to prevent rate limiting)
      const snapshot = liveDataOrchestrator.getSnapshot(activeStrategy.id);
      if (snapshot && snapshot.account) {
        return res.json(snapshot.account);
      }

      // WebSocket data not available yet - return friendly error
      // Frontend will retry via refetchInterval
      return res.status(503).json({
        error: "Account data not yet available via WebSocket. Please wait a moment...",
        retryAfter: 5 // Suggest retry after 5 seconds
      });
    } catch (error) {
      console.error('Error fetching live account data:', error);
      res.status(500).json({ error: "Failed to fetch live account data" });
    }
  });

  // Listen key management for WebSocket user data stream
  app.post("/api/live/listenKey", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: "Aster DEX API key not configured" });
      }

      const response = await fetch(
        'https://fapi.asterdex.com/fapi/v1/listenKey',
        {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to create listen key:', errorText);
        return res.status(response.status).json({ error: `Failed to create listen key: ${errorText}` });
      }

      const data = await response.json();
      console.log('✅ Created listen key for WebSocket user data stream');
      res.json(data);
    } catch (error) {
      console.error('Error creating listen key:', error);
      res.status(500).json({ error: "Failed to create listen key" });
    }
  });

  app.put("/api/live/listenKey", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: "Aster DEX API key not configured" });
      }

      const response = await fetch(
        'https://fapi.asterdex.com/fapi/v1/listenKey',
        {
          method: 'PUT',
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to keepalive listen key:', errorText);
        return res.status(response.status).json({ error: `Failed to keepalive listen key: ${errorText}` });
      }

      const data = await response.json();
      console.log('🔄 Keepalive listen key');
      res.json(data);
    } catch (error) {
      console.error('Error keepalive listen key:', error);
      res.status(500).json({ error: "Failed to keepalive listen key" });
    }
  });

  app.delete("/api/live/listenKey", async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: "Aster DEX API key not configured" });
      }

      const response = await fetch(
        'https://fapi.asterdex.com/fapi/v1/listenKey',
        {
          method: 'DELETE',
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to close listen key:', errorText);
        return res.status(response.status).json({ error: `Failed to close listen key: ${errorText}` });
      }

      const data = await response.json();
      console.log('🔚 Closed listen key');
      res.json(data);
    } catch (error) {
      console.error('Error closing listen key:', error);
      res.status(500).json({ error: "Failed to close listen key" });
    }
  });

  // Get live open positions from Aster DEX
  app.get("/api/live/positions", async (req, res) => {
    try {
      // Get active strategy
      const activeStrategy = await db.query.strategies.findFirst({
        where: (strategies, { eq }) => eq(strategies.isActive, true)
      });
      
      if (!activeStrategy) {
        return res.status(404).json({ error: "No active strategy found" });
      }
      
      // Check if fresh data requested (bypass cache for initial startup)
      const fresh = req.query.fresh === 'true';
      
      // Check orchestrator cache first (populated by WebSocket) - only if not requesting fresh data
      if (!fresh) {
        const snapshot = liveDataOrchestrator.getSnapshot(activeStrategy.id);
        if (snapshot && snapshot.positions && snapshot.positions.length > 0) {
          console.log(`📦 Returning ${snapshot.positions.length} cached positions`);
          return res.json(snapshot.positions);
        }
      } else {
        console.log('🔄 Fresh position data requested, bypassing cache');
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
        console.error(`❌ Failed to fetch Aster DEX positions (${response.status}):`, errorText);
        // If rate limited, try to return stale cache
        if (response.status === 429) {
          const staleCache = apiCache.get('live_positions');
          if (staleCache) {
            console.log('📦 Returning stale cached positions due to rate limit');
            return res.json(staleCache.data);
          }
        }
        return res.status(response.status).json({ error: `Aster DEX API error: ${errorText}` });
      }

      const data = await response.json();
      console.log(`📥 Received ${data.length} total positions from Aster DEX API`);
      
      // Filter out positions with zero quantity
      const openPositions = data.filter((pos: any) => parseFloat(pos.positionAmt) !== 0);
      console.log(`✅ Filtered to ${openPositions.length} non-zero positions`);

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

  // DEBUG: Test endpoint to fetch ALL income types
  app.get('/api/debug/all-income', async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.json({ error: 'API keys not configured' });
      }

      const timestamp = Date.now();
      const queryParams = `timestamp=${timestamp}`;

      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(queryParams)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return res.json({ error: `HTTP ${response.status}: ${errorText}` });
      }

      const allIncome = await response.json();

      // Group by income type and sum
      const summary: Record<string, { count: number; total: number }> = {};
      allIncome.forEach((item: any) => {
        const type = item.incomeType || 'UNKNOWN';
        if (!summary[type]) {
          summary[type] = { count: 0, total: 0 };
        }
        summary[type].count++;
        summary[type].total += parseFloat(item.income || '0');
      });

      return res.json({
        totalRecords: allIncome.length,
        summary,
        sampleRecords: allIncome.slice(0, 5),
      });
    } catch (error) {
      return res.json({ error: String(error) });
    }
  });

  // Get deposits and withdrawals (TRANSFER income type)
  app.get('/api/account/deposits-withdrawals', async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(500).json({ error: 'API keys not configured' });
      }

      console.log('📥 Fetching deposits and withdrawals from exchange...');

      const allTransfers: any[] = [];
      let hasMoreData = true;
      let startTime = 0; // Fetch all-time data

      // Pagination loop (max 1000 records per request)
      while (hasMoreData) {
        const timestamp = Date.now();
        const params = new URLSearchParams({
          incomeType: 'TRANSFER', // Get transfer transactions (includes deposits/withdrawals)
          startTime: startTime.toString(),
          limit: '1000',
          timestamp: timestamp.toString(),
        });

        const signature = crypto
          .createHmac('sha256', secretKey)
          .update(params.toString())
          .digest('hex');
        params.append('signature', signature);

        const response = await fetch(
          `https://fapi.asterdex.com/fapi/v1/income?${params}`,
          { headers: { 'X-MBX-APIKEY': apiKey } }
        );

        if (!response.ok) {
          const errorText = await response.text();
          return res.status(500).json({ error: `Exchange API error: ${errorText}` });
        }

        const batch = await response.json();

        if (batch.length === 0) {
          hasMoreData = false;
        } else {
          allTransfers.push(...batch);

          // If we got exactly 1000, there might be more data
          if (batch.length < 1000) {
            hasMoreData = false;
          } else {
            // Use last record's time as next startTime
            const lastRecord = batch[batch.length - 1];
            startTime = lastRecord.time + 1;
          }
        }
      }

      console.log(`✅ Fetched ${allTransfers.length} transfer records from exchange`);

      // Separate deposits and withdrawals
      const deposits = allTransfers.filter(t => parseFloat(t.income) > 0);
      const withdrawals = allTransfers.filter(t => parseFloat(t.income) < 0);

      const totalDeposits = deposits.reduce((sum, t) => sum + parseFloat(t.income), 0);
      const totalWithdrawals = withdrawals.reduce((sum, t) => sum + parseFloat(t.income), 0);

      return res.json({
        summary: {
          totalDeposits: totalDeposits.toFixed(2),
          totalWithdrawals: Math.abs(totalWithdrawals).toFixed(2),
          netTransfer: (totalDeposits + totalWithdrawals).toFixed(2),
          depositCount: deposits.length,
          withdrawalCount: withdrawals.length,
        },
        deposits: deposits.map(d => ({
          amount: parseFloat(d.income).toFixed(2),
          asset: d.asset,
          time: new Date(d.time).toISOString(),
          tranId: d.tranId,
        })),
        withdrawals: withdrawals.map(w => ({
          amount: Math.abs(parseFloat(w.income)).toFixed(2),
          asset: w.asset,
          time: new Date(w.time).toISOString(),
          tranId: w.tranId,
        })),
      });
    } catch (error) {
      console.error('Error fetching deposits/withdrawals:', error);
      return res.status(500).json({ error: String(error) });
    }
  });

  // Account Ledger Endpoints

  // Get all ledger entries
  app.get('/api/account/ledger', async (req, res) => {
    try {
      const { investor, startDate, endDate, type } = req.query;

      let query = db.select().from(accountLedger).where(eq(accountLedger.userId, DEFAULT_USER_ID));

      if (investor) {
        query = query.where(eq(accountLedger.investor, investor as string));
      }

      if (startDate) {
        query = query.where(gte(accountLedger.timestamp, new Date(startDate as string)));
      }

      if (endDate) {
        query = query.where(lte(accountLedger.timestamp, new Date(endDate as string)));
      }

      if (type) {
        query = query.where(eq(accountLedger.type, type as string));
      }

      const entries = await query.orderBy(desc(accountLedger.timestamp));

      res.json(entries);
    } catch (error) {
      console.error('Error fetching ledger:', error);
      res.status(500).json({ error: 'Failed to fetch ledger' });
    }
  });

  // Fetch pending exchange transfers (not yet in ledger) - USDT and USDF only
  app.get('/api/account/ledger/pending-transfers', async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(500).json({ error: 'API keys not configured' });
      }

      console.log('📥 Fetching ALL exchange transactions from October 16, 2025 5:19 PM UTC...');

      // Start from October 16, 2025 at 17:19 UTC (first deposit - excludes testing period)
      const oct10Timestamp = 1760635140000;

      const allTransfers: any[] = [];
      let hasMoreData = true;
      let startTime = oct10Timestamp;

      while (hasMoreData) {
        const timestamp = Date.now();
        const params = new URLSearchParams({
          // Remove incomeType filter to get ALL transaction types
          startTime: startTime.toString(),
          limit: '1000',
          timestamp: timestamp.toString(),
        });

        const signature = crypto.createHmac('sha256', secretKey).update(params.toString()).digest('hex');
        params.append('signature', signature);

        const response = await fetch(`https://fapi.asterdex.com/fapi/v1/income?${params}`, {
          headers: { 'X-MBX-APIKEY': apiKey },
        });

        if (!response.ok) {
          const errorText = await response.text();
          return res.status(500).json({ error: `Exchange API error: ${errorText}` });
        }

        const batch = await response.json();

        if (batch.length === 0) {
          hasMoreData = false;
        } else {
          allTransfers.push(...batch);
          if (batch.length < 1000) {
            hasMoreData = false;
          } else {
            const lastRecord = batch[batch.length - 1];
            startTime = lastRecord.time + 1;
          }
        }
      }

      // First, let's see all transfer types across ALL assets
      const allTransferTypes = allTransfers.filter(t =>
        t.incomeType && t.incomeType.includes('TRANSFER')
      );

      console.log(`🔍 Found ${allTransferTypes.length} total TRANSFER transactions across ALL assets`);
      console.log(`   Assets: ${[...new Set(allTransferTypes.map(t => t.asset))].join(', ')}`);
      console.log(`   Income Types: ${[...new Set(allTransferTypes.map(t => t.incomeType))].join(', ')}`);

      // Show ALL TRANSFER types across ALL assets (not just USDT/USDF)
      const filteredTransfers = allTransfers.filter(t =>
        parseFloat(t.income || '0') !== 0 &&
        t.incomeType && t.incomeType.includes('TRANSFER')
      );

      console.log(`✅ Fetched ${filteredTransfers.length} TRANSFER transactions from exchange (all assets)`);

      // Get all existing tranIds from ledger
      const existingEntries = await db.select({
        tranId: accountLedger.tranId
      }).from(accountLedger)
        .where(sql`${accountLedger.tranId} IS NOT NULL`);

      const existingTranIds = new Set(existingEntries.map(e => e.tranId));

      // Filter out transfers already in ledger
      const pendingTransfers = filteredTransfers
        .filter(t => !existingTranIds.has(String(t.tranId)))
        .map(t => ({
          tranId: String(t.tranId),
          asset: t.asset,
          income: t.income,
          amount: Math.abs(parseFloat(t.income)),
          type: parseFloat(t.income) > 0 ? 'deposit' : 'withdrawal',
          time: t.time,
          timestamp: new Date(t.time).toISOString(),
          incomeType: t.incomeType, // Include transaction type
        }))
        .sort((a, b) => b.time - a.time); // Most recent first

      console.log(`✅ Found ${pendingTransfers.length} pending transfers not in ledger`);

      res.json({
        transfers: pendingTransfers,
        total: pendingTransfers.length,
      });
    } catch (error) {
      console.error('Error fetching pending transfers:', error);
      res.status(500).json({ error: 'Failed to fetch pending transfers' });
    }
  });

  // Helper function: Recalculate baseline for the most recent ledger entry
  // This ensures fairness when entries are added or deleted
  async function recalculateMostRecentBaseline() {
    try {
      // Get the most recent ledger entry by timestamp
      const mostRecentEntry = await db.query.accountLedger.findFirst({
        where: (ledger, { eq }) => eq(ledger.userId, DEFAULT_USER_ID),
        orderBy: (ledger, { desc }) => [desc(ledger.timestamp)],
      });

      if (!mostRecentEntry) {
        console.log('📊 No ledger entries to recalculate');
        return;
      }

      // Fetch current account balance
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        console.warn('⚠️ Cannot recalculate baseline: API keys not configured');
        return;
      }

      const ts = Date.now();
      const params = new URLSearchParams({ timestamp: ts.toString() });
      const signature = crypto.createHmac('sha256', secretKey).update(params.toString()).digest('hex');
      params.append('signature', signature);

      const response = await fetch(`https://fapi.asterdex.com/fapi/v2/account?${params}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      });

      if (!response.ok) {
        console.warn('⚠️ Failed to fetch account balance for baseline recalculation');
        return;
      }

      const accountData = await response.json();
      const currentBalance = parseFloat(accountData.totalWalletBalance || '0') + parseFloat(accountData.totalUnrealizedProfit || '0');

      // Update the most recent entry's baseline to current balance
      await db.update(accountLedger)
        .set({
          baselineBalance: currentBalance.toString(),
          updatedAt: new Date(),
        })
        .where(eq(accountLedger.id, mostRecentEntry.id));

      console.log(`✅ Recalculated baseline for most recent entry: $${currentBalance.toFixed(2)}`);
    } catch (error) {
      console.error('❌ Error recalculating baseline:', error);
      // Don't throw - this is a best-effort operation
    }
  }

  // Add specific transfer to ledger with optional details
  app.post('/api/account/ledger/from-transfer', async (req, res) => {
    try {
      const { tranId, asset, amount, type, timestamp, investor, reason, notes } = req.body;

      if (!tranId || !asset || !amount || !type || !timestamp) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Check if already exists
      const existing = await db.select().from(accountLedger)
        .where(eq(accountLedger.tranId, String(tranId)))
        .limit(1);

      if (existing.length > 0) {
        return res.status(409).json({ error: 'Transfer already in ledger' });
      }

      // Fetch current account balance for baseline tracking
      let baselineBalance: number | null = null;
      try {
        const apiKey = process.env.ASTER_API_KEY;
        const secretKey = process.env.ASTER_SECRET_KEY;

        if (apiKey && secretKey) {
          const ts = Date.now();
          const params = new URLSearchParams({ timestamp: ts.toString() });
          const signature = crypto.createHmac('sha256', secretKey).update(params.toString()).digest('hex');
          params.append('signature', signature);

          const response = await fetch(`https://fapi.asterdex.com/fapi/v2/account?${params}`, {
            headers: { 'X-MBX-APIKEY': apiKey },
          });

          if (response.ok) {
            const accountData = await response.json();
            const currentBalance = parseFloat(accountData.totalWalletBalance || '0') + parseFloat(accountData.totalUnrealizedProfit || '0');

            // Baseline should be balance BEFORE this transaction
            // If adding funds: subtract the deposit from current balance
            // If removing funds: add the withdrawal back to current balance
            if (type === 'deposit' || type === 'manual_add') {
              baselineBalance = currentBalance - amount;
            } else if (type === 'withdrawal' || type === 'manual_subtract') {
              baselineBalance = currentBalance + amount;
            } else {
              baselineBalance = currentBalance;
            }

            console.log(`📊 Baseline balance captured: $${baselineBalance.toFixed(2)} (current: $${currentBalance.toFixed(2)}, ${type} amount: $${amount})`);
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to fetch baseline balance:', error);
        // Continue without baseline - it's optional for backward compatibility
      }

      // Insert into ledger with optional details
      const [entry] = await db.insert(accountLedger).values({
        userId: DEFAULT_USER_ID,
        type,
        amount: amount.toString(),
        asset,
        timestamp: new Date(timestamp),
        tranId: String(tranId),
        investor: investor || null,
        reason: reason || null,
        notes: notes || null,
        baselineBalance: baselineBalance?.toString() || null,
      }).returning();

      console.log(`✅ Added transfer ${tranId} to ledger with details`);

      // Recalculate baseline for fairness after addition
      await recalculateMostRecentBaseline();

      res.json(entry);
    } catch (error) {
      console.error('Error adding transfer to ledger:', error);
      res.status(500).json({ error: 'Failed to add transfer to ledger' });
    }
  });

  // Add manual ledger entry
  app.post('/api/account/ledger/manual', async (req, res) => {
    try {
      const { type, amount, asset, timestamp, investor, reason, notes } = req.body;

      if (!type || !amount || !timestamp) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (!['manual_add', 'manual_subtract'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type. Must be manual_add or manual_subtract' });
      }

      // Fetch current account balance for baseline tracking
      let baselineBalance: number | null = null;
      try {
        const apiKey = process.env.ASTER_API_KEY;
        const secretKey = process.env.ASTER_SECRET_KEY;

        if (apiKey && secretKey) {
          const ts = Date.now();
          const params = new URLSearchParams({ timestamp: ts.toString() });
          const signature = crypto.createHmac('sha256', secretKey).update(params.toString()).digest('hex');
          params.append('signature', signature);

          const response = await fetch(`https://fapi.asterdex.com/fapi/v2/account?${params}`, {
            headers: { 'X-MBX-APIKEY': apiKey },
          });

          if (response.ok) {
            const accountData = await response.json();
            const currentBalance = parseFloat(accountData.totalWalletBalance || '0') + parseFloat(accountData.totalUnrealizedProfit || '0');
            const amountNum = parseFloat(amount);

            // Baseline should be balance BEFORE this transaction
            // If adding funds: subtract the deposit from current balance
            // If removing funds: add the withdrawal back to current balance
            if (type === 'manual_add') {
              baselineBalance = currentBalance - amountNum;
            } else if (type === 'manual_subtract') {
              baselineBalance = currentBalance + amountNum;
            } else {
              baselineBalance = currentBalance;
            }

            console.log(`📊 Baseline balance captured: $${baselineBalance.toFixed(2)} (current: $${currentBalance.toFixed(2)}, ${type} amount: $${amountNum})`);
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to fetch baseline balance:', error);
        // Continue without baseline - it's optional for backward compatibility
      }

      const entry = await db.insert(accountLedger).values({
        userId: DEFAULT_USER_ID,
        type,
        amount: amount.toString(),
        asset: asset || 'USDT',
        timestamp: new Date(timestamp),
        investor,
        reason,
        notes,
        baselineBalance: baselineBalance?.toString() || null,
      }).returning();

      // Recalculate baseline for fairness after addition
      // This ensures if entries were added out of order, the most recent has correct baseline
      await recalculateMostRecentBaseline();

      res.json(entry[0]);
    } catch (error) {
      console.error('Error adding manual entry:', error);
      res.status(500).json({ error: 'Failed to add manual entry' });
    }
  });

  // Update ledger entry (manual or transfer)
  app.put('/api/account/ledger/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { investor, reason, notes } = req.body;

      // Only allow updating investor, reason, and notes
      const entry = await db.update(accountLedger)
        .set({
          investor,
          reason,
          notes,
          updatedAt: new Date(),
        })
        .where(eq(accountLedger.id, id))
        .returning();

      if (entry.length === 0) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      res.json(entry[0]);
    } catch (error) {
      console.error('Error updating entry:', error);
      res.status(500).json({ error: 'Failed to update entry' });
    }
  });

  // Legacy endpoint for backward compatibility
  app.put('/api/account/ledger/manual/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { type, amount, asset, timestamp, investor, reason, notes } = req.body;

      const entry = await db.update(accountLedger)
        .set({
          type,
          amount: amount?.toString(),
          asset,
          timestamp: timestamp ? new Date(timestamp) : undefined,
          investor,
          reason,
          notes,
          updatedAt: new Date(),
        })
        .where(eq(accountLedger.id, id))
        .returning();

      if (entry.length === 0) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      res.json(entry[0]);
    } catch (error) {
      console.error('Error updating manual entry:', error);
      res.status(500).json({ error: 'Failed to update manual entry' });
    }
  });

  // Delete any ledger entry
  app.delete('/api/account/ledger/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const deleted = await db.delete(accountLedger)
        .where(eq(accountLedger.id, id))
        .returning();

      if (deleted.length === 0) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      // Recalculate baseline for fairness after deletion
      await recalculateMostRecentBaseline();

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting entry:', error);
      res.status(500).json({ error: 'Failed to delete entry' });
    }
  });

  // ONE-TIME FIX: Correct baselines that were captured AFTER deposits
  app.post('/api/account/ledger/fix-baselines', async (req, res) => {
    try {
      const entries = await db.select().from(accountLedger)
        .where(eq(accountLedger.userId, DEFAULT_USER_ID))
        .orderBy(accountLedger.timestamp);

      const fixed = [];

      for (const entry of entries) {
        if (entry.baselineBalance && (entry.type === 'deposit' || entry.type === 'manual_add' || entry.type === 'withdrawal' || entry.type === 'manual_subtract')) {
          const currentBaseline = parseFloat(entry.baselineBalance);
          const amount = parseFloat(entry.amount);

          // Calculate what the baseline should be (balance BEFORE transaction)
          let correctBaseline;
          if (entry.type === 'deposit' || entry.type === 'manual_add') {
            // If baseline was captured after deposit, subtract the deposit amount
            correctBaseline = currentBaseline - amount;
          } else if (entry.type === 'withdrawal' || entry.type === 'manual_subtract') {
            // If baseline was captured after withdrawal, add it back
            correctBaseline = currentBaseline + amount;
          }

          // Only update if different and makes sense (not negative)
          if (correctBaseline !== undefined && correctBaseline >= 0 && Math.abs(correctBaseline - currentBaseline) > 0.01) {
            await db.update(accountLedger)
              .set({
                baselineBalance: correctBaseline.toString(),
                updatedAt: new Date(),
              })
              .where(eq(accountLedger.id, entry.id));

            fixed.push({
              id: entry.id,
              investor: entry.investor,
              amount: entry.amount,
              oldBaseline: currentBaseline.toFixed(2),
              newBaseline: correctBaseline.toFixed(2),
            });

            console.log(`✅ Fixed baseline for ${entry.investor} $${entry.amount}: $${currentBaseline.toFixed(2)} → $${correctBaseline.toFixed(2)}`);
          }
        }
      }

      res.json({
        success: true,
        fixed: fixed.length,
        entries: fixed,
      });
    } catch (error) {
      console.error('Error fixing baselines:', error);
      res.status(500).json({ error: 'Failed to fix baselines' });
    }
  });

  // ONE-TIME FIX: Set specific baseline values manually
  app.post('/api/account/ledger/fix-baselines-manual', async (req, res) => {
    try {
      const fixes = [
        // Initial deposits - all start with baseline $0 (starting capital)
        { investor: 'R', amount: '1300.00', timestamp: '2025-10-16T17:09:00.000Z', baseline: '0.00' },
        { investor: 'DT', amount: '1300.00', timestamp: '2025-10-16T17:19:00.000Z', baseline: '0.00' },
        // Additional deposits - baseline is balance BEFORE deposit
        { investor: 'DT', amount: '5000.00', timestamp: '2025-10-28T18:14:09.119Z', baseline: '4200.00' },
        { investor: 'K', amount: '5000.00', timestamp: '2025-10-30T06:05:49.936Z', baseline: '9505.87' },
      ];

      const results = [];
      for (const fix of fixes) {
        const updated = await db.update(accountLedger)
          .set({
            baselineBalance: fix.baseline,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(accountLedger.investor, fix.investor),
              eq(accountLedger.amount, fix.amount),
              eq(accountLedger.timestamp, new Date(fix.timestamp))
            )
          )
          .returning();

        if (updated.length > 0) {
          results.push({ ...fix, success: true });
          console.log(`✅ Fixed ${fix.investor} $${fix.amount} baseline to ${fix.baseline}`);
        }
      }

      res.json({ success: true, fixed: results.length, entries: results });
    } catch (error) {
      console.error('Error fixing baselines manually:', error);
      res.status(500).json({ error: 'Failed to fix baselines' });
    }
  });

  // Legacy endpoint for backward compatibility
  app.delete('/api/account/ledger/manual/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const deleted = await db.delete(accountLedger)
        .where(eq(accountLedger.id, id))
        .returning();

      if (deleted.length === 0) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      // Recalculate baseline for fairness after deletion
      await recalculateMostRecentBaseline();

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting manual entry:', error);
      res.status(500).json({ error: 'Failed to delete manual entry' });
    }
  });

  // Calculate PNL/ROI based on ledger entries
  app.get('/api/account/ledger/pnl', async (req, res) => {
    try {
      const { investor, startDate, endDate } = req.query;

      // Get ledger entries
      let ledgerQuery = db.select().from(accountLedger).where(eq(accountLedger.userId, DEFAULT_USER_ID));

      if (investor) {
        ledgerQuery = ledgerQuery.where(eq(accountLedger.investor, investor as string));
      }

      if (startDate) {
        ledgerQuery = ledgerQuery.where(gte(accountLedger.timestamp, new Date(startDate as string)));
      }

      if (endDate) {
        ledgerQuery = ledgerQuery.where(lte(accountLedger.timestamp, new Date(endDate as string)));
      }

      const ledgerEntries = await ledgerQuery;

      // Calculate total capital
      const totalCapital = ledgerEntries.reduce((sum, entry) => {
        const amount = parseFloat(entry.amount);
        if (entry.type === 'deposit' || entry.type === 'manual_add') {
          return sum + amount;
        } else if (entry.type === 'withdrawal' || entry.type === 'manual_subtract') {
          return sum - amount;
        }
        return sum;
      }, 0);

      // Get current account balance from exchange
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(500).json({ error: 'API keys not configured' });
      }

      const timestamp = Date.now();
      const params = new URLSearchParams({ timestamp: timestamp.toString() });
      const signature = crypto.createHmac('sha256', secretKey).update(params.toString()).digest('hex');
      params.append('signature', signature);

      const response = await fetch(`https://fapi.asterdex.com/fapi/v2/account?${params}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      });

      if (!response.ok) {
        return res.status(500).json({ error: 'Failed to fetch account balance' });
      }

      const accountData = await response.json();
      const currentBalance = parseFloat(accountData.totalWalletBalance || '0') + parseFloat(accountData.totalUnrealizedProfit || '0');

      // Calculate PNL and ROI
      const pnl = currentBalance - totalCapital;
      const roi = totalCapital > 0 ? (pnl / totalCapital) * 100 : 0;

      res.json({
        totalCapital: totalCapital.toFixed(2),
        currentBalance: currentBalance.toFixed(2),
        pnl: pnl.toFixed(2),
        roiPercent: roi.toFixed(2),
        ledgerEntries: ledgerEntries.length,
      });
    } catch (error) {
      console.error('Error calculating PNL:', error);
      res.status(500).json({ error: 'Failed to calculate PNL' });
    }
  });

  // Get investor returns breakdown with time-weighted ROI
  app.get('/api/account/ledger/investors-returns', async (req, res) => {
    try {
      // Get all ledger entries sorted by timestamp
      const ledgerEntries = await db.select().from(accountLedger)
        .where(eq(accountLedger.userId, DEFAULT_USER_ID))
        .orderBy(accountLedger.timestamp);

      // Get unique investors (including null/undefined for unassigned)
      const investorsSet = new Set<string>();
      ledgerEntries.forEach(entry => {
        investorsSet.add(entry.investor || 'Unassigned');
      });

      const investors = Array.from(investorsSet);

      // Get current account balance from WebSocket cache (like investor report)
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      if (strategies.length === 0) {
        return res.status(404).json({ error: 'No strategy found' });
      }

      const strategy = strategies[0];
      const snapshot = liveDataOrchestrator.getSnapshot(strategy.id);
      if (!snapshot || !snapshot.account || !snapshot.account.totalWalletBalance) {
        return res.status(503).json({
          error: 'Account data not yet available via WebSocket. Please wait a moment...',
          retryAfter: 5
        });
      }

      const totalCurrentBalance = parseFloat(snapshot.account.totalWalletBalance);

      // Check if we have baseline data for time-weighted calculation
      const hasBaselineData = ledgerEntries.some(e => e.baselineBalance !== null);

      // Build investor P&L tracking
      const investorPnLMap = new Map<string, number>();
      investors.forEach(inv => investorPnLMap.set(inv, 0));

      if (hasBaselineData) {
        // COMPOUNDING PERIOD-BASED CALCULATION WITH BASELINE GROUPING
        // Group deposits by baseline value - only unique baselines create new periods
        // After each period, gains/losses compound into investor balances
        // Ownership % recalculates when new capital arrives
        console.log('📊 Calculating compounding period-based returns with baseline grouping...');

        // Track current balance for each investor (compounds over time)
        const investorBalances = new Map<string, number>();
        investors.forEach(inv => investorBalances.set(inv, 0));

        // Get entries with baselines to define periods
        const baselineEntries = ledgerEntries.filter(e => e.baselineBalance !== null);

        // Group deposits by their baseline value (unique baseline = new period boundary)
        const baselineGroups: Array<{baseline: number, deposits: any[]}> = [];
        baselineEntries.forEach(entry => {
          const baseline = parseFloat(entry.baselineBalance || '0');
          let group = baselineGroups.find(g => Math.abs(g.baseline - baseline) < 0.01);
          if (!group) {
            group = { baseline, deposits: [] };
            baselineGroups.push(group);
          }
          group.deposits.push(entry);
        });

        // Sort groups by baseline value
        baselineGroups.sort((a, b) => a.baseline - b.baseline);

        let currentTotalBalance = baselineGroups.length > 0 ? baselineGroups[0].baseline : 0;

        // Process each baseline group
        baselineGroups.forEach((group, groupIdx) => {
          console.log(`\n  Period ${groupIdx + 1}: Processing baseline $${group.baseline.toFixed(2)} with ${group.deposits.length} deposit(s)`);

          // Calculate period gain from previous total to this baseline
          if (groupIdx > 0 && currentTotalBalance > 0) {
            const periodGain = group.baseline - currentTotalBalance;

            // Get total balance across all investors at start of period
            let totalBalance = 0;
            investorBalances.forEach(bal => totalBalance += bal);

            // Allocate period gain/loss proportionally based on current balances
            if (totalBalance > 0) {
              console.log(`    Period gain/loss: $${currentTotalBalance.toFixed(2)} → $${group.baseline.toFixed(2)} (${periodGain >= 0 ? '+' : ''}$${periodGain.toFixed(2)})`);

              investorBalances.forEach((balance, investor) => {
                if (balance > 0) {
                  const share = balance / totalBalance;
                  const allocatedGain = periodGain * share;
                  const newBalance = balance + allocatedGain;
                  investorBalances.set(investor, newBalance);

                  console.log(`      ${investor}: $${balance.toFixed(2)} (${(share * 100).toFixed(2)}%) → $${newBalance.toFixed(2)} (${allocatedGain >= 0 ? '+' : ''}$${allocatedGain.toFixed(2)})`);
                }
              });
            }
          }

          // Process all deposits in this baseline group
          let groupTotalDeposits = 0;
          group.deposits.forEach(entry => {
            const depositAmount = parseFloat(entry.amount);
            const depositInvestor = entry.investor || 'Unassigned';

            const currentBalance = investorBalances.get(depositInvestor) || 0;
            investorBalances.set(depositInvestor, currentBalance + depositAmount);
            groupTotalDeposits += depositAmount;

            console.log(`    ${depositInvestor} deposits +$${depositAmount.toFixed(2)} → balance: $${(currentBalance + depositAmount).toFixed(2)}`);
          });

          // Update current total (baseline + all deposits in this group)
          currentTotalBalance = group.baseline + groupTotalDeposits;
          console.log(`    Period total after deposits: $${currentTotalBalance.toFixed(2)}`);
        });

        // Final period: from last baseline group to current balance
        const finalPeriodGain = totalCurrentBalance - currentTotalBalance;
        if (finalPeriodGain !== 0) {
          let totalBalance = 0;
          investorBalances.forEach(bal => totalBalance += bal);

          console.log(`\n  Final Period: Total balance $${currentTotalBalance.toFixed(2)} → $${totalCurrentBalance.toFixed(2)} (${finalPeriodGain >= 0 ? '+' : ''}$${finalPeriodGain.toFixed(2)})`);

          investorBalances.forEach((balance, investor) => {
            if (balance > 0) {
              const share = balance / totalBalance;
              const allocatedGain = finalPeriodGain * share;
              const newBalance = balance + allocatedGain;
              investorBalances.set(investor, newBalance);

              console.log(`    ${investor}: $${balance.toFixed(2)} (${(share * 100).toFixed(2)}%) → $${newBalance.toFixed(2)} (${allocatedGain >= 0 ? '+' : ''}$${allocatedGain.toFixed(2)})`);
            }
          });
        }

        // Calculate P&L for each investor (final balance - total invested)
        investorBalances.forEach((finalBalance, investor) => {
          // Get total capital invested by this investor
          const capitalInvested = ledgerEntries
            .filter(e => (e.investor || 'Unassigned') === investor)
            .reduce((sum, e) => {
              const amt = parseFloat(e.amount);
              if (e.type === 'deposit' || e.type === 'manual_add') return sum + amt;
              if (e.type === 'withdrawal' || e.type === 'manual_subtract') return sum - amt;
              return sum;
            }, 0);

          const pnl = finalBalance - capitalInvested;
          investorPnLMap.set(investor, pnl);
          console.log(`\n✅ ${investor}: Invested $${capitalInvested.toFixed(2)} → Balance $${finalBalance.toFixed(2)} → P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
        });
      }

      // Calculate returns for each investor
      const investorReturns = investors.map(investor => {
        const investorEntries = ledgerEntries.filter(entry =>
          (entry.investor || 'Unassigned') === investor
        );

        // Calculate total capital
        const capital = investorEntries.reduce((sum, entry) => {
          const amount = parseFloat(entry.amount);
          if (entry.type === 'deposit' || entry.type === 'manual_add') {
            return sum + amount;
          } else if (entry.type === 'withdrawal' || entry.type === 'manual_subtract') {
            return sum - amount;
          }
          return sum;
        }, 0);

        let pnl = 0;
        let currentBalance = capital;

        if (hasBaselineData) {
          // Use time-weighted P&L
          pnl = investorPnLMap.get(investor) || 0;
          currentBalance = capital + pnl;
          console.log(`✅ ${investor}: capital=$${capital.toFixed(2)}, P&L=$${pnl.toFixed(2)}, balance=$${currentBalance.toFixed(2)}`);
        } else {
          // Legacy proportional allocation (no baseline data)
          const totalCapital = ledgerEntries.reduce((sum, entry) => {
            const amount = parseFloat(entry.amount);
            if (entry.type === 'deposit' || entry.type === 'manual_add') {
              return sum + amount;
            } else if (entry.type === 'withdrawal' || entry.type === 'manual_subtract') {
              return sum - amount;
            }
            return sum;
          }, 0);

          const capitalShare = totalCapital > 0 ? capital / totalCapital : 0;
          currentBalance = totalCurrentBalance * capitalShare;
          pnl = currentBalance - capital;
          console.log(`⚠️ ${investor} using legacy proportional (no baseline data)`);
        }

        const roi = capital > 0 ? (pnl / capital) * 100 : 0;

        return {
          investor,
          capital,
          currentBalance,
          pnl,
          roi,
          entryCount: investorEntries.length,
        };
      });

      // Calculate total capital across all investors
      const totalCapital = investorReturns.reduce((sum, inv) => sum + inv.capital, 0);

      // Format and sort results
      const returns = investorReturns
        .map(inv => ({
          investor: inv.investor,
          capital: inv.capital.toFixed(2),
          currentBalance: inv.currentBalance.toFixed(2),
          pnl: inv.pnl.toFixed(2),
          roiPercent: inv.roi.toFixed(2),
          capitalShare: totalCapital > 0 ? ((inv.capital / totalCapital) * 100).toFixed(2) : '0.00',
          entryCount: inv.entryCount,
        }))
        .sort((a, b) => parseFloat(b.capital) - parseFloat(a.capital));

      res.json({
        investors: returns,
        totalCapital: totalCapital.toFixed(2),
        totalCurrentBalance: totalCurrentBalance.toFixed(2),
        totalPnl: (totalCurrentBalance - totalCapital).toFixed(2),
      });
    } catch (error) {
      console.error('Error calculating investor returns:', error);
      res.status(500).json({ error: 'Failed to calculate investor returns' });
    }
  });

  // Get comprehensive investor report with period-by-period breakdown
  app.get('/api/account/investor-report', async (req, res) => {
    try {
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      if (strategies.length === 0) {
        return res.status(404).json({ error: 'No strategy found' });
      }

      const strategy = strategies[0];

      // Get actual account balance from WebSocket cache (prevents rate limiting)
      const snapshot = liveDataOrchestrator.getSnapshot(strategy.id);
      if (!snapshot || !snapshot.account || !snapshot.account.totalWalletBalance) {
        return res.status(503).json({
          error: 'Account data not yet available via WebSocket. Please wait a moment...',
          retryAfter: 5
        });
      }

      const totalCurrentBalance = parseFloat(snapshot.account.totalWalletBalance);

      // Get all ledger entries
      const ledgerEntries = await db
        .select()
        .from(accountLedger)
        .where(eq(accountLedger.userId, 'personal_user'))
        .orderBy(asc(accountLedger.timestamp));

      if (ledgerEntries.length === 0) {
        return res.json({
          reportDate: new Date().toISOString(),
          fundBalance: totalCurrentBalance,
          totalCapital: 0,
          overallPnl: 0,
          overallRoi: 0,
          investors: [],
          periods: [],
          deposits: [],
        });
      }

      // Get unique investors
      const investors = Array.from(new Set(ledgerEntries.map(e => e.investor || 'Unassigned')));

      // Check if we have baseline data
      const hasBaselineData = ledgerEntries.some(e => e.baselineBalance !== null);

      if (!hasBaselineData) {
        return res.status(400).json({ error: 'No baseline data available for period-by-period report' });
      }

      // Track investor balances (compounding)
      const investorBalances = new Map<string, number>();
      investors.forEach(inv => investorBalances.set(inv, 0));

      const baselineEntries = ledgerEntries.filter(e => e.baselineBalance !== null);

      // Store period data
      const periods: any[] = [];
      const depositTimeline: any[] = [];

      // Group deposits by their baseline value (unique baseline = new period boundary)
      const baselineGroups: Array<{baseline: number, deposits: any[]}> = [];
      baselineEntries.forEach(entry => {
        const baseline = parseFloat(entry.baselineBalance || '0');
        let group = baselineGroups.find(g => Math.abs(g.baseline - baseline) < 0.01);
        if (!group) {
          group = { baseline, deposits: [] };
          baselineGroups.push(group);
        }
        group.deposits.push(entry);
      });

      // Sort groups by baseline value
      baselineGroups.sort((a, b) => a.baseline - b.baseline);

      let currentTotalBalance = 0;

      // Process each baseline group
      baselineGroups.forEach((group, groupIdx) => {
        // If this isn't the first group, calculate period gain from previous total to this baseline
        if (groupIdx > 0 && currentTotalBalance > 0) {
          const periodGain = group.baseline - currentTotalBalance;

          if (periodGain !== 0) {
            // Get ownership percentages before this period
            const ownershipBefore: any = {};
            const allocations: any = {};
            let totalBalance = 0;
            investorBalances.forEach(bal => totalBalance += bal);

            // Allocate period gain/loss proportionally
            investorBalances.forEach((balance, investor) => {
              if (balance > 0) {
                const share = balance / totalBalance;
                ownershipBefore[investor] = share * 100;
                const allocatedGain = periodGain * share;
                investorBalances.set(investor, balance + allocatedGain);
                allocations[investor] = allocatedGain;
              }
            });

            periods.push({
              periodNumber: periods.length + 1,
              startBalance: currentTotalBalance,
              endBalance: group.baseline,
              gainLoss: periodGain,
              roiPercent: currentTotalBalance > 0 ? (periodGain / currentTotalBalance) * 100 : 0,
              ownership: ownershipBefore,
              allocations,
            });
          }
        }

        // Process all deposits in this group
        let groupTotalDeposits = 0;
        group.deposits.forEach(entry => {
          const depositAmount = parseFloat(entry.amount);
          const depositInvestor = entry.investor || 'Unassigned';
          groupTotalDeposits += depositAmount;

          // Record deposit in timeline
          depositTimeline.push({
            date: entry.timestamp,
            investor: depositInvestor,
            amount: depositAmount,
            balanceBefore: group.baseline,
            balanceAfter: group.baseline + groupTotalDeposits,
          });

          // Add deposit to investor's balance
          const currentBalance = investorBalances.get(depositInvestor) || 0;
          investorBalances.set(depositInvestor, currentBalance + depositAmount);
        });

        // Update current total balance (baseline + all deposits in this group)
        currentTotalBalance = group.baseline + groupTotalDeposits;
      });

      // Final period: from last baseline group to current balance
      const finalPeriodGain = totalCurrentBalance - currentTotalBalance;
      if (finalPeriodGain !== 0) {
        let totalBalance = 0;
        investorBalances.forEach(bal => totalBalance += bal);

        const ownershipCurrent: any = {};
        const finalAllocations: any = {};

        investorBalances.forEach((balance, investor) => {
          if (balance > 0) {
            const share = balance / totalBalance;
            ownershipCurrent[investor] = (share * 100);
            const allocatedGain = finalPeriodGain * share;
            investorBalances.set(investor, balance + allocatedGain);
            finalAllocations[investor] = allocatedGain;
          }
        });

        periods.push({
          periodNumber: periods.length + 1,
          startBalance: currentTotalBalance,
          endBalance: totalCurrentBalance,
          gainLoss: finalPeriodGain,
          roiPercent: currentTotalBalance > 0 ? (finalPeriodGain / currentTotalBalance) * 100 : 0,
          ownership: ownershipCurrent,
          allocations: finalAllocations,
        });
      }

      // Calculate final investor positions
      const investorPositions: any[] = [];
      investorBalances.forEach((finalBalance, investor) => {
        const capitalInvested = ledgerEntries
          .filter(e => (e.investor || 'Unassigned') === investor)
          .reduce((sum, e) => {
            const amt = parseFloat(e.amount);
            if (e.type === 'deposit' || e.type === 'manual_add') return sum + amt;
            if (e.type === 'withdrawal' || e.type === 'manual_subtract') return sum - amt;
            return sum;
          }, 0);

        const pnl = finalBalance - capitalInvested;
        const roiPercent = capitalInvested > 0 ? (pnl / capitalInvested) * 100 : 0;

        // Current ownership %
        const currentOwnership = totalCurrentBalance > 0 ? (finalBalance / totalCurrentBalance) * 100 : 0;

        investorPositions.push({
          investor,
          capitalInvested,
          currentBalance: finalBalance,
          pnl,
          roiPercent,
          currentOwnership,
        });
      });

      // Sort by capital invested (descending)
      investorPositions.sort((a, b) => b.capitalInvested - a.capitalInvested);

      const totalCapital = investorPositions.reduce((sum, inv) => sum + inv.capitalInvested, 0);
      const totalPnl = totalCurrentBalance - totalCapital;
      const overallRoi = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;

      res.json({
        reportDate: new Date().toISOString(),
        fundBalance: totalCurrentBalance,
        totalCapital,
        overallPnl: totalPnl,
        overallRoi,
        investors: investorPositions,
        periods,
        deposits: depositTimeline,
        methodology: 'Compounding Period-Based Allocation',
      });
    } catch (error: any) {
      console.error('Error generating investor report:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({
        error: 'Failed to generate investor report',
        details: error.message
      });
    }
  });

  // Archive current investor report (manual trigger or cron)
  app.post('/api/account/investor-report/archive', async (req, res) => {
    try {
      // Get current report data
      const strategies = await storage.getStrategiesByUser(DEFAULT_USER_ID);
      if (strategies.length === 0) {
        return res.status(404).json({ error: 'No strategy found' });
      }

      const strategy = strategies[0];
      const snapshot = liveDataOrchestrator.getSnapshot(strategy.id);
      if (!snapshot || !snapshot.account || !snapshot.account.totalWalletBalance) {
        return res.status(503).json({
          error: 'Account data not yet available via WebSocket',
        });
      }

      // Generate report (reuse logic from main endpoint - this could be refactored into a function)
      const reportResponse = await fetch(`http://localhost:${process.env.PORT || 5000}/api/account/investor-report`);
      if (!reportResponse.ok) {
        throw new Error('Failed to fetch report data');
      }
      const reportData = await reportResponse.json();

      // Create midnight UTC timestamp for today
      const reportDate = new Date();
      reportDate.setUTCHours(0, 0, 0, 0);

      // Check if we already have an archive for today
      const existing = await db.select().from(investorReportArchive)
        .where(and(
          eq(investorReportArchive.userId, DEFAULT_USER_ID),
          eq(investorReportArchive.reportDate, reportDate)
        ))
        .limit(1);

      if (existing.length > 0) {
        // Update existing
        await db.update(investorReportArchive)
          .set({
            reportData: reportData,
          })
          .where(eq(investorReportArchive.id, existing[0].id));

        console.log(`✅ Updated investor report archive for ${reportDate.toISOString()}`);
      } else {
        // Insert new
        await db.insert(investorReportArchive).values({
          userId: DEFAULT_USER_ID,
          reportDate: reportDate,
          reportData: reportData,
        });

        console.log(`✅ Created investor report archive for ${reportDate.toISOString()}`);
      }

      res.json({ success: true, reportDate: reportDate.toISOString() });
    } catch (error: any) {
      console.error('Error archiving investor report:', error);
      res.status(500).json({
        error: 'Failed to archive report',
        details: error.message
      });
    }
  });

  // Get list of archived report dates
  app.get('/api/account/investor-report/archived', async (req, res) => {
    try {
      const archives = await db.select({
        reportDate: investorReportArchive.reportDate,
      })
      .from(investorReportArchive)
      .where(eq(investorReportArchive.userId, DEFAULT_USER_ID))
      .orderBy(desc(investorReportArchive.reportDate));

      const dates = archives.map(a => a.reportDate.toISOString());
      res.json({ dates });
    } catch (error: any) {
      console.error('Error fetching archived report dates:', error);
      res.status(500).json({
        error: 'Failed to fetch archived reports',
        details: error.message
      });
    }
  });

  // Get specific archived report by date
  app.get('/api/account/investor-report/archived/:date', async (req, res) => {
    try {
      const { date } = req.params;
      const requestedDate = new Date(date);
      requestedDate.setUTCHours(0, 0, 0, 0);

      const archive = await db.select()
        .from(investorReportArchive)
        .where(and(
          eq(investorReportArchive.userId, DEFAULT_USER_ID),
          eq(investorReportArchive.reportDate, requestedDate)
        ))
        .limit(1);

      if (archive.length === 0) {
        return res.status(404).json({ error: 'No archived report found for this date' });
      }

      res.json(archive[0].reportData);
    } catch (error: any) {
      console.error('Error fetching archived report:', error);
      res.status(500).json({
        error: 'Failed to fetch archived report',
        details: error.message
      });
    }
  });

  // Get individual ledger entries with time-weighted ROI per entry
  app.get('/api/account/ledger/entries-returns', async (req, res) => {
    try {
      // Get all ledger entries sorted by timestamp
      const ledgerEntries = await db.select().from(accountLedger)
        .where(eq(accountLedger.userId, DEFAULT_USER_ID))
        .orderBy(accountLedger.timestamp);

      // Get current account balance
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(500).json({ error: 'API keys not configured' });
      }

      const timestamp = Date.now();
      const params = new URLSearchParams({ timestamp: timestamp.toString() });
      const signature = crypto.createHmac('sha256', secretKey).update(params.toString()).digest('hex');
      params.append('signature', signature);

      const response = await fetch(`https://fapi.asterdex.com/fapi/v2/account?${params}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      });

      if (!response.ok) {
        return res.status(500).json({ error: 'Failed to fetch account balance' });
      }

      const accountData = await response.json();
      const totalCurrentBalance = parseFloat(accountData.totalWalletBalance || '0') + parseFloat(accountData.totalUnrealizedProfit || '0');

      // Check if we have baseline data
      const hasBaselineData = ledgerEntries.some(e => e.baselineBalance !== null);

      if (!hasBaselineData) {
        return res.status(400).json({ error: 'No baseline data available. Please add new deposits to enable time-weighted tracking.' });
      }

      console.log('📊 Calculating individual entry returns with time-weighted ROI...');

      // Calculate gains for each period between deposits
      const baselineEntries = ledgerEntries.filter(e => e.baselineBalance !== null);

      // Build period gains - track LEDGER entry indices, not baseline entry indices
      const periodGains: { startBalance: number; endBalance: number; gain: number; ledgerEntryIdx: number }[] = [];

      let previousBalance = 0;
      baselineEntries.forEach((entry, idx) => {
        const baselineBeforeDeposit = parseFloat(entry.baselineBalance || '0');
        const depositAmount = parseFloat(entry.amount);

        const periodGain = baselineBeforeDeposit - previousBalance;

        // Find this entry's index in the full ledgerEntries array
        const ledgerEntryIdx = ledgerEntries.findIndex(e => e.id === entry.id);

        periodGains.push({
          startBalance: previousBalance,
          endBalance: baselineBeforeDeposit,
          gain: periodGain,
          ledgerEntryIdx: ledgerEntryIdx
        });

        previousBalance = baselineBeforeDeposit + depositAmount;
      });

      // Final period to current
      const finalGain = totalCurrentBalance - previousBalance;
      periodGains.push({
        startBalance: previousBalance,
        endBalance: totalCurrentBalance,
        gain: finalGain,
        ledgerEntryIdx: ledgerEntries.length // Final period is after all entries
      });

      // Find the most recent deposit (last baseline entry) - it should NOT participate in final period
      const lastBaselineEntryIdx = baselineEntries.length > 0
        ? ledgerEntries.findIndex(e => e.id === baselineEntries[baselineEntries.length - 1].id)
        : -1;
      const finalPeriodIdx = periodGains.length - 1;

      // Calculate P&L for each individual entry
      const entryReturns = ledgerEntries.map((entry, entryIdx) => {
        const amount = parseFloat(entry.amount);
        const baseline = parseFloat(entry.baselineBalance || '0');

        // This entry's P&L comes from all periods AFTER it was deposited
        let entryPnL = 0;

        periodGains.forEach((period, periodIdx) => {
          // Only count gains from periods AFTER this entry
          // Period ends when the entry at ledgerEntryIdx is deposited
          // So this entry earns from periods where period.ledgerEntryIdx > entryIdx
          if (period.ledgerEntryIdx > entryIdx) {
            // Get total capital in the period (from all entries BEFORE this period's deposit)
            let capitalInPeriod = 0;

            // For final period, include ALL current capital
            if (periodIdx === finalPeriodIdx) {
              ledgerEntries.forEach((e) => {
                const amt = parseFloat(e.amount);
                if (e.type === 'deposit' || e.type === 'manual_add') {
                  capitalInPeriod += amt;
                } else if (e.type === 'withdrawal' || e.type === 'manual_subtract') {
                  capitalInPeriod -= amt;
                }
              });
            } else {
              // For non-final periods, only count capital that existed before the period's ending deposit
              ledgerEntries.forEach((e, eIdx) => {
                if (eIdx < period.ledgerEntryIdx) {
                  const amt = parseFloat(e.amount);
                  if (e.type === 'deposit' || e.type === 'manual_add') {
                    capitalInPeriod += amt;
                  } else if (e.type === 'withdrawal' || e.type === 'manual_subtract') {
                    capitalInPeriod -= amt;
                  }
                }
              });
            }

            // This entry's share of the period gain
            if (capitalInPeriod > 0 && period.gain !== 0) {
              const share = amount / capitalInPeriod;
              entryPnL += period.gain * share;
            }
          }
        });

        const currentBalance = amount + entryPnL;
        const roi = amount > 0 ? (entryPnL / amount) * 100 : 0;

        return {
          id: entry.id,
          investor: entry.investor || 'Unassigned',
          timestamp: entry.timestamp,
          type: entry.type,
          amount: amount.toFixed(2),
          baseline: baseline.toFixed(2),
          pnl: entryPnL.toFixed(2),
          currentBalance: currentBalance.toFixed(2),
          roiPercent: roi.toFixed(2),
          reason: entry.reason || '',
          notes: entry.notes || ''
        };
      });

      // Calculate totals
      const totalCapital = ledgerEntries.reduce((sum, entry) => {
        const amount = parseFloat(entry.amount);
        if (entry.type === 'deposit' || entry.type === 'manual_add') {
          return sum + amount;
        } else if (entry.type === 'withdrawal' || entry.type === 'manual_subtract') {
          return sum - amount;
        }
        return sum;
      }, 0);

      res.json({
        entries: entryReturns,
        totalCapital: totalCapital.toFixed(2),
        totalCurrentBalance: totalCurrentBalance.toFixed(2),
        totalPnl: (totalCurrentBalance - totalCapital).toFixed(2),
      });
    } catch (error) {
      console.error('Error calculating entry returns:', error);
      res.status(500).json({ error: 'Failed to calculate entry returns' });
    }
  });

  // Sync P&L from exchange for all closed positions
  app.post("/api/positions/sync-pnl-from-exchange", async (req, res) => {
    try {
      console.log('📥 Fetching realized P&L from Aster DEX exchange...');
      
      // Fetch ALL realized P&L from exchange (all-time)
      const apiKey = process.env.ASTER_API_KEY;
      const apiSecret = process.env.ASTER_SECRET_KEY; // Correct env var name
      
      if (!apiKey || !apiSecret) {
        return res.status(500).json({ error: 'Missing API credentials' });
      }
      
      const timestamp = Date.now();
      const params = new URLSearchParams({
        incomeType: 'REALIZED_PNL', // CRITICAL: Must filter by REALIZED_PNL only
        startTime: '0', // Fetch all-time data
        limit: '1000', // Max per request
        timestamp: timestamp.toString(),
      });
      
      const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(params.toString())
        .digest('hex');
      params.append('signature', signature);
      
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/income?${params}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return res.status(500).json({ error: `Exchange API error: ${errorText}` });
      }
      
      const exchangeIncome: any[] = await response.json();
      console.log(`📊 Fetched ${exchangeIncome.length} realized P&L records from exchange`);
      
      // Get all closed positions
      const allSessions = await storage.getAllTradeSessions(DEFAULT_USER_ID);
      let updatedCount = 0;
      let matchedCount = 0;
      
      for (const session of allSessions) {
        const closedPositions = await storage.getClosedPositions(session.id);
        
        for (const position of closedPositions) {
          // Find matching exchange income record (by symbol and approximate timestamp)
          const positionCloseTime = new Date(position.closedAt!).getTime();
          const matchWindow = 60000; // 60 second window
          
          const matchingIncome = exchangeIncome.find((inc: any) => {
            const incomeTime = inc.time;
            const incomeSymbol = inc.symbol;
            const timeDiff = Math.abs(incomeTime - positionCloseTime);
            
            return incomeSymbol === position.symbol && timeDiff < matchWindow;
          });
          
          if (matchingIncome) {
            matchedCount++;
            const exchangePnl = parseFloat(matchingIncome.income);
            const currentPnl = parseFloat(position.realizedPnl || '0');
            
            // Calculate percentage for display
            const avgEntryPrice = parseFloat(position.avgEntryPrice);
            const totalQuantity = parseFloat(position.totalQuantity);
            const positionSize = avgEntryPrice * totalQuantity;
            const pnlPercent = (exchangePnl / positionSize) * 100;
            
            // Skip if percentage is invalid (Infinity/NaN from zero position size)
            if (!isFinite(pnlPercent)) {
              console.log(`⚠️  Skipping ${position.symbol} ${position.side}: Invalid P&L% (position size: $${positionSize.toFixed(2)})`);
              continue;
            }
            
            if (Math.abs(exchangePnl - currentPnl) > 0.001) {
              console.log(`🔄 Syncing ${position.symbol} ${position.side}: $${currentPnl.toFixed(2)} → $${exchangePnl.toFixed(2)} (${pnlPercent.toFixed(2)}%) from exchange`);
              await storage.closePosition(position.id, new Date(position.closedAt!), exchangePnl, pnlPercent);
              updatedCount++;
            }
          }
        }
      }
      
      console.log(`✅ Synced ${updatedCount} positions from exchange (${matchedCount} matched)`);
      res.json({ 
        success: true, 
        totalExchangeRecords: exchangeIncome.length,
        matchedPositions: matchedCount,
        updatedPositions: updatedCount 
      });
    } catch (error) {
      console.error('Error syncing P&L from exchange:', error);
      res.status(500).json({ error: 'Failed to sync P&L from exchange' });
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

      // Get OFFICIAL realized P&L directly from exchange income API (all-time)
      // MUST happen BEFORE session check so we get accurate P&L even without active session
      console.log('📊 Fetching realized P&L from exchange (all-time)...');
      // Calculate ACTUAL realized P&L from wallet balance minus deposits
      // This accounts for ALL fees including insurance fund, liquidation fees, etc.
      let totalRealizedPnl = 0;
      let currentWalletBalance = 0;
      let totalDeposits = 0;

      try {
        // Get current wallet balance from WebSocket snapshot (more reliable than API call)
        const wsSnapshot = liveDataOrchestrator.getSnapshot(activeStrategy.id);
        if (wsSnapshot?.account?.totalWalletBalance) {
          currentWalletBalance = parseFloat(wsSnapshot.account.totalWalletBalance);
          console.log(`💰 Current wallet balance (WebSocket): $${currentWalletBalance.toFixed(2)}`);
        } else {
          // Fallback to API call if WebSocket data not available
          const apiKey = process.env.ASTER_API_KEY;
          const secretKey = process.env.ASTER_SECRET_KEY;

          if (apiKey && secretKey) {
            const timestamp = Date.now();
            const params = `timestamp=${timestamp}`;
            const signature = crypto.createHmac('sha256', secretKey).update(params).digest('hex');

            const response = await fetch(
              `https://fapi.asterdex.com/fapi/v2/account?${params}&signature=${signature}`,
              { headers: { 'X-MBX-APIKEY': apiKey } }
            );

            if (response.ok) {
              const accountData = await response.json();
              currentWalletBalance = parseFloat(accountData.totalWalletBalance || '0');
              console.log(`💰 Current wallet balance (API fallback): $${currentWalletBalance.toFixed(2)}`);
            }
          }
        }

        // Get total deposits from account ledger
        const ledger = await db.select().from(accountLedger).where(eq(accountLedger.userId, DEFAULT_USER_ID));
        if (ledger && ledger.length > 0) {
          totalDeposits = ledger.reduce((sum: number, entry: any) => {
            if (entry.type === 'deposit' || entry.type === 'manual_add') {
              return sum + parseFloat(entry.amount || '0');
            } else if (entry.type === 'withdrawal') {
              return sum - parseFloat(entry.amount || '0');
            }
            return sum;
          }, 0);
          console.log(`📥 Total deposits from ledger: $${totalDeposits.toFixed(2)}`);
        }

        // Actual realized P&L = current wallet - deposits (includes ALL fees)
        totalRealizedPnl = currentWalletBalance - totalDeposits;
        console.log(`✅ ACTUAL realized P&L (wallet - deposits): $${totalRealizedPnl.toFixed(2)}`);
      } catch (error) {
        console.error('❌ Error calculating actual P&L from wallet:', error);
      }

      // Get the active session for this strategy
      const activeSession = await storage.getActiveTradeSession(activeStrategy.id);

      // If no active session, return with real exchange P&L (not zeros!)
      if (!activeSession) {
        const responseData = {
          totalTrades: 0, // No positions in database without session
          openTrades: 0,
          closedTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          totalRealizedPnl,
          totalUnrealizedPnl: 0,
          totalPnl: totalRealizedPnl,
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
          maxDrawdownPercent: 0,
        };
        console.log("📊 Performance Overview (no session):", JSON.stringify(responseData));
        return res.json(responseData);
      }

      // Get ALL sessions for this strategy (includes archived for accurate cumulative PNL)
      const allSessions = await storage.getSessionsByStrategy(activeStrategy.id);

      // Get positions from ALL sessions (active + archived)
      const allPositions: any[] = [];
      const allSessionFills: any[] = [];

      for (const session of allSessions) {
        const sessionPositions = await storage.getPositionsBySession(session.id);
        const sessionFills = await storage.getFillsBySession(session.id);
        allPositions.push(...sessionPositions);
        allSessionFills.push(...sessionFills);
      }

      // Get LIVE positions from exchange to calculate unrealized P&L
      let livePositions: any[] = [];
      try {
        const apiKey = process.env.ASTER_API_KEY;
        const secretKey = process.env.ASTER_SECRET_KEY;
        
        if (!apiKey || !secretKey) {
          console.error('❌ API keys not configured for live positions');
        } else {
          // Create signed request
          const timestamp = Date.now();
          const params = `timestamp=${timestamp}`;
          const signature = crypto
            .createHmac('sha256', secretKey)
            .update(params)
            .digest('hex');

          const response = await fetch(
            `https://fapi.asterdex.com/fapi/v2/positionRisk?${params}&signature=${signature}`,
            {
              headers: { 'X-MBX-APIKEY': apiKey },
            }
          );
          
          if (response.ok) {
            const allPositions = await response.json();
            // Filter for non-zero positions only
            livePositions = allPositions.filter((p: any) => parseFloat(p.positionAmt) !== 0);
            console.log(`📊 Found ${livePositions.length} live open positions on exchange`);
          } else {
            const errorText = await response.text();
            console.error(`❌ Failed to fetch live positions: ${response.status} ${errorText}`);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching live positions from exchange:', error);
      }

      if (!allPositions || allPositions.length === 0) {
        return res.json({
          totalTrades: 0, // No positions in database
          openTrades: 0,
          closedTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          totalRealizedPnl,
          totalUnrealizedPnl: 0,
          totalPnl: totalRealizedPnl,
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
          maxDrawdownPercent: 0,
        });
      }

      // Calculate metrics
      const openPositions = allPositions.filter(p => p.isOpen === true);
      let closedPositions = allPositions.filter(p => p.isOpen === false);

      // For win/loss statistics, still use position-level P&L
      const closedPnlDollars = closedPositions.map(p => {
        return parseFloat(p.realizedPnl || '0');
      });
      
      const winningTrades = closedPnlDollars.filter(pnl => pnl > 0);
      const losingTrades = closedPnlDollars.filter(pnl => pnl < 0);
      
      // Calculate unrealized P&L from LIVE exchange positions (not database positions)
      // Use the official unRealizedProfit field from exchange API (note: capital R and P)
      const totalUnrealizedPnl = livePositions.reduce((sum, p) => {
        const unrealizedProfit = parseFloat(p.unRealizedProfit || '0');
        console.log(`  📊 ${p.symbol} ${p.positionSide}: unrealized P&L = $${unrealizedProfit.toFixed(2)}`);
        return sum + unrealizedProfit;
      }, 0);
      console.log(`📊 Total unrealized P&L from ${livePositions.length} live positions: $${totalUnrealizedPnl.toFixed(2)}`);
      
      // Get total commission fees from exchange API (all historical data)
      let totalFees = 0;
      try {
        const { getTotalCommissions } = await import('./exchange-sync');
        const commissionsResult = await getTotalCommissions();
        if (commissionsResult.success) {
          totalFees = commissionsResult.total;
        }
      } catch (error) {
        console.error('❌ Error fetching commission fees:', error);
      }

      // Get total funding costs from exchange API
      let totalFundingCost = 0;
      try {
        const { getTotalFundingFees } = await import('./exchange-sync');
        const fundingResult = await getTotalFundingFees();
        if (fundingResult.success) {
          totalFundingCost = fundingResult.total;
        }
      } catch (error) {
        console.error('❌ Error fetching funding fees:', error);
      }
      
      // CRITICAL: Total P&L = Realized P&L + Unrealized P&L - Commission Fees - Funding Costs
      const totalPnl = totalRealizedPnl + totalUnrealizedPnl - totalFees - totalFundingCost;
      console.log(`💰 P&L Breakdown: Realized=$${totalRealizedPnl.toFixed(2)}, Unrealized=$${totalUnrealizedPnl.toFixed(2)}, Fees=$${totalFees.toFixed(2)}, Funding=$${totalFundingCost.toFixed(2)}, Total=$${totalPnl.toFixed(2)}`);
      
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

      // Calculate average trade time from closed positions (in milliseconds)
      const tradeTimesMs = closedPositions
        .filter(p => p.openedAt && p.closedAt)
        .map(p => new Date(p.closedAt!).getTime() - new Date(p.openedAt!).getTime());
      
      const averageTradeTimeMs = tradeTimesMs.length > 0
        ? tradeTimesMs.reduce((sum, time) => sum + time, 0) / tradeTimesMs.length
        : 0;

      // Use deposits from account ledger for base capital calculation
      // (totalDeposits already calculated above from account ledger)
      const baseCapital = totalDeposits > 0 ? totalDeposits : parseFloat(activeSession.startingBalance);
      const totalPnlPercent = baseCapital > 0 ? (totalPnl / baseCapital) * 100 : 0;

      // Filter out positions with obviously corrupt realizedPnl data
      // With isolated margin + max 10% position size + 5x leverage + 20% max SL = max 10% loss per position
      // Being conservative, allow up to 20% of account balance as max reasonable single position P&L
      const maxReasonablePnl = baseCapital * 0.20; // Max 20% of account on any single position
      const originalClosedCount = closedPositions.length;
      closedPositions = closedPositions.filter(p => {
        const pnl = Math.abs(parseFloat(p.realizedPnl || '0'));
        return pnl <= maxReasonablePnl;
      });

      if (closedPositions.length < originalClosedCount) {
        console.log(`⚠️ Filtered out ${originalClosedCount - closedPositions.length} positions with corrupt P&L data (>${baseCapital.toFixed(2)})`);
      }

      // Recalculate win/loss statistics after filtering
      const filteredPnlDollars = closedPositions.map(p => parseFloat(p.realizedPnl || '0'));
      const filteredWinningTrades = filteredPnlDollars.filter(pnl => pnl > 0);
      const filteredLosingTrades = filteredPnlDollars.filter(pnl => pnl < 0);
      const filteredBestTrade = filteredPnlDollars.length > 0 ? Math.max(...filteredPnlDollars) : 0;
      const filteredWorstTrade = filteredPnlDollars.length > 0 ? Math.min(...filteredPnlDollars) : 0;

      // Calculate maximum drawdown based on total account balance (deposits + cumulative P&L)
      // Max drawdown = (Peak Balance - Trough Balance) / Peak Balance
      let maxDrawdown = 0;
      let maxDrawdownPercent = 0;

      if (closedPositions.length > 0) {
        let peakBalance = baseCapital; // Start with initial deposits as peak
        let cumulativePnl = 0;

        for (const p of closedPositions) {
          // CRITICAL: realizedPnl is ALREADY in DOLLARS (not percentage!)
          const pnlDollar = parseFloat(p.realizedPnl || '0');
          cumulativePnl += pnlDollar;

          // Current total balance = deposits + cumulative P&L
          const currentBalance = baseCapital + cumulativePnl;

          // Update peak balance if we reached a new high
          if (currentBalance > peakBalance) {
            peakBalance = currentBalance;
          }

          // Calculate drawdown from peak balance (in dollars)
          const currentDrawdownDollar = peakBalance - currentBalance;

          // Calculate drawdown percentage: (peak - current) / peak * 100
          const currentDrawdownPercent = peakBalance > 0
            ? (currentDrawdownDollar / peakBalance) * 100
            : 0;

          // Track maximum drawdown (both dollars and percentage)
          if (currentDrawdownDollar > maxDrawdown) {
            maxDrawdown = currentDrawdownDollar;
            maxDrawdownPercent = currentDrawdownPercent;
          }
        }
      }

      res.json({
        totalTrades: closedPositions.length + livePositions.length, // Consolidated: DB positions + currently open positions
        openTrades: livePositions.length, // Use live positions from exchange, not database
        closedTrades: closedPositions.length, // Use consolidated position count (each position = all DCA layers combined)
        winningTrades: filteredWinningTrades.length,
        losingTrades: filteredLosingTrades.length,
        winRate: closedPositions.length > 0 ? (filteredWinningTrades.length / closedPositions.length) * 100 : 0,
        totalRealizedPnl,
        totalUnrealizedPnl,
        totalPnl,
        totalPnlPercent,
        averageWin: filteredWinningTrades.length > 0 ? filteredWinningTrades.reduce((sum, pnl) => sum + pnl, 0) / filteredWinningTrades.length : 0,
        averageLoss: filteredLosingTrades.length > 0 ? filteredLosingTrades.reduce((sum, pnl) => sum + pnl, 0) / filteredLosingTrades.length : 0,
        bestTrade: filteredBestTrade,
        worstTrade: filteredWorstTrade,
        profitFactor: filteredLosingTrades.length > 0
          ? Math.abs(filteredWinningTrades.reduce((sum, pnl) => sum + pnl, 0) / filteredLosingTrades.reduce((sum, pnl) => sum + pnl, 0))
          : filteredWinningTrades.length > 0 ? 999 : 0,
        totalFees,
        fundingCost: totalFundingCost,
        averageTradeTimeMs,
        maxDrawdown,
        maxDrawdownPercent,
      });
    } catch (error) {
      console.error('Error fetching performance overview:', error);
      res.status(500).json({ error: "Failed to fetch performance overview" });
    }
  });

  app.get("/api/performance/chart", async (req, res) => {
    try {
      // Fetch realized P&L events directly from exchange (source of truth)
      const { fetchRealizedPnlEvents, fetchCommissions, fetchFundingFees } = await import('./exchange-sync');
      const startTime = 1760635140000; // From Oct 16, 2025 at 17:19:00 UTC (first deposit - excludes testing period)

      const pnlResult = await fetchRealizedPnlEvents({ startTime });

      if (!pnlResult.success || !pnlResult.events || pnlResult.events.length === 0) {
        return res.json([]);
      }

      // Fetch all closed positions from database to get the actual position side
      // This is needed because P&L direction doesn't indicate position side (a loss can be from LONG or SHORT)
      let allPositions = [];
      try {
        allPositions = await db.select({
          symbol: positions.symbol,
          side: positions.side,
          closedAt: positions.closedAt,
          realizedPnl: positions.realizedPnl,
        })
          .from(positions)
          .where(eq(positions.isOpen, false))
          .orderBy(positions.closedAt);

        console.log(`📊 Loaded ${allPositions.length} closed positions from database for side matching`);
      } catch (error) {
        console.error('❌ Error fetching positions for side matching:', error);
        // Continue without side matching - will fall back to P&L inference
      }

      // Create a map of positions by symbol and timestamp for quick lookup
      // Key: `${symbol}_${closedAtTimestamp}`
      const positionsBySymbolTime = new Map();
      for (const pos of allPositions) {
        if (pos.closedAt) {
          const timestamp = new Date(pos.closedAt).getTime();
          const key = `${pos.symbol}_${timestamp}`;
          positionsBySymbolTime.set(key, pos);
        }
      }

      // Debug: Count positions per symbol
      const symbolCounts = new Map();
      for (const pos of allPositions) {
        symbolCounts.set(pos.symbol, (symbolCounts.get(pos.symbol) || 0) + 1);
      }
      console.log(`📊 Sample position counts: HEMIUSDT=${symbolCounts.get('HEMIUSDT') || 0}, BNBUSDT=${symbolCounts.get('BNBUSDT') || 0}`)

      // Fetch commissions to subtract from P&L (commissions can be matched accurately by tradeId)
      const commissionsResult = await fetchCommissions({ startTime });
      const commissionsByTradeId = new Map();

      if (commissionsResult.success && commissionsResult.records) {
        commissionsResult.records.forEach((comm: any) => {
          const existing = commissionsByTradeId.get(comm.tradeId) || 0;
          commissionsByTradeId.set(comm.tradeId, existing + Math.abs(parseFloat(comm.income || '0')));
        });
      }

      // Fetch funding fees to subtract from cumulative P&L over time
      const fundingFeesResult = await fetchFundingFees({ startTime });
      const fundingFeesByTime: Array<{ time: number; fee: number }> = [];

      if (fundingFeesResult.success && fundingFeesResult.records) {
        fundingFeesResult.records.forEach((fee: any) => {
          fundingFeesByTime.push({
            time: fee.time,
            fee: parseFloat(fee.income || '0'), // Negative = cost, positive = received
          });
        });
        // Sort by time (oldest first)
        fundingFeesByTime.sort((a, b) => a.time - b.time);
      }

      // Sort by timestamp (oldest first)
      const sortedEvents = pnlResult.events.sort((a: any, b: any) => a.time - b.time);

      // GROUP EVENTS INTO POSITIONS
      // Events with same symbol within 10 seconds = same position (multiple DCA layers closing)
      const consolidatedPositions: any[] = [];
      let currentPosition: any = null;

      for (const event of sortedEvents) {
        const pnl = parseFloat(event.income || '0');
        const commission = commissionsByTradeId.get(event.tradeId) || 0;

        // Check if this event belongs to the current position being built
        const shouldMerge = currentPosition &&
          currentPosition.symbol === event.symbol &&
          Math.abs(event.time - currentPosition.timestamp) <= 10000; // Within 10 seconds

        if (shouldMerge) {
          // Merge this layer into the current position
          currentPosition.pnl += pnl;
          currentPosition.commission += commission;
          currentPosition.layerCount += 1;
          // Update timestamp to latest layer
          currentPosition.timestamp = Math.max(currentPosition.timestamp, event.time);
        } else {
          // Start a new position
          if (currentPosition) {
            consolidatedPositions.push(currentPosition);
          }
          currentPosition = {
            symbol: event.symbol,
            timestamp: event.time,
            pnl: pnl,
            commission: commission,
            layerCount: 1,
            tradeId: event.tradeId,
          };
        }
      }

      // Don't forget the last position
      if (currentPosition) {
        consolidatedPositions.push(currentPosition);
      }

      // Build chart data from consolidated positions with NET P&L (after commissions AND funding fees)
      // Funding fees are time-based (every 8 hours), so we calculate cumulative funding fees
      // up to each position's timestamp and include them in the cumulative P&L curve
      let cumulativeNetPnl = 0;
      let cumulativeFundingFees = 0;
      let fundingFeeIndex = 0;

      let matchedCount = 0;
      let unmatchedCount = 0;

      const chartData = consolidatedPositions.map((position, index) => {
        // Calculate net P&L for this position (gross P&L - commissions)
        const netPnlAfterCommissions = position.pnl - position.commission;
        cumulativeNetPnl += netPnlAfterCommissions;

        // Add all funding fees that occurred up to this position's timestamp
        while (fundingFeeIndex < fundingFeesByTime.length && fundingFeesByTime[fundingFeeIndex].time <= position.timestamp) {
          cumulativeFundingFees += fundingFeesByTime[fundingFeeIndex].fee;
          fundingFeeIndex++;
        }

        // Final cumulative P&L includes both commissions and funding fees
        // Funding fees are negative (costs) or positive (received), so we add them directly
        const cumulativePnlAfterAllFees = cumulativeNetPnl + cumulativeFundingFees;

        // Look up actual position side from database instead of inferring from P&L
        // This fixes the issue where stopped out LONG positions (negative P&L) were labeled as SHORT
        const lookupKey = `${position.symbol}_${position.timestamp}`;
        const dbPosition = positionsBySymbolTime.get(lookupKey);

        // If we can't find exact match, try to find by symbol within ±5 minutes (exchange events can be delayed)
        // Exchange P&L event timestamps may not exactly match our database closedAt times
        let actualSide = dbPosition?.side;
        let matchTimeDiff = 0;
        if (!actualSide) {
          let closestMatch = null;
          let closestDiff = Infinity;

          for (const [key, pos] of positionsBySymbolTime) {
            if (pos.symbol === position.symbol) {
              const posTimestamp = new Date(pos.closedAt!).getTime();
              const diff = Math.abs(posTimestamp - position.timestamp);
              // Match within 5 minutes (300,000 ms) - exchange events can be delayed or grouped
              if (diff <= 300000 && diff < closestDiff) {
                closestMatch = pos;
                closestDiff = diff;
              }
            }
          }

          if (closestMatch) {
            actualSide = closestMatch.side;
            matchTimeDiff = closestDiff;
            matchedCount++;
          } else {
            unmatchedCount++;
          }
        } else {
          matchedCount++;
        }

        // Fallback to P&L inference only if we can't find the position in database
        const side = actualSide || (netPnlAfterCommissions >= 0 ? 'long' : 'short');

        return {
          tradeNumber: index + 1,
          timestamp: position.timestamp,
          symbol: position.symbol,
          side: side, // Use actual position side from database, not inferred from P&L
          pnl: netPnlAfterCommissions, // NET P&L after commissions (per-position does not include funding)
          cumulativePnl: cumulativePnlAfterAllFees, // Cumulative NET P&L (after commissions AND funding fees)
          entryPrice: 0, // Not available from P&L events
          quantity: 0, // Not available from P&L events
          commission: position.commission, // Total commissions for all layers
          layersFilled: position.layerCount, // Number of DCA layers in this position
        };
      });

      console.log(`📊 Chart data: ${chartData.length} trades, ${matchedCount} matched with DB, ${unmatchedCount} unmatched (fallback to P&L inference)`);

      // CRITICAL: Scale the chart to match ACTUAL wallet-based P&L
      // The chart calculated from trades shows $1,141 but actual profit is only ~$950
      // This is because insurance fund fees, liquidation penalties, and other hidden fees aren't in the trade data
      // Solution: Calculate scaling factor and adjust entire chart to match reality

      let scaledChartData = chartData;

      if (chartData.length > 0) {
        const chartCalculatedPnl = chartData[chartData.length - 1].cumulativePnl;

        // Get ACTUAL realized P&L from wallet balance
        try {
          const apiKey = process.env.ASTER_API_KEY;
          const secretKey = process.env.ASTER_SECRET_KEY;

          if (apiKey && secretKey) {
            // Fetch current wallet balance
            const timestamp = Date.now();
            const params = `timestamp=${timestamp}`;
            const signature = crypto.createHmac('sha256', secretKey).update(params).digest('hex');

            const response = await fetch(
              `https://fapi.asterdex.com/fapi/v2/account?${params}&signature=${signature}`,
              { headers: { 'X-MBX-APIKEY': apiKey } }
            );

            if (response.ok) {
              const accountData = await response.json();
              const currentWalletBalance = parseFloat(accountData.totalWalletBalance || '0');

              // Get deposits from account ledger
              const ledger = await db.select().from(accountLedger).where(eq(accountLedger.userId, DEFAULT_USER_ID));
              const totalDeposits = ledger.reduce((sum: number, entry: any) => {
                if (entry.type === 'deposit' || entry.type === 'manual_add') {
                  return sum + parseFloat(entry.amount || '0');
                } else if (entry.type === 'withdrawal') {
                  return sum - parseFloat(entry.amount || '0');
                }
                return sum;
              }, 0);

              // Actual realized P&L = wallet - deposits
              const actualRealizedPnl = currentWalletBalance - totalDeposits;

              // Calculate scaling factor
              const scalingFactor = actualRealizedPnl / chartCalculatedPnl;

              console.log(`📊 Chart P&L (from trades): $${chartCalculatedPnl.toFixed(2)}`);
              console.log(`💰 Actual P&L (wallet - deposits): $${actualRealizedPnl.toFixed(2)}`);
              console.log(`📏 Scaling factor: ${scalingFactor.toFixed(4)}`);

              // Scale all cumulative P&L values to match reality
              scaledChartData = chartData.map(point => ({
                ...point,
                cumulativePnl: point.cumulativePnl * scalingFactor,
              }));

              console.log(`✅ Chart scaled to match actual wallet balance`);
            }
          }
        } catch (error) {
          console.error('⚠️ Failed to scale chart, using unscaled data:', error);
        }
      }

      res.json(scaledChartData);
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
        'orderType', 'maxRetryDurationMs', 'marginAmount', 'selectedAssets',
        'maxPortfolioRiskPercent', 'maxOpenPositions'
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

        // Sync cascade detector if selectedAssets changed
        if (changes.selectedAssets) {
          console.log(`🔄 Syncing cascade detector with updated asset selection...`);
          await cascadeDetectorService.syncSymbols();

          // Update VWAP filters and price feed with new symbols
          const updatedStrategy = await storage.getStrategy(strategyId);
          if (updatedStrategy && updatedStrategy.vwapFilterEnabled && updatedStrategy.selectedAssets.length > 0) {
            console.log(`🔄 Updating VWAP filters and price feed with ${updatedStrategy.selectedAssets.length} symbols...`);
            const { vwapFilterManager } = await import('./vwap-direction-filter');
            const { vwapPriceFeed } = await import('./vwap-price-feed');

            // Initialize filters for all symbols (including new ones)
            const vwapConfig = {
              enabled: updatedStrategy.vwapFilterEnabled,
              timeframeMinutes: updatedStrategy.vwapTimeframeMinutes,
              bufferPercentage: parseFloat(updatedStrategy.vwapBufferPercentage),
              enableBuffer: updatedStrategy.vwapEnableBuffer,
            };

            for (const symbol of updatedStrategy.selectedAssets) {
              vwapFilterManager.getFilter(symbol, vwapConfig);
            }

            // Update price feed to track all symbols
            vwapPriceFeed.updateSymbols(updatedStrategy.selectedAssets);

            // Update live data orchestrator kline stream
            liveDataOrchestrator.updateKlineSymbols(updatedStrategy.selectedAssets);

            console.log(`✅ VWAP filters and price feed updated for ${updatedStrategy.selectedAssets.length} symbols`);
          }
        }
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
          
          // Check if any DCA-affecting parameters changed
          // These fields affect calculateDCALevels() or reserved risk calculations
          const dcaAffectingFields = [
            'maxLayers', 'leverage', 'stopLossPercent', 'marginAmount',
            'atrPeriod', // ATR calculation period
            'dcaStartStepPercent', 'dcaSpacingConvexity', 'dcaSizeGrowth', // DCA layer sizing
            'dcaMaxRiskPercent', 'dcaVolatilityRef', 'dcaExitCushionMultiplier', // Risk management
            'adaptiveTpEnabled', 'tpAtrMultiplier', 'minTpPercent', 'maxTpPercent', // Adaptive TP
            'adaptiveSlEnabled', 'slAtrMultiplier', 'minSlPercent', 'maxSlPercent', // Adaptive SL
            'retHighThreshold', 'retMediumThreshold' // Risk/entry thresholds
          ];
          const dcaParamChanged = dcaAffectingFields.some(field => changes[field]);
          
          if (dcaParamChanged) {
            const changedParams = dcaAffectingFields.filter(f => changes[f]).map(f => `${f}: ${changes[f]?.old} → ${changes[f]?.new}`).join(', ');
            console.log(`♻️ DCA parameters changed (${changedParams}), recalculating reserved risk...`);
            
            try {
              const apiKey = process.env.ASTER_API_KEY;
              const secretKey = process.env.ASTER_SECRET_KEY;
              let currentBalance = 1000; // Fallback balance for development
              
              // Try to fetch live balance if API keys available
              if (apiKey && secretKey) {
                try {
                  const timestamp = Date.now();
                  const queryString = `timestamp=${timestamp}`;
                  const crypto = require('crypto');
                  const signature = crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
                  
                  const balanceResponse = await fetch(
                    `https://fapi.asterdex.com/fapi/v2/account?${queryString}&signature=${signature}`,
                    { headers: { 'X-MBX-APIKEY': apiKey } }
                  );
                  
                  if (balanceResponse.ok) {
                    const balanceData = await balanceResponse.json() as { totalWalletBalance: string; totalUnrealizedProfit: string };
                    currentBalance = parseFloat(balanceData.totalWalletBalance || '0') + parseFloat(balanceData.totalUnrealizedProfit || '0');
                    console.log(`💰 Fetched live balance: $${currentBalance.toFixed(2)}`);
                  } else {
                    console.warn('⚠️ Failed to fetch live balance, using fallback: $1000');
                  }
                } catch (balanceError) {
                  console.warn('⚠️ Balance fetch error, using fallback: $1000', balanceError);
                }
              } else {
                console.log('💡 No API keys, using fallback balance: $1000');
              }
              
              // Always recalculate, even without API keys (function has ATR fallback)
              const updatedStrategyForRecalc = await storage.getStrategy(strategyId);
              if (updatedStrategyForRecalc && strategyEngine) {
                const { recalculateReservedRiskForSession } = await import('./dca-calculator');
                await recalculateReservedRiskForSession(
                  activeSession.id,
                  updatedStrategyForRecalc,
                  currentBalance,
                  apiKey || '',
                  secretKey || '',
                  (symbol: string) => strategyEngine.getSymbolPrecision(symbol)?.minNotional
                );
                
                // Broadcast update notification via WebSocket
                wsBroadcaster.broadcast({
                  type: 'reserved_risk_updated',
                  data: {
                    sessionId: activeSession.id,
                    changes: changedParams
                  }
                });
                
                console.log(`✅ Reserved risk recalculation complete`);
              }
            } catch (error) {
              console.error('❌ Failed to recalculate reserved risk:', error);
              // Don't fail the strategy update if recalculation fails
            }
          }
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
        retMediumThreshold: strategy.ret_medium_threshold,
        adaptiveTpEnabled: strategy.adaptive_tp_enabled,
        tpAtrMultiplier: strategy.tp_atr_multiplier,
        minTpPercent: strategy.min_tp_percent,
        maxTpPercent: strategy.max_tp_percent,
        adaptiveSlEnabled: strategy.adaptive_sl_enabled,
        slAtrMultiplier: strategy.sl_atr_multiplier,
        minSlPercent: strategy.min_sl_percent,
        maxSlPercent: strategy.max_sl_percent
      });
    } catch (error) {
      console.error('Error fetching DCA settings:', error);
      res.status(500).json({ error: "Failed to fetch DCA settings" });
    }
  });

  // DCA Preview endpoint - calculates effective growth factor with current balance
  app.get("/api/strategies/:id/dca/preview", async (req, res) => {
    try {
      const strategyId = req.params.id;
      const { getStrategyWithDCA } = await import('./dca-sql');
      const { calculateDCALevels, calculateATRPercent } = await import('./dca-calculator');
      
      const dbStrategy = await getStrategyWithDCA(strategyId);
      
      if (!dbStrategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Get current account balance from live data orchestrator
      const snapshot = liveDataOrchestrator.getSnapshot(strategyId);
      const balance = (snapshot.account as any)?.totalWalletBalance || 0;
      
      // Get real price and ATR data from monitored symbols
      // Parse selected_assets - it might be a string representation or array
      let monitoredSymbols: string[] = [];
      if (Array.isArray(dbStrategy.selected_assets)) {
        monitoredSymbols = dbStrategy.selected_assets;
      } else if (typeof dbStrategy.selected_assets === 'string') {
        try {
          monitoredSymbols = JSON.parse(dbStrategy.selected_assets);
        } catch {
          monitoredSymbols = [];
        }
      }
      
      let avgPrice = 100; // Fallback
      let avgATR = 1.0; // Fallback
      
      console.log(`📊 DCA Preview: Found ${monitoredSymbols.length} monitored symbols:`, monitoredSymbols.slice(0, 5));
      
      if (monitoredSymbols.length > 0) {
        // Get recent liquidations to extract current prices
        const recentLiqs = await storage.getLiquidationsBySymbol(monitoredSymbols, 1000);
        
        const symbolPrices: Record<string, number> = {};
        const symbolATRs: Record<string, number> = {};
        
        // Extract most recent price for each symbol from liquidations
        for (const symbol of monitoredSymbols) {
          const symbolLiqs = recentLiqs
            .filter(l => l.symbol === symbol)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
          
          if (symbolLiqs.length > 0) {
            symbolPrices[symbol] = parseFloat(symbolLiqs[0].price.toString());
          }
        }
        
        // Calculate real ATR for symbols with API keys
        const apiKey = process.env.ASTER_API_KEY;
        const secretKey = process.env.ASTER_SECRET_KEY;
        
        if (apiKey && secretKey) {
          // Calculate ATR for symbols we have prices for
          for (const symbol of Object.keys(symbolPrices)) {
            try {
              const atr = await calculateATRPercent(symbol, 10, apiKey, secretKey);
              symbolATRs[symbol] = atr;
            } catch (error) {
              console.error(`Failed to calculate ATR for ${symbol}:`, error);
              symbolATRs[symbol] = 1.2; // Fallback
            }
          }
        }
        
        // Calculate weighted average (by recent activity)
        const validSymbols = Object.keys(symbolPrices);
        if (validSymbols.length > 0) {
          avgPrice = validSymbols.reduce((sum, sym) => sum + symbolPrices[sym], 0) / validSymbols.length;
          avgATR = validSymbols.reduce((sum, sym) => sum + (symbolATRs[sym] || 1.2), 0) / validSymbols.length;
          
          console.log(`📊 DCA Preview using real data: avg price=$${avgPrice.toFixed(4)}, avg ATR=${avgATR.toFixed(2)}%`);
          console.log(`   Symbols analyzed:`, validSymbols.map(s => `${s}=$${symbolPrices[s].toFixed(4)}`).join(', '));
        }
      }
      
      // Transform database result to match calculator expectations (snake_case → camelCase)
      const strategy = {
        ...dbStrategy,
        dcaStartStepPercent: dbStrategy.dca_start_step_percent,
        dcaSpacingConvexity: dbStrategy.dca_spacing_convexity,
        dcaSizeGrowth: dbStrategy.dca_size_growth,
        dcaMaxRiskPercent: dbStrategy.dca_max_risk_percent,
        dcaVolatilityRef: dbStrategy.dca_volatility_ref,
        dcaExitCushionMultiplier: dbStrategy.dca_exit_cushion_multiplier,
        maxLayers: dbStrategy.max_layers,
        stopLossPercent: dbStrategy.stop_loss_percent,
        marginAmount: dbStrategy.margin_amount,
      };
      
      // Get minimum minNotional from monitored symbols (for preview calculation)
      let minNotional = 5.0; // Fallback
      if (strategyEngine && monitoredSymbols.length > 0) {
        const notionals = monitoredSymbols
          .map(sym => strategyEngine.getSymbolPrecision(sym)?.minNotional)
          .filter((n): n is number => n !== undefined);
        if (notionals.length > 0) {
          minNotional = Math.min(...notionals); // Use lowest minimum across all symbols
        }
      }
      
      // Calculate DCA levels to get effective growth factor using REAL price and ATR
      const dcaResult = calculateDCALevels(
        strategy as any,
        {
          entryPrice: avgPrice,
          side: 'long',
          currentBalance: balance,
          leverage: dbStrategy.leverage,
          atrPercent: avgATR,
          minNotional,
        }
      );
      
      res.json({
        effectiveGrowthFactor: dcaResult.effectiveGrowthFactor,
        configuredGrowthFactor: dcaResult.configuredGrowthFactor,
        growthFactorAdjusted: dcaResult.growthFactorAdjusted,
        currentBalance: balance,
      });
    } catch (error) {
      console.error('Error calculating DCA preview:', error);
      res.status(500).json({ error: "Failed to calculate DCA preview" });
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
        adaptiveTpEnabled: z.union([z.boolean(), z.string()]).transform((val) => {
          if (typeof val === 'boolean') return val;
          return val === 'true';
        }).nullable().optional(),
        tpAtrMultiplier: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0.5 && num <= 5.0;
        }, "Must be between 0.5 and 5.0").nullable().optional(),
        minTpPercent: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0.1 && num <= 10.0;
        }, "Must be between 0.1 and 10.0").nullable().optional(),
        maxTpPercent: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 1.0 && num <= 20.0;
        }, "Must be between 1.0 and 20.0").nullable().optional(),
        adaptiveSlEnabled: z.union([z.boolean(), z.string()]).transform((val) => {
          if (typeof val === 'boolean') return val;
          return val === 'true';
        }).nullable().optional(),
        slAtrMultiplier: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0.5 && num <= 5.0;
        }, "Must be between 0.5 and 5.0").nullable().optional(),
        minSlPercent: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 0.5 && num <= 100;
        }, "Must be between 0.5 and 100").nullable().optional(),
        maxSlPercent: z.string().refine((val) => {
          const num = parseFloat(val);
          return !isNaN(num) && num >= 1.0 && num <= 100;
        }, "Must be between 1.0 and 100").nullable().optional(),
      });
      
      const validatedData = dcaUpdateSchema.parse(req.body);
      
      // Filter out null and undefined values
      const filteredData = Object.fromEntries(
        Object.entries(validatedData).filter(([_, value]) => value != null && value !== '')
      );
      
      if (Object.keys(filteredData).length === 0) {
        return res.status(400).json({ error: "No DCA parameters provided" });
      }
      
      // Validate minTpPercent <= maxTpPercent if both are provided
      if (filteredData.minTpPercent && filteredData.maxTpPercent) {
        const minTp = parseFloat(filteredData.minTpPercent);
        const maxTp = parseFloat(filteredData.maxTpPercent);
        if (minTp > maxTp) {
          return res.status(400).json({ error: "Min TP % must be less than or equal to Max TP %" });
        }
      }
      
      // Validate minSlPercent <= maxSlPercent if both are provided
      if (filteredData.minSlPercent && filteredData.maxSlPercent) {
        const minSl = parseFloat(filteredData.minSlPercent);
        const maxSl = parseFloat(filteredData.maxSlPercent);
        if (minSl > maxSl) {
          return res.status(400).json({ error: "Min SL % must be less than or equal to Max SL %" });
        }
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
        retMediumThreshold: updated.ret_medium_threshold,
        adaptiveTpEnabled: updated.adaptive_tp_enabled,
        tpAtrMultiplier: updated.tp_atr_multiplier,
        minTpPercent: updated.min_tp_percent,
        maxTpPercent: updated.max_tp_percent,
        adaptiveSlEnabled: updated.adaptive_sl_enabled,
        slAtrMultiplier: updated.sl_atr_multiplier,
        minSlPercent: updated.min_sl_percent,
        maxSlPercent: updated.max_sl_percent
      });
    } catch (error) {
      console.error('Error updating DCA settings:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid DCA parameters", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update DCA settings" });
    }
  });

  // Get VWAP status for all symbols tracked by strategy
  app.get("/api/strategies/:id/vwap/status", async (req, res) => {
    try {
      const strategyId = req.params.id;

      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }

      // Import vwapFilterManager
      const { vwapFilterManager } = await import('./vwap-direction-filter');

      // Get 24hr trading volume for each symbol from exchange
      const volumeDataMap = new Map<string, { volume24h: number }>();
      try {
        const apiKey = process.env.ASTER_API_KEY;

        console.log(`📊 Fetching 24hr volume for ${strategy.selectedAssets.length} symbols (sequential with 250ms delays to avoid burst limit)`);

        if (!apiKey) {
          console.error('API key not configured for volume fetch');
        } else {
          // Fetch ticker data SEQUENTIALLY with delays to avoid burst rate limit
          // 24 symbols × 250ms = 6 seconds (safe for burst limits)
          let successCount = 0;
          let errorCount = 0;

          for (const symbol of strategy.selectedAssets) {
            try {
              const response = await fetch(
                `https://fapi.asterdex.com/fapi/v1/ticker/24hr?symbol=${symbol}`,
                {
                  headers: {
                    'X-MBX-APIKEY': apiKey
                  }
                }
              );

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }

              const ticker = await response.json();

              // Extract quote volume (USDT volume)
              const quoteVolume = parseFloat(ticker.quoteVolume || ticker.volume || '0');
              console.log(`  ${symbol}: $${(quoteVolume / 1e6).toFixed(2)}M`);
              volumeDataMap.set(symbol, { volume24h: quoteVolume });
              successCount++;

              // Add 250ms delay between requests to avoid burst rate limit
              await new Promise(resolve => setTimeout(resolve, 250));
            } catch (error) {
              console.error(`  ❌ Error fetching 24hr ticker for ${symbol}:`, error);
              volumeDataMap.set(symbol, { volume24h: 0 });
              errorCount++;
            }
          }

          console.log(`✅ Fetched 24hr volume: ${successCount} succeeded, ${errorCount} failed`);
        }
      } catch (error) {
        console.error('❌ Error fetching 24hr ticker data:', error);
      }

      // Get VWAP status for all symbols in the strategy
      const symbolStatuses = strategy.selectedAssets.map(symbol => {
        const filter = vwapFilterManager.getFilter(symbol, {
          enabled: strategy.vwapFilterEnabled,
          timeframeMinutes: strategy.vwapTimeframeMinutes,
          bufferPercentage: parseFloat(strategy.vwapBufferPercentage),
          enableBuffer: strategy.vwapEnableBuffer,
        });

        const status = filter.getStatus();
        const stats = filter.getStatistics();
        const volumeData = volumeDataMap.get(symbol) || { volume24h: 0 };

        return {
          symbol,
          direction: status.direction,
          currentVWAP: status.currentVWAP,
          currentPrice: status.currentPrice,
          upperBuffer: status.upperBuffer,
          lowerBuffer: status.lowerBuffer,
          inBufferZone: status.inBufferZone,
          previousDirection: status.previousDirection,
          distanceFromVWAP: status.distanceFromVWAP,
          nextResetTime: status.nextResetTime,
          timeUntilReset: status.timeUntilReset,
          volume24h: volumeData.volume24h,
          statistics: {
            directionChanges: stats.directionChanges,
            signalsBlocked: stats.signalsBlocked,
            timeInBufferMs: stats.timeInBufferMs,
            sessionStartTime: stats.sessionStartTime,
            dataPoints: stats.dataPoints,
          }
        };
      });

      res.status(200).json({
        strategyId,
        enabled: strategy.vwapFilterEnabled,
        timeframeMinutes: strategy.vwapTimeframeMinutes,
        bufferPercentage: parseFloat(strategy.vwapBufferPercentage),
        enableBuffer: strategy.vwapEnableBuffer,
        symbols: symbolStatuses
      });
    } catch (error) {
      console.error('Error getting VWAP status:', error);
      res.status(500).json({ error: "Failed to get VWAP status" });
    }
  });

  // Get VWAP chart data for a specific symbol
  app.get("/api/strategies/:id/vwap/chart/:symbol", async (req, res) => {
    try {
      const strategyId = req.params.id;
      const symbol = req.params.symbol;

      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }

      // Import vwapFilterManager
      const { vwapFilterManager } = await import('./vwap-direction-filter');

      // Get VWAP filter for the symbol
      const filter = vwapFilterManager.getFilter(symbol, {
        enabled: strategy.vwapFilterEnabled,
        timeframeMinutes: strategy.vwapTimeframeMinutes,
        bufferPercentage: parseFloat(strategy.vwapBufferPercentage),
        enableBuffer: strategy.vwapEnableBuffer,
      });

      // Get price history from the filter (last 100 data points)
      const priceHistory = filter.getPriceHistory();

      // Get current VWAP status
      const status = filter.getStatus();

      // Transform to chart data format
      const chartData = priceHistory.map((data: any) => {
        return {
          time: data.timestamp,
          open: data.high, // We're using typical price, so approximate with high/low
          high: data.high,
          low: data.low,
          close: data.close,
          vwap: status.currentVWAP,
          upperBuffer: status.upperBuffer,
          lowerBuffer: status.lowerBuffer,
        };
      });

      res.json(chartData);
    } catch (error) {
      console.error('Error getting VWAP chart data:', error);
      res.status(500).json({ error: "Failed to get VWAP chart data" });
    }
  });

  // Update VWAP configuration
  app.patch("/api/strategies/:id/vwap/config", async (req, res) => {
    try {
      const strategyId = req.params.id;
      console.log(`🔄 VWAP config update request for strategy ${strategyId}:`, JSON.stringify(req.body, null, 2));

      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }

      // Validate VWAP configuration
      const vwapConfigSchema = z.object({
        vwapFilterEnabled: z.boolean().optional(),
        vwapTimeframeMinutes: z.number().int().positive().optional(),
        vwapBufferPercentage: z.number().min(0.0001).max(0.002).optional(), // 0.01% to 0.2%
        vwapEnableBuffer: z.boolean().optional(),
      });

      const validated = vwapConfigSchema.parse(req.body);
      console.log(`✅ VWAP config validated:`, JSON.stringify(validated, null, 2));

      // Update strategy in database
      const updates: Record<string, any> = {};
      if (validated.vwapFilterEnabled !== undefined) {
        updates.vwapFilterEnabled = validated.vwapFilterEnabled;
      }
      if (validated.vwapTimeframeMinutes !== undefined) {
        updates.vwapTimeframeMinutes = validated.vwapTimeframeMinutes;
      }
      if (validated.vwapBufferPercentage !== undefined) {
        updates.vwapBufferPercentage = validated.vwapBufferPercentage.toString();
      }
      if (validated.vwapEnableBuffer !== undefined) {
        updates.vwapEnableBuffer = validated.vwapEnableBuffer;
      }

      await storage.updateStrategy(strategyId, updates);

      // Get updated strategy
      const updatedStrategy = await storage.getStrategy(strategyId);
      if (!updatedStrategy) {
        return res.status(404).json({ error: "Strategy not found after update" });
      }

      // Update VWAP filters for all symbols if strategy is active
      if (updatedStrategy.isActive) {
        const { vwapFilterManager } = await import('./vwap-direction-filter');
        const { vwapPriceFeed } = await import('./vwap-price-feed');

        // Update configuration for all tracked symbols
        for (const symbol of updatedStrategy.selectedAssets) {
          const filter = vwapFilterManager.getFilter(symbol);
          filter.updateConfig({
            enabled: updatedStrategy.vwapFilterEnabled,
            timeframeMinutes: updatedStrategy.vwapTimeframeMinutes,
            bufferPercentage: parseFloat(updatedStrategy.vwapBufferPercentage),
            enableBuffer: updatedStrategy.vwapEnableBuffer,
          });
        }

        // Start or stop price feed based on whether VWAP is enabled
        if (updatedStrategy.vwapFilterEnabled && updatedStrategy.selectedAssets.length > 0) {
          vwapPriceFeed.start(updatedStrategy.selectedAssets);

          // Force immediate refresh to fetch fresh data with new settings
          console.log('🔄 Force refreshing VWAP data with new settings...');
          await vwapPriceFeed.forceRefresh();

          // Broadcast updated VWAP status to frontend for all symbols
          for (const symbol of updatedStrategy.selectedAssets) {
            const filter = vwapFilterManager.getFilter(symbol);
            const vwapStatus = filter.getStatus();
            wsBroadcaster.broadcast({
              type: 'vwap_update',
              data: {
                symbol,
                status: vwapStatus
              },
              timestamp: Date.now()
            });
          }

          console.log(`📊 VWAP Price Feed started for ${updatedStrategy.selectedAssets.length} symbols`);
        } else {
          vwapPriceFeed.stop();
          console.log('📊 VWAP Price Feed stopped (filter disabled)');
        }
      }

      console.log(`✅ VWAP configuration updated for strategy ${strategyId}`);
      res.status(200).json({
        vwapFilterEnabled: updatedStrategy.vwapFilterEnabled,
        vwapTimeframeMinutes: updatedStrategy.vwapTimeframeMinutes,
        vwapBufferPercentage: parseFloat(updatedStrategy.vwapBufferPercentage),
        vwapEnableBuffer: updatedStrategy.vwapEnableBuffer,
      });
    } catch (error) {
      console.error('❌ Error updating VWAP configuration:', error);
      if (error instanceof z.ZodError) {
        console.error('❌ Zod validation error:', JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ error: "Invalid VWAP parameters", details: error.errors });
      }
      console.error('❌ Unknown error:', error instanceof Error ? error.message : String(error));
      res.status(500).json({ error: "Failed to update VWAP configuration" });
    }
  });

  // Start strategy route (activate strategy for trading)
  app.post("/api/strategies/:id/start", async (req, res) => {
    try {
      const strategyId = req.params.id;
      
      // Verify strategy exists
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: "Strategy not found" });
      }
      
      // Update strategy to active status and ensure it's not paused
      await storage.updateStrategy(strategyId, { 
        isActive: true,
        paused: false  // Ensure not paused when starting
      });
      
      // Fetch the updated strategy with fresh isActive and paused values
      const updatedStrategy = await storage.getStrategy(strategyId);
      if (!updatedStrategy) {
        return res.status(404).json({ error: "Strategy not found after update" });
      }
      
      // Register with strategy engine using the FRESH strategy data
      await strategyEngine.registerStrategy(updatedStrategy);
      
      // Initialize WebSocket-only cache (NO POLLING)
      const { liveDataOrchestrator } = await import('./live-data-orchestrator');
      liveDataOrchestrator.start(strategyId);
      
      res.status(200).json(updatedStrategy);
    } catch (error) {
      console.error('Error starting strategy:', error);
      res.status(500).json({ error: "Failed to start strategy" });
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
      
      // Broadcast pause status to frontend (turn trade light red)
      wsBroadcaster.broadcastTradeBlock({
        blocked: true,
        reason: "Strategy paused by user",
        type: "user_pause"
      });
      
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
      
      // Broadcast resume status to frontend (turn trade light green)
      wsBroadcaster.broadcastTradeBlock({
        blocked: false,
        reason: "",
        type: ""
      });
      
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

  app.get("/api/cascade/settings", async (req, res) => {
    try {
      res.json({
        autoEnabled: cascadeDetectorService.getAutoEnabled(),
        globalBlockThresholdPercent: cascadeDetectorService.getGlobalBlockThreshold()
      });
    } catch (error) {
      console.error('Error fetching cascade settings:', error);
      res.status(500).json({ error: "Failed to fetch cascade settings" });
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

  app.post("/api/cascade/stop", async (req, res) => {
    try {
      cascadeDetectorService.stop();
      
      res.json({ 
        success: true, 
        message: "Cascade detector stopped successfully"
      });
    } catch (error) {
      console.error('Error stopping cascade detector:', error);
      res.status(500).json({ error: "Failed to stop cascade detector" });
    }
  });

  const httpServer = createServer(app);

  // WebSocket server for real-time liquidation updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Store connected clients
  const clients = new Set<WebSocket>();

  wss.on('connection', async (ws) => {
    console.log('Client connected to WebSocket');
    clients.add(ws);
    
    // Send cached snapshot to newly connected client
    try {
      const activeStrategy = await db.query.strategies.findFirst({
        where: (strategies, { eq }) => eq(strategies.isActive, true)
      });
      
      console.log('🔍 DEBUG: activeStrategy found:', !!activeStrategy);
      if (activeStrategy) {
        console.log('🔍 DEBUG: activeStrategy.id =', activeStrategy.id, 'paused =', activeStrategy.paused);
        
        const snapshot = liveDataOrchestrator.getSnapshot(activeStrategy.id);
        console.log('🔍 DEBUG: snapshot found:', !!snapshot, 'has account:', !!(snapshot && snapshot.account));
        
        if (snapshot && snapshot.account) {
          ws.send(JSON.stringify({
            type: 'live_snapshot',
            data: { snapshot },
            timestamp: Date.now()
          }));
          console.log('📤 Sent cached snapshot to new client (balance: $' + snapshot.account.usdtBalance + ')');
        }
        
        // Send current pause status to set trade light correctly
        console.log('🔍 DEBUG: Checking pause status - paused =', activeStrategy.paused, 'type:', typeof activeStrategy.paused);
        if (activeStrategy.paused) {
          ws.send(JSON.stringify({
            type: 'trade_block',
            data: {
              blocked: true,
              reason: "Strategy paused by user",
              type: "user_pause"
            },
            timestamp: Date.now()
          }));
          console.log('📤 Sent pause status to new client (paused: true)');
        } else {
          console.log('⚠️ Strategy NOT paused, skipping pause message');
        }
      } else {
        console.log('⚠️ No active strategy found for WebSocket init');
      }
    } catch (error) {
      console.error('Error sending initial snapshot:', error);
    }
    
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
  
  // Initialize cascade detector service with ULTRA-MINIMAL POLLING
  // ⚠️ Uses rotating OI fetch + batch prices = ~24 API calls/min (vs 1,620/min before)
  // DO NOT change polling config without user permission!
  // Delay start by 30 seconds to avoid startup rate limits
  cascadeDetectorService.setClients(clients);
  console.log('⏳ Delaying cascade detector by 30s to avoid startup rate limits...');
  setTimeout(async () => {
    try {
      await cascadeDetectorService.start();
      console.log('🚨 Cascade detector started (delayed startup complete)');
    } catch (error) {
      console.error('❌ Failed to start cascade detector:', error);
    }
  }, 30000); // 30 second delay
  
  // Connect to Aster DEX WebSocket and relay data
  connectToAsterDEX(clients);
  
  // Connect to User Data Stream for real-time account/position updates
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
    if (!strategy) {
      return;
    }

    // Fetch fills from exchange (all historical data, no cutoff)
    const timestamp = Date.now();
    const params = `timestamp=${timestamp}&limit=10000`;
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

  // DEBUG: Manual risk calculation endpoint
  app.get('/api/strategies/:strategyId/risk-debug', async (req, res) => {
    try {
      const { strategyId } = req.params;
      const strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        return res.status(404).json({ error: 'Strategy not found' });
      }

      const session = await storage.getActiveTradeSession(strategyId);
      if (!session) {
        return res.status(404).json({ error: 'No active session' });
      }

      const openPositions = await storage.getOpenPositions(session.id);

      let currentBalance = parseFloat(session.currentBalance);

      // Try to get exchange balance
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      let exchangeBalance = null;

      try {
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', secretKey!).update(queryString).digest('hex');

        const accountResponse = await fetch(
          `https://fapi.asterdex.com/fapi/v2/account?${queryString}&signature=${signature}`,
          { headers: { 'X-MBX-APIKEY': apiKey! } }
        );

        if (accountResponse.ok) {
          const data = await accountResponse.json();
          // Use totalWalletBalance (total account equity) not availableBalance
          exchangeBalance = parseFloat(data.totalWalletBalance || '0');
        }
      } catch (error) {
        console.error('Failed to fetch exchange balance for debug:', error);
      }

      // Import adaptive SL utility
      const { getStopLossPercent } = await import('./adaptive-sl-tp-utils');

      const positionDetails = await Promise.all(openPositions.map(async (position) => {
        const entryPrice = parseFloat(position.avgEntryPrice);
        const quantity = Math.abs(parseFloat(position.totalQuantity));
        const isLong = position.side === 'long';

        // Use adaptive SL if enabled
        const stopLossPercent = await getStopLossPercent(strategy, position.symbol);

        const stopLossPrice = isLong
          ? entryPrice * (1 - stopLossPercent / 100)
          : entryPrice * (1 + stopLossPercent / 100);

        const lossPerUnit = isLong
          ? entryPrice - stopLossPrice
          : stopLossPrice - entryPrice;

        const positionLoss = lossPerUnit * quantity;

        return {
          id: position.id,
          symbol: position.symbol,
          side: position.side,
          quantity: quantity.toFixed(8),
          avgEntryPrice: entryPrice.toFixed(4),
          stopLossPrice: stopLossPrice.toFixed(4),
          stopLossPercent: stopLossPercent.toFixed(1),
          lossPerUnit: lossPerUnit.toFixed(4),
          totalLoss: positionLoss.toFixed(2)
        };
      }));

      const totalPotentialLoss = positionDetails.reduce((sum, p) => sum + parseFloat(p.totalLoss), 0);

      res.json({
        openPositionCount: openPositions.length,
        adaptiveSlEnabled: strategy.adaptiveSlEnabled || false,
        sessionBalance: parseFloat(session.currentBalance).toFixed(2),
        exchangeBalance: exchangeBalance ? exchangeBalance.toFixed(2) : null,
        usedBalance: exchangeBalance || currentBalance,
        positions: positionDetails,
        totalPotentialLoss: totalPotentialLoss.toFixed(2),
        riskPercentageWithSession: ((totalPotentialLoss / currentBalance) * 100).toFixed(1),
        riskPercentageWithExchange: exchangeBalance ? ((totalPotentialLoss / exchangeBalance) * 100).toFixed(1) : null
      });
    } catch (error) {
      console.error('Error in risk debug:', error);
      res.status(500).json({ error: 'Failed to calculate risk' });
    }
  });

  // Get position summary by strategy ID (finds active trade session automatically)
  app.get('/api/strategies/:strategyId/positions/summary', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Check cache first to prevent rate limiting (5 minute cache)
      const cacheKey = `position_summary_${strategyId}`;
      const cached = getCached<any>(cacheKey, 300000); // 5 minute TTL
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
              // CRITICAL FIX: P&L is based on (Price × Quantity), NOT leveraged notional value
              // Realized P&L = P&L% × (Entry Price × Total Quantity)
              const avgEntryPrice = parseFloat(dbPos.avgEntryPrice);
              const totalQuantity = parseFloat(dbPos.totalQuantity);
              const positionSize = avgEntryPrice * totalQuantity; // Actual position size (no leverage)
              const realizedPnlDollar = (realizedPnlPercent / 100) * positionSize;
              
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
                // Orphaned exchange position found! Validate against DCA Layer 1 sizing before adding
                console.log(`🔍 Orphan position detected: ${exPos.symbol} ${side} (qty=${Math.abs(posAmt)})`);
                
                const entryPrice = parseFloat(exPos.entryPrice || '0');
                const quantity = Math.abs(posAmt);
                
                // CRITICAL: Validate orphan position size against DCA Layer 1 limits
                // Use shared validation helper to ensure consistent enforcement
                const { validateOrphanPosition } = await import('./exchange-sync.js');
                const validationResult = await validateOrphanPosition(
                  exPos.symbol,
                  side,
                  quantity,
                  entryPrice,
                  liveSession.id,
                  storage
                );
                
                if (!validationResult.valid) {
                  console.error(`❌ ORPHAN REJECTED: ${validationResult.error}`);
                  console.error(`   Position will NOT be tracked to maintain DCA policy compliance`);
                  continue; // Skip this orphan - do NOT add to database
                }
                
                // Validation passed - create position in database
                console.log(`⚠️ ORPHANED POSITION DETECTED: ${exPos.symbol} ${side} with ${quantity} units on exchange but NOT in database`);
                console.log(`   This position will now be tracked and monitored for stop-loss`);
                
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
            // Try to return stale cached data (ignore TTL)
            const staleCache = apiCache.get(cacheKey);
            if (staleCache) {
              console.log('📦 Returning stale cached position summary due to rate limit');
              return res.json(staleCache.data);
            }
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
              layersFilled: positionFills.length, // Number of entry layers filled
              maxLayers: strategy.maxLayers, // Maximum layers from strategy
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
      let { strategyId } = req.params;
      
      // FLEXIBLE ID RESOLUTION: Accept both strategy ID and session ID
      // If ID is a session ID, resolve to its strategy ID
      let strategy = await storage.getStrategy(strategyId);
      if (!strategy) {
        // Check if this might be a session ID
        const sessionResult = await db.select().from(tradeSessions).where(eq(tradeSessions.id, strategyId)).limit(1);
        if (sessionResult.length > 0) {
          strategyId = sessionResult[0].strategyId;
          strategy = await storage.getStrategy(strategyId);
        }
      }
      
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

      console.log(`💰 Calculating P&L from fills for ${allClosedPositions.length} closed positions (${allFills.length} total fills)`);
      
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
      
      // UPDATED Oct 15, 2025: Database consolidated to single-source-of-truth positions
      // Each closed position has ONE entry with REAL exchange fills (no synthetic fills)
      // Filter OUT any remaining positions with ONLY synthetic 'sync-pnl-' fills AND attach fills to each position
      const realPositions = closedPositionsWithFees
        .filter(p => {
          const positionFills = allFills.filter(f => f.positionId === p.id);
          // Exclude positions that ONLY have synthetic fills (should be none after cleanup)
          const hasOnlySyntheticFills = positionFills.length > 0 && 
            positionFills.every(f => f.orderId.startsWith('sync-pnl-'));
          return !hasOnlySyntheticFills; // Return positions with real fills or no fills
        })
        .map(p => {
          // Attach fills to each position for frontend display
          // Filter out synthetic fills and sort chronologically by filledAt (oldest first)
          const positionFills = allFills
            .filter(f => f.positionId === p.id)
            .filter(f => !f.orderId.startsWith('sync-pnl-')) // Remove any synthetic fills
            .sort((a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime()); // Sort chronologically (oldest first)
          return {
            ...p,
            fills: positionFills
          };
        });
      
      // CALCULATE P&L DIRECTLY FROM FILLS (Oct 17, 2025)
      // This works for ALL positions regardless of age - no 7-day exchange API limitation
      // P&L = (exit value - entry value) × direction - total fees
      
      const positionsWithRealPnl = realPositions.map(position => {
        if (!position.closedAt || !position.openedAt || !position.fills || position.fills.length === 0) {
          return {
            ...position,
            realizedPnl: '0',
            pnlSource: 'no_fills',
          };
        }
        
        // Separate entry and exit fills based on position direction
        const isLong = position.side === 'long';
        
        // Entry fills: BUY for long, SELL for short (layer > 0 or matching side)
        const entryFills = position.fills.filter((fill: any) => {
          const matchingSide = (isLong && fill.side === 'buy') || (!isLong && fill.side === 'sell');
          return matchingSide && (fill.layerNumber > 0 || fill.orderId.startsWith('entry-'));
        });
        
        // Exit fills: SELL for long, BUY for short (layer = 0 or exit orderId)
        const exitFills = position.fills.filter((fill: any) => {
          const matchingSide = (isLong && fill.side === 'sell') || (!isLong && fill.side === 'buy');
          return matchingSide && (fill.layerNumber === 0 || fill.orderId.startsWith('exit-'));
        });
        
        // Calculate total values from fills
        const entryValue = entryFills.reduce((sum: number, fill: any) => {
          return sum + (parseFloat(fill.quantity || '0') * parseFloat(fill.price || '0'));
        }, 0);
        
        const exitValue = exitFills.reduce((sum: number, fill: any) => {
          return sum + (parseFloat(fill.quantity || '0') * parseFloat(fill.price || '0'));
        }, 0);
        
        const totalFees = position.fills.reduce((sum: number, fill: any) => {
          return sum + parseFloat(fill.fee || '0');
        }, 0);
        
        // Calculate P&L based on position direction
        // Long: profit when exit > entry (sell high, buy low)
        // Short: profit when entry > exit (sell high, buy back low)
        let grossPnl = 0;
        if (isLong) {
          grossPnl = exitValue - entryValue;
        } else {
          grossPnl = entryValue - exitValue;
        }
        
        const netPnl = grossPnl - totalFees;
        
        // Calculate P&L percentage
        const pnlPercent = entryValue > 0 ? (grossPnl / entryValue) * 100 : 0;
        
        return {
          ...position,
          realizedPnl: netPnl.toFixed(8),
          realizedPnlPercent: pnlPercent.toFixed(2),
          totalFees: totalFees.toFixed(4),
          pnlSource: 'fills',
          entryFillCount: entryFills.length,
          exitFillCount: exitFills.length,
        };
      });
      
      const consolidatedPositions: any[] = [...positionsWithRealPnl]; // Return positions with real P&L
      
      // Helper function to merge a group of positions into one consolidated position
      function mergePositionGroup(group: any[]) {
        if (group.length === 1) return group[0];
        
        const totalQuantity = group.reduce((sum, p) => sum + parseFloat(p.totalQuantity || '0'), 0);
        const totalCost = group.reduce((sum, p) => sum + parseFloat(p.totalCost || '0'), 0);
        const totalRealizedPnl = group.reduce((sum, p) => sum + parseFloat(p.realizedPnl || '0'), 0);
        const totalUnrealizedPnl = group.reduce((sum, p) => sum + parseFloat(p.unrealizedPnl || '0'), 0);
        const totalFees = group.reduce((sum, p) => sum + parseFloat(p.totalFees || '0'), 0);
        const totalLayersFilled = group.reduce((sum, p) => sum + (p.layersFilled || 1), 0);
        
        // Weighted average entry price
        const avgEntryPrice = totalCost > 0 
          ? group.reduce((sum, p) => sum + parseFloat(p.avgEntryPrice || '0') * parseFloat(p.totalCost || '0'), 0) / totalCost
          : parseFloat(group[0].avgEntryPrice || '0');
        
        return {
          ...group[0], // Use first position as base
          id: group.map(p => p.id).join(','), // Combine IDs for reference
          totalQuantity: totalQuantity.toFixed(8),
          avgEntryPrice: avgEntryPrice.toFixed(8),
          totalCost: totalCost.toFixed(8),
          realizedPnl: totalRealizedPnl.toFixed(8),
          unrealizedPnl: totalUnrealizedPnl.toFixed(8),
          totalFees: totalFees.toFixed(4),
          layersFilled: totalLayersFilled,
          openedAt: group[0].openedAt, // Earliest open time
          closedAt: group[group.length - 1].closedAt, // Latest close time
          consolidatedCount: group.length, // Track how many positions were merged
        };
      }
      
      // Sort consolidated positions by close time (most recent first)
      consolidatedPositions.sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
      
      // Prevent caching to ensure fresh data on each request
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      // Filter out testing period - only include positions closed on or after Oct 16, 2025
      const CUTOFF_TIMESTAMP = 1760635140000; // Oct 16, 2025 at 17:19:00 UTC (first deposit)
      const filteredPositions = consolidatedPositions.filter(position => {
        if (!position.closedAt) return false; // Exclude positions without close time
        const closeTime = new Date(position.closedAt).getTime();
        return closeTime >= CUTOFF_TIMESTAMP;
      });

      console.log(`📊 Filtered positions: ${consolidatedPositions.length} total → ${filteredPositions.length} after Oct 10 cutoff`);

      res.json(filteredPositions);
    } catch (error) {
      console.error('Error fetching closed positions:', error);
      res.status(500).json({ error: 'Failed to fetch closed positions' });
    }
  });

  // Get actual TP/SL orders for live positions
  app.get('/api/live/protective-orders', async (req, res) => {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        return res.status(500).json({ error: 'API keys not configured' });
      }

      // Get all open orders
      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/openOrders?${params}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey },
        }
      );

      if (!response.ok) {
        return res.status(500).json({ error: 'Failed to fetch orders' });
      }

      const orders = await response.json();
      
      // Group orders by symbol and find TP/SL for each position
      const protectiveOrders: Record<string, { symbol: string; tpPrice: number | null; slPrice: number | null; side: string }> = {};
      
      for (const order of orders) {
        const key = `${order.symbol}-${order.side === 'BUY' ? 'SHORT' : 'LONG'}`; // Opposite of order side
        
        if (!protectiveOrders[key]) {
          protectiveOrders[key] = {
            symbol: order.symbol,
            tpPrice: null,
            slPrice: null,
            side: order.side === 'BUY' ? 'SHORT' : 'LONG'
          };
        }
        
        // TP is LIMIT order, SL is STOP_MARKET order
        if (order.type === 'LIMIT' && order.reduceOnly) {
          protectiveOrders[key].tpPrice = parseFloat(order.price);
        } else if (order.type === 'STOP_MARKET') {
          protectiveOrders[key].slPrice = parseFloat(order.stopPrice);
        }
      }

      res.json(protectiveOrders);
    } catch (error) {
      console.error('Error fetching protective orders:', error);
      res.status(500).json({ error: 'Failed to fetch protective orders' });
    }
  });

  // Clean up duplicate positions for a strategy
  app.post('/api/strategies/:strategyId/cleanup-duplicates', async (req, res) => {
    try {
      const { strategyId } = req.params;
      
      // Find the active trade session for this strategy
      const session = await storage.getActiveTradeSession(strategyId);
      
      if (!session) {
        return res.status(404).json({ error: 'No active trade session found for this strategy' });
      }

      // Get all closed positions
      const allPositions = await storage.getClosedPositions(session.id);
      
      // Find duplicates - positions with same symbol, side, and close time within 5 seconds
      const duplicatesToDelete: string[] = [];
      const seen = new Map<string, string>(); // key -> first position ID
      
      for (const pos of allPositions) {
        if (!pos.closedAt) continue;
        
        const closedTime = new Date(pos.closedAt).getTime();
        const qty = parseFloat(pos.totalQuantity);
        
        // Find if we already have a similar position
        let foundDuplicate = false;
        for (const [key, firstPosId] of Array.from(seen.entries())) {
          const [seenSymbol, seenSide, seenTime, seenQty] = key.split('|');
          
          if (pos.symbol === seenSymbol && pos.side === seenSide) {
            const timeDiff = Math.abs(closedTime - parseInt(seenTime));
            const qtyDiff = Math.abs(qty - parseFloat(seenQty)) / parseFloat(seenQty);
            
            if (timeDiff < 5000 && qtyDiff < 0.001) {
              // This is a duplicate - mark for deletion
              duplicatesToDelete.push(pos.id);
              foundDuplicate = true;
              break;
            }
          }
        }
        
        // If not a duplicate, remember this position
        if (!foundDuplicate) {
          const key = `${pos.symbol}|${pos.side}|${closedTime}|${qty}`;
          seen.set(key, pos.id);
        }
      }
      
      // Delete duplicates
      const { fills } = await import('@shared/schema');
      for (const posId of duplicatesToDelete) {
        // Delete fills first (foreign key constraint)
        await db.delete(fills).where(eq(fills.positionId, posId));
        
        // Delete position
        await db.delete(positions).where(eq(positions.id, posId));
      }
      
      res.json({ 
        success: true, 
        deletedCount: duplicatesToDelete.length,
        message: `Removed ${duplicatesToDelete.length} duplicate positions`
      });
    } catch (error) {
      console.error('Error cleaning up duplicates:', error);
      res.status(500).json({ error: 'Failed to clean up duplicates' });
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

  // Get the actual first trade time from exchange for a symbol+side
  app.get('/api/positions/:positionId/first-trade-time', async (req, res) => {
    try {
      const { positionId } = req.params;
      let symbol: string;
      let side: 'long' | 'short';

      // Handle live positions (IDs like: live-HYPEUSDT-LONG)
      if (positionId.startsWith('live-')) {
        const parts = positionId.substring(5).split('-');
        const positionSide = parts.pop() || '';
        symbol = parts.join('-');
        side = positionSide.toLowerCase().includes('long') ? 'long' : 'short';
      } else {
        // Database position - fetch it to get symbol and side
        const position = await storage.getPosition(positionId);
        if (!position) {
          return res.status(404).json({ error: 'Position not found' });
        }
        symbol = position.symbol;
        side = position.side;
      }

      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return res.status(400).json({ error: 'API keys not configured' });
      }

      // Step 1: Get current position size from exchange
      let timestamp = Date.now();
      let params = `timestamp=${timestamp}`;
      let signature = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const accountResponse = await fetch(
        `https://fapi.asterdex.com/fapi/v2/account?${params}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey },
        }
      );

      if (!accountResponse.ok) {
        return res.json({ firstTradeTime: null });
      }

      const accountData = await accountResponse.json();

      // In hedge mode, need to match both symbol AND positionSide
      const targetPositionSide = side === 'long' ? 'LONG' : 'SHORT';
      const exchangePosition = accountData.positions?.find((p: any) =>
        p.symbol === symbol && p.positionSide === targetPositionSide
      );

      if (!exchangePosition) {
        console.log(`[first-trade-time] Position not found on exchange for ${symbol} ${targetPositionSide}`);
        return res.json({ firstTradeTime: null });
      }

      const positionAmt = Math.abs(parseFloat(exchangePosition.positionAmt));
      console.log(`[first-trade-time] ${symbol} ${side} position size: ${positionAmt}`);

      if (positionAmt === 0) {
        console.log(`[first-trade-time] Position size is zero for ${symbol} ${side}`);
        return res.json({ firstTradeTime: null });
      }

      // Step 2: Fetch recent trades (newest first by default)
      timestamp = Date.now();
      params = `symbol=${symbol}&timestamp=${timestamp}&limit=1000`;
      signature = crypto
        .createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const tradesResponse = await fetch(
        `https://fapi.asterdex.com/fapi/v1/userTrades?${params}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey },
        }
      );

      if (!tradesResponse.ok) {
        return res.json({ firstTradeTime: null });
      }

      const trades = await tradesResponse.json();

      // Sort all trades newest first
      const allTrades = trades.sort((a: any, b: any) => b.time - a.time);

      if (allTrades.length === 0) {
        return res.json({ firstTradeTime: null });
      }

      // Step 3: Work backwards calculating net position until we reach current position size
      // For LONG: BUY increases position, SELL decreases position
      // For SHORT: SELL increases position (makes more negative), BUY decreases position (makes less negative)
      let netPosition = 0;
      let firstTradeTime: string | null = null;

      for (let i = 0; i < allTrades.length; i++) {
        const trade = allTrades[i];
        const qty = parseFloat(trade.qty);

        // Going backwards: reverse the trade effect
        if (side === 'long') {
          // Working backwards for LONG: BUY adds to position, SELL subtracts
          if (trade.side === 'BUY') {
            netPosition += qty;
          } else {
            netPosition -= qty;
          }
        } else {
          // Working backwards for SHORT: SELL adds to position, BUY subtracts
          if (trade.side === 'SELL') {
            netPosition += qty;
          } else {
            netPosition -= qty;
          }
        }

        // Once we've accumulated the full position size, we found the first trade
        if (netPosition >= positionAmt) {
          firstTradeTime = new Date(trade.time).toISOString();
        } else if (firstTradeTime) {
          // We had enough but now we don't - we've gone too far back
          break;
        }
      }

      if (!firstTradeTime) {
        return res.json({ firstTradeTime: null });
      }

      res.json({ firstTradeTime });
    } catch (error) {
      console.error('Error fetching first trade time:', error);
      res.json({ firstTradeTime: null });
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
        
        // Fetch actual fills from exchange
        const apiKey = process.env.ASTER_API_KEY;
        const secretKey = process.env.ASTER_SECRET_KEY;

        if (!apiKey || !secretKey) {
          return res.status(400).json({ error: 'Aster DEX API keys not configured' });
        }

        // Fetch trade history from exchange for this symbol (all historical data, no cutoff)
        const timestamp = Date.now();
        const params = `symbol=${symbol}&timestamp=${timestamp}&limit=1000`;
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

          // Sort ALL fills chronologically (both BUY and SELL) to track position lifecycle
          const allSymbolFills = exchangeFills.sort((a: any, b: any) => a.time - b.time);

          // Find where the CURRENT position started by tracking cumulative quantity
          // Position quantity increases with buys, decreases with sells
          let cumulativeQty = 0;
          let lastZeroTime = 0;

          for (const fill of allSymbolFills) {
            const qty = parseFloat(fill.qty);

            // BUY increases position, SELL decreases position
            if (fill.side === 'BUY') {
              cumulativeQty += qty;
            } else {
              cumulativeQty -= qty;
            }

            // If position went to zero (or very close), mark this timestamp
            if (Math.abs(cumulativeQty) < 0.0001) {
              lastZeroTime = fill.time;
            }
          }

          // Now filter to only the target side (BUY for longs, SELL for shorts)
          // and only fills AFTER the last zero crossing (current position start)
          const currentPositionFills = allSymbolFills
            .filter((trade: any) =>
              trade.side === targetSide &&
              trade.time > lastZeroTime  // Only fills after position was last at zero
            );

          // Additional safety: verify these fills sum to current position
          const totalFillQty = currentPositionFills.reduce((sum, f) => sum + parseFloat(f.qty), 0);
          if (Math.abs(totalFillQty - currentQty) > 0.01) {
            console.warn(`⚠️ Fill quantity mismatch for ${symbol}: fills=${totalFillQty.toFixed(2)}, position=${currentQty.toFixed(2)}`);
            // If mismatch, fall back to working backwards method
            const reversedFills = allSymbolFills
              .filter((trade: any) => trade.side === targetSide)
              .reverse();

            const fallbackFills: any[] = [];
            let accumulatedQty = 0;

            for (const fill of reversedFills) {
              fallbackFills.unshift(fill);
              accumulatedQty += parseFloat(fill.qty);
              if (accumulatedQty >= currentQty) break;
            }

            const fills = fallbackFills.map((trade: any, index: number) => ({
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

          // Map to our format with sequential layer numbers (DCA layers)
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
            layerNumber: index + 1, // Sequential DCA layer number for CURRENT position
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

        // Place market order to close the position (include positionSide for hedge mode)
        const orderTimestamp = Date.now();
        const orderParams = `symbol=${symbol}&side=${side}&positionSide=${positionSide}&type=MARKET&quantity=${quantity}&timestamp=${orderTimestamp}`;
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

      // Try to fetch actual P&L from exchange (only works for positions within last 7 days)
      const closedAt = new Date();
      let finalPnl = dollarPnl;
      let pnlSource = 'calculated';
      
      const pnlResult = await fetchPositionPnL({
        symbol: position.symbol,
        side: position.side as 'long' | 'short',
        openedAt: position.openedAt,
        closedAt,
      });
      
      if (pnlResult.success && pnlResult.realizedPnl !== undefined) {
        finalPnl = pnlResult.realizedPnl;
        pnlSource = 'exchange';
        console.log(`✅ Using exchange P&L: $${finalPnl.toFixed(2)} (calculated was $${dollarPnl.toFixed(2)})`);
      } else {
        console.log(`ℹ️ Using calculated P&L: $${dollarPnl.toFixed(2)} (${pnlResult.error})`);
      }
      
      // Close the position with actual or calculated P&L
      await storage.closePosition(position.id, closedAt, finalPnl, unrealizedPnl);

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

  // Backfill P&L for closed positions (within last 7 days)
  app.post('/api/admin/backfill-pnl', async (req, res) => {
    try {
      console.log('🔄 Starting P&L backfill for closed positions...');
      
      // Get all closed positions with NULL realizedPnl (never stored)
      const allClosedPositions = await db.select()
        .from(positions)
        .where(eq(positions.isOpen, false));
      
      const positionsNeedingPnl = allClosedPositions.filter(p => 
        (p.realizedPnl === null || p.realizedPnl === undefined) && p.closedAt && p.openedAt
      );
      
      console.log(`📊 Found ${positionsNeedingPnl.length} positions needing P&L backfill (out of ${allClosedPositions.length} total)`);
      
      let successCount = 0;
      let failCount = 0;
      let skippedCount = 0;
      
      for (const position of positionsNeedingPnl) {
        try {
          // Check if position is within last 7 days
          const daysSinceClosed = (Date.now() - new Date(position.closedAt!).getTime()) / (24 * 60 * 60 * 1000);
          
          if (daysSinceClosed > 7) {
            console.log(`⏭️ Skipping ${position.symbol} ${position.side} - closed ${daysSinceClosed.toFixed(1)} days ago (> 7 days)`);
            skippedCount++;
            continue;
          }
          
          // Fetch P&L from exchange
          const pnlResult = await fetchPositionPnL({
            symbol: position.symbol,
            side: position.side as 'long' | 'short',
            openedAt: position.openedAt!,
            closedAt: position.closedAt!,
          });
          
          if (pnlResult.success && pnlResult.realizedPnl !== undefined) {
            // Update position with actual P&L
            await db.update(positions)
              .set({ 
                realizedPnl: pnlResult.realizedPnl.toString(),
                updatedAt: new Date()
              })
              .where(eq(positions.id, position.id));
            
            console.log(`✅ ${position.symbol} ${position.side}: $${pnlResult.realizedPnl.toFixed(2)}`);
            successCount++;
          } else {
            console.log(`❌ ${position.symbol} ${position.side}: ${pnlResult.error}`);
            failCount++;
          }
        } catch (error) {
          console.error(`❌ Error backfilling ${position.symbol} ${position.side}:`, error);
          failCount++;
        }
      }
      
      res.json({
        success: true,
        message: `Backfill complete: ${successCount} updated, ${failCount} failed, ${skippedCount} skipped (> 7 days)`,
        updated: successCount,
        failed: failCount,
        skipped: skippedCount,
        total: positionsNeedingPnl.length
      });
    } catch (error) {
      console.error('Error backfilling P&L:', error);
      res.status(500).json({ error: 'Failed to backfill P&L' });
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

  // Get exchange limits (MIN_NOTIONAL, precision) for cascade monitoring symbols
  app.get('/api/exchange-limits', async (req, res) => {
    try {
      if (!strategyEngine) {
        return res.status(503).json({ error: 'Strategy engine not initialized' });
      }

      // Get monitored symbols from cascade detector service (already loaded and active)
      const monitoredSymbols = cascadeDetectorService.getMonitoredSymbols();

      if (monitoredSymbols.length === 0) {
        return res.json({ limits: [], message: 'No assets being monitored for cascade detection' });
      }

      // Get symbol precision data from strategy engine cache using public getter
      const limits = monitoredSymbols.map(symbol => {
        const precision = strategyEngine.getSymbolPrecision(symbol);
        return {
          symbol,
          minNotional: precision?.minNotional ?? null,
          pricePrecision: precision?.pricePrecision ?? null,
          quantityPrecision: precision?.quantityPrecision ?? null,
          available: !!precision?.minNotional
        };
      });

      res.json({ limits });
    } catch (error) {
      console.error('Error fetching exchange limits:', error);
      res.status(500).json({ error: 'Failed to fetch exchange limits' });
    }
  });

  // Get trade entry errors with optional filtering (symbol, reason, date range)
  app.get('/api/trade-errors', async (req, res) => {
    try {
      const { symbol, reason, startTime, endTime, limit } = req.query;
      
      const filters: any = {};
      
      if (symbol) {
        filters.symbol = symbol as string;
      }
      
      if (reason) {
        filters.reason = reason as string;
      }
      
      if (startTime) {
        const timestamp = parseInt(startTime as string);
        if (isNaN(timestamp)) {
          return res.status(400).json({ error: 'Invalid startTime parameter' });
        }
        filters.startTime = new Date(timestamp);
        if (isNaN(filters.startTime.getTime())) {
          return res.status(400).json({ error: 'Invalid startTime date' });
        }
      }
      
      if (endTime) {
        const timestamp = parseInt(endTime as string);
        if (isNaN(timestamp)) {
          return res.status(400).json({ error: 'Invalid endTime parameter' });
        }
        filters.endTime = new Date(timestamp);
        if (isNaN(filters.endTime.getTime())) {
          return res.status(400).json({ error: 'Invalid endTime date' });
        }
      }
      
      if (limit) {
        const parsedLimit = parseInt(limit as string);
        if (isNaN(parsedLimit) || parsedLimit < 1) {
          return res.status(400).json({ error: 'Invalid limit parameter' });
        }
        filters.limit = parsedLimit;
      }

      const errors = await storage.getTradeEntryErrors(DEFAULT_USER_ID, filters);
      res.json(errors);
    } catch (error) {
      console.error('Error fetching trade entry errors:', error);
      res.status(500).json({ error: 'Failed to fetch trade entry errors' });
    }
  });

  // Get console logs (warnings, errors, etc.)
  app.get('/api/console-logs', async (req, res) => {
    try {
      const { level, search, startTime, endTime, limit } = req.query;

      const filters: any = {};

      if (level && (level === 'log' || level === 'warn' || level === 'error')) {
        filters.level = level as 'log' | 'warn' | 'error';
      }

      if (search) {
        filters.search = search as string;
      }

      if (startTime) {
        const timestamp = parseInt(startTime as string);
        if (!isNaN(timestamp)) {
          filters.startTime = new Date(timestamp);
        }
      }

      if (endTime) {
        const timestamp = parseInt(endTime as string);
        if (!isNaN(timestamp)) {
          filters.endTime = new Date(timestamp);
        }
      }

      if (limit) {
        const parsedLimit = parseInt(limit as string);
        if (!isNaN(parsedLimit) && parsedLimit > 0) {
          filters.limit = parsedLimit;
        }
      } else {
        filters.limit = 200; // Default to last 200 logs
      }

      const logs = getConsoleLogs(filters);
      res.json(logs);
    } catch (error) {
      console.error('Error fetching console logs:', error);
      res.status(500).json({ error: 'Failed to fetch console logs' });
    }
  });

  // Get trading hotspots analysis (when does the bot trade most?)
  app.get('/api/trading-hotspots/:strategyId', async (req, res) => {
    try {
      // Use SAME data source as P&L chart - fetch directly from exchange API
      const { fetchRealizedPnlEvents } = await import('./exchange-sync');
      const startTime = 1760635140000; // Same cutoff as P&L chart: Oct 16, 2025 at 17:19:00 UTC

      const pnlResult = await fetchRealizedPnlEvents({ startTime });

      if (!pnlResult.success || !pnlResult.events || pnlResult.events.length === 0) {
        return res.json({
          hourlyDistribution: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
          dailyDistribution: Array.from({ length: 7 }, (_, i) => ({ day: i, count: 0 })),
          heatmapData: [],
          totalTrades: 0,
          peakHour: null,
          peakDay: null,
        });
      }

      // Sort by timestamp (oldest first)
      const sortedEvents = pnlResult.events.sort((a: any, b: any) => a.time - b.time);

      // GROUP EVENTS INTO POSITIONS (same logic as P&L chart)
      // Events with same symbol within 10 seconds = same position (multiple DCA layers closing)
      const consolidatedPositions: any[] = [];
      let currentPosition: any = null;

      for (const event of sortedEvents) {
        const shouldStartNewPosition = !currentPosition ||
          currentPosition.symbol !== event.symbol ||
          event.time - currentPosition.time > 10000; // 10 seconds

        if (shouldStartNewPosition) {
          if (currentPosition) {
            consolidatedPositions.push(currentPosition);
          }
          currentPosition = {
            symbol: event.symbol,
            time: event.time, // Use timestamp of first event in the position
          };
        } else {
          // Continue grouping into current position (don't update timestamp)
        }
      }

      // Push the last position
      if (currentPosition) {
        consolidatedPositions.push(currentPosition);
      }

      if (consolidatedPositions.length === 0) {
        return res.json({
          hourlyDistribution: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
          dailyDistribution: Array.from({ length: 7 }, (_, i) => ({ day: i, count: 0 })),
          heatmapData: [],
          totalTrades: 0,
          peakHour: null,
          peakDay: null,
        });
      }

      // Analyze consolidated positions by hour and day
      const hourCounts = new Map<number, number>();
      const dayCounts = new Map<number, number>();
      const heatmap = new Map<string, number>(); // "day-hour" -> count

      consolidatedPositions.forEach(position => {
        // Convert to Pacific Time (same as P&L chart display)
        const utcDate = new Date(position.time);
        const pacificDateStr = utcDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const pacificDate = new Date(pacificDateStr);

        const hour = pacificDate.getHours(); // 0-23 in Pacific Time
        const day = pacificDate.getDay(); // 0-6 (Sunday-Saturday) in Pacific Time

        // Hour distribution
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);

        // Day distribution
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1);

        // Heatmap data (day x hour grid)
        const key = `${day}-${hour}`;
        heatmap.set(key, (heatmap.get(key) || 0) + 1);
      });

      // Convert to arrays for frontend
      const hourlyDistribution = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: hourCounts.get(hour) || 0,
      }));

      const dailyDistribution = Array.from({ length: 7 }, (_, day) => ({
        day,
        dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day],
        count: dayCounts.get(day) || 0,
      }));

      // Heatmap: array of { day, hour, count }
      const heatmapData = [];
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const key = `${day}-${hour}`;
          const count = heatmap.get(key) || 0;
          if (count > 0) {
            heatmapData.push({
              day,
              hour,
              count,
              dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day],
            });
          }
        }
      }

      // Find peak times
      const peakHourEntry = [...hourCounts.entries()].reduce((max, curr) =>
        curr[1] > max[1] ? curr : max, [0, 0]
      );
      const peakDayEntry = [...dayCounts.entries()].reduce((max, curr) =>
        curr[1] > max[1] ? curr : max, [0, 0]
      );

      res.json({
        hourlyDistribution,
        dailyDistribution,
        heatmapData,
        totalTrades: consolidatedPositions.length,
        peakHour: peakHourEntry[1] > 0 ? { hour: peakHourEntry[0], count: peakHourEntry[1] } : null,
        peakDay: peakDayEntry[1] > 0 ? {
          day: peakDayEntry[0],
          dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][peakDayEntry[0]],
          count: peakDayEntry[1]
        } : null,
      });
    } catch (error) {
      console.error('Error fetching trading hotspots:', error);
      res.status(500).json({ error: 'Failed to fetch trading hotspots' });
    }
  });

  // Get realized P&L events from exchange (actual closed trades)
  app.get('/api/realized-pnl-events', async (req, res) => {
    try {
      const { fetchRealizedPnlEvents } = await import('./exchange-sync');
      
      const { startTime, endTime } = req.query;
      
      const params: { startTime?: number; endTime?: number } = {};
      
      if (startTime) {
        const timestamp = parseInt(startTime as string);
        if (isNaN(timestamp)) {
          return res.status(400).json({ error: 'Invalid startTime parameter' });
        }
        params.startTime = timestamp;
      }
      
      if (endTime) {
        const timestamp = parseInt(endTime as string);
        if (isNaN(timestamp)) {
          return res.status(400).json({ error: 'Invalid endTime parameter' });
        }
        params.endTime = timestamp;
      }

      const result = await fetchRealizedPnlEvents(params);
      
      if (!result.success) {
        return res.status(500).json({ error: result.error || 'Failed to fetch P&L events' });
      }
      
      res.json({
        success: true,
        events: result.events,
        total: result.total,
        count: result.count,
        dateRange: result.dateRange
      });
    } catch (error) {
      console.error('Error fetching realized P&L events:', error);
      res.status(500).json({ error: 'Failed to fetch realized P&L events' });
    }
  });

  // Get all trades with database details when available
  // CONSOLIDATES multiple P&L events within 10 seconds (same as chart data)
  app.get('/api/all-trades', async (req, res) => {
    try {
      const { getTradeHistory } = await import('./trade-history-service');

      // Fetch ALL P&L events from exchange (Oct 16 onwards - excludes testing period)
      // Uses cached service to prevent rate limiting
      const startTime = 1760635140000; // Oct 16, 2025 at 17:19:00 UTC (first deposit)
      const result = await getTradeHistory({ startTime, endTime: Date.now() });

      if (!result.success) {
        return res.status(500).json({ error: result.error || 'Failed to fetch trades' });
      }

      // Sort events by timestamp (oldest first) for consolidation
      const sortedEvents = result.events.sort((a: any, b: any) => a.time - b.time);

      // GROUP EVENTS INTO CONSOLIDATED POSITIONS
      // Events with same symbol within 10 seconds = same position (multiple DCA layers closing)
      // This matches the chart data consolidation logic
      const consolidatedPositions: any[] = [];
      let currentPosition: any = null;

      for (const event of sortedEvents) {
        const pnl = parseFloat(event.income || '0');

        // Check if this event belongs to the current position being built
        const shouldMerge = currentPosition &&
          currentPosition.symbol === event.symbol &&
          Math.abs(event.time - currentPosition.timestamp) <= 10000; // Within 10 seconds

        if (shouldMerge) {
          // Merge this layer into the current position
          currentPosition.pnl += pnl;
          currentPosition.layerCount += 1;
          // Update timestamp to latest layer
          currentPosition.timestamp = Math.max(currentPosition.timestamp, event.time);
          currentPosition.tradeIds.push(event.tradeId);
        } else {
          // Start a new position
          if (currentPosition) {
            consolidatedPositions.push(currentPosition);
          }
          currentPosition = {
            symbol: event.symbol,
            timestamp: event.time,
            pnl: pnl,
            layerCount: 1,
            tradeIds: [event.tradeId],
          };
        }
      }

      // Don't forget the last position
      if (currentPosition) {
        consolidatedPositions.push(currentPosition);
      }

      // Get all closed positions from database
      const dbPositions = await db
        .select()
        .from(positions)
        .where(eq(positions.isOpen, false))
        .orderBy(desc(positions.closedAt));

      // Match consolidated positions with database positions
      const trades = consolidatedPositions.map((position, index) => {
        const eventDate = new Date(position.timestamp);
        const eventPnL = position.pnl;

        // Strategy 1: Exact match by symbol + close time + P&L (if P&L stored)
        let matchedPosition = dbPositions.find(p => {
          if (!p.closedAt || p.symbol !== position.symbol) return false;
          if (p.realizedPnl === null) return false; // Skip if P&L not stored

          const positionDate = new Date(p.closedAt);
          const timeDiff = Math.abs(eventDate.getTime() - positionDate.getTime());
          const pnlDiff = Math.abs(eventPnL - parseFloat(p.realizedPnl));

          // Match if within 10 minutes and P&L difference < $0.01
          return timeDiff < 600000 && pnlDiff < 0.01;
        });

        // Strategy 2: Match by symbol + close time (wider window, ignoring P&L)
        if (!matchedPosition) {
          matchedPosition = dbPositions.find(p => {
            if (!p.closedAt || p.symbol !== position.symbol) return false;

            const positionDate = new Date(p.closedAt);
            const timeDiff = Math.abs(eventDate.getTime() - positionDate.getTime());

            // Match if within 1 hour
            return timeDiff < 3600000;
          });
        }

        // Strategy 3: Match by symbol + P&L (if both exist), ignoring time
        if (!matchedPosition) {
          matchedPosition = dbPositions.find(p => {
            if (p.symbol !== position.symbol) return false;
            if (p.realizedPnl === null) return false;

            const pnlDiff = Math.abs(eventPnL - parseFloat(p.realizedPnl));

            // Match if P&L difference < $0.01
            return pnlDiff < 0.01;
          });
        }

        // Strategy 4: Last resort - just match by symbol and find closest time
        if (!matchedPosition) {
          const symbolMatches = dbPositions.filter(p =>
            p.symbol === position.symbol && p.closedAt
          );

          if (symbolMatches.length > 0) {
            // Find the one with closest close time
            matchedPosition = symbolMatches.reduce((closest, p) => {
              const pDate = new Date(p.closedAt!);
              const cDate = new Date(closest.closedAt!);
              const pDiff = Math.abs(eventDate.getTime() - pDate.getTime());
              const cDiff = Math.abs(eventDate.getTime() - cDate.getTime());
              return pDiff < cDiff ? p : closest;
            });

            // Only use if within 24 hours
            const timeDiff = Math.abs(eventDate.getTime() - new Date(matchedPosition.closedAt!).getTime());
            if (timeDiff > 86400000) {
              matchedPosition = undefined;
            }
          }
        }

        return {
          tradeNumber: index + 1,
          timestamp: position.timestamp,
          date: eventDate.toISOString(),
          symbol: position.symbol,
          pnl: eventPnL,
          tradeId: position.tradeIds[0], // First trade ID from consolidated layers
          // Database details (if available)
          hasDetails: !!matchedPosition,
          positionId: matchedPosition?.id,
          side: matchedPosition?.side,
          quantity: matchedPosition?.totalQuantity,
          entryPrice: matchedPosition?.avgEntryPrice,
          openedAt: matchedPosition?.openedAt,
          layersFilled: matchedPosition?.layersFilled || position.layerCount, // Use DB layers if available, else consolidated count
        };
      });

      // Sort trades by timestamp (newest first)
      trades.sort((a, b) => b.timestamp - a.timestamp);

      res.json({
        success: true,
        trades,
        total: trades.length,
        withDetails: trades.filter(t => t.hasDetails).length,
        withoutDetails: trades.filter(t => !t.hasDetails).length,
      });
    } catch (error) {
      console.error('Error fetching all trades:', error);
      res.status(500).json({ error: 'Failed to fetch all trades' });
    }
  });

  // Telegram notification routes
  app.post("/api/telegram/test", async (req, res) => {
    try {
      const { telegramService } = await import('./telegram-service');
      const success = await telegramService.sendTestMessage();
      
      if (success) {
        res.json({ success: true, message: 'Test message sent successfully' });
      } else {
        res.status(500).json({ error: 'Failed to send test message - check server logs' });
      }
    } catch (error: any) {
      console.error('❌ Error sending test message:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/telegram/daily-report", async (req, res) => {
    try {
      const { strategyId } = req.body;
      
      if (!strategyId) {
        return res.status(400).json({ error: 'strategyId is required' });
      }
      
      const { telegramService } = await import('./telegram-service');
      await telegramService.sendDailyReport(strategyId);
      
      res.json({ success: true, message: 'Daily report sent successfully' });
    } catch (error: any) {
      console.error('❌ Error sending daily report:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/telegram/scheduler/start", async (req, res) => {
    try {
      const { strategyId } = req.body;
      
      if (!strategyId) {
        return res.status(400).json({ error: 'strategyId is required' });
      }
      
      const { telegramScheduler } = await import('./telegram-scheduler');
      telegramScheduler.start(strategyId);
      
      res.json({ success: true, message: 'Daily report scheduler started' });
    } catch (error: any) {
      console.error('❌ Error starting scheduler:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/telegram/scheduler/stop", async (req, res) => {
    try {
      const { telegramScheduler } = await import('./telegram-scheduler');
      telegramScheduler.stop();
      
      res.json({ success: true, message: 'Daily report scheduler stopped' });
    } catch (error: any) {
      console.error('❌ Error stopping scheduler:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/telegram/scheduler/status", async (req, res) => {
    try {
      const { telegramScheduler } = await import('./telegram-scheduler');
      const status = telegramScheduler.getStatus();
      
      res.json(status);
    } catch (error: any) {
      console.error('❌ Error getting scheduler status:', error);
      res.status(500).json({ error: error.message });
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
      console.error(`❌ Failed to create listen key (HTTP ${response.status}):`, errorText || '(empty response)');
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

// Start keepalive interval (every 1 minute)
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
  }, 60 * 1000); // Every 1 minute

  console.log('⏰ Keepalive scheduled every 1 minute');
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
            const usdtBalance = balances.find((b: any) => b.a === 'USDF');
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
