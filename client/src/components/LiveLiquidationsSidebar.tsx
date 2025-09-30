import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import LiquidationRow from "./LiquidationRow";
import { ChevronLeft, ChevronRight, Activity, Zap } from "lucide-react";

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface LiveLiquidationsSidebarProps {
  liquidations: Liquidation[];
  isConnected: boolean;
  selectedAssets: string[];
  isCollapsed: boolean;
  onToggleCollapse: (collapsed: boolean) => void;
  onLiquidationClick: (liquidation: Liquidation) => void;
}

export default function LiveLiquidationsSidebar({ 
  liquidations, 
  isConnected,
  selectedAssets,
  isCollapsed,
  onToggleCollapse,
  onLiquidationClick
}: LiveLiquidationsSidebarProps) {

  // Show liquidations from the last 8 hours
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
  const recentLiquidations = liquidations.filter(liq => {
    const liqDate = typeof liq.timestamp === 'string' ? new Date(liq.timestamp) : liq.timestamp;
    return liqDate >= eightHoursAgo;
  });

  // Calculate total value from ALL liquidations
  const totalValue = liquidations.reduce((sum, liq) => sum + parseFloat(liq.value), 0);

  // Get unique symbols from recent liquidations to fetch their complete history
  const uniqueSymbols = useMemo(() => {
    return Array.from(new Set(recentLiquidations.map(liq => liq.symbol)));
  }, [recentLiquidations]);

  // Fetch complete historical data for all unique symbols shown in sidebar
  const { data: symbolHistories, isLoading: historiesLoading } = useQuery<Record<string, Liquidation[]>>({
    queryKey: [`/api/liquidations/by-symbol?symbols=${uniqueSymbols.join(',')}&limit=10000`],
    enabled: uniqueSymbols.length > 0,
    refetchInterval: 30000, // Refresh every 30 seconds
    select: (data: any) => {
      // Normalize timestamps and group by symbol
      const normalized = data.map((liq: any) => ({
        ...liq,
        timestamp: typeof liq.timestamp === 'string' ? new Date(liq.timestamp) : liq.timestamp
      }));
      
      // Group by symbol
      const grouped: Record<string, Liquidation[]> = {};
      normalized.forEach((liq: Liquidation) => {
        if (!grouped[liq.symbol]) {
          grouped[liq.symbol] = [];
        }
        grouped[liq.symbol].push(liq);
      });
      
      return grouped;
    }
  });

  const formatValue = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  };

  // Cache sorted asset values to avoid recomputing on every render
  const sortedAssetValues = useMemo(() => {
    const cache: Record<string, number[]> = {};
    if (symbolHistories) {
      Object.keys(symbolHistories).forEach(symbol => {
        const values = symbolHistories[symbol].map(liq => parseFloat(liq.value));
        cache[symbol] = values.sort((a, b) => a - b);
      });
    }
    return cache;
  }, [symbolHistories]);

  // Calculate asset-specific percentile based on complete history for that symbol
  const calculateAssetPercentile = (symbol: string, value: number) => {
    const assetValues = sortedAssetValues[symbol];
    if (!assetValues || assetValues.length === 0) {
      return 0;
    }
    
    // Binary search for efficient O(log n) lookup
    let left = 0, right = assetValues.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (assetValues[mid] <= value) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return Math.round((left / assetValues.length) * 100);
  };

  const getOrdinalSuffix = (n: number) => {
    const lastDigit = n % 10;
    const lastTwoDigits = n % 100;
    
    // Special cases for 11th, 12th, 13th
    if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
      return `${n}th`;
    }
    
    // Regular cases
    switch (lastDigit) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  };

  const getPercentileLabel = (percentile: number) => {
    const ordinal = getOrdinalSuffix(percentile);
    
    if (percentile >= 95) return { text: ordinal, color: 'bg-red-500 text-white' };
    if (percentile >= 90) return { text: ordinal, color: 'bg-orange-500 text-white' };
    if (percentile >= 75) return { text: ordinal, color: 'bg-yellow-500 text-black' };
    if (percentile >= 50) return { text: ordinal, color: 'bg-blue-500 text-white' };
    return { text: ordinal, color: 'bg-gray-500 text-white' };
  };

  return (
    <div 
      className={`fixed right-0 bg-background border-l transition-all duration-300 z-40 ${
        isCollapsed ? 'w-12' : 'w-80'
      } hidden md:block`}
      style={{
        top: '73px', // Position below the header
        height: 'calc(100vh - 73px)' // Full height minus header
      }}
      data-testid="sidebar-live-liquidations"
    >
      {/* Collapse/Expand Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onToggleCollapse(!isCollapsed)}
        className="absolute -left-10 top-4 bg-background border shadow-md hover-elevate"
        data-testid="button-toggle-sidebar"
      >
        {isCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>

      {/* Sidebar Content */}
      <div className={`h-full flex flex-col ${isCollapsed ? 'hidden' : 'block'}`}>
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm" data-testid="text-sidebar-title">
              Live Liquidations
            </h3>
            <Badge 
              variant={isConnected ? "default" : "destructive"} 
              className="text-xs"
              data-testid="badge-connection-status"
            >
              {isConnected ? "LIVE" : "OFFLINE"}
            </Badge>
          </div>
          
          {/* Quick Stats */}
          <div className="text-xs">
            <div className="text-center p-3 rounded-md bg-muted/30">
              <div className="text-muted-foreground text-xs">Total Value</div>
              <div className="font-bold text-lg" data-testid="text-total-value">
                {formatValue(totalValue)}
              </div>
            </div>
          </div>
        </div>

        {/* Liquidations List */}
        <div className="flex-1 overflow-hidden">
          {recentLiquidations.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm" data-testid="text-no-liquidations">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {selectedAssets.length === 0 ? "Select assets to monitor" : "No recent liquidations"}
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {recentLiquidations.map((liquidation, index) => (
                  <div
                    key={liquidation.id}
                    className={`relative p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                      index === 0 
                        ? 'bg-gradient-to-r from-primary/10 to-primary/5 border-primary/30 ring-1 ring-primary/20 shadow-sm' 
                        : 'bg-card hover-elevate border-border/50'
                    }`}
                    onClick={() => onLiquidationClick(liquidation)}
                    data-testid={`card-liquidation-${liquidation.id}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm" data-testid={`text-symbol-${liquidation.id}`}>
                          {liquidation.symbol}
                        </span>
                        <Badge 
                          className={`text-xs px-2 py-0.5 font-medium ${
                            liquidation.side === 'long' 
                              ? 'bg-green-500/10 text-green-600 border-green-500/20' 
                              : 'bg-red-500/10 text-red-600 border-red-500/20'
                          }`}
                        >
                          {liquidation.side.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {new Date(liquidation.timestamp).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="text-muted-foreground">
                        Size: <span className="font-medium text-foreground">{parseFloat(liquidation.size).toFixed(4)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`font-bold text-sm ${
                          parseFloat(liquidation.value) > 10000 ? 'text-orange-500' : 
                          parseFloat(liquidation.value) > 1000 ? 'text-yellow-600' : 'text-foreground'
                        }`}>
                          {formatValue(parseFloat(liquidation.value))}
                        </div>
                        {(() => {
                          const percentile = calculateAssetPercentile(liquidation.symbol, parseFloat(liquidation.value));
                          const label = getPercentileLabel(percentile);
                          return (
                            <Badge 
                              className={`text-xs px-1.5 py-0.5 ${label.color}`}
                              data-testid={`badge-percentile-${liquidation.id}`}
                            >
                              {label.text}
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>
                    
                    <div className="text-xs text-muted-foreground font-mono">
                      @ ${parseFloat(liquidation.price).toFixed(6)}
                    </div>

                    {/* Visual indicator for recent liquidation */}
                    {index === 0 && (
                      <div className="absolute -left-1 top-1/2 transform -translate-y-1/2 w-1 h-8 bg-primary rounded-r animate-pulse"></div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Footer Info */}
        <div className="p-3 border-t bg-muted/30">
          <div className="text-xs text-muted-foreground text-center">
            Showing last {recentLiquidations.length} liquidations
            {selectedAssets.length > 0 && (
              <div className="mt-1">
                Tracking: {selectedAssets.slice(0, 2).join(", ")}
                {selectedAssets.length > 2 && ` +${selectedAssets.length - 2} more`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Collapsed State Icon */}
      {isCollapsed && (
        <div className="flex flex-col items-center pt-4 space-y-2">
          <Zap className="h-5 w-5 text-primary" />
          <div className="writing-mode-vertical text-xs text-muted-foreground transform rotate-90 origin-center">
            Live
          </div>
          {recentLiquidations.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {recentLiquidations.length}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}