import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, X, TrendingUp, RotateCcw } from "lucide-react";

interface Asset {
  symbol: string;
  name: string;
  category: "major" | "altcoin" | "meme" | "stock" | "other";
  leverage?: string;
}

interface AssetSelectorProps {
  selectedAssets: string[];
  onAssetsChange: (assets: string[]) => void;
}

// Available assets on Aster DEX based on research
const AVAILABLE_ASSETS: Asset[] = [
  // Major cryptocurrencies
  { symbol: "BTC/USDT", name: "Bitcoin", category: "major", leverage: "1001x" },
  { symbol: "ETH/USDT", name: "Ethereum", category: "major", leverage: "1001x" },
  { symbol: "SOL/USDT", name: "Solana", category: "major", leverage: "100x" },
  { symbol: "BNB/USDT", name: "BNB", category: "major", leverage: "100x" },
  { symbol: "XRP/USDT", name: "Ripple", category: "major", leverage: "100x" },
  { symbol: "LTC/USDT", name: "Litecoin", category: "major", leverage: "50x" },
  { symbol: "DOGE/USDT", name: "Dogecoin", category: "altcoin", leverage: "50x" },
  
  // Native and other tokens
  { symbol: "ASTER/USDT", name: "Aster", category: "other", leverage: "100x" },
  { symbol: "FORM/USDT", name: "Four", category: "other", leverage: "50x" },
  { symbol: "CDL/USDT", name: "Creditlink", category: "other", leverage: "50x" },
  { symbol: "USD1/USDT", name: "World Liberty Financial USD", category: "other", leverage: "50x" },
  
  // Meme coins
  { symbol: "SHIB/USDT", name: "Shiba Inu", category: "meme", leverage: "50x" },
  { symbol: "PEPE/USDT", name: "Pepe", category: "meme", leverage: "50x" },
  { symbol: "FLOKI/USDT", name: "Floki", category: "meme", leverage: "50x" },
  { symbol: "FARTCOIN/USDT", name: "Fartcoin", category: "meme", leverage: "50x" },
  
  // Tokenized stocks
  { symbol: "AAPL/USDT", name: "Apple Inc.", category: "stock", leverage: "50x" },
  { symbol: "MSFT/USDT", name: "Microsoft", category: "stock", leverage: "50x" },
  { symbol: "AMZN/USDT", name: "Amazon", category: "stock", leverage: "50x" },
  { symbol: "NVDA/USDT", name: "NVIDIA", category: "stock", leverage: "50x" },
  { symbol: "META/USDT", name: "Meta Platforms", category: "stock", leverage: "50x" },
  { symbol: "TSLA/USDT", name: "Tesla", category: "stock", leverage: "50x" },
];

const CATEGORY_COLORS = {
  major: "bg-chart-1 text-chart-1-foreground",
  altcoin: "bg-chart-4 text-chart-4-foreground",
  meme: "bg-chart-3 text-chart-3-foreground", 
  stock: "bg-chart-5 text-chart-5-foreground",
  other: "bg-chart-2 text-chart-2-foreground"
};

export default function AssetSelector({ selectedAssets, onAssetsChange }: AssetSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSearchTerm, setActiveSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filteredAssets = AVAILABLE_ASSETS.filter(asset => {
    const matchesSearch = activeSearchTerm === "" || 
                         asset.symbol.toLowerCase().includes(activeSearchTerm.toLowerCase()) ||
                         asset.name.toLowerCase().includes(activeSearchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || asset.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleAddAsset = (symbol: string) => {
    if (!selectedAssets.includes(symbol)) {
      onAssetsChange([...selectedAssets, symbol]);
    }
  };

  const handleRemoveAsset = (symbol: string) => {
    onAssetsChange(selectedAssets.filter(s => s !== symbol));
  };

  const handleSearch = () => {
    setActiveSearchTerm(searchTerm);
  };

  const handleClearSearch = () => {
    setSearchTerm("");
    setActiveSearchTerm("");
    setSelectedCategory("all");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const categories = ["all", "major", "altcoin", "meme", "stock", "other"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Asset Selection
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose which assets to monitor for liquidations
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selected Assets */}
        {selectedAssets.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Selected Assets ({selectedAssets.length})</h4>
            <div className="flex flex-wrap gap-2">
              {selectedAssets.map(symbol => (
                <Badge
                  key={symbol}
                  variant="default"
                  className="flex items-center gap-1"
                  data-testid={`badge-selected-${symbol.replace('/', '-')}`}
                >
                  {symbol}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => handleRemoveAsset(symbol)}
                    data-testid={`button-remove-${symbol.replace('/', '-')}`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search assets (e.g., BTC, Apple, Pepe)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={handleKeyPress}
                className="pl-10"
                data-testid="input-asset-search"
              />
            </div>
            <Button
              onClick={handleSearch}
              disabled={!searchTerm.trim()}
              data-testid="button-search"
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={handleClearSearch}
              disabled={!activeSearchTerm && selectedCategory === "all"}
              data-testid="button-show-all"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Show All
            </Button>
          </div>
          {activeSearchTerm && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" data-testid="badge-active-search">
                Searching: "{activeSearchTerm}"
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveSearchTerm("")}
                className="h-6 w-6 p-0"
                data-testid="button-clear-search-term"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2">
          {categories.map(category => (
            <Button
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(category)}
              data-testid={`button-category-${category}`}
            >
              {category === "all" ? "All" : category.charAt(0).toUpperCase() + category.slice(1)}
            </Button>
          ))}
        </div>

        {/* Available Assets */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Available Assets</h4>
          <ScrollArea className="h-64 border rounded-md">
            <div className="p-2 space-y-1">
              {filteredAssets.map(asset => {
                const isSelected = selectedAssets.includes(asset.symbol);
                return (
                  <div
                    key={asset.symbol}
                    className="flex items-center justify-between p-2 hover-elevate rounded-md border"
                    data-testid={`asset-item-${asset.symbol.replace('/', '-')}`}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{asset.symbol}</span>
                          <Badge
                            variant="secondary"
                            className={`text-xs ${CATEGORY_COLORS[asset.category]}`}
                          >
                            {asset.category}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          <span>{asset.name}</span>
                          {asset.leverage && (
                            <span className="text-chart-1">Max: {asset.leverage}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant={isSelected ? "destructive" : "default"}
                      size="sm"
                      onClick={() => isSelected ? handleRemoveAsset(asset.symbol) : handleAddAsset(asset.symbol)}
                      data-testid={`button-toggle-${asset.symbol.replace('/', '-')}`}
                    >
                      {isSelected ? (
                        <X className="h-4 w-4" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                );
              })}
              {filteredAssets.length === 0 && (
                <div className="text-center py-8 text-muted-foreground" data-testid="text-no-assets">
                  No assets found matching your search
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAssetsChange(AVAILABLE_ASSETS.filter(a => a.category === "major").map(a => a.symbol))}
            data-testid="button-select-major"
          >
            Select Major Crypto
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAssetsChange([])}
            disabled={selectedAssets.length === 0}
            data-testid="button-clear-all"
          >
            Clear All
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}