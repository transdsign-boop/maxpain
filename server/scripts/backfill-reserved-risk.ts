/**
 * Backfill Reserved Risk for Existing Positions
 * 
 * This script calculates and stores the full DCA potential (reserved risk) for all
 * existing open positions that don't have reserved_risk_dollars populated.
 * 
 * Run with: npx tsx server/scripts/backfill-reserved-risk.ts
 */

import { storage } from '../storage';
import { calculateDCALevels, calculateATRPercent } from '../dca-calculator';
import type { Strategy, Position } from '@shared/schema';
import { db } from '../db';
import { strategies, tradeSessions } from '@shared/schema';
import { desc, eq } from 'drizzle-orm';
import { createHmac } from 'crypto';

interface LiveAccountBalance {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
}

async function fetchLiveAccountBalance(): Promise<number> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const apiSecret = process.env.ASTER_SECRET_KEY;

    if (!apiKey || !apiSecret) {
      throw new Error('Missing ASTER_API_KEY or ASTER_SECRET_KEY');
    }

    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = createHmac('sha256', apiSecret)
      .update(queryString)
      .digest('hex');

    const response = await fetch(
      `https://fapi.asterdex.com/fapi/v2/account?${queryString}&signature=${signature}`,
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch account: ${response.statusText}`);
    }

    const data = await response.json() as LiveAccountBalance;
    const balance = parseFloat(data.totalWalletBalance || '0');
    const unrealizedPnl = parseFloat(data.totalUnrealizedProfit || '0');
    return balance + unrealizedPnl;
  } catch (error) {
    console.error('❌ Failed to fetch live account balance:', error);
    throw error;
  }
}

async function backfillReservedRisk(strategyId?: string, sessionId?: string) {
  console.log('🔄 Starting reserved risk backfill for existing positions...\n');

  try {
    // Fetch current balance
    const currentBalance = await fetchLiveAccountBalance();
    console.log(`💰 Current balance: $${currentBalance.toFixed(2)}\n`);

    // Use provided IDs or auto-find from database
    let activeStrategy: Strategy | undefined;
    let session: { id: string } | undefined;

    if (strategyId && sessionId) {
      activeStrategy = await storage.getStrategy(strategyId);
      session = { id: sessionId };
      console.log(`✅ Using provided strategy: ${strategyId}, session: ${sessionId}\n`);
    } else {
      // Auto-find active strategy and latest session
      console.log('🔍 Auto-finding active strategy and session...\n');
      
      const activeStrategyRows = await db.select().from(strategies)
        .where(eq(strategies.isActive, true))
        .limit(1);
      
      if (activeStrategyRows.length === 0) {
        console.log('❌ No active strategy found');
        return;
      }
      
      activeStrategy = activeStrategyRows[0];
      console.log(`✅ Found active strategy: ${activeStrategy.name} (${activeStrategy.id})`);
      
      const latestSessionRows = await db.select().from(tradeSessions)
        .where(eq(tradeSessions.strategyId, activeStrategy.id))
        .orderBy(desc(tradeSessions.startedAt))
        .limit(1);
      
      if (latestSessionRows.length === 0) {
        console.log('❌ No session found for strategy');
        return;
      }
      
      session = latestSessionRows[0];
      console.log(`✅ Found latest session: ${session.id}\n`);
    }

    if (!activeStrategy) {
      console.log('⚠️  Strategy not found');
      return;
    }

    // Fetch all open positions
    const openPositions = await storage.getOpenPositions(session.id);
    console.log(`📊 Found ${openPositions.length} open positions\n`);

    // Filter positions without reserved risk
    const positionsToBackfill = openPositions.filter(
      pos => pos.reservedRiskDollars === null || pos.reservedRiskDollars === undefined
    );

    if (positionsToBackfill.length === 0) {
      console.log('✅ All positions already have reserved risk calculated. Nothing to backfill.');
      return;
    }

    console.log(`🎯 ${positionsToBackfill.length} positions need backfilling:\n`);

    for (const position of positionsToBackfill) {
      console.log(`\n📍 Processing ${position.symbol} ${position.side}:`);
      console.log(`   Position ID: ${position.id}`);
      console.log(`   Entry Price: $${position.avgEntryPrice}`);
      console.log(`   Quantity: ${position.totalQuantity}`);

      // Calculate ATR
      const atrPercent = await calculateATRPercent(position.symbol, parseFloat(activeStrategy.atrPeriod));
      console.log(`   ATR: ${atrPercent.toFixed(2)}%`);

      // Calculate full DCA potential
      const dcaResult = calculateDCALevels(activeStrategy, {
        entryPrice: parseFloat(position.avgEntryPrice),
        side: position.side as 'long' | 'short',
        currentBalance,
        leverage: parseFloat(activeStrategy.leverage),
        atrPercent,
      });

      const reservedRiskDollars = dcaResult.totalRiskDollars;
      const reservedRiskPercent = (reservedRiskDollars / currentBalance) * 100;

      console.log(`   💾 Calculated reserved risk: $${reservedRiskDollars.toFixed(2)} (${reservedRiskPercent.toFixed(1)}%)`);

      // Update position
      await storage.updatePosition(position.id, {
        reservedRiskDollars: reservedRiskDollars.toString(),
        reservedRiskPercent: reservedRiskPercent.toString(),
      });

      console.log(`   ✅ Updated position with reserved risk`);
    }

    console.log(`\n\n✅ Backfill complete! Updated ${positionsToBackfill.length} positions.`);
    
    // Show summary
    const allPositions = await storage.getOpenPositions(session.id);
    const stopLossPercent = parseFloat(activeStrategy.stopLossPercent.toString());
    
    const totalFilled = allPositions.reduce((sum, pos) => {
      const filled = parseFloat(pos.avgEntryPrice) * parseFloat(pos.totalQuantity) * (stopLossPercent / 100);
      return sum + filled;
    }, 0);
    
    const totalReserved = allPositions.reduce((sum, pos) => {
      return sum + parseFloat(pos.reservedRiskDollars || '0');
    }, 0);

    console.log(`\n📊 Portfolio Risk Summary:`);
    console.log(`   Filled Risk: $${totalFilled.toFixed(2)} (${((totalFilled / currentBalance) * 100).toFixed(1)}%)`);
    console.log(`   Reserved Risk: $${totalReserved.toFixed(2)} (${((totalReserved / currentBalance) * 100).toFixed(1)}%)`);

  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    throw error;
  }
}

// Run the script
const [strategyId, sessionId] = process.argv.slice(2);

backfillReservedRisk(strategyId, sessionId)
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
