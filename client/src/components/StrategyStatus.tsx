import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, DollarSign, Target, Layers, X, ChevronDown, ChevronUp, CheckCircle2, Award } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { soundNotifications } from "@/lib/soundNotifications";
import { useStrategyData } from "@/hooks/use-strategy-data";

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

interface AssetPerformance {
  symbol: string;
  totalPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
}

// Completed trade card with expandable layer details
function CompletedTradeCard({ position, formatCurrency, formatPercentage, getPnlColor, isHedge }: CompletedTradeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { data: fills } = useQuery<Fill[]>({
    queryKey: ['/api/positions', position.id, 'fills'],
    enabled: isExpanded,
  });

  // CRITICAL: realizedPnl is stored as DOLLAR AMOUNT (not percentage) in the database!
  // unrealizedPnl field contains the PERCENTAGE at close time
  const realizedPnlPercent = parseFloat(position.unrealizedPnl); // This is the percentage
  const realizedPnlDollar = parseFloat(position.realizedPnl || '0'); // This is ALREADY in dollars!
  const avgEntry = parseFloat(position.avgEntryPrice);
  
  // Separate entry and exit fills/fees
  const entryFills = fills?.filter(f => f.layerNumber > 0) || [];
  const exitFills = fills?.filter(f => f.layerNumber === 0) || [];
  const entryFees = entryFills.reduce((sum, f) => sum + parseFloat(f.fee || '0'), 0);
  const exitFees = exitFills.reduce((sum, f) => sum + parseFloat(f.fee || '0'), 0);
  const totalFees = entryFees + exitFees;
  
  // Use actual entry fills count if we have fills data, otherwise fall back to database value
  const actualLayersFilled = fills && entryFills.length > 0 ? entryFills.length : position.layersFilled;
  
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
                className={`text-xs ${position.side === 'long' ? 'bg-lime-600 text-white' : 'bg-red-700 text-white'}`}
              >
                {position.side.toUpperCase()}
              </Badge>
              {isHedge && (
                <Badge variant="secondary" className="text-xs">
                  HEDGE
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {actualLayersFilled}/{position.maxLayers} layers
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
                        <div key={fill.id} className="text-xs py-1 px-2 rounded bg-muted/30 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs h-5">L{fill.layerNumber}</Badge>
                              <span className="text-foreground">
                                {parseFloat(fill.quantity).toFixed(4)} @ {formatCurrency(parseFloat(fill.price))}
                              </span>
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {formatCurrency(parseFloat(fill.fee || '0'))}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            {format(new Date(fill.filledAt), 'MMM d, h:mm a')}
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
                        <div key={fill.id} className="text-xs py-1 px-2 rounded bg-muted/30 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs h-5">Exit</Badge>
                              <span className="text-foreground">
                                {parseFloat(fill.quantity).toFixed(4)} @ {formatCurrency(parseFloat(fill.price))}
                              </span>
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {formatCurrency(parseFloat(fill.fee || '0'))}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            {format(new Date(fill.filledAt), 'MMM d, h:mm a')}
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
  const [isFlashing, setIsFlashing] = useState(false);
  const prevLayersRef = useRef(position.layersFilled);
  
  const { data: fills } = useQuery<Fill[]>({
    queryKey: ['/api/positions', position.id, 'fills'],
    enabled: isExpanded,
  });
  
  // Calculate actual layers from entry fills (layerNumber > 0)
  const entryFills = fills?.filter(f => f.layerNumber > 0) || [];
  const exitFills = fills?.filter(f => f.layerNumber === 0) || [];
  const actualLayersFilled = fills && entryFills.length > 0 ? entryFills.length : position.layersFilled;
  
  // Flash effect when layers increase
  useEffect(() => {
    if (actualLayersFilled > prevLayersRef.current) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 600);
      prevLayersRef.current = actualLayersFilled;
      return () => clearTimeout(timer);
    }
    prevLayersRef.current = actualLayersFilled;
  }, [actualLayersFilled]);

  // unrealizedPnl is stored as percentage in the database (e.g., 0.36292126 = 0.36%)
  const unrealizedPnlPercent = parseFloat(position.unrealizedPnl);
  const totalCost = parseFloat(position.totalCost);
  
  // Get leverage first (needed for notional value calculation)
  const rawLeverage = Number(strategy?.leverage);
  const leverage = Number.isFinite(rawLeverage) && rawLeverage > 0 ? rawLeverage : 1;
  
  // Calculate notional value (totalCost stores margin, multiply by leverage for notional)
  const notionalValue = totalCost * leverage;
  
  // Calculate dollar P&L from percentage and NOTIONAL position size (not margin)
  const unrealizedPnlDollar = (unrealizedPnlPercent / 100) * notionalValue;
  
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
  
  // Calculate SL and TP prices using sanitized values (with exchange rounding)
  // Matches backend roundPrice logic - floor to nearest tick size
  const calculateRoundedPrice = (rawPrice: number) => {
    // Tick size approximation based on price magnitude (matches exchange tick sizes)
    let decimals: number;
    let tickSize: number;
    
    if (rawPrice >= 1000) {
      tickSize = 0.1;
      decimals = 1;
    } else if (rawPrice >= 100) {
      tickSize = 0.01;
      decimals = 2;
    } else if (rawPrice >= 10) {
      tickSize = 0.001;
      decimals = 3;
    } else if (rawPrice >= 1) {
      tickSize = 0.0001;
      decimals = 4;
    } else {
      // For prices < 1 (like DOGE at ~0.26), use 5 decimals
      tickSize = 0.00001;
      decimals = 5;
    }
    
    const rounded = Math.floor(rawPrice / tickSize) * tickSize;
    return parseFloat(rounded.toFixed(decimals));
  };
  
  const rawStopLossPrice = position.side === 'long'
    ? avgEntry * (1 - sanitizedSL / 100)
    : avgEntry * (1 + sanitizedSL / 100);
    
  const rawTakeProfitPrice = position.side === 'long'
    ? avgEntry * (1 + sanitizedTP / 100)
    : avgEntry * (1 - sanitizedTP / 100);
  
  const stopLossPrice = calculateRoundedPrice(rawStopLossPrice);
  const takeProfitPrice = calculateRoundedPrice(rawTakeProfitPrice);

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

  // Calculate gradient opacity based on distance from neutral point
  // Opacity increases as we move closer to either extreme (SL or TP)
  const distanceFromNeutral = Math.abs(pressureValue - neutralPoint);
  const maxDistance = unrealizedPnlPercent > 0 
    ? (100 - neutralPoint) // Distance to TP
    : neutralPoint; // Distance to SL
  const opacityFactor = maxDistance > 0 ? distanceFromNeutral / maxDistance : 0;
  
  // Create gradient colors with increasing opacity toward the target
  const gradientColor = unrealizedPnlPercent > 0 
    ? 'rgb(190, 242, 100)'
    : unrealizedPnlPercent < 0 
    ? 'rgb(220, 38, 38)'
    : 'rgb(156, 163, 175)';
  
  const gradientDirection = pressureValue > neutralPoint ? 'to right' : 'to left';
  const gradientStart = `rgba(${unrealizedPnlPercent > 0 ? '190, 242, 100' : unrealizedPnlPercent < 0 ? '220, 38, 38' : '156, 163, 175'}, 0.05)`;
  const gradientEnd = `rgba(${unrealizedPnlPercent > 0 ? '190, 242, 100' : unrealizedPnlPercent < 0 ? '220, 38, 38' : '156, 163, 175'}, ${Math.min(0.5, 0.1 + opacityFactor * 0.4)})`;

  const isLong = position.side === 'long';

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div 
        className={`relative rounded-2xl overflow-hidden ring-1 ring-border shadow-lg transition-all duration-300 ${isFlashing ? 'animate-layer-flash' : ''}`}
        data-testid={`position-${position.symbol}`}
      >
        {/* Position pressure indicator line */}
        <div 
          className="absolute top-0 bottom-0 w-0.5 transition-all duration-300 z-10"
          style={{ 
            left: `${pressureValue}%`,
            backgroundColor: gradientColor
          }}
          data-testid={`pressure-indicator-${position.symbol}`}
        />
        
        {/* Gradient intensity overlay */}
        <div 
          className="absolute top-0 bottom-0 transition-all duration-300 z-0"
          style={{ 
            left: pressureValue > neutralPoint ? `${neutralPoint}%` : `${pressureValue}%`,
            right: pressureValue < neutralPoint ? `${100 - neutralPoint}%` : `${100 - pressureValue}%`,
            background: `linear-gradient(${gradientDirection}, ${gradientStart}, ${gradientEnd})`
          }}
        />
        
        {/* Mobile layout (stacked) and Desktop layout (grid) */}
        <div className="relative z-10">
          {/* Mobile: Stacked layout */}
          <div className="lg:hidden">
            {/* Header row: Symbol, badges, and info */}
            <div className="relative">
              <div className="relative p-2 space-y-1.5">
                {/* Symbol and badges row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="font-bold text-foreground text-lg tracking-tight">{position.symbol}</div>
                    <Badge className={`text-xs px-1.5 py-0.5 ${isLong ? 'bg-lime-500/15 text-lime-300 border-lime-400/30' : 'bg-red-600/15 text-red-400 border-red-500/30'}`}>
                      {isLong ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                      {position.side.toUpperCase()}
                    </Badge>
                    {isHedge && (
                      <Badge variant="secondary" className="text-xs">HEDGE</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground bg-muted/50">
                      {actualLayersFilled}/{position.maxLayers}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground bg-muted/50">
                      {leverage}×
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Price data with compact P&L and Close button */}
            <div className="px-2 py-2 border-t border-border/30">
              <div className="flex items-center gap-3">
                {/* Left column: Avg and SL */}
                <div className="space-y-1.5 flex-shrink-0">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Avg:</div>
                    <div className="text-xs font-medium text-foreground">{formatCurrency(avgEntry)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">SL:</div>
                    <div className="text-xs text-red-700 dark:text-red-500">{formatCurrency(stopLossPrice)}</div>
                  </div>
                </div>

                {/* Center: P&L and Close button */}
                <div className="flex flex-col items-center justify-center flex-1 gap-1.5">
                  <div className="flex flex-col items-center">
                    <div className={`text-2xl font-black font-mono leading-none ${getPnlColor(unrealizedPnlDollar)}`}>
                      {unrealizedPnlDollar >= 0 ? '+' : ''}{formatCurrency(unrealizedPnlDollar)}
                    </div>
                    <div className={`text-sm font-bold font-mono ${getPnlColor(unrealizedPnlPercent)}`}>
                      {unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      {formatCurrency(notionalValue)}
                    </div>
                  </div>
                  <button
                    className="rounded flex items-center justify-center px-2 py-0.5 border border-destructive bg-transparent text-destructive text-[10px] font-semibold transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid={`button-close-position-${position.symbol}`}
                    onClick={onClose}
                    disabled={isClosing}
                  >
                    Close
                  </button>
                </div>

                {/* Right column: Current and TP */}
                <div className="space-y-1.5 flex-shrink-0">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Current:</div>
                    <div className="text-xs font-semibold text-foreground" data-testid={`current-price-${position.symbol}`}>
                      {formatCurrency(currentPrice)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">TP:</div>
                    <div className="text-xs text-lime-600 dark:text-lime-400">{formatCurrency(takeProfitPrice)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Liquidation gauge and expand button */}
            <div className="px-2 py-2 flex items-center justify-between gap-2 border-t border-border/30">
              {/* Liquidation donut (if applicable) */}
              {liquidationPrice !== null && distanceToLiquidation !== null && (
                <div className="flex items-center gap-2">
                  <div className="relative" style={{ width: '40px', height: '40px' }}>
                    <svg viewBox="0 0 100 100" className="transform -rotate-90">
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="hsl(var(--muted))"
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={distanceToLiquidation < 5 ? 'rgb(220, 38, 38)' : distanceToLiquidation < 15 ? 'rgb(251, 146, 60)' : 'rgb(190, 242, 100)'}
                        strokeWidth="8"
                        strokeDasharray={`${Math.min(100, distanceToLiquidation * 2.5)} ${251.2 - Math.min(100, distanceToLiquidation * 2.5)}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className={`text-[10px] font-bold ${distanceToLiquidation < 5 ? 'text-red-700' : distanceToLiquidation < 15 ? 'text-orange-500' : 'text-lime-600'}`}>
                        {distanceToLiquidation.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground">to liq</span>
                </div>
              )}

              {/* Expand button */}
              <div className="ml-auto">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" data-testid="button-toggle-layers">
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </div>

          {/* Desktop: Grid layout */}
          <div className="hidden lg:grid lg:grid-cols-[180px_1fr_auto]">
            {/* Left: Asset label */}
            <div className="relative">
              {/* Compact chips */}
              <div className="relative p-2 flex items-center gap-2 flex-wrap">
                <Badge className={`text-xs px-1.5 py-0.5 ${isLong ? 'bg-lime-500/15 text-lime-300 border-lime-400/30' : 'bg-red-600/15 text-red-400 border-red-500/30'}`}>
                  {isLong ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                  {position.side.toUpperCase()}
                </Badge>
                <span className="px-1.5 py-0.5 rounded-lg text-[10px] text-muted-foreground bg-muted/50 border border-border/50">
                  {actualLayersFilled}/{position.maxLayers}
                </span>
                <span className="px-1.5 py-0.5 rounded-lg text-[10px] text-muted-foreground bg-muted/50 border border-border/50">
                  {leverage}× • {formatCurrency(notionalValue)}
                </span>
                {isHedge && (
                  <Badge variant="secondary" className="text-xs">HEDGE</Badge>
                )}
              </div>

              {/* Bottom: Symbol label with expand button */}
              <div className="relative px-2 pb-2 flex items-center gap-2">
                <div className="font-bold text-foreground text-lg tracking-tight">{position.symbol}</div>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" data-testid="button-toggle-layers">
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>

            {/* Middle: price data with P&L and Close button */}
            <div className="px-2 py-2 flex items-center gap-3">
              {/* Left column: Avg and SL */}
              <div className="space-y-1.5 flex-shrink-0">
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">Avg:</div>
                  <div className="text-xs text-foreground/90 truncate">{formatCurrency(avgEntry)}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">SL:</div>
                  <div className="text-xs text-red-700 dark:text-red-500 truncate">{formatCurrency(stopLossPrice)}</div>
                </div>
              </div>

              {/* Center: P&L and Close button */}
              <div className="flex flex-col items-center justify-center flex-1 gap-1.5">
                <div className="flex flex-col items-center">
                  <div className={`text-2xl font-black font-mono leading-none ${getPnlColor(unrealizedPnlDollar)}`}>
                    {unrealizedPnlDollar >= 0 ? '+' : ''}{formatCurrency(unrealizedPnlDollar)}
                  </div>
                  <div className={`text-sm font-bold font-mono ${getPnlColor(unrealizedPnlPercent)}`}>
                    {unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {formatCurrency(notionalValue)}
                  </div>
                </div>
                <button
                  className="rounded flex items-center justify-center px-2 py-0.5 border border-destructive bg-transparent text-destructive text-[10px] font-semibold transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid={`button-close-position-${position.symbol}`}
                  onClick={onClose}
                  disabled={isClosing}
                >
                  Close
                </button>
              </div>

              {/* Right column: Current and TP */}
              <div className="space-y-1.5 flex-shrink-0">
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">Current:</div>
                  <div className="text-xs font-semibold text-foreground truncate" data-testid={`current-price-${position.symbol}`}>
                    {formatCurrency(currentPrice)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">TP:</div>
                  <div className="text-xs text-lime-600 dark:text-lime-400 truncate">{formatCurrency(takeProfitPrice)}</div>
                </div>
              </div>
            </div>

            {/* Right Column: Liquidation Risk Donut */}
            <div className="flex items-center justify-center py-2 px-2 border-l border-border/30">
              {liquidationPrice !== null && distanceToLiquidation !== null && (
                <div className="flex items-center gap-2">
                  <div className="relative" style={{ width: '50px', height: '50px' }}>
                    <svg viewBox="0 0 100 100" className="transform -rotate-90">
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="hsl(var(--muted))"
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={distanceToLiquidation < 5 ? 'rgb(220, 38, 38)' : distanceToLiquidation < 15 ? 'rgb(251, 146, 60)' : 'rgb(190, 242, 100)'}
                        strokeWidth="8"
                        strokeDasharray={`${Math.min(100, distanceToLiquidation * 2.5)} ${251.2 - Math.min(100, distanceToLiquidation * 2.5)}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className={`text-[10px] font-bold ${distanceToLiquidation < 5 ? 'text-red-700' : distanceToLiquidation < 15 ? 'text-orange-500' : 'text-lime-600'}`}>
                        {distanceToLiquidation.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">to liq</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t px-3 py-2 relative z-10 bg-background/30">
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

export function StrategyStatus() {
  const { toast } = useToast();
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const [positionToClose, setPositionToClose] = useState<Position | null>(null);

  // Use centralized hook for all strategy-related data (reduces API calls by 10-20x)
  const {
    activeStrategy,
    livePositions: livePositionsData,
    livePositionsLoading: isLoading,
    livePositionsError: error,
    closedPositions,
    strategyChanges,
    assetPerformance,
  } = useStrategyData();

  // Fetch fills for each live position to get layer counts
  const livePositionIds = livePositionsData
    ?.filter(p => parseFloat(p.positionAmt) !== 0)
    .map(p => `live-${p.symbol}-${parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT'}`) || [];

  // Create a map of position fills
  const livePositionFills = useQuery({
    queryKey: ['/api/live/position-fills', livePositionIds],
    queryFn: async () => {
      if (!livePositionIds.length) return {};
      
      const fillsMap: Record<string, any[]> = {};
      
      // Fetch fills for all positions in parallel
      const results = await Promise.all(
        livePositionIds.map(async (positionId) => {
          try {
            const response = await fetch(`/api/positions/${positionId}/fills`);
            if (response.ok) {
              const fills = await response.json();
              return { positionId, fills };
            }
          } catch (error) {
            console.error(`Failed to fetch fills for ${positionId}:`, error);
          }
          return { positionId, fills: [] };
        })
      );
      
      results.forEach(({ positionId, fills }) => {
        fillsMap[positionId] = fills;
      });
      
      return fillsMap;
    },
    enabled: livePositionIds.length > 0,
    refetchInterval: 120000, // 2min fallback, WebSocket provides real-time
    retry: 2,
  });

  // Transform live positions to match Position interface for display
  const livePositionsSummary: PositionSummary | undefined = livePositionsData ? {
    positions: livePositionsData
      .filter(p => parseFloat(p.positionAmt) !== 0) // Filter out zero positions
      .map(p => {
        const notional = Math.abs(parseFloat(p.positionAmt) * parseFloat(p.entryPrice));
        const leverage = parseInt(p.leverage) || activeStrategy?.leverage || 1;
        // CRITICAL: totalCost must store MARGIN (notional / leverage), not notional!
        const margin = notional / leverage;
        
        const positionId = `live-${p.symbol}-${parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT'}`;
        const fills = livePositionFills.data?.[positionId] || [];
        
        // Calculate layers from fills - count unique layer numbers
        const uniqueLayers = new Set(fills.map((f: any) => f.layerNumber));
        const layersFilled = uniqueLayers.size || 1; // Default to 1 if no fills data
        
        return {
          id: positionId,
          symbol: p.symbol,
          side: parseFloat(p.positionAmt) > 0 ? 'long' as const : 'short' as const,
          avgEntryPrice: p.entryPrice,
          totalQuantity: Math.abs(parseFloat(p.positionAmt)).toString(),
          totalCost: margin.toString(), // Store margin, not notional!
          unrealizedPnl: p.unRealizedProfit && parseFloat(p.entryPrice) > 0 
            ? ((parseFloat(p.unRealizedProfit) / notional) * 100).toString()
            : '0',
          realizedPnl: '0', // Live positions from exchange don't have realized P&L
          leverage, // Include leverage for liquidation donut calculation
          layersFilled,
          maxLayers: activeStrategy?.maxLayers || 5,
          lastLayerPrice: p.entryPrice, // Use entry price as last layer price
          isOpen: true,
          openedAt: new Date(),
          updatedAt: new Date(),
          closedAt: null,
          sessionId: activeStrategy?.id || '',
        };
      }),
    sessionId: activeStrategy?.id || '',
    totalExposure: livePositionsData.reduce((sum, p) => 
      sum + Math.abs(parseFloat(p.positionAmt) * parseFloat(p.markPrice || p.entryPrice || 0)), 0
    ),
    currentBalance: 0, // Will be updated from account data
    startingBalance: 0,
    totalPnl: 0,
    realizedPnl: 0,
    winRate: 0,
    totalTrades: 0,
    activePositions: livePositionsData.filter(p => parseFloat(p.positionAmt) !== 0).length,
    unrealizedPnl: livePositionsData.reduce((sum, p) => sum + parseFloat(p.unRealizedProfit || '0'), 0),
  } : undefined;

  // Use live positions summary (live-only mode)
  const displaySummary = livePositionsSummary;

  // Calculate top 3 performing assets by total P&L (only from closed positions)
  const top3Assets = useMemo(() => {
    if (!assetPerformance || assetPerformance.length === 0) return [];
    
    // Filter out assets with no trades
    const validAssets = assetPerformance.filter(asset => 
      (asset.totalTrades || 0) > 0
    );
    
    if (validAssets.length === 0) return [];
    
    return validAssets
      .sort((a, b) => (b.totalPnl || 0) - (a.totalPnl || 0))
      .slice(0, 3);
  }, [assetPerformance]);

  // Calculate bottom 3 performing assets by total P&L
  const bottom3Assets = useMemo(() => {
    if (!assetPerformance || assetPerformance.length === 0) return [];
    
    // Filter out assets with no trades
    const validAssets = assetPerformance.filter(asset => 
      (asset.totalTrades || 0) > 0
    );
    
    if (validAssets.length === 0) return [];
    
    return validAssets
      .sort((a, b) => (a.totalPnl || 0) - (b.totalPnl || 0))
      .slice(0, 3);
  }, [assetPerformance]);

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
    if (!displaySummary?.positions) return new Set<string>();
    
    const symbolSides = new Map<string, Set<'long' | 'short'>>();
    
    // Group positions by symbol and track their sides
    displaySummary.positions.forEach(pos => {
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
  }, [displaySummary?.positions]);

  // Track previous positions for sound notifications
  const prevPositionsRef = useRef<Map<string, { layersFilled: number; isOpen: boolean }>>(new Map());
  const prevClosedCountRef = useRef<number>(0);

  // Sound notifications for trading events
  useEffect(() => {
    if (!displaySummary?.positions) return;

    const currentPositionsMap = new Map<string, { layersFilled: number; isOpen: boolean }>();
    
    // Build map of current positions
    displaySummary.positions.forEach(pos => {
      currentPositionsMap.set(pos.id, {
        layersFilled: pos.layersFilled,
        isOpen: pos.isOpen
      });
    });

    // Check for new positions (new trades)
    currentPositionsMap.forEach((current, positionId) => {
      const prev = prevPositionsRef.current.get(positionId);
      
      if (!prev) {
        // New position detected
        soundNotifications.newTrade();
      } else if (current.layersFilled > prev.layersFilled) {
        // Layer added to existing position
        soundNotifications.layerAdded();
      }
    });

    // Check for closed positions (TP or SL hit)
    // Use closedPositions count instead of tracking individual closes to avoid false positives
    if (closedPositions && closedPositions.length > prevClosedCountRef.current) {
      // A position was closed - check the most recent one
      const recentlyClosed = closedPositions[0]; // Already sorted newest first
      if (recentlyClosed) {
        const pnlPercent = parseFloat(recentlyClosed.unrealizedPnl);
        if (pnlPercent > 0) {
          soundNotifications.takeProfitHit();
        } else if (pnlPercent < 0) {
          soundNotifications.stopLossHit();
        }
      }
    }

    // Update refs
    prevPositionsRef.current = currentPositionsMap;
    if (closedPositions) {
      prevClosedCountRef.current = closedPositions.length;
    }
  }, [displaySummary?.positions, closedPositions]);

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
  const hasError = error && errorStatus !== 404 && errorStatus !== 429;
  const hasNoSession = error && errorStatus === 404;
  const isRateLimited = error && errorStatus === 429;

  if (isRateLimited) {
    // Rate limited - show a friendly message instead of an error
    return (
      <Card data-testid="strategy-status-rate-limited">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Position data will load in a moment...</p>
        </CardContent>
      </Card>
    );
  }

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
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getPnlColor = (pnl: number) => {
    if (pnl > 0) return "text-lime-600 dark:text-lime-400";
    if (pnl < 0) return "text-red-700 dark:text-red-500";
    return "text-muted-foreground";
  };

  const totalReturnPercent = displaySummary ? ((displaySummary.totalPnl || 0) / (displaySummary.startingBalance || 1)) * 100 : 0;
  
  // Calculate current balance including unrealized P&L
  const currentBalanceWithUnrealized = displaySummary 
    ? displaySummary.currentBalance + (displaySummary.unrealizedPnl || 0)
    : 0;
  
  // Calculate available margin (current balance minus margin in use)
  const leverage = activeStrategy?.leverage || 1;
  const marginInUse = displaySummary ? (displaySummary.totalExposure / leverage) : 0;
  const availableMargin = displaySummary ? (displaySummary.currentBalance - marginInUse) : 0;

  return (
    <div className="space-y-6">
    <Card data-testid="strategy-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Transactions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Top 3 and Worst 3 Performing Assets */}
        {(top3Assets.length > 0 || bottom3Assets.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Top 3 Performing Assets */}
            {top3Assets.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Award className="h-3 w-3" />
                  Top 3 Performing Assets
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {top3Assets.map((asset, index) => (
                    <div 
                      key={asset.symbol} 
                      className="flex flex-col p-2 md:p-3 rounded-lg bg-muted/30 border border-border"
                      data-testid={`card-top-asset-${index + 1}`}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <Badge variant="outline" className="font-mono text-[10px] md:text-xs px-1 py-0">
                          #{index + 1}
                        </Badge>
                        <span className="font-semibold text-xs md:text-sm truncate">{asset.symbol}</span>
                      </div>
                      <div className={`text-sm md:text-lg font-mono font-bold ${(asset.totalPnl || 0) >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`}>
                        {(asset.totalPnl || 0) >= 0 ? '+' : ''}${(asset.totalPnl || 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] md:text-xs text-muted-foreground truncate">
                        {asset.wins}W-{asset.losses}L · {asset.winRate.toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom 3 Performing Assets */}
            {bottom3Assets.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                  <TrendingDown className="h-3 w-3" />
                  Worst 3 Performing Assets
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {bottom3Assets.map((asset, index) => (
                    <div 
                      key={asset.symbol} 
                      className="flex flex-col p-2 md:p-3 rounded-lg bg-muted/30 border border-border"
                      data-testid={`card-worst-asset-${index + 1}`}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <Badge variant="outline" className="font-mono text-[10px] md:text-xs px-1 py-0">
                          #{index + 1}
                        </Badge>
                        <span className="font-semibold text-xs md:text-sm truncate">{asset.symbol}</span>
                      </div>
                      <div className={`text-sm md:text-lg font-mono font-bold ${(asset.totalPnl || 0) >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`}>
                        {(asset.totalPnl || 0) >= 0 ? '+' : ''}${(asset.totalPnl || 0).toFixed(2)}
                      </div>
                      <div className="text-[10px] md:text-xs text-muted-foreground truncate">
                        {asset.wins}W-{asset.losses}L · {asset.winRate.toFixed(0)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <Tabs defaultValue="active" className="w-full mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active" data-testid="tab-active-positions">
              Active Positions
              {displaySummary?.positions && displaySummary.positions.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {displaySummary.positions.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed" data-testid="tab-completed-positions">
              Completed Positions
              {closedPositions && closedPositions.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {closedPositions.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-3 md:mt-4">
            {displaySummary?.positions && displaySummary.positions.length > 0 ? (
              <div className="space-y-2">
                {displaySummary.positions.map((position) => (
                  <PositionCard
                    key={position.id}
                    position={position}
                    strategy={activeStrategy}
                    onClose={() => {
                      setPositionToClose(position);
                      setIsCloseConfirmOpen(true);
                    }}
                    isClosing={closePositionMutation.isPending}
                    formatCurrency={formatCurrency}
                    formatPercentage={formatPercentage}
                    getPnlColor={getPnlColor}
                    isHedge={hedgeSymbols.has(position.symbol)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No active positions</p>
                <p className="text-sm text-muted-foreground">Positions will appear here when your strategy triggers trades</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed" className="mt-3 md:mt-4">
            {tradeHistory && tradeHistory.filter(item => item.type === 'trade').length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar">
                {tradeHistory
                  .filter(item => item.type === 'trade')
                  .map((item) => (
                    <CompletedTradeCard key={item.data.id} position={item.data} formatCurrency={formatCurrency} formatPercentage={formatPercentage} getPnlColor={getPnlColor} isHedge={closedHedgePositions.get(item.data.id) || false} />
                  ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No completed positions yet</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>

    {/* Close Position Confirmation Dialog */}
    <Dialog open={isCloseConfirmOpen} onOpenChange={setIsCloseConfirmOpen}>
      <DialogContent data-testid="dialog-close-position-confirm">
        <DialogHeader>
          <DialogTitle>Close Position</DialogTitle>
          <DialogDescription>
            Are you sure you want to close this position?
            {positionToClose && (
              <div className="mt-4 p-3 rounded-lg bg-muted/50 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{positionToClose.symbol}</span>
                  <Badge className={positionToClose.side === 'long' ? 'bg-lime-500/15 text-lime-300 border-lime-400/30' : 'bg-red-600/15 text-red-400 border-red-500/30'}>
                    {positionToClose.side.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="text-foreground">{parseFloat(positionToClose.totalQuantity).toFixed(4)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Avg Entry</span>
                  <span className="text-foreground">{formatCurrency(parseFloat(positionToClose.avgEntryPrice))}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Unrealized P&L</span>
                  <span className={getPnlColor(parseFloat(positionToClose.unrealizedPnl))}>
                    {parseFloat(positionToClose.unrealizedPnl) >= 0 ? '+' : ''}{parseFloat(positionToClose.unrealizedPnl).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setIsCloseConfirmOpen(false);
              setPositionToClose(null);
            }}
            data-testid="button-cancel-close-position"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (positionToClose) {
                closePositionMutation.mutate(positionToClose.id);
                setIsCloseConfirmOpen(false);
                setPositionToClose(null);
              }
            }}
            disabled={closePositionMutation.isPending}
            data-testid="button-confirm-close-position"
          >
            {closePositionMutation.isPending ? "Closing..." : "Close Position"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}