import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, BarChart3, ArrowUpDown, ChevronDown } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import VWAPChartDialog from "@/components/VWAPChartDialog";
import { formatInTimeZone } from "date-fns-tz";
import { useLiquidityStatus } from "@/hooks/use-liquidity-status";

interface VWAPSymbolStatus {
  symbol: string;
  direction: 'LONG_ONLY' | 'SHORT_ONLY' | 'BUFFER' | 'LOADING';
  currentVWAP: number;
  currentPrice: number;
  upperBuffer: number;
  lowerBuffer: number;
  inBufferZone: boolean;
  previousDirection: 'LONG_ONLY' | 'SHORT_ONLY' | 'BUFFER' | 'LOADING';
  distanceFromVWAP: number;
  nextResetTime: number;
  timeUntilReset: number;
  volume24h: number;
  statistics: {
    directionChanges: number;
    signalsBlocked: number;
    timeInBufferMs: number;
    sessionStartTime: number;
    dataPoints: number;
  };
}

interface VWAPStatusResponse {
  strategyId: string;
  enabled: boolean;
  timeframeMinutes: number;
  bufferPercentage: number;
  enableBuffer: boolean;
  symbols: VWAPSymbolStatus[];
}

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface VWAPStatusDisplayProps {
  strategyId: string;
  liquidations: Liquidation[];
}

function formatTimeRemaining(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  } else if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(0)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

function formatValue(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return `${Math.round(value)}`;
}

function formatTimeAgo(timestamp: Date): string {
  const now = Date.now();
  const liqTime = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp.getTime();
  const diffSeconds = Math.floor((now - liqTime) / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h`;
  return `${Math.floor(diffSeconds / 86400)}d`;
}

function DirectionBadge({ direction, inBufferZone }: { direction: string; inBufferZone: boolean }) {
  const getDirectionColor = () => {
    if (direction === 'LOADING') return 'bg-gray-500';
    if (inBufferZone) return 'bg-yellow-500';
    if (direction === 'LONG_ONLY') return 'bg-green-500';
    if (direction === 'SHORT_ONLY') return 'bg-red-500';
    return 'bg-gray-500';
  };

  const getDirectionIcon = () => {
    if (direction === 'LOADING') return <ArrowUpDown className="h-3 w-3" />;
    if (inBufferZone) return <Minus className="h-3 w-3" />;
    if (direction === 'LONG_ONLY') return <TrendingUp className="h-3 w-3" />;
    if (direction === 'SHORT_ONLY') return <TrendingDown className="h-3 w-3" />;
    return <Minus className="h-3 w-3" />;
  };

  const getDirectionText = () => {
    if (inBufferZone) return 'BUFFER';
    return direction.replace('_', ' ');
  };

  return (
    <Badge className={`${getDirectionColor()} text-white flex items-center gap-1`}>
      {getDirectionIcon()}
      {getDirectionText()}
    </Badge>
  );
}

export default function VWAPStatusDisplay({ strategyId, liquidations }: VWAPStatusDisplayProps) {
  const [selectedSymbolName, setSelectedSymbolName] = useState<string | null>(null);
  const [chartDialogOpen, setChartDialogOpen] = useState(false);
  const [flashingSymbols, setFlashingSymbols] = useState<Set<string>>(new Set());
  const previousLiquidationIds = useRef<Set<string>>(new Set());

  const { data: vwapStatus, isLoading } = useQuery<VWAPStatusResponse>({
    queryKey: [`/api/strategies/${strategyId}/vwap/status`],
    refetchInterval: 60000, // Refresh every 1 minute
    enabled: !!strategyId,
  });

  // Fetch strategy to get percentile threshold
  const { data: strategy } = useQuery<any>({
    queryKey: ['/api/strategies', strategyId],
    queryFn: async () => {
      const response = await fetch('/api/strategies');
      const strategies = await response.json();
      const strategy = strategies.find((s: any) => s.id === strategyId);
      console.log('Strategy loaded:', strategy);
      console.log('Percentile threshold:', strategy?.percentileThreshold);
      return strategy;
    },
    enabled: !!strategyId,
  });

  // Get unique symbols from VWAP status
  const trackedSymbolsList = useMemo(() => {
    return vwapStatus?.symbols.map(s => s.symbol) || [];
  }, [vwapStatus?.symbols]);

  // Get all unique symbols from both tracked symbols AND recent liquidations
  const allUniqueSymbols = useMemo(() => {
    const tracked = new Set(trackedSymbolsList);
    // Add symbols from recent liquidations
    liquidations.forEach(liq => tracked.add(liq.symbol));
    return Array.from(tracked);
  }, [trackedSymbolsList, liquidations]);

  // Get liquidity status for tracked symbols
  const { data: liveAccount } = useQuery<any>({
    queryKey: ['/api/live/account'],
    staleTime: Infinity,
  });
  const accountBalance = parseFloat(liveAccount?.totalWalletBalance || '0');
  const leverage = strategy?.leverage || 5;
  const { liquidityStatusMap } = useLiquidityStatus(trackedSymbolsList, accountBalance, leverage);

  // Fetch complete historical data PER SYMBOL for percentile calculation (includes ALL symbols, not just tracked)
  const { data: symbolHistories } = useQuery<Record<string, Liquidation[]>>({
    queryKey: ['liquidations-by-symbol-vwap', allUniqueSymbols.sort().join(',')],
    queryFn: async () => {
      // Query each symbol separately with limit=500 (matches strategy engine)
      const results = await Promise.all(
        allUniqueSymbols.map(async (symbol) => {
          const response = await fetch(`/api/liquidations/by-symbol?symbols=${symbol}&limit=500`);
          const data = await response.json();
          return { symbol, data };
        })
      );

      // Group results by symbol
      const grouped: Record<string, Liquidation[]> = {};
      results.forEach(({ symbol, data }) => {
        grouped[symbol] = data.map((liq: any) => ({
          ...liq,
          timestamp: typeof liq.timestamp === 'string' ? new Date(liq.timestamp) : liq.timestamp
        }));
      });

      return grouped;
    },
    enabled: allUniqueSymbols.length > 0,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Pre-sort values per symbol for percentile calculation (ALL historical data)
  const sortedValuesBySymbol = useMemo(() => {
    if (!symbolHistories) return {};

    const cache: Record<string, number[]> = {};
    Object.entries(symbolHistories).forEach(([symbol, liqs]) => {
      cache[symbol] = liqs.map(l => parseFloat(l.value)).sort((a, b) => a - b);
    });
    return cache;
  }, [symbolHistories]);

  // Calculate percentile for a liquidation using ALL historical data
  const calculatePercentile = (symbol: string, value: number): number => {
    const values = sortedValuesBySymbol[symbol];
    if (!values || values.length === 0) return 0;

    let left = 0, right = values.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (values[mid] <= value) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return Math.round((left / values.length) * 100);
  };

  // Filter liquidations from last 8 hours FOR DISPLAY ONLY
  const eightHoursAgo = Date.now() - 8 * 60 * 60 * 1000;
  const recentLiquidations = liquidations.filter(liq => {
    const liqTime = typeof liq.timestamp === 'string' ? new Date(liq.timestamp).getTime() : liq.timestamp.getTime();
    return liqTime >= eightHoursAgo;
  });

  // Group recent liquidations by symbol FOR DISPLAY
  const liquidationsBySymbol = recentLiquidations.reduce((acc, liq) => {
    if (!acc[liq.symbol]) acc[liq.symbol] = [];
    acc[liq.symbol].push(liq);
    return acc;
  }, {} as Record<string, Liquidation[]>);

  // Get tracked symbols from vwapStatus
  const trackedSymbols = vwapStatus?.symbols.map(s => s.symbol) || [];

  // Find the symbol with the most recent liquidation
  const symbolWithLatestLiquidation = useMemo(() => {
    if (recentLiquidations.length === 0) return null;

    // Sort all liquidations by timestamp (newest first)
    const sorted = [...recentLiquidations].sort((a, b) => {
      const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp.getTime();
      const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp.getTime();
      return timeB - timeA;
    });

    return sorted[0]?.symbol || null;
  }, [recentLiquidations]);

  // Get non-tracked liquidations for ticker
  const nonTrackedLiquidations = recentLiquidations.filter(liq => !trackedSymbols.includes(liq.symbol));

  // Calculate liquidation metrics for header
  const liquidationMetrics = useMemo(() => {
    const totalValue = recentLiquidations.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
    const count = recentLiquidations.length;
    const largestValue = Math.max(...recentLiquidations.map(liq => parseFloat(liq.value)), 0);

    return {
      totalValue,
      count,
      largestValue,
      formattedTotal: totalValue >= 1_000_000
        ? `$${(totalValue / 1_000_000).toFixed(2)}M`
        : `$${(totalValue / 1_000).toFixed(0)}K`,
      formattedLargest: largestValue >= 1_000_000
        ? `$${(largestValue / 1_000_000).toFixed(2)}M`
        : `$${(largestValue / 1_000).toFixed(0)}K`
    };
  }, [recentLiquidations]);

  // Detect new liquidations and trigger flash animation
  useEffect(() => {
    const currentIds = new Set(liquidations.map(l => l.id));
    const newLiquidations = liquidations.filter(l => !previousLiquidationIds.current.has(l.id));

    if (newLiquidations.length > 0) {
      // Get symbols that have new liquidations
      const newSymbols = new Set(newLiquidations.map(l => l.symbol));
      setFlashingSymbols(newSymbols);

      // Remove flash after animation completes (500ms)
      const timer = setTimeout(() => {
        setFlashingSymbols(new Set());
      }, 500);

      previousLiquidationIds.current = currentIds;
      return () => clearTimeout(timer);
    }

    previousLiquidationIds.current = currentIds;
  }, [liquidations]);

  // Calculate heat intensity for a symbol (0-1 scale)
  const getHeatIntensity = (symbol: string): number => {
    const liqs = liquidationsBySymbol[symbol] || [];
    if (liqs.length === 0) return 0;

    const totalValue = liqs.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
    const count = liqs.length;

    // Normalize: combine count and value
    // High activity = many liquidations or high total value
    const normalizedCount = Math.min(count / 50, 1); // 50+ liquidations = max
    const normalizedValue = Math.min(totalValue / 1_000_000, 1); // $1M+ = max

    return (normalizedCount + normalizedValue) / 2;
  };

  // Get latest 3 liquidations for a symbol
  const getLatestLiquidations = (symbol: string): Liquidation[] => {
    const liqs = liquidationsBySymbol[symbol] || [];
    return liqs
      .sort((a, b) => {
        const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp.getTime();
        const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp.getTime();
        return timeB - timeA; // Most recent first
      })
      .slice(0, 3);
  };

  // Get the current data for the selected symbol (updates live with each query refresh)
  const selectedSymbol = selectedSymbolName
    ? vwapStatus?.symbols.find(s => s.symbol === selectedSymbolName) || null
    : null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            VWAP Direction Filter and live liquidations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading VWAP status...</div>
        </CardContent>
      </Card>
    );
  }

  if (!vwapStatus || !vwapStatus.enabled) {
    return null; // Don't show if VWAP filter is disabled
  }

  // Check if VWAP data is initialized (all values are zero means no data yet)
  const hasData = vwapStatus.symbols.some(s => s.currentVWAP > 0 || s.currentPrice > 0);

  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            VWAP Direction Filter and live liquidations
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            {vwapStatus.timeframeMinutes / 60}h timeframe • {(vwapStatus.bufferPercentage * 100).toFixed(2)}% buffer
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <div className="animate-pulse h-2 w-2 bg-blue-500 rounded-full"></div>
            Waiting for price data... VWAP will update when liquidations occur.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Count symbols by direction
  const longCount = vwapStatus.symbols.filter(s => s.direction === 'LONG_ONLY' && !s.inBufferZone).length;
  const shortCount = vwapStatus.symbols.filter(s => s.direction === 'SHORT_ONLY' && !s.inBufferZone).length;
  const bufferCount = vwapStatus.symbols.filter(s => s.inBufferZone).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              VWAP Direction Filter and live liquidations
            </CardTitle>
            <CardDescription className="text-xs mt-1 flex items-center gap-3">
              <span>{vwapStatus.timeframeMinutes / 60}h • {(vwapStatus.bufferPercentage * 100).toFixed(2)}% buffer</span>
              <span className="text-muted-foreground">|</span>
              <span className="font-mono">{liquidationMetrics.count} liqs • {liquidationMetrics.formattedTotal} total • {liquidationMetrics.formattedLargest} max</span>
            </CardDescription>
          </div>
          <div className="flex gap-3 text-xs font-medium">
            <span className="text-green-600">
              {longCount} LONG
            </span>
            <span className="text-red-600">
              {shortCount} SHORT
            </span>
            {bufferCount > 0 && (
              <span className="text-gray-500">
                {bufferCount} BUFFER
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Grid layout with VWAP + Liquidations */}
        <div className="grid grid-cols-6 gap-1">
          {vwapStatus.symbols.map((symbolStatus) => {
            const isSelected = selectedSymbolName === symbolStatus.symbol;
            const latestLiqs = getLatestLiquidations(symbolStatus.symbol);
            const heatIntensity = getHeatIntensity(symbolStatus.symbol);

            // Calculate opacity based on distance from VWAP (0 = transparent, 1 = solid)
            const getOpacity = () => {
              if (symbolStatus.currentVWAP === 0 || symbolStatus.currentPrice === 0) return 0.1;
              if (symbolStatus.inBufferZone) return 0;
              const absDistance = Math.abs(symbolStatus.distanceFromVWAP);
              if (!isFinite(absDistance)) return 0.1;
              if (absDistance < 0.5) return 0.15;
              if (absDistance < 1.0) return 0.35;
              if (absDistance < 2.0) return 0.55;
              if (absDistance < 4.0) return 0.75;
              return 0.9;
            };

            const opacity = getOpacity();

            // Background color based on VWAP direction (same as before)
            const getBgColor = () => {
              if (symbolStatus.inBufferZone) return 'transparent';
              if (symbolStatus.direction === 'LONG_ONLY') return `rgba(34, 197, 94, ${opacity})`;
              if (symbolStatus.direction === 'SHORT_ONLY') return `rgba(239, 68, 68, ${opacity})`;
              return `rgba(107, 114, 128, ${opacity})`;
            };

            // Border based on liquidation heat intensity (lime green)
            const getBorderStyle = () => {
              const width = 1 + (heatIntensity * 3); // 1-4px based on heat
              const baseOpacity = 0.3 + (heatIntensity * 0.7); // 0.3-1.0 based on heat
              return {
                borderWidth: `${width}px`,
                borderColor: `rgba(132, 204, 22, ${baseOpacity})`, // lime-500 color for heat
              };
            };

            const isFlashing = flashingSymbols.has(symbolStatus.symbol);
            const hasLatestLiquidation = symbolStatus.symbol === symbolWithLatestLiquidation;

            const getTextColor = () => {
              if (symbolStatus.inBufferZone) return 'text-gray-500';
              if (symbolStatus.direction === 'LONG_ONLY') return opacity > 0.5 ? 'text-white' : 'text-green-600';
              if (symbolStatus.direction === 'SHORT_ONLY') return opacity > 0.5 ? 'text-white' : 'text-red-600';
              return 'text-gray-600';
            };

            return (
              <div
                key={symbolStatus.symbol}
                className={`rounded p-1.5 transition-all cursor-pointer ${isSelected ? 'ring-2 ring-offset-1 ring-blue-500' : ''} ${isFlashing ? 'animate-border-flash' : ''} ${hasLatestLiquidation ? 'border-4 border-primary ring-2 ring-primary/30 shadow-lg' : 'border'}`}
                style={{
                  backgroundColor: getBgColor(),
                  ...(hasLatestLiquidation ? {} : getBorderStyle()), // Don't apply heat border if it's the latest
                }}
                onClick={() => setSelectedSymbolName(selectedSymbolName === symbolStatus.symbol ? null : symbolStatus.symbol)}
              >
                {/* Symbol header */}
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <span className={`font-mono text-[11px] font-bold ${getTextColor()}`}>
                    {symbolStatus.symbol.replace('USDT', '')}
                  </span>
                  {liquidityStatusMap.get(symbolStatus.symbol) && (
                    <div
                      className={`w-1.5 h-1.5 ${liquidityStatusMap.get(symbolStatus.symbol)?.color}`}
                      title={liquidityStatusMap.get(symbolStatus.symbol)?.tooltip}
                    />
                  )}
                </div>

                {/* Separator */}
                <div className="border-t border-current opacity-20 mb-0.5"></div>

                {/* Latest liquidations */}
                <div className="space-y-0.5">
                  {latestLiqs.length > 0 ? (
                    latestLiqs.map((liq, idx) => {
                      const percentile = calculatePercentile(liq.symbol, parseFloat(liq.value));
                      const threshold = strategy?.percentileThreshold || 0;
                      const meetsThreshold = threshold > 0 && percentile >= threshold;

                      // Debug logging for first liquidation only
                      if (idx === 0 && symbolStatus.symbol === 'BTCUSDT') {
                        console.log('BTC Liquidation Debug:', {
                          percentile,
                          threshold,
                          meetsThreshold,
                          strategyLoaded: !!strategy,
                          thresholdValue: strategy?.percentileThreshold
                        });
                      }

                      return (
                        <div key={idx} className="flex items-center gap-0.5 text-[9px] font-mono">
                          {/* Vertical bar indicator */}
                          <span className={`w-0.5 h-2.5 rounded-sm ${liq.side === 'short' ? 'bg-red-500' : 'bg-green-500'}`}></span>
                          <span className={opacity > 0.5 ? 'text-white' : 'text-foreground'}>
                            {formatValue(parseFloat(liq.value))}
                          </span>
                          <span className={`${meetsThreshold ? 'text-lime-500 font-bold' : opacity > 0.5 ? 'text-white/70' : 'text-muted-foreground'}`}>
                            {percentile}%
                          </span>
                          <span className={`${opacity > 0.5 ? 'text-white/50' : 'text-muted-foreground'} ml-auto`}>
                            {formatTimeAgo(liq.timestamp)}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className={`text-[9px] text-center ${opacity > 0.5 ? 'text-white/50' : 'text-muted-foreground'}`}>
                      No recent liqs
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Collapsible dropdown for non-tracked assets */}
        {nonTrackedLiquidations.length > 0 && (
          <Collapsible className="mt-2 border-t pt-1.5">
            <CollapsibleTrigger className="w-full flex items-center justify-between hover:bg-muted/50 rounded px-2 py-1 transition-colors">
              <div className="text-[9px] text-muted-foreground">
                Other Activity: {nonTrackedLiquidations.length} liquidation{nonTrackedLiquidations.length !== 1 ? 's' : ''}
              </div>
              <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 space-y-0.5 max-h-64 overflow-y-auto">
              {nonTrackedLiquidations.map((liq, idx) => {
                const percentile = calculatePercentile(liq.symbol, parseFloat(liq.value));
                const meetsThreshold = strategy?.percentileThreshold ? percentile >= strategy.percentileThreshold : false;
                return (
                  <div key={idx} className="flex items-center justify-between px-2 py-1 rounded text-[10px] font-mono hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className={`w-0.5 h-3 rounded-sm ${liq.side === 'short' ? 'bg-red-500' : 'bg-green-500'}`}></div>
                      <span className="font-bold min-w-[60px]">{liq.symbol.replace('USDT', '')}</span>
                      <span className="text-muted-foreground">${formatValue(parseFloat(liq.value))}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={meetsThreshold ? 'text-lime-500 font-bold' : 'text-muted-foreground'}>{percentile}%</span>
                      <span className="text-muted-foreground">{formatTimeAgo(liq.timestamp)}</span>
                    </div>
                  </div>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Details panel when a symbol is selected */}
        {selectedSymbol && (
          <div className="mt-3 p-3 border rounded bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-mono font-bold text-sm">{selectedSymbol.symbol}</h3>
                <DirectionBadge direction={selectedSymbol.direction} inBufferZone={selectedSymbol.inBufferZone} />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setChartDialogOpen(true)}
                  className="h-6 text-xs"
                >
                  <BarChart3 className="h-3 w-3 mr-1" />
                  View Chart
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedSymbolName(null)}
                  className="h-6 text-xs"
                >
                  Close
                </Button>
              </div>
            </div>

            {selectedSymbol.currentVWAP === 0 || selectedSymbol.currentPrice === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                <div className="animate-pulse h-2 w-2 bg-blue-500 rounded-full mx-auto mb-2"></div>
                Loading VWAP data for {selectedSymbol.symbol}...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Price:</span>
                <span className="font-mono font-semibold">${selectedSymbol.currentPrice.toFixed(6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">VWAP:</span>
                <span className="font-mono font-semibold">${selectedSymbol.currentVWAP.toFixed(6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Upper Buffer:</span>
                <span className="font-mono font-semibold">${selectedSymbol.upperBuffer.toFixed(6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lower Buffer:</span>
                <span className="font-mono font-semibold">${selectedSymbol.lowerBuffer.toFixed(6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Distance:</span>
                <span className={`font-mono font-semibold ${selectedSymbol.distanceFromVWAP > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {selectedSymbol.distanceFromVWAP > 0 ? '+' : ''}{selectedSymbol.distanceFromVWAP.toFixed(3)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reset In:</span>
                <span className="font-mono font-semibold">{formatTimeRemaining(selectedSymbol.timeUntilReset)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Reset (PST):</span>
                <span className="font-mono font-semibold">
                  {formatInTimeZone(new Date(selectedSymbol.statistics.sessionStartTime), 'America/Los_Angeles', 'MMM d, h:mm a')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Direction Changes:</span>
                <span className="font-mono font-semibold">{selectedSymbol.statistics.directionChanges}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data Points:</span>
                <span className="font-mono font-semibold">{selectedSymbol.statistics.dataPoints}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">24h Volume:</span>
                <span className="font-mono font-semibold">{formatVolume(selectedSymbol.volume24h || 0)}</span>
              </div>
            </div>
            )}

            {/* Recent Liquidations Section */}
            {(() => {
              const symbolLiqs = (liquidationsBySymbol[selectedSymbol.symbol] || [])
                .sort((a, b) => {
                  const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp.getTime();
                  const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp.getTime();
                  return timeB - timeA; // Most recent first
                });
              const last10Liqs = symbolLiqs.slice(0, 10);

              if (last10Liqs.length === 0) {
                return (
                  <div className="mt-3 pt-3 border-t">
                    <div className="text-xs text-muted-foreground text-center py-2">
                      No recent liquidations for {selectedSymbol.symbol}
                    </div>
                  </div>
                );
              }

              return (
                <div className="mt-3 pt-3 border-t">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold">Recent Liquidations ({last10Liqs.length})</h4>
                    <span className="text-xs text-muted-foreground">Last 8 hours</span>
                  </div>
                  <div className="space-y-1">
                    {last10Liqs.map((liq, idx) => {
                      const percentile = calculatePercentile(liq.symbol, parseFloat(liq.value));
                      const meetsThreshold = strategy?.percentileThreshold ? percentile >= strategy.percentileThreshold : false;
                      const liqTime = typeof liq.timestamp === 'string' ? new Date(liq.timestamp) : liq.timestamp;

                      return (
                        <div
                          key={liq.id || idx}
                          className={`flex items-center gap-2 p-1.5 rounded text-xs font-mono ${
                            idx === 0 ? 'bg-primary/10 border-4 border-primary ring-2 ring-primary/30' : 'bg-card'
                          }`}
                        >
                          {/* Side indicator */}
                          <span className={`w-1 h-4 rounded-sm ${liq.side === 'short' ? 'bg-red-500' : 'bg-green-500'}`}></span>

                          {/* Side label */}
                          <span className={`w-12 font-bold ${liq.side === 'short' ? 'text-red-500' : 'text-green-500'}`}>
                            {liq.side.toUpperCase()}
                          </span>

                          {/* Value */}
                          <span className="font-semibold">
                            ${parseFloat(liq.value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>

                          {/* Percentile */}
                          <span className={`${meetsThreshold ? 'text-lime-500 font-bold' : 'text-muted-foreground'}`}>
                            {percentile}%
                          </span>

                          {/* Price */}
                          <span className="text-muted-foreground ml-auto">
                            @${parseFloat(liq.price).toFixed(2)}
                          </span>

                          {/* Time ago */}
                          <span className="text-muted-foreground">
                            {formatTimeAgo(liqTime)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* VWAP Chart Dialog */}
        {selectedSymbol && vwapStatus && (
          <VWAPChartDialog
            symbol={selectedSymbol.symbol}
            strategyId={strategyId}
            open={chartDialogOpen}
            onOpenChange={setChartDialogOpen}
            currentVWAP={selectedSymbol.currentVWAP}
            currentPrice={selectedSymbol.currentPrice}
            bufferPercentage={vwapStatus.bufferPercentage}
          />
        )}
      </CardContent>
    </Card>
  );
}
