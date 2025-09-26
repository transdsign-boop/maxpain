import AssetSelector from '../AssetSelector';
import { useState } from 'react';

export default function AssetSelectorExample() {
  const [selectedAssets, setSelectedAssets] = useState<string[]>(["BTC/USDT", "ETH/USDT"]);

  return (
    <div className="p-4 max-w-4xl">
      <AssetSelector 
        selectedAssets={selectedAssets}
        onAssetsChange={setSelectedAssets}
      />
    </div>
  );
}