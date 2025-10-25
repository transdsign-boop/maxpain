import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import VWAPChartDialog from "@/components/VWAPChartDialog";

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
  const [selectedSymbolName, setSelectedSymbolName] = useState<string | null>(null);
  const [chartDialogOpen, setChartDialogOpen] = useState(false);

  const { data: vwapStatus, isLoading } = useQuery<VWAPStatusResponse>({
    queryKey: [`/api/strategies/${strategyId}/vwap/status`],
    refetchInterval: 60000, // Refresh every 1 minute
    enabled: !!strategyId,
  });

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
              VWAP Direction Filter
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {vwapStatus.timeframeMinutes / 60}h • {(vwapStatus.bufferPercentage * 100).toFixed(2)}% buffer
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
        {/* Ultra-compact grid layout - all symbols visible at once */}
        <div className="grid grid-cols-9 gap-0.5">
          {vwapStatus.symbols.map((symbolStatus) => {
            const isSelected = selectedSymbolName === symbolStatus.symbol;

            // Calculate opacity based on distance from VWAP (0 = transparent, 1 = solid)
            const getOpacity = () => {
              // If no VWAP data yet (still loading), return low opacity
              if (symbolStatus.currentVWAP === 0 || symbolStatus.currentPrice === 0) return 0.1;
              if (symbolStatus.inBufferZone) return 0; // Fully transparent in buffer
              const absDistance = Math.abs(symbolStatus.distanceFromVWAP);
              // Handle NaN/Infinity from division errors
              if (!isFinite(absDistance)) return 0.1;
              // Map distance to opacity: 0-0.5% = 0.1, 0.5-1% = 0.3, 1-2% = 0.5, 2%+ = 0.8
              if (absDistance < 0.5) return 0.15;
              if (absDistance < 1.0) return 0.35;
              if (absDistance < 2.0) return 0.55;
              if (absDistance < 4.0) return 0.75;
              return 0.9; // Very far from VWAP
            };

            const opacity = getOpacity();

            // Get RGB color values based on direction
            const getBgColor = () => {
              if (symbolStatus.inBufferZone) return 'transparent';
              if (symbolStatus.direction === 'LONG_ONLY') return `rgba(34, 197, 94, ${opacity})`; // green-500
              if (symbolStatus.direction === 'SHORT_ONLY') return `rgba(239, 68, 68, ${opacity})`; // red-500
              return `rgba(107, 114, 128, ${opacity})`; // gray-500
            };

            const getBorderColor = () => {
              if (symbolStatus.inBufferZone) return 'rgba(156, 163, 175, 0.3)'; // gray-400/30
              if (symbolStatus.direction === 'LONG_ONLY') return `rgba(34, 197, 94, ${Math.min(opacity + 0.2, 1)})`;
              if (symbolStatus.direction === 'SHORT_ONLY') return `rgba(239, 68, 68, ${Math.min(opacity + 0.2, 1)})`;
              return `rgba(107, 114, 128, ${Math.min(opacity + 0.2, 1)})`;
            };

            const getTextColor = () => {
              if (symbolStatus.inBufferZone) return 'text-gray-500';
              if (symbolStatus.direction === 'LONG_ONLY') return opacity > 0.5 ? 'text-white' : 'text-green-600';
              if (symbolStatus.direction === 'SHORT_ONLY') return opacity > 0.5 ? 'text-white' : 'text-red-600';
              return 'text-gray-600';
            };

            return (
              <div
                key={symbolStatus.symbol}
                className={`border rounded p-1.5 transition-all cursor-pointer ${isSelected ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
                style={{
                  backgroundColor: getBgColor(),
                  borderColor: getBorderColor(),
                  borderWidth: isSelected ? '2px' : '1px',
                }}
                onClick={() => setSelectedSymbolName(selectedSymbolName === symbolStatus.symbol ? null : symbolStatus.symbol)}
              >
                <div className="flex items-center justify-center h-full">
                  <span className={`font-mono text-xs font-bold ${getTextColor()}`}>
                    {symbolStatus.symbol.replace('USDT', '')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

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
                <span className="text-muted-foreground">Direction Changes:</span>
                <span className="font-mono font-semibold">{selectedSymbol.statistics.directionChanges}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data Points:</span>
                <span className="font-mono font-semibold">{selectedSymbol.statistics.dataPoints}</span>
              </div>
            </div>
            )}
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
