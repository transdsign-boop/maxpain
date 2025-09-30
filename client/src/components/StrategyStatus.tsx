import React, { useState } from "react";
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
}

function PositionCard({ position, strategy, onClose, isClosing, formatCurrency, formatPercentage, getPnlColor }: PositionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { data: fills } = useQuery<Fill[]>({
    queryKey: ['/api/positions', position.id, 'fills'],
    enabled: isExpanded,
  });

  const unrealizedPnl = parseFloat(position.unrealizedPnl);
  const pnlPercent = (unrealizedPnl / parseFloat(position.totalCost)) * 100;
  const avgEntry = parseFloat(position.avgEntryPrice);
  
  // Calculate current price from unrealized P&L
  // unrealizedPnl is stored as percentage in the database
  const currentPrice = position.side === 'long'
    ? avgEntry * (1 + pnlPercent / 100)
    : avgEntry * (1 - pnlPercent / 100);
  
  // Calculate SL and TP based on strategy settings
  const stopLossPercent = strategy ? parseFloat(strategy.stopLossPercent) : 2;
  const profitTargetPercent = strategy ? parseFloat(strategy.profitTargetPercent) : 1;
  
  const stopLossPrice = position.side === 'long'
    ? avgEntry * (1 - stopLossPercent / 100)
    : avgEntry * (1 + stopLossPercent / 100);
    
  const takeProfitPrice = position.side === 'long'
    ? avgEntry * (1 + profitTargetPercent / 100)
    : avgEntry * (1 - profitTargetPercent / 100);
  
  // Calculate margin (totalCost is already the leveraged position value)
  const leverage = strategy ? strategy.leverage : 1;
  const totalMargin = parseFloat(position.totalCost) / leverage;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="rounded-lg border bg-card" data-testid={`position-${position.symbol}`}>
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3 flex-1">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{position.symbol}</span>
                <Badge variant={position.side === 'long' ? 'default' : 'secondary'} className="text-xs">
                  {position.side === 'long' ? (
                    <TrendingUp className="h-3 w-3 mr-1" />
                  ) : (
                    <TrendingDown className="h-3 w-3 mr-1" />
                  )}
                  {position.side.toUpperCase()}
                </Badge>
                <Badge variant="outline" className="flex items-center gap-1 text-xs">
                  <Layers className="h-3 w-3" />
                  {position.layersFilled}/{position.maxLayers}
                </Badge>
                <Badge variant="outline" className="text-xs" data-testid={`leverage-${position.symbol}`}>
                  {leverage}x • {formatCurrency(totalMargin)}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Avg: {formatCurrency(avgEntry)}</span>
                <span className="font-medium text-foreground" data-testid={`current-price-${position.symbol}`}>
                  Current: {formatCurrency(currentPrice)}
                </span>
                <span className="text-red-600 dark:text-red-400">SL: {formatCurrency(stopLossPrice)}</span>
                <span className="text-emerald-600 dark:text-emerald-400">TP: {formatCurrency(takeProfitPrice)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className={`font-medium ${getPnlColor(unrealizedPnl)}`}>
                {formatCurrency(unrealizedPnl)}
              </p>
              <p className={`text-sm ${getPnlColor(pnlPercent)}`}>
                {formatPercentage(pnlPercent)}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              data-testid={`button-close-position-${position.symbol}`}
              onClick={onClose}
              disabled={isClosing}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t px-3 py-2">
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

  // Close position mutation - must be defined before any early returns
  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      const response = await apiRequest('POST', `/api/positions/${positionId}/close`);
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Position Closed",
        description: `Closed ${data.position.symbol} position with ${data.pnlPercent >= 0 ? '+' : ''}${data.pnlPercent.toFixed(2)}% P&L ($${data.pnlDollar >= 0 ? '+' : ''}${data.pnlDollar.toFixed(2)})`,
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
    if (pnl > 0) return "text-emerald-600 dark:text-emerald-400";
    if (pnl < 0) return "text-red-600 dark:text-red-400";
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
          Strategy Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Portfolio Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Current Balance</p>
            <p className={`text-lg font-semibold ${getPnlColor(summary?.unrealizedPnl || 0)}`} data-testid="current-balance">
              {formatCurrency(currentBalanceWithUnrealized)}
            </p>
            {summary && summary.unrealizedPnl !== 0 && (
              <p className="text-xs text-muted-foreground">
                Base: {formatCurrency(summary.currentBalance)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total P&L</p>
            <p className={`text-lg font-semibold ${getPnlColor(summary?.totalPnl || 0)}`} data-testid="total-pnl">
              {formatCurrency(summary?.totalPnl || 0)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total Return</p>
            <p className={`text-lg font-semibold ${getPnlColor(totalReturnPercent)}`} data-testid="total-return">
              {formatPercentage(totalReturnPercent)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Win Rate</p>
            <p className="text-lg font-semibold" data-testid="win-rate">
              {summary?.winRate || 0}%
            </p>
          </div>
        </div>

        {/* Portfolio Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Available Margin</p>
            <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400" data-testid="available-margin">
              {formatCurrency(availableMargin)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Margin In Use</p>
            <p className="text-lg font-semibold" data-testid="margin-in-use">
              {formatCurrency(marginInUse)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total Exposure</p>
            <p className="text-lg font-semibold" data-testid="total-exposure">
              {formatCurrency(summary?.totalExposure || 0)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Active Positions</p>
            <p className="text-lg font-semibold" data-testid="active-positions">
              {summary?.activePositions || 0}
            </p>
          </div>
        </div>
        
        {/* P&L Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Unrealized P&L</p>
            <p className={`text-lg font-semibold ${getPnlColor(summary?.unrealizedPnl || 0)}`} data-testid="unrealized-pnl">
              {formatCurrency(summary?.unrealizedPnl || 0)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Realized P&L</p>
            <p className={`text-lg font-semibold ${getPnlColor(summary?.realizedPnl || 0)}`} data-testid="realized-pnl">
              {formatCurrency(summary?.realizedPnl || 0)}
            </p>
          </div>
        </div>

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
            {closedPositions && closedPositions.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {closedPositions.map((position) => {
                  const realizedPnl = parseFloat(position.realizedPnl);
                  const pnlPercent = (realizedPnl / parseFloat(position.totalCost)) * 100;
                  const avgEntry = parseFloat(position.avgEntryPrice);
                  
                  return (
                    <div
                      key={position.id}
                      className="p-4 rounded-lg border bg-card hover-elevate"
                      data-testid={`completed-trade-${position.id}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{position.symbol}</span>
                          <Badge 
                            variant={position.side === 'long' ? 'destructive' : 'default'}
                            className="text-xs"
                          >
                            {position.side.toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {position.layersFilled}/{position.maxLayers} layers
                          </Badge>
                        </div>
                        <div className={`text-sm font-semibold ${getPnlColor(realizedPnl)}`}>
                          {realizedPnl >= 0 ? '+' : ''}{formatCurrency(realizedPnl)}
                          <span className="text-xs ml-1">
                            ({realizedPnl >= 0 ? '+' : ''}{formatPercentage(pnlPercent)})
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <div>
                          Quantity: <span className="text-foreground">{parseFloat(position.totalQuantity).toFixed(4)}</span>
                        </div>
                        <div>
                          Entry: <span className="text-foreground">{formatCurrency(avgEntry)}</span>
                        </div>
                        <div>
                          Opened: <span className="text-foreground">{format(new Date(position.openedAt), 'MMM d, h:mm a')}</span>
                        </div>
                        <div>
                          Closed: <span className="text-foreground">{position.closedAt ? format(new Date(position.closedAt), 'MMM d, h:mm a') : 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  );
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