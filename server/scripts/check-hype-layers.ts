import { db } from '../db';
import { positions, positionLayers } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

async function checkHypeLayers() {
  console.log('🔍 Checking HYPE position layers...\n');
  
  // Find HYPE position
  const hypePositions = await db.select()
    .from(positions)
    .where(and(
      eq(positions.symbol, 'HYPEUSDT'),
      eq(positions.isOpen, true)
    ));
  
  if (hypePositions.length === 0) {
    console.log('❌ No open HYPE position found');
    return;
  }
  
  const hypePos = hypePositions[0];
  console.log('📊 HYPE Position:');
  console.log(`   ID: ${hypePos.id}`);
  console.log(`   Side: ${hypePos.side}`);
  console.log(`   Total Quantity: ${hypePos.totalQuantity}`);
  console.log(`   Avg Entry: $${hypePos.avgEntryPrice}`);
  console.log(`   Total Notional: $${(parseFloat(hypePos.totalQuantity) * parseFloat(hypePos.avgEntryPrice)).toFixed(2)}`);
  console.log(`   Layers Filled: ${hypePos.layersFilled}`);
  console.log(`   Max Layers: ${hypePos.maxLayers}\n`);
  
  // Get layer details
  const layers = await db.select()
    .from(positionLayers)
    .where(eq(positionLayers.positionId, hypePos.id))
    .orderBy(desc(positionLayers.layerNumber));
  
  if (layers.length > 0) {
    console.log('📋 Individual Layers:');
    for (const layer of layers) {
      const layerNotional = parseFloat(layer.quantity) * parseFloat(layer.entryPrice);
      console.log(`   Layer ${layer.layerNumber}: ${layer.quantity} @ $${layer.entryPrice} = $${layerNotional.toFixed(2)} notional`);
    }
    
    const totalFromLayers = layers.reduce((sum, l) => sum + (parseFloat(l.quantity) * parseFloat(l.entryPrice)), 0);
    console.log(`\n💰 Total notional from layers: $${totalFromLayers.toFixed(2)}`);
  } else {
    console.log('⚠️  No layer records found (position created before layer tracking was implemented)');
  }
}

checkHypeLayers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
