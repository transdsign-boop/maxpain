import { db } from '../db';
import { positionLayers } from '@shared/schema';

async function countPositionLayers() {
  console.log('🔍 Counting position_layers records...\n');
  
  // Get all position layers
  const allLayers = await db.select().from(positionLayers);
  
  console.log(`📊 Total position_layers records: ${allLayers.length}\n`);
  
  if (allLayers.length > 0) {
    // Show some sample data
    console.log('📋 Sample records (first 5):');
    for (let i = 0; i < Math.min(5, allLayers.length); i++) {
      const layer = allLayers[i];
      console.log(`   Layer ${layer.layerNumber} - Position: ${layer.positionId.slice(0, 8)}... Entry: $${layer.entryPrice}`);
    }
    
    // Group by position to see layer distribution
    const layersByPosition = new Map<string, number>();
    for (const layer of allLayers) {
      layersByPosition.set(
        layer.positionId, 
        (layersByPosition.get(layer.positionId) || 0) + 1
      );
    }
    
    const positionsWithLayers = layersByPosition.size;
    const maxLayers = Math.max(...Array.from(layersByPosition.values()));
    const avgLayers = allLayers.length / positionsWithLayers;
    
    console.log(`\n📈 Layer Statistics:`);
    console.log(`   - Positions with layers: ${positionsWithLayers}`);
    console.log(`   - Max layers per position: ${maxLayers}`);
    console.log(`   - Avg layers per position: ${avgLayers.toFixed(2)}`);
  } else {
    console.log('⚠️  No position_layers records found in the database.');
  }
}

countPositionLayers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
