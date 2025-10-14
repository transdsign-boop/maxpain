import { db } from './server/db';
import { positions, tradeSessions, strategies } from './shared/schema';
import { eq, and } from 'drizzle-orm';

async function checkPositions() {
  try {
    // Get active strategy
    const activeStrategy = await db.select().from(strategies).where(eq(strategies.isActive, true)).limit(1);
    if (!activeStrategy.length) {
      console.log('No active strategy found');
      return;
    }

    console.log('Active Strategy:', {
      name: activeStrategy[0].name,
      maxLayers: activeStrategy[0].maxLayers,
      leverage: activeStrategy[0].leverage,
      dcaStartStepPercent: activeStrategy[0].dcaStartStepPercent,
      dcaSizeGrowth: activeStrategy[0].dcaSizeGrowth,
      dcaMaxRiskPercent: activeStrategy[0].dcaMaxRiskPercent,
    });

    // Get active session
    const activeSessions = await db.select().from(tradeSessions)
      .where(
        and(
          eq(tradeSessions.strategyId, activeStrategy[0].id),
          eq(tradeSessions.isActive, true)
        )
      )
      .limit(1);

    if (!activeSessions.length) {
      console.log('No active session found');
      return;
    }

    console.log('\nActive Session ID:', activeSessions[0].id);

    // Get ALL positions for this session
    const allPositions = await db.select().from(positions)
      .where(eq(positions.sessionId, activeSessions[0].id));

    console.log(`\nFound ${allPositions.length} total positions for this session`);
    
    const onlyOpen = allPositions.filter(p => p.status === 'open');
    console.log(`Found ${onlyOpen.length} open positions:\n`);

    if (onlyOpen.length === 0) {
      console.log('Checking ALL sessions for open positions...\n');
      const anyOpenPositions = await db.select().from(positions);
      const anyOpen = anyOpenPositions.filter(p => p.status === 'open');
      console.log(`Found ${anyOpen.length} open positions across all sessions:\n`);
      for (const pos of anyOpen) {
        console.log(`${pos.symbol} (${pos.side}) - Session: ${pos.sessionId}`);
        console.log(`  Status: ${pos.status}`);
        console.log(`  Reserved Risk: $${pos.reservedRiskDollars?.toFixed(2) || 'NULL'}`);
        console.log();
      }
      return;
    }

    for (const pos of onlyOpen) {
      console.log(`${pos.symbol} (${pos.side}):`);
      console.log(`  Filled Risk: $${pos.filledRiskDollars?.toFixed(2) || '0.00'} (${pos.filledRiskPercent?.toFixed(2) || '0.00'}%)`);
      console.log(`  Reserved Risk: $${pos.reservedRiskDollars?.toFixed(2) || 'NULL'} (${pos.reservedRiskPercent?.toFixed(2) || 'NULL'}%)`);
      console.log(`  Current Layers: ${pos.currentLayers || 1}`);
      console.log(`  Entry Price: $${pos.avgEntryPrice}`);
      console.log(`  Unrealized P&L: $${pos.unrealizedPnl || 0}`);
      console.log();
    }

    // Calculate total portfolio risk
    const totalFilledRisk = openPositions.reduce((sum, p) => sum + (p.filledRiskDollars || 0), 0);
    const totalReservedRisk = openPositions.reduce((sum, p) => sum + (p.reservedRiskDollars || 0), 0);
    
    console.log('Portfolio Summary:');
    console.log(`  Total Filled Risk: $${totalFilledRisk.toFixed(2)}`);
    console.log(`  Total Reserved Risk: $${totalReservedRisk.toFixed(2)}`);
    console.log(`  Max Portfolio Risk: ${activeStrategy[0].maxPortfolioRiskPercent}%`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkPositions();
