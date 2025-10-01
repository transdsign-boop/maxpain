import React, { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TrendingUp, TrendingDown, DollarSign, Target, Layers, X, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Fill {
  id: string;
  orderId: string;
  sessionId: string;
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  value: string;
  layerNumber: number;
  filledAt: Date;
  fee?: string;
}

interface Position {
  id: string;
  sessionId: string;
  symbol: string;
  side: "long" | "short";
  totalQuantity: string;
  avgEntryPrice: string;
  totalCost: string;
  unrealizedPnl: string;
  realizedPnl: string;
  layersFilled: number;
  maxLayers: number;
  lastLayerPrice: string | null;
  isOpen: boolean;
  openedAt: Date;
  closedAt?: Date | null;
  updatedAt: Date;
  totalFees?: string; // Total fees paid for this position (entry + exit)
}

interface PositionSummary {
  sessionId: string;
  startingBalance: number;
  currentBalance: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalExposure: number;
  activePositions: number;
  totalTrades: number;
  winRate: number;
  positions: Position[];
}

interface StrategyStatusProps {}

interface PositionCardProps{
  position: Position;
  strategy: any;
  onClose: () => void;
  isClosing: boolean;
  formatCurrency: (value: number) => string;
  formatPercentage: (value: number) => string;
  getPnlColor: (pnl: number) => string;
  isHedge?: boolean;
}

interface CompletedTradeCardProps {
  position: Position;
  formatCurrency: (value: number) => string;
  formatPercentage: (value: number) => string;
  getPnlColor: (pnl: number) => string;
  isHedge?: boolean;
}

// Completed trade card with expandable layer details
function CompletedTradeCard({ position, formatCurrency, formatPercentage, getPnlColor, isHedge }: CompletedTradeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { data: fills } = useQuery<Fill[]>({
    queryKey: ['/api/positions', position.id, 'fills'],
    enabled: isExpanded,
  });

  // realizedPnl is stored as percentage in the database (stored in unrealizedPnl field after close)
  const realizedPnlPercent = parseFloat(position.unrealizedPnl);
  const totalCost = parseFloat(position.totalCost);
  const realizedPnlDollar = (realizedPnlPercent / 100) * totalCost;
  const avgEntry = parseFloat(position.avgEntryPrice);
  
  // Separate entry and exit fills/fees
  const entryFills = fills?.filter(f => f.layerNumber > 0) || [];
  const exitFills = fills?.filter(f => f.layerNumber === 0) || [];
  const entryFees = entryFills.reduce((sum, f) => sum + parseFloat(f.fee || '0'), 0);
  const exitFees = exitFills.reduce((sum, f) => sum + parseFloat(f.fee || '0'), 0);
  const totalFees = entryFees + exitFees;
  
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="rounded-lg border bg-card hover-elevate" data-testid={`completed-trade-${position.id}`}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" data-testid="button-toggle-trade-details">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <span className="font-semibold text-sm">{position.symbol}</span>
              <Badge 
                className={`text-xs ${position.side === 'long' ? 'bg-lime-600 text-white' : 'bg-orange-600 text-white'}`}
              >
                {position.side.toUpperCase()}
              </Badge>
              {isHedge && (
                <Badge variant="secondary" className="text-xs">
                  HEDGE
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {position.layersFilled}/{position.maxLayers} layers
              </Badge>
            </div>
            <div className={`text-sm font-semibold ${getPnlColor(realizedPnlDollar)}`}>
              {realizedPnlDollar >= 0 ? '+' : ''}{formatCurrency(realizedPnlDollar)}
              <span className="text-xs ml-1">
                ({realizedPnlPercent >= 0 ? '+' : ''}{formatPercentage(realizedPnlPercent)})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>
              Quantity: <span className="text-foreground">{parseFloat(position.totalQuantity).toFixed(4)}</span>
            </div>
            <div>
              Avg Entry: <span className="text-foreground">{formatCurrency(avgEntry)}</span>
            </div>
            <div>
              Opened: <span className="text-foreground">{format(new Date(position.openedAt), 'MMM d, h:mm a')}</span>
            </div>
            <div>
              Closed: <span className="text-foreground">{position.closedAt ? format(new Date(position.closedAt), 'MMM d, h:mm a') : 'N/A'}</span>
            </div>
            {fills && (
              <>
                <div>
                  Entry Fees: <span className="text-foreground">{formatCurrency(entryFees)}</span>
                </div>
                <div>
                  Exit Fees: <span className="text-foreground">{formatCurrency(exitFees)}</span>
                </div>
              </>
            )}
            {!fills && (
              <div className="col-span-2">
                Total Fees: <span className="text-foreground">{formatCurrency(parseFloat(position.totalFees || '0'))}</span>
                {parseFloat(position.totalFees || '0') > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">(0.035% taker)</span>
                )}
              </div>
            )}
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Layer Details</p>
            {fills && fills.length > 0 ? (
              <div className="space-y-2">
                {entryFills.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground/70 mb-1">Entry Layers ({entryFills.length})</p>
                    <div className="space-y-1">
                      {entryFills.sort((a, b) => a.layerNumber - b.layerNumber).map((fill) => (
                        <div key={fill.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/30">
                          <div className="flex items-center gap-2 flex-1">
                            <Badge variant="outline" className="text-xs h-5">L{fill.layerNumber}</Badge>
                            <span className="text-foreground">
                              {parseFloat(fill.quantity).toFixed(4)} @ {formatCurrency(parseFloat(fill.price))}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground/70">
                              {format(new Date(fill.filledAt), 'MMM d, h:mm:ss a')}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              Fee: {formatCurrency(parseFloat(fill.fee || '0'))}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {exitFills.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground/70 mb-1">Exit</p>
                    <div className="space-y-1">
                      {exitFills.map((fill) => (
                        <div key={fill.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/30">
                          <div className="flex items-center gap-2 flex-1">
                            <Badge variant="outline" className="text-xs h-5">Exit</Badge>
                            <span className="text-foreground">
                              {parseFloat(fill.quantity).toFixed(4)} @ {formatCurrency(parseFloat(fill.price))}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground/70">
                              {format(new Date(fill.filledAt), 'MMM d, h:mm:ss a')}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              Fee: {formatCurrency(parseFloat(fill.fee || '0'))}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No layer details available</p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function PositionCard({ position, strategy, onClose, isClosing, formatCurrency, formatPercentage, getPnlColor, isHedge }: PositionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { data: fills } = useQuery<Fill[]>({
    queryKey: ['/api/positions', position.id, 'fills'],
    enabled: isExpanded,
  });

  // unrealizedPnl is stored as percentage in the database (e.g., 0.36292126 = 0.36%)
  const unrealizedPnlPercent = parseFloat(position.unrealizedPnl);
  const totalCost = parseFloat(position.totalCost);
  
  // Calculate dollar P&L from percentage and leveraged position size
  const unrealizedPnlDollar = (unrealizedPnlPercent / 100) * totalCost;
  
  const avgEntry = parseFloat(position.avgEntryPrice);
  
  // Calculate current price from unrealized P&L percentage
  const currentPrice = position.side === 'long'
    ? avgEntry * (1 + unrealizedPnlPercent / 100)
    : avgEntry * (1 - unrealizedPnlPercent / 100);
  
  // Sanitize strategy values with defaults to prevent NaN issues
  const rawSL = Number(strategy?.stopLossPercent);
  const sanitizedSL = Number.isFinite(rawSL) && rawSL > 0 ? rawSL : 2;
  
  const rawTP = Number(strategy?.profitTargetPercent);
  const sanitizedTP = Number.isFinite(rawTP) && rawTP > 0 ? rawTP : 1;
  
  const rawLeverage = Number(strategy?.leverage);
  const leverage = Number.isFinite(rawLeverage) && rawLeverage > 0 ? rawLeverage : 1;
  
  // Calculate SL and TP prices using sanitized values
  const stopLossPrice = position.side === 'long'
    ? avgEntry * (1 - sanitizedSL / 100)
    : avgEntry * (1 + sanitizedSL / 100);
    
  const takeProfitPrice = position.side === 'long'
    ? avgEntry * (1 + sanitizedTP / 100)
    : avgEntry * (1 - sanitizedTP / 100);
  
  // Calculate margin (totalCost is already the leveraged position value)
  const totalMargin = leverage > 0 ? totalCost / leverage : totalCost;

  // Calculate liquidation price based on leverage (isolated margin)
  const maintenanceMarginFactor = 0.95;
  const hasLiquidation = leverage > 1 && !isNaN(leverage) && isFinite(leverage);
  
  const liquidationPrice = hasLiquidation
    ? position.side === 'long'
      ? avgEntry * (1 - (1 / leverage) * maintenanceMarginFactor)
      : avgEntry * (1 + (1 / leverage) * maintenanceMarginFactor)
    : null;
  
  // Calculate distance to liquidation as a percentage
  let distanceToLiquidation = null;
  if (liquidationPrice && hasLiquidation && currentPrice > 0) {
    const rawDistance = position.side === 'long'
      ? ((currentPrice - liquidationPrice) / currentPrice) * 100
      : ((liquidationPrice - currentPrice) / currentPrice) * 100;
    
    distanceToLiquidation = Math.max(0, rawDistance);
  }
  
  // Calculate position pressure for visual indicator
  const totalRange = sanitizedTP + sanitizedSL;
  const clampedPnl = Math.max(-sanitizedSL, Math.min(sanitizedTP, unrealizedPnlPercent));
  const clampedFromLeft = clampedPnl + sanitizedSL;
  const pressureValue = totalRange > 0 ? Math.max(0, Math.min(100, (clampedFromLeft / totalRange) * 100)) : 50;
  const neutralPoint = totalRange > 0 ? (sanitizedSL / totalRange) * 100 : 50;

  const isLong = position.side === 'long';

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div 
        className="relative rounded-2xl overflow-hidden ring-1 ring-border shadow-lg transition-all duration-300" 
        data-testid={`position-${position.symbol}`}
        style={{
          background: `linear-gradient(to right, rgb(251 146 60 / 0.12) 0%, rgb(156 163 175 / 0.06) ${neutralPoint}%, rgb(190 242 100 / 0.12) 100%)`
        }}
      >
        {/* Position pressure indicator line */}
        <div 
          className="absolute top-0 bottom-0 w-0.5 transition-all duration-300 z-10"
          style={{ 
            left: `${pressureValue}%`,
            backgroundColor: unrealizedPnlPercent > 0 
              ? 'rgb(190, 242, 100)'
              : unrealizedPnlPercent < 0 
              ? 'rgb(251, 146, 60)'
              : 'rgb(156, 163, 175)'
          }}
          data-testid={`pressure-indicator-${position.symbol}`}
        />
        
        {/* Intensity overlay */}
        <div 
          className="absolute top-0 bottom-0 transition-all duration-300 z-0"
          style={{ 
            left: pressureValue > neutralPoint ? `${neutralPoint}%` : `${pressureValue}%`,
            right: pressureValue < neutralPoint ? `${100 - neutralPoint}%` : `${100 - pressureValue}%`,
            backgroundColor: unrealizedPnlPercent > 0 
              ? 'rgba(190, 242, 100, 0.15)'
              : unrealizedPnlPercent < 0 
              ? 'rgba(251, 146, 60, 0.15)'
              : 'rgba(156, 163, 175, 0.08)'
          }}
        />
        
        <div className="relative z-10 grid grid-cols-[minmax(140px,220px)_1fr_auto]">
          {/* Left: Asset label with edge-bleed */}
          <div className="relative isolate overflow-hidden">
            {/* Gradient background */}
            <div className={`absolute inset-0 ${isLong ? 'bg-gradient-to-br from-lime-600/25 via-lime-500/10 to-transparent' : 'bg-gradient-to-br from-orange-600/25 via-orange-500/10 to-transparent'}`} />
            
            {/* Large background asset text */}
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 select-none pointer-events-none">
              <span className={`font-black tracking-tight text-5xl sm:text-6xl md:text-7xl leading-none whitespace-nowrap ${isLong ? 'text-lime-400/15' : 'text-orange-400/15'}`}>
                {position.symbol}
              </span>
            </div>

            {/* Top row: compact chips */}
            <div className="relative p-2 flex items-center gap-2 flex-wrap">
              <Badge className={`text-xs px-1.5 py-0.5 ${isLong ? 'bg-lime-500/15 text-lime-300 border-lime-400/30' : 'bg-orange-500/15 text-orange-300 border-orange-400/30'}`}>
                {isLong ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                {position.side.toUpperCase()}
              </Badge>
              <span className="px-1.5 py-0.5 rounded-lg text-[10px] text-muted-foreground bg-muted/50 border border-border/50">
                {position.layersFilled}/{position.maxLayers}
              </span>
              <span className="px-1.5 py-0.5 rounded-lg text-[10px] text-muted-foreground bg-muted/50 border border-border/50">
                {leverage}× • {formatCurrency(totalMargin)}
              </span>
              {isHedge && (
                <Badge variant="secondary" className="text-xs">HEDGE</Badge>
              )}
            </div>

            {/* Bottom: large asset label */}
            <div className="relative px-2 pb-2">
              <div className="font-extrabold text-foreground text-2xl tracking-tight">{position.symbol}</div>
            </div>
          </div>

          {/* Middle: price data in compact grid */}
          <div className="px-3 py-2 flex flex-col gap-1">
            <div className="grid grid-cols-3 gap-x-3 text-sm">
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground truncate">Avg:</div>
                <div className="text-[13px] text-foreground/90 truncate">{formatCurrency(avgEntry)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground truncate">Current:</div>
                <div className="text-[14px] font-semibold text-foreground truncate" data-testid={`current-price-${position.symbol}`}>
                  {formatCurrency(currentPrice)}
                </div>
              </div>
              {liquidationPrice !== null && distanceToLiquidation !== null && (
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">Liq:</div>
                  <div className={`text-[13px] truncate ${distanceToLiquidation < 10 ? 'text-orange-600 dark:text-orange-400' : 'text-foreground/90'}`} data-testid={`liquidation-info-${position.symbol}`}>
                    {formatCurrency(liquidationPrice)} ({distanceToLiquidation.toFixed(1)}%)
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-x-3 text-sm">
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground truncate">SL:</div>
                <div className="text-[13px] text-orange-600 dark:text-orange-400 truncate">{formatCurrency(stopLossPrice)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground truncate">TP:</div>
                <div className="text-[13px] text-lime-600 dark:text-lime-400 truncate">{formatCurrency(takeProfitPrice)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground truncate">Pressure:</div>
                <div className={`text-[13px] truncate ${getPnlColor(unrealizedPnlPercent)}`}>
                  {unrealizedPnlPercent > 0 ? 'Profit' : unrealizedPnlPercent < 0 ? 'Loss' : 'Neutral'}
                </div>
              </div>
            </div>
          </div>

          {/* Right: PnL and actions */}
          <div className="px-3 py-2 flex items-center gap-3">
            <div className="text-right">
              <div className={`text-sm font-semibold ${getPnlColor(unrealizedPnlDollar)}`}>
                {unrealizedPnlDollar >= 0 ? '+' : ''}{formatCurrency(unrealizedPnlDollar)}
              </div>
              <div className={`text-xs ${getPnlColor(unrealizedPnlPercent)}`}>
                {unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" data-testid="button-toggle-layers">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                data-testid={`button-close-position-${position.symbol}`}
                onClick={onClose}
                disabled={isClosing}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t px-3 py-2 relative z-10 bg-background/30">
            <p className="text-xs font-medium text-muted-foreground mb-2">Layer Entries</p>
            {fills && fills.length > 0 ? (
              <div className="space-y-1">
                {fills.map((fill) => (
                  <div key={fill.id} className="flex items-center justify-between text-xs py-1">
                    <div className="flex items-center gap-2 flex-1">
                      <Badge variant="outline" className="text-xs h-5">L{fill.layerNumber}</Badge>
                      <span className="text-muted-foreground">
                        {parseFloat(fill.quantity).toFixed(4)} @ {formatCurrency(parseFloat(fill.price))}
                      </span>
                      <span className="text-xs text-muted-foreground/70">
                        {format(new Date(fill.filledAt), 'MMM d, h:mm:ss a')}
                      </span>
                    </div>
                    <span className="text-muted-foreground">{formatCurrency(parseFloat(fill.value))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No layer details available</p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function StrategyStatus() {
  const { toast } = useToast();
  const [showClosedTrades, setShowClosedTrades] = useState(false);

  // First, get active strategies
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 5000,
  });

  // Find the active strategy
  const activeStrategy = strategies?.find(s => s.isActive);

  // Then fetch positions using the strategy ID
  const { data: summary, isLoading, error } = useQuery<PositionSummary>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'],
    queryFn: async () => {
      const response = await fetch(`/api/strategies/${activeStrategy.id}/positions/summary`);
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
      return response.json();
    },
    enabled: !!activeStrategy?.id,
    refetchInterval: 1000, // Refresh every 1 second for real-time P&L
    retry: (failureCount, error: any) => {
      // Don't retry 404 errors - they indicate no trade session exists
      if (error?.status === 404) return false;
      return failureCount < 3;
    },
  });

  // Fetch closed positions when section is expanded
  const { data: closedPositions } = useQuery<Position[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'closed'],
    enabled: !!activeStrategy?.id && showClosedTrades,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch strategy changes for the session
  const { data: strategyChanges } = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'changes'],
    enabled: !!activeStrategy?.id && showClosedTrades,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Detect hedge positions in closed trades - check for overlapping time periods with opposite sides
  // Returns a Map of positionId -> boolean indicating if that specific position was hedged
  const closedHedgePositions = useMemo(() => {
    if (!closedPositions) return new Map<string, boolean>();
    
    const hedgedMap = new Map<string, boolean>();
    
    // For each position, check if there's another position with opposite side that overlapped in time
    closedPositions.forEach(pos1 => {
      let isHedged = false;
      
      closedPositions.forEach(pos2 => {
        if (pos1.id === pos2.id) return; // Skip same position
        if (pos1.symbol !== pos2.symbol) return; // Skip different symbols
        if (pos1.side === pos2.side) return; // Skip same side
        
        // Check if time periods overlapped
        const pos1Start = new Date(pos1.openedAt).getTime();
        const pos1End = pos1.closedAt ? new Date(pos1.closedAt).getTime() : Date.now();
        const pos2Start = new Date(pos2.openedAt).getTime();
        const pos2End = pos2.closedAt ? new Date(pos2.closedAt).getTime() : Date.now();
        
        // Check for overlap: start1 <= end2 && start2 <= end1
        if (pos1Start <= pos2End && pos2Start <= pos1End) {
          isHedged = true;
        }
      });
      
      hedgedMap.set(pos1.id, isHedged);
    });
    
    return hedgedMap;
  }, [closedPositions]);

  // Merge and sort closed positions with strategy changes by timestamp
  const tradeHistory = useMemo(() => {
    const items: Array<{ type: 'trade' | 'change'; timestamp: Date; data: any }> = [];
    
    if (closedPositions) {
      closedPositions.forEach(position => {
        items.push({
          type: 'trade',
          timestamp: position.closedAt ? new Date(position.closedAt) : new Date(position.openedAt),
          data: position
        });
      });
    }
    
    if (strategyChanges) {
      strategyChanges.forEach(change => {
        items.push({
          type: 'change',
          timestamp: new Date(change.changedAt),
          data: change
        });
      });
    }
    
    // Sort by timestamp, newest first
    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [closedPositions, strategyChanges]);

  // Detect hedge positions - when there are both long and short positions for the same symbol
  const hedgeSymbols = useMemo(() => {
    if (!summary?.positions) return new Set<string>();
    
    const symbolSides = new Map<string, Set<'long' | 'short'>>();
    
    // Group positions by symbol and track their sides
    summary.positions.forEach(pos => {
      if (!symbolSides.has(pos.symbol)) {
        symbolSides.set(pos.symbol, new Set());
      }
      symbolSides.get(pos.symbol)!.add(pos.side);
    });
    
    // Find symbols that have both long and short positions
    const hedged = new Set<string>();
    symbolSides.forEach((sides, symbol) => {
      if (sides.has('long') && sides.has('short')) {
        hedged.add(symbol);
      }
    });
    
    return hedged;
  }, [summary?.positions]);

  // Close position mutation - must be defined before any early returns
  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      const response = await apiRequest('POST', `/api/positions/${positionId}/close`);
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Position Closed",
        description: `Closed ${data.position.symbol} position with ${data.pnlPercent >= 0 ? '+' : ''}${data.pnlPercent.toFixed(2)}% P&L ($${data.pnlDollar >= 0 ? '+' : ''}${Math.abs(data.pnlDollar).toFixed(2)})`,
      });
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to close position. Please try again.",
        variant: "destructive",
      });
    }
  });


  if (isLoading) {
    return (
      <Card data-testid="strategy-status-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  // Handle 404 as "no active session" rather than error
  // Check multiple ways the error status might be stored
  const getErrorStatus = (err: any) => {
    // Direct status properties
    if (err?.status) return err.status;
    if (err?.response?.status) return err.response.status;
    if (err?.statusCode) return err.statusCode;
    
    // Parse status from error message like "404: {json}"
    if (err?.message && typeof err.message === 'string') {
      const statusMatch = err.message.match(/^(\d{3}):/);
      if (statusMatch) {
        return parseInt(statusMatch[1], 10);
      }
    }
    
    return null;
  };
  
  const errorStatus = error ? getErrorStatus(error) : null;
  const hasError = error && errorStatus !== 404;
  const hasNoSession = error && errorStatus === 404;


  if (hasError) {
    return (
      <Card data-testid="strategy-status-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">Failed to load position data. Please try again.</p>
        </CardContent>
      </Card>
    );
  }

  if (hasNoSession) {
    return (
      <Card data-testid="strategy-status-no-session">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No active trading session. Start a strategy to begin tracking positions and P&L.</p>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getPnlColor = (pnl: number) => {
    if (pnl > 0) return "text-lime-600 dark:text-lime-400";
    if (pnl < 0) return "text-orange-600 dark:text-orange-400";
    return "text-muted-foreground";
  };

  const totalReturnPercent = summary ? ((summary.totalPnl / summary.startingBalance) * 100) : 0;
  
  // Calculate current balance including unrealized P&L
  const currentBalanceWithUnrealized = summary 
    ? summary.currentBalance + (summary.unrealizedPnl || 0)
    : 0;
  
  // Calculate available margin (current balance minus margin in use)
  const leverage = activeStrategy?.leverage || 1;
  const marginInUse = summary ? (summary.totalExposure / leverage) : 0;
  const availableMargin = summary ? (summary.currentBalance - marginInUse) : 0;

  return (
    <Card data-testid="strategy-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Active Positions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Active Positions */}
        {summary?.positions && summary.positions.length > 0 ? (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Active Positions</h4>
            <div className="space-y-2">
              {summary.positions.map((position) => (
                <PositionCard
                  key={position.id}
                  position={position}
                  strategy={activeStrategy}
                  onClose={() => closePositionMutation.mutate(position.id)}
                  isClosing={closePositionMutation.isPending}
                  formatCurrency={formatCurrency}
                  formatPercentage={formatPercentage}
                  getPnlColor={getPnlColor}
                  isHedge={hedgeSymbols.has(position.symbol)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No active positions</p>
            <p className="text-sm text-muted-foreground">Positions will appear here when your strategy triggers trades</p>
          </div>
        )}

        {/* Completed Trades */}
        <Collapsible open={showClosedTrades} onOpenChange={setShowClosedTrades}>
          <CollapsibleTrigger className="flex items-center justify-between w-full hover-elevate rounded-lg px-4 py-3 border" data-testid="button-toggle-closed-trades">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Completed Trades</span>
              {closedPositions && (
                <Badge variant="secondary" className="text-xs">
                  {closedPositions.length}
                </Badge>
              )}
            </div>
            {showClosedTrades ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            {tradeHistory && tradeHistory.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tradeHistory.map((item) => {
                  if (item.type === 'change') {
                    // Render strategy change card
                    const change = item.data;
                    const changes = change.changes as Record<string, { old: any; new: any }>;
                    const changeCount = Object.keys(changes).length;
                    
                    return (
                      <div
                        key={change.id}
                        className="p-4 rounded-lg border bg-muted/30 border-primary/20"
                        data-testid={`strategy-change-${change.id}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs border-primary/50">
                            Strategy Updated
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(change.changedAt), 'MMM d, h:mm a')}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {Object.entries(changes).slice(0, 3).map(([field, value]) => (
                            <div key={field} className="text-xs">
                              <span className="text-muted-foreground capitalize">
                                {field.replace(/([A-Z])/g, ' $1').trim()}:
                              </span>
                              <span className="text-foreground ml-1">
                                {JSON.stringify(value.old)} → {JSON.stringify(value.new)}
                              </span>
                            </div>
                          ))}
                          {changeCount > 3 && (
                            <div className="text-xs text-muted-foreground">
                              +{changeCount - 3} more changes
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  } else {
                    // Render trade card (with expandable details)
                    return <CompletedTradeCard key={item.data.id} position={item.data} formatCurrency={formatCurrency} formatPercentage={formatPercentage} getPnlColor={getPnlColor} isHedge={closedHedgePositions.get(item.data.id) || false} />;
                  }
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No completed trades yet</p>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}