import { db } from '../db';
import { positionLayers } from '@shared/schema';
import { asc, desc } from 'drizzle-orm';

async function checkLayerDates() {
  console.log('🔍 Checking position_layers date range...\n');
  
  // Get earliest layer
  const earliest = await db.select()
    .from(positionLayers)
    .orderBy(asc(positionLayers.createdAt))
    .limit(1);
  
  // Get latest layer
  const latest = await db.select()
    .from(positionLayers)
    .orderBy(desc(positionLayers.createdAt))
    .limit(1);
  
  if (earliest.length > 0 && latest.length > 0) {
    const earliestDate = earliest[0].createdAt;
    const latestDate = latest[0].createdAt;
    
    console.log(`📅 Date Range:`);
    console.log(`   Earliest: ${earliestDate.toISOString()}`);
    console.log(`   Latest:   ${latestDate.toISOString()}\n`);
    
    // Calculate duration
    const durationMs = latestDate.getTime() - earliestDate.getTime();
    const durationDays = Math.floor(durationMs / (1000 * 60 * 60 * 24));
    const durationHours = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    console.log(`⏱️  Duration: ${durationDays} days, ${durationHours} hours`);
    
    console.log(`\n📋 Earliest Layer:`);
    console.log(`   Position: ${earliest[0].positionId}`);
    console.log(`   Layer: ${earliest[0].layerNumber}`);
    console.log(`   Entry Price: $${earliest[0].entryPrice}`);
    
    console.log(`\n📋 Latest Layer:`);
    console.log(`   Position: ${latest[0].positionId}`);
    console.log(`   Layer: ${latest[0].layerNumber}`);
    console.log(`   Entry Price: $${latest[0].entryPrice}`);
  } else {
    console.log('⚠️  No position_layers records found');
  }
}

checkLayerDates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
