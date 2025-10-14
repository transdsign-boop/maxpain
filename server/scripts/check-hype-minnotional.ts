async function checkHypeMinNotional() {
  const response = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
  const data = await response.json();
  
  const hype = data.symbols.find((s: any) => s.symbol === 'HYPEUSDT');
  
  if (hype) {
    const minNotionalFilter = hype.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
    
    console.log('\n🔍 HYPEUSDT Exchange Limits:');
    console.log(`   Symbol: ${hype.symbol}`);
    console.log(`   MIN_NOTIONAL: $${minNotionalFilter?.notional || 'NOT FOUND'}`);
    
    // Compare with other symbols
    const compareSymbols = ['BTCUSDT', 'ASTERUSDT', 'FARTCOINUSDT', 'ETHUSDT'];
    console.log('\n📊 Comparison with other symbols:');
    
    for (const symName of compareSymbols) {
      const sym = data.symbols.find((s: any) => s.symbol === symName);
      const minNot = sym?.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
      console.log(`   ${symName}: $${minNot?.notional || 'N/A'}`);
    }
  } else {
    console.log('❌ HYPEUSDT not found');
  }
}

checkHypeMinNotional();
