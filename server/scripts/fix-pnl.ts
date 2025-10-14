#!/usr/bin/env tsx
import { db } from '../db';
import { positions, fills } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';
import { syncCompletedTrades } from '../exchange-sync';

async function fixPnL() {
  const sessionId = '0e2da39e-7b40-4f20-9f34-324a6bcc48f8';
  
  console.log('🔄 Fixing P&L for all closed positions...');
  
  // Step 1: Delete all closed positions and their fills
  console.log('🗑️ Deleting closed positions and their fills...');
  
  const closedPositions = await db.select()
    .from(positions)
    .where(and(
      eq(positions.sessionId, sessionId),
      eq(positions.isOpen, false)
    ));
  
  console.log(`Found ${closedPositions.length} closed positions to delete`);
  
  // Delete fills for closed positions
  for (const pos of closedPositions) {
    await db.delete(fills).where(eq(fills.positionId, pos.id));
  }
  
  // Delete closed positions
  await db.delete(positions).where(and(
    eq(positions.sessionId, sessionId),
    eq(positions.isOpen, false)
  ));
  
  console.log('✅ Deleted all closed positions and fills');
  
  // Step 2: Re-sync from exchange with corrected P&L calculation
  console.log('🔄 Re-syncing positions from exchange...');
  const result = await syncCompletedTrades(sessionId);
  
  if (result.success) {
    console.log(`✅ Successfully synced ${result.addedCount} positions with correct P&L`);
  } else {
    console.error(`❌ Sync failed: ${result.error}`);
  }
}

fixPnL().catch(console.error);
