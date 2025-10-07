import { db } from './db';
import { strategies } from '../shared/schema';

async function findCredentials() {
  console.log('\n=== SEARCHING FOR API CREDENTIALS IN DATABASE ===\n');
  
  // Check all strategies for any API credentials
  const allStrategies = await db.select().from(strategies);
  
  console.log('STRATEGIES WITH CREDENTIALS:');
  let foundAny = false;
  let credentialsSource: any = null;
  
  for (const s of allStrategies) {
    const hasAster = s.asterApiKey && s.asterApiSecret;
    const hasBybit = s.bybitApiKey && s.bybitApiSecret;
    
    if (hasAster || hasBybit) {
      foundAny = true;
      if (!credentialsSource) credentialsSource = s;
      console.log(`\n- Strategy: ${s.name} (${s.id.substring(0, 8)}...)`);
      console.log(`  Active: ${s.isActive}, Mode: ${s.tradingMode}, Created: ${s.createdAt}`);
      if (hasAster) {
        console.log(`  ✓ Aster API Key: ${s.asterApiKey?.substring(0, 10)}...`);
        console.log(`  ✓ Aster Secret: ${s.asterApiSecret ? '[exists]' : '[missing]'}`);
      }
      if (hasBybit) {
        console.log(`  ✓ Bybit API Key: ${s.bybitApiKey?.substring(0, 10)}...`);
        console.log(`  ✓ Bybit Secret: ${s.bybitApiSecret ? '[exists]' : '[missing]'}`);
      }
    }
  }
  
  if (!foundAny) {
    console.log('❌ NO API CREDENTIALS FOUND IN ANY STRATEGY');
  } else if (credentialsSource) {
    console.log('\n\n💡 CREDENTIALS FOUND - Can copy to active strategy!');
    console.log(`Source: ${credentialsSource.id}`);
  }
}

findCredentials().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
