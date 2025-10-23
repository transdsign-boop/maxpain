import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

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

interface VWAPStatusDisplayProps {
  strategyId: string;
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

export default function VWAPStatusDisplay({ strategyId }: VWAPStatusDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: vwapStatus, isLoading } = useQuery<VWAPStatusResponse>({
    queryKey: [`/api/strategies/${strategyId}/vwap/status`],
    refetchInterval: 5000, // Refresh every 5 seconds
    enabled: !!strategyId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            VWAP Direction Filter
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
            VWAP Direction Filter
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

  const visibleSymbols = isExpanded ? vwapStatus.symbols : vwapStatus.symbols.slice(0, 3);
  const hasMore = vwapStatus.symbols.length > 3;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              VWAP Direction Filter
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {vwapStatus.timeframeMinutes / 60}h timeframe • {(vwapStatus.bufferPercentage * 100).toFixed(2)}% buffer
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            {vwapStatus.symbols.length} symbols
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleSymbols.map((symbolStatus) => (
          <div
            key={symbolStatus.symbol}
            className="p-3 border rounded-lg space-y-2 hover:bg-muted/50 transition-colors"
          >
            {/* Header with symbol and direction */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-sm">{symbolStatus.symbol}</span>
                <DirectionBadge
                  direction={symbolStatus.direction}
                  inBufferZone={symbolStatus.inBufferZone}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                Reset in {formatTimeRemaining(symbolStatus.timeUntilReset)}
              </div>
            </div>

            {/* Price and VWAP info */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Current Price:</span>
                <span className="ml-1 font-mono font-medium">
                  ${symbolStatus.currentPrice.toFixed(4)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">VWAP:</span>
                <span className="ml-1 font-mono font-medium">
                  ${symbolStatus.currentVWAP.toFixed(4)}
                </span>
              </div>
            </div>

            {/* Distance from VWAP */}
            <div className="text-xs">
              <span className="text-muted-foreground">Distance:</span>
              <span
                className={`ml-1 font-mono font-medium ${
                  symbolStatus.distanceFromVWAP > 0 ? 'text-red-500' : 'text-green-500'
                }`}
              >
                {symbolStatus.distanceFromVWAP > 0 ? '+' : ''}
                {symbolStatus.distanceFromVWAP.toFixed(2)}%
              </span>
              {symbolStatus.inBufferZone && (
                <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1">
                  In Buffer Zone
                </Badge>
              )}
            </div>

            {/* Buffer zones (only when buffer is enabled) */}
            {vwapStatus.enableBuffer && (
              <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                <div>
                  Upper: ${symbolStatus.upperBuffer.toFixed(4)}
                </div>
                <div>
                  Lower: ${symbolStatus.lowerBuffer.toFixed(4)}
                </div>
              </div>
            )}

            {/* Statistics */}
            {symbolStatus.statistics.signalsBlocked > 0 && (
              <div className="text-[10px] text-muted-foreground">
                🚫 Blocked {symbolStatus.statistics.signalsBlocked} signals
              </div>
            )}
          </div>
        ))}

        {/* Show more/less button */}
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full text-xs"
          >
            {isExpanded ? 'Show Less' : `Show ${vwapStatus.symbols.length - 3} More`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
