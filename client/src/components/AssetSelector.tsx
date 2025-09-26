import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, X, TrendingUp, RotateCcw, Loader2 } from "lucide-react";

interface Asset {
  symbol: string;
  name: string;
  category: "major" | "altcoin" | "meme" | "stock" | "other";
  baseAsset: string;
  quoteAsset: string;
  status: string;
  contractType?: string;
}

interface AssetSelectorProps {
  selectedAssets: string[];
  onAssetsChange: (assets: string[]) => void;
}

// Categorize assets based on their base asset
const categorizeAsset = (baseAsset: string, symbol: string): "major" | "altcoin" | "meme" | "stock" | "other" => {
  const major = ["BTC", "ETH", "SOL", "BNB", "XRP", "LTC", "ADA", "MATIC", "DOT", "AVAX"];
  const meme = ["DOGE", "SHIB", "PEPE", "FLOKI", "FART", "FARTCOIN", "MEME", "WIF", "BONK"];
  const stocks = ["AAPL", "MSFT", "NVDA", "TSLA", "META", "AMZN", "GOOGL", "NFLX", "GOOG", "BABA"];
  
  if (major.includes(baseAsset)) return "major";
  if (meme.some(m => baseAsset.includes(m))) return "meme";
  if (stocks.includes(baseAsset)) return "stock";
  if (baseAsset === "ASTER" || baseAsset === "FORM" || baseAsset === "CDL") return "other";
  
  return "altcoin";
};

// Get friendly name for assets
const getAssetName = (baseAsset: string): string => {
  const names: Record<string, string> = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum", 
    "SOL": "Solana",
    "BNB": "BNB",
    "XRP": "Ripple",
    "LTC": "Litecoin",
    "DOGE": "Dogecoin",
    "ASTER": "Aster",
    "SHIB": "Shiba Inu",
    "PEPE": "Pepe",
    "AAPL": "Apple Inc.",
    "MSFT": "Microsoft",
    "NVDA": "NVIDIA",
    "TSLA": "Tesla",
    "META": "Meta Platforms",
    "AMZN": "Amazon"
  };
  
  return names[baseAsset] || baseAsset;
};

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
  const [availableAssets, setAvailableAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch available assets from Aster DEX
  useEffect(() => {
    const fetchAssets = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch('/api/symbols');
        if (!response.ok) {
          throw new Error('Failed to fetch symbols');
        }
        
        const data = await response.json();
        
        // Convert Aster DEX symbols to our Asset format
        const assets: Asset[] = data.symbols
          .filter((symbol: any) => symbol.status === 'TRADING')
          .map((symbol: any) => ({
            symbol: symbol.symbol,
            name: getAssetName(symbol.baseAsset),
            category: categorizeAsset(symbol.baseAsset, symbol.symbol),
            baseAsset: symbol.baseAsset,
            quoteAsset: symbol.quoteAsset,
            status: symbol.status,
            contractType: symbol.contractType
          }))
          .sort((a: Asset, b: Asset) => {
            // Sort by category priority, then alphabetically
            const categoryOrder = { major: 0, stock: 1, altcoin: 2, other: 3, meme: 4 };
            const categoryDiff = categoryOrder[a.category] - categoryOrder[b.category];
            if (categoryDiff !== 0) return categoryDiff;
            return a.symbol.localeCompare(b.symbol);
          });
        
        setAvailableAssets(assets);
      } catch (error) {
        console.error('Failed to fetch assets:', error);
        setError('Failed to load trading pairs');
      } finally {
        setLoading(false);
      }
    };

    fetchAssets();
  }, []);

  const filteredAssets = availableAssets.filter(asset => {
    const matchesSearch = activeSearchTerm === "" || 
                         asset.symbol.toLowerCase().includes(activeSearchTerm.toLowerCase()) ||
                         asset.name.toLowerCase().includes(activeSearchTerm.toLowerCase()) ||
                         asset.baseAsset.toLowerCase().includes(activeSearchTerm.toLowerCase());
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
          <h4 className="text-sm font-medium">
            Available Assets {!loading && `(${availableAssets.length})`}
          </h4>
          <ScrollArea className="h-64 border rounded-md">
            <div className="p-2 space-y-1">
              {loading && (
                <div className="flex items-center justify-center py-8" data-testid="loading-assets">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Loading trading pairs...</span>
                </div>
              )}
              
              {error && (
                <div className="text-center py-8 text-destructive" data-testid="error-assets">
                  <p>{error}</p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="mt-2"
                    onClick={() => window.location.reload()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              
              {!loading && !error && filteredAssets.map(asset => {
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
                          <span className="text-chart-1">{asset.contractType || 'PERPETUAL'}</span>
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
              
              {!loading && !error && filteredAssets.length === 0 && (
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
            onClick={() => onAssetsChange(availableAssets.filter(a => a.category === "major").map(a => a.symbol))}
            disabled={loading || availableAssets.length === 0}
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