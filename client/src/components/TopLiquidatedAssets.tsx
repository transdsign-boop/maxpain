import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, Target } from "lucide-react";

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface AssetData {
  symbol: string;
  count: number;
  totalValue: number;
  longCount: number;
  shortCount: number;
  avgValue: number;
  latestTimestamp: Date;
}

interface TopLiquidatedAssetsProps {
  liquidations: Liquidation[];
}

export default function TopLiquidatedAssets({ liquidations }: TopLiquidatedAssetsProps) {
  // Calculate top 10 assets by liquidation count
  const topAssets = useMemo(() => {
    const assetMap = new Map<string, AssetData>();

    // Process all liquidations to get asset statistics
    liquidations.forEach(liq => {
      const existing = assetMap.get(liq.symbol);
      const value = parseFloat(liq.value);
      
      if (existing) {
        existing.count++;
        existing.totalValue += value;
        existing.longCount += liq.side === 'long' ? 1 : 0;
        existing.shortCount += liq.side === 'short' ? 1 : 0;
        existing.avgValue = existing.totalValue / existing.count;
        if (liq.timestamp > existing.latestTimestamp) {
          existing.latestTimestamp = liq.timestamp;
        }
      } else {
        assetMap.set(liq.symbol, {
          symbol: liq.symbol,
          count: 1,
          totalValue: value,
          longCount: liq.side === 'long' ? 1 : 0,
          shortCount: liq.side === 'short' ? 1 : 0,
          avgValue: value,
          latestTimestamp: liq.timestamp,
        });
      }
    });

    // Sort by count and take top 10
    return Array.from(assetMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [liquidations]);

  const formatValue = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  };

  const getTimeAgo = (timestamp: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Target className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold">Counter-Trade Opportunities</h2>
        <Badge variant="secondary" className="text-xs">
          Top 10 Most Liquidated Assets
        </Badge>
      </div>
      
      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
        {topAssets.map((asset, index) => (
          <Card 
            key={asset.symbol} 
            className={`hover-elevate cursor-pointer transition-all duration-200 flex-none w-64 ${
              index === 0 ? 'ring-2 ring-primary/20 bg-primary/5' : ''
            }`}
            data-testid={`card-asset-${asset.symbol}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  {index === 0 && <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />}
                  {asset.symbol}
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  #{index + 1}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Liquidation Count */}
              <div className="text-center">
                <div className="text-2xl font-bold text-primary" data-testid={`count-${asset.symbol}`}>
                  {asset.count}
                </div>
                <div className="text-xs text-muted-foreground">Liquidations</div>
              </div>

              {/* Long/Short Ratio */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-center p-2 rounded bg-red-500/10">
                  <div className="flex items-center justify-center gap-1">
                    <TrendingUp className="h-3 w-3 text-red-600" />
                    <span className="font-bold text-red-600">{asset.longCount}</span>
                  </div>
                  <div className="text-muted-foreground">Longs</div>
                </div>
                <div className="text-center p-2 rounded bg-green-500/10">
                  <div className="flex items-center justify-center gap-1">
                    <TrendingDown className="h-3 w-3 text-green-600" />
                    <span className="font-bold text-green-600">{asset.shortCount}</span>
                  </div>
                  <div className="text-muted-foreground">Shorts</div>
                </div>
              </div>

              {/* Total Value */}
              <div className="text-center p-2 rounded bg-muted/30">
                <div className="font-bold text-sm" data-testid={`value-${asset.symbol}`}>
                  {formatValue(asset.totalValue)}
                </div>
                <div className="text-xs text-muted-foreground">Total Value</div>
              </div>

              {/* Average & Latest */}
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg:</span>
                  <span className="font-medium">{formatValue(asset.avgValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Latest:</span>
                  <span className="font-medium">{getTimeAgo(asset.latestTimestamp)}</span>
                </div>
              </div>

              {/* Activity Indicator */}
              <div className="flex items-center justify-center gap-1 pt-1 border-t">
                <Activity className="h-3 w-3 text-primary" />
                <span className="text-xs text-primary font-medium">Counter-Trade Ready</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Stats Summary */}
      {topAssets.length > 0 && (
        <Card className="bg-muted/30">
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-lg font-bold">{topAssets.reduce((sum, asset) => sum + asset.count, 0)}</div>
                <div className="text-sm text-muted-foreground">Total Liquidations</div>
              </div>
              <div>
                <div className="text-lg font-bold">{formatValue(topAssets.reduce((sum, asset) => sum + asset.totalValue, 0))}</div>
                <div className="text-sm text-muted-foreground">Combined Value</div>
              </div>
              <div>
                <div className="text-lg font-bold text-red-600">{topAssets.reduce((sum, asset) => sum + asset.longCount, 0)}</div>
                <div className="text-sm text-muted-foreground">Long Liquidations</div>
              </div>
              <div>
                <div className="text-lg font-bold text-green-600">{topAssets.reduce((sum, asset) => sum + asset.shortCount, 0)}</div>
                <div className="text-sm text-muted-foreground">Short Liquidations</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}