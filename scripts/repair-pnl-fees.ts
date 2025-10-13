#!/usr/bin/env tsx
/**
 * Repair Script: Recalculate P&L and totalFees for all closed positions
 * 
 * This script fetches all closed positions from the database and recalculates
 * their realizedPnl and totalFees using the corrected logic from fills data.
 */

import { DatabaseStorage } from '../server/storage.js';

const DEFAULT_USER_ID = "personal_user";

async function repairPnlAndFees() {
  console.log('🔧 Starting P&L and fees repair for all closed positions...');
  
  const storage = new DatabaseStorage();
  
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
  console.log('\n📋 Sample Discrepancies:');
  console.table(sampleDiscrepancies);
  
  process.exit(0);
}

repairPnlAndFees().catch((error) => {
  console.error('❌ Repair failed:', error);
  process.exit(1);
});
