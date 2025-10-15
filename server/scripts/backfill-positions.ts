#!/usr/bin/env tsx
import { db } from '../db';
import { positions, fills } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';
import { fetchAllAccountTrades, fetchRealizedPnlEvents } from '../exchange-sync';
import { storage } from '../storage';

// Group trades into positions (entry and exit pairs)
// Handles BOTH positionSide (One-way Mode) by tracking net position
function groupTradesIntoPositions(trades: Array<{
  symbol: string;
  side: 'BUY' | 'SELL';
  price: string;
  qty: string;
  commission: string;
  time: number;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  realizedPnl: string;
}>) {
  // Group by symbol first
  const bySymbol = new Map<string, typeof trades>();
  
  for (const trade of trades) {
    if (!bySymbol.has(trade.symbol)) {
      bySymbol.set(trade.symbol, []);
    }
    bySymbol.get(trade.symbol)!.push(trade);
  }
  
  // Sort each symbol's trades by time
  for (const trades of bySymbol.values()) {
    trades.sort((a, b) => a.time - b.time);
  }

  const groupedPositions: Array<{
    symbol: string;
    side: 'long' | 'short';
    entryTrades: typeof trades;
    exitTrades: typeof trades;
    openedAt: Date;
    closedAt: Date;
    avgEntryPrice: number;
    avgExitPrice: number;
    totalQuantity: number;
    realizedPnl: number;
    totalFees: number;
  }> = [];

  // Process each symbol's trades
  for (const [symbol, symbolTrades] of bySymbol.entries()) {
    let netPosition = 0;
    let entryTrades: typeof trades = [];
    let exitTrades: typeof trades = [];
    let currentSide: 'long' | 'short' | null = null;
    
    for (const trade of symbolTrades) {
      const qty = parseFloat(trade.qty);
      const isBuy = trade.side === 'BUY';
      
      // Update net position
      const prevNetPosition = netPosition;
      netPosition += isBuy ? qty : -qty;
      
      // Determine position side from net position direction
      const newSide: 'long' | 'short' | null = 
        netPosition > 0.00001 ? 'long' :
        netPosition < -0.00001 ? 'short' : null;
      
      // Detect position transitions
      const wasFlat = Math.abs(prevNetPosition) < 0.00001;
      const nowFlat = Math.abs(netPosition) < 0.00001;
      const directionChanged = (prevNetPosition > 0 && netPosition < 0) || 
                               (prevNetPosition < 0 && netPosition > 0);
      
      if (wasFlat && newSide) {
        // Opening new position from flat
        currentSide = newSide;
        entryTrades = [trade];
        exitTrades = [];
      } else if (currentSide && !nowFlat && newSide === currentSide) {
        // Adding to existing position
        if ((currentSide === 'long' && isBuy) || (currentSide === 'short' && !isBuy)) {
          entryTrades.push(trade);
        } else {
          // Reducing position (partial close)
          exitTrades.push(trade);
        }
      } else if (currentSide && nowFlat) {
        // Position fully closed
        exitTrades.push(trade);
        
        const entryQty = entryTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0);
        const exitQty = exitTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0);
        const entryValue = entryTrades.reduce((sum, t) => 
          sum + (parseFloat(t.price) * parseFloat(t.qty)), 0);
        const exitValue = exitTrades.reduce((sum, t) => 
          sum + (parseFloat(t.price) * parseFloat(t.qty)), 0);
        
        const totalPnl = exitTrades.reduce((sum, t) => 
          sum + parseFloat(t.realizedPnl || '0'), 0);
        const totalFees = [...entryTrades, ...exitTrades].reduce((sum, t) => 
          sum + parseFloat(t.commission || '0'), 0);
        
        if (entryQty > 0 && exitQty > 0) {
          groupedPositions.push({
            symbol,
            side: currentSide,
            entryTrades: [...entryTrades],
            exitTrades: [...exitTrades],
            openedAt: new Date(entryTrades[0].time),
            closedAt: new Date(exitTrades[exitTrades.length - 1].time),
            avgEntryPrice: entryValue / entryQty,
            avgExitPrice: exitValue / exitQty,
            totalQuantity: Math.min(entryQty, exitQty),
            realizedPnl: totalPnl,
            totalFees,
          });
        }
        
        entryTrades = [];
        exitTrades = [];
        currentSide = null;
      } else if (directionChanged) {
        // Direction flip - close old position and open new one
        // This shouldn't happen often in normal trading
        entryTrades = [trade];
        exitTrades = [];
        currentSide = newSide;
      }
    }
  }
  
  return groupedPositions;
}

async function backfillPositions() {
  try {
    const sessionId = '0e2da39e-7b40-4f20-9f34-324a6bcc48f8';
    
    // Step 1: Get the date range from P&L events
    console.log('📊 Fetching P&L events to determine date range...');
    const startTime = new Date('2025-10-03T00:00:00Z').getTime();
    const endTime = Date.now();
    
    const pnlResult = await fetchRealizedPnlEvents({ startTime, endTime });
    
    if (!pnlResult.success) {
      console.error('❌ Failed to fetch P&L events:', pnlResult.error);
      return;
    }
    
    console.log(`✅ Found ${pnlResult.count} P&L events from exchange`);
    
    // Step 2: Get existing positions from database
    const existingPositions = await db
      .select()
      .from(positions)
      .where(and(
        eq(positions.sessionId, sessionId),
        eq(positions.isOpen, false)
      ));
    
    console.log(`📦 Found ${existingPositions.length} existing positions in database`);
    console.log(`🔍 Missing: ${pnlResult.count - existingPositions.length} positions to backfill`);
    
    // Step 3: Fetch ALL trades from exchange
    console.log('\n🔄 Fetching all account trades from exchange...');
    const tradesResult = await fetchAllAccountTrades({ startTime, endTime });
    
    if (!tradesResult.success) {
      console.error('❌ Failed to fetch trades:', tradesResult.error);
      return;
    }
    
    console.log(`✅ Fetched ${tradesResult.trades.length} trades from exchange`);
    
    // Step 4: Debug trade data structure
    console.log('\n🔍 Analyzing trade data structure...');
    const sampleTrade = tradesResult.trades[0];
    console.log('Sample trade:', JSON.stringify(sampleTrade, null, 2));
    
    const positionSides = new Set(tradesResult.trades.map(t => t.positionSide));
    console.log('Unique positionSide values:', Array.from(positionSides));
    
    const sidesWithTrades = Array.from(positionSides).map(ps => ({
      positionSide: ps,
      count: tradesResult.trades.filter(t => t.positionSide === ps).length
    }));
    console.log('Trades by positionSide:', sidesWithTrades);
    
    // Step 4: Group trades into positions
    console.log('\n🔄 Grouping trades into positions...');
    const reconPositions = groupTradesIntoPositions(tradesResult.trades);
    console.log(`✅ Reconstructed ${reconPositions.length} positions from trades`);
    
    // Step 5: Find missing positions
    console.log('\n🔍 Identifying missing positions...');
    const existingKeys = new Set(
      existingPositions.map(p => 
        `${p.symbol}-${p.side}-${new Date(p.closedAt!).getTime()}`
      )
    );
    
    const missingPositions = reconPositions.filter(rp => {
      const key = `${rp.symbol}-${rp.side}-${rp.closedAt.getTime()}`;
      return !existingKeys.has(key);
    });
    
    console.log(`📋 Found ${missingPositions.length} missing positions to create`);
    
    // Step 6: Create missing positions
    let createdCount = 0;
    const strategy = await storage.getStrategyBySession(sessionId);
    const leverage = strategy?.leverage || 1;
    
    for (const mp of missingPositions) {
      console.log(`\n➕ Creating position: ${mp.symbol} ${mp.side} qty=${mp.totalQuantity.toFixed(4)} P&L=${mp.realizedPnl.toFixed(4)}`);
      
      // Create position
      const position = await storage.createPosition({
        sessionId,
        symbol: mp.symbol,
        side: mp.side,
        totalQuantity: mp.totalQuantity.toFixed(8),
        avgEntryPrice: mp.avgEntryPrice.toFixed(8),
        totalCost: (mp.totalQuantity * mp.avgEntryPrice).toFixed(8),
        unrealizedPnl: '0',
        realizedPnl: mp.realizedPnl.toFixed(8),
        layersFilled: 1,
        maxLayers: 1,
        leverage,
        isOpen: false,
      });
      
      // Update timestamps
      await db.update(positions)
        .set({
          openedAt: mp.openedAt,
          closedAt: mp.closedAt,
        })
        .where(eq(positions.id, position.id));
      
      // Create fills for entry trades
      for (let i = 0; i < mp.entryTrades.length; i++) {
        const trade = mp.entryTrades[i];
        await storage.applyFill({
          orderId: `backfill-entry-${trade.time}-${i}`,
          sessionId,
          positionId: position.id,
          symbol: trade.symbol,
          side: mp.side === 'long' ? 'buy' : 'sell',
          quantity: trade.qty,
          price: trade.price,
          value: (parseFloat(trade.price) * parseFloat(trade.qty)).toFixed(8),
          fee: trade.commission,
          layerNumber: i + 1,
          filledAt: new Date(trade.time),
        });
      }
      
      // Create fills for exit trades
      for (let i = 0; i < mp.exitTrades.length; i++) {
        const trade = mp.exitTrades[i];
        await storage.applyFill({
          orderId: `backfill-exit-${trade.time}-${i}`,
          sessionId,
          positionId: position.id,
          symbol: trade.symbol,
          side: mp.side === 'long' ? 'sell' : 'buy',
          quantity: trade.qty,
          price: trade.price,
          value: (parseFloat(trade.price) * parseFloat(trade.qty)).toFixed(8),
          fee: trade.commission,
          layerNumber: mp.entryTrades.length + i + 1,
          filledAt: new Date(trade.time),
        });
      }
      
      createdCount++;
      console.log(`  ✓ Created position with ${mp.entryTrades.length} entry fills and ${mp.exitTrades.length} exit fills`);
    }
    
    console.log(`\n✅ Backfill complete! Created ${createdCount} positions`);
    
    // Verify final count
    const finalPositions = await db
      .select()
      .from(positions)
      .where(and(
        eq(positions.sessionId, sessionId),
        eq(positions.isOpen, false)
      ));
    
    console.log(`📊 Final database count: ${finalPositions.length} positions`);
    console.log(`🎯 Target P&L events: ${pnlResult.count} events`);
    
    if (finalPositions.length < pnlResult.count) {
      console.warn(`⚠️  Still missing ${pnlResult.count - finalPositions.length} positions`);
      console.warn('   This may be due to partial positions or trades that haven\'t fully closed yet');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

backfillPositions();
