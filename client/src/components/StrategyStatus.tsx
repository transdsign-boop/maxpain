import React, { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  
  // Calculate actual layers from entry fills (layerNumber > 0)
  const entryFills = fills?.filter(f => f.layerNumber > 0) || [];
  const actualLayersFilled = fills && entryFills.length > 0 ? entryFills.length : position.layersFilled;

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
  
  // Calculate SL and TP prices using sanitized values
  const stopLossPrice = position.side === 'long'
    ? avgEntry * (1 - sanitizedSL / 100)
    : avgEntry * (1 + sanitizedSL / 100);
    
  const takeProfitPrice = position.side === 'long'
    ? avgEntry * (1 + sanitizedTP / 100)
    : avgEntry * (1 - sanitizedTP / 100);

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
        className="relative rounded-2xl overflow-hidden ring-1 ring-border shadow-lg transition-all duration-300" 
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
            <div className="relative isolate overflow-hidden">
              {/* Gradient background */}
              <div className={`absolute inset-0 ${isLong ? 'bg-gradient-to-br from-lime-600/25 via-lime-500/10 to-transparent' : 'bg-gradient-to-br from-red-700/25 via-red-600/10 to-transparent'}`} />
              
              {/* Large background asset text */}
              <div className="absolute -left-2 top-1/2 -translate-y-1/2 select-none pointer-events-none">
                <span className={`font-black tracking-tight text-5xl leading-none whitespace-nowrap ${isLong ? 'text-lime-400/15' : 'text-red-500/15'}`}>
                  {position.symbol}
                </span>
              </div>

              <div className="relative p-3 space-y-2">
                {/* Symbol and badges row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="font-extrabold text-foreground text-2xl tracking-tight">{position.symbol}</div>
                    <button
                      className="rounded-lg flex items-center justify-center px-2 py-1 border-2 border-destructive bg-transparent text-destructive text-xs font-semibold transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid={`button-close-position-${position.symbol}`}
                      onClick={onClose}
                      disabled={isClosing}
                    >
                      Close
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-xs px-2 py-0.5 ${isLong ? 'bg-lime-500/15 text-lime-300 border-lime-400/30' : 'bg-red-600/15 text-red-400 border-red-500/30'}`}>
                      {isLong ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                      {position.side.toUpperCase()}
                    </Badge>
                    {isHedge && (
                      <Badge variant="secondary" className="text-xs">HEDGE</Badge>
                    )}
                  </div>
                </div>

                {/* Layers and leverage info */}
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded-lg text-xs text-muted-foreground bg-muted/50 border border-border/50">
                    {actualLayersFilled}/{position.maxLayers} Layers
                  </span>
                  <span className="px-2 py-1 rounded-lg text-xs text-muted-foreground bg-muted/50 border border-border/50">
                    {leverage}× • {formatCurrency(notionalValue)}
                  </span>
                </div>
              </div>
            </div>

            {/* Price data with large centered P&L (3 columns) */}
            <div className="px-3 py-4 grid grid-cols-[1fr_auto_1fr] gap-4 items-center border-t border-border/30 bg-background/30">
              {/* Left column: Avg and SL */}
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Avg:</div>
                  <div className="text-sm font-medium text-foreground">{formatCurrency(avgEntry)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">SL:</div>
                  <div className="text-sm text-red-700 dark:text-red-500">{formatCurrency(stopLossPrice)}</div>
                </div>
              </div>

              {/* Center: P&L (very large and prominent) */}
              <div className="flex flex-col items-center justify-center px-6 min-w-[140px]">
                <div className={`text-4xl font-black font-mono leading-none ${getPnlColor(unrealizedPnlDollar)}`}>
                  {unrealizedPnlDollar >= 0 ? '+' : ''}{formatCurrency(unrealizedPnlDollar)}
                </div>
                <div className={`text-xl font-bold font-mono mt-1 ${getPnlColor(unrealizedPnlPercent)}`}>
                  {unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%
                </div>
              </div>

              {/* Right column: Current and TP */}
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Current:</div>
                  <div className="text-sm font-semibold text-foreground" data-testid={`current-price-${position.symbol}`}>
                    {formatCurrency(currentPrice)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">TP:</div>
                  <div className="text-sm text-lime-600 dark:text-lime-400">{formatCurrency(takeProfitPrice)}</div>
                </div>
              </div>
            </div>

            {/* Liquidation and Actions row */}
            <div className="px-3 py-3 flex items-center justify-between gap-3 border-t border-border/30 bg-background/50">
              {/* Liquidation donut (if applicable) */}
              {liquidationPrice !== null && distanceToLiquidation !== null && (
                <div className="flex flex-col items-center">
                  <div className="relative" style={{ width: '60px', height: '60px' }}>
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
                      <div className={`text-xs font-bold ${distanceToLiquidation < 5 ? 'text-red-700' : distanceToLiquidation < 15 ? 'text-orange-500' : 'text-lime-600'}`}>
                        {distanceToLiquidation.toFixed(0)}%
                      </div>
                      <div className="text-[8px] text-muted-foreground">liq</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 ml-auto">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10" data-testid="button-toggle-layers">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </div>

          {/* Desktop: Grid layout */}
          <div className="hidden lg:grid lg:grid-cols-[minmax(180px,240px)_1fr_auto]">
            {/* Left: Asset label with edge-bleed */}
            <div className="relative isolate overflow-hidden">
              {/* Gradient background */}
              <div className={`absolute inset-0 ${isLong ? 'bg-gradient-to-br from-lime-600/25 via-lime-500/10 to-transparent' : 'bg-gradient-to-br from-red-700/25 via-red-600/10 to-transparent'}`} />
              
              {/* Large background asset text */}
              <div className="absolute -left-2 top-1/2 -translate-y-1/2 select-none pointer-events-none">
                <span className={`font-black tracking-tight text-5xl sm:text-6xl md:text-7xl leading-none whitespace-nowrap ${isLong ? 'text-lime-400/15' : 'text-red-500/15'}`}>
                  {position.symbol}
                </span>
              </div>

              {/* Top row: compact chips */}
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

              {/* Bottom: large asset label with close and expand buttons */}
              <div className="relative px-2 pb-2 flex items-center gap-2">
                <div className="font-extrabold text-foreground text-2xl tracking-tight">{position.symbol}</div>
                <button
                  className="rounded-lg flex items-center justify-center px-2 py-1 border-2 border-destructive bg-transparent text-destructive text-xs font-semibold transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid={`button-close-position-${position.symbol}`}
                  onClick={onClose}
                  disabled={isClosing}
                >
                  Close
                </button>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" data-testid="button-toggle-layers">
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>

            {/* Middle: price data with large centered P&L */}
            <div className="px-3 py-2 flex items-center justify-between gap-3">
              {/* Left column: Avg and SL */}
              <div className="space-y-1.5 flex-shrink-0">
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">Avg:</div>
                  <div className="text-[13px] text-foreground/90 truncate">{formatCurrency(avgEntry)}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">SL:</div>
                  <div className="text-[13px] text-red-700 dark:text-red-500 truncate">{formatCurrency(stopLossPrice)}</div>
                </div>
              </div>

              {/* Center: Large P&L */}
              <div className="flex flex-col items-center justify-center flex-1">
                <div className={`text-3xl font-black font-mono leading-none ${getPnlColor(unrealizedPnlDollar)}`}>
                  {unrealizedPnlDollar >= 0 ? '+' : ''}{formatCurrency(unrealizedPnlDollar)}
                </div>
                <div className={`text-lg font-bold font-mono mt-0.5 ${getPnlColor(unrealizedPnlPercent)}`}>
                  {unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%
                </div>
              </div>

              {/* Right column: Current and TP */}
              <div className="space-y-1.5 flex-shrink-0">
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">Current:</div>
                  <div className="text-[14px] font-semibold text-foreground truncate" data-testid={`current-price-${position.symbol}`}>
                    {formatCurrency(currentPrice)}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] text-muted-foreground truncate">TP:</div>
                  <div className="text-[13px] text-lime-600 dark:text-lime-400 truncate">{formatCurrency(takeProfitPrice)}</div>
                </div>
              </div>
            </div>

            {/* Liquidation Risk Donut */}
            {liquidationPrice !== null && distanceToLiquidation !== null && (
              <div className="flex flex-col items-center justify-center py-2 px-2 border-l border-border/30">
                <div className="relative" style={{ width: '80px', height: '80px' }}>
                  <svg viewBox="0 0 100 100" className="transform -rotate-90">
                    {/* Background circle */}
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="hsl(var(--muted))"
                      strokeWidth="8"
                    />
                    {/* Progress circle */}
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
                    <div className={`text-xs font-bold ${distanceToLiquidation < 5 ? 'text-red-700' : distanceToLiquidation < 15 ? 'text-orange-500' : 'text-lime-600'}`}>
                      {distanceToLiquidation.toFixed(0)}%
                    </div>
                    <div className="text-[8px] text-muted-foreground">to liq</div>
                  </div>
                </div>
              </div>
            )}
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
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const [positionToClose, setPositionToClose] = useState<Position | null>(null);

  // First, get active strategies
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 5000,
  });

  // Find the active strategy
  const activeStrategy = strategies?.find(s => s.isActive);

  // Then fetch positions using the strategy ID
  const isLiveMode = activeStrategy?.tradingMode === 'live';

  const { data: summary, isLoading, error } = useQuery<PositionSummary>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'],
    queryFn: async () => {
      const response = await fetch(`/api/strategies/${activeStrategy.id}/positions/summary`);
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
      return response.json();
    },
    enabled: !!activeStrategy?.id && !isLiveMode, // Only fetch database positions in paper mode
    refetchInterval: 10000, // Reduced to 10 seconds to avoid rate limiting
    retry: (failureCount, error: any) => {
      // Don't retry 404 errors - they indicate no trade session exists
      if (error?.status === 404) return false;
      return failureCount < 3;
    },
  });

  // Fetch live exchange positions when in live mode
  const { data: livePositionsData } = useQuery<any[]>({
    queryKey: ['/api/live/positions'],
    refetchInterval: 20000, // Reduced to 20 seconds to avoid rate limiting
    enabled: !!isLiveMode && !!activeStrategy,
    retry: 2,
  });

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
    enabled: !!isLiveMode && livePositionIds.length > 0,
    refetchInterval: 20000,
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
          sessionId: activeStrategy.id,
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

  // Use live positions summary when in live mode, otherwise use database summary
  const displaySummary = isLiveMode ? livePositionsSummary : summary;

  // Fetch closed positions when section is expanded
  // Backend automatically returns appropriate data based on trading mode
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
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Active Positions
          </CardTitle>
          {isLiveMode && (
            <Badge 
              variant="default" 
              className="bg-[rgb(190,242,100)] text-black hover:bg-[rgb(190,242,100)] font-semibold"
              data-testid="badge-live-mode-positions"
            >
              LIVE MODE
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Active Positions */}
        {displaySummary?.positions && displaySummary.positions.length > 0 ? (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Active Positions</h4>
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