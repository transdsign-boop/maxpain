import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, Target, Layers } from "lucide-react";

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

interface StrategyStatusProps {
  sessionId: string | null;
}

export function StrategyStatus({ sessionId }: StrategyStatusProps) {
  const { data: summary, isLoading, error } = useQuery<PositionSummary>({
    queryKey: ['/api/positions', sessionId, 'summary'],
    enabled: !!sessionId,
    refetchInterval: 5000, // Refresh every 5 seconds for real-time P&L
    retry: (failureCount, error: any) => {
      // Don't retry 404 errors - they indicate no trade session exists
      if (error?.status === 404) return false;
      return failureCount < 3;
    },
  });

  if (!sessionId) {
    return (
      <Card data-testid="strategy-status-no-session">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No active trading session. Start a strategy to view positions.</p>
        </CardContent>
      </Card>
    );
  }

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
            <p className="text-lg font-semibold" data-testid="current-balance">
              {formatCurrency(summary?.currentBalance || 0)}
            </p>
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
            <p className="text-sm text-muted-foreground">Active Positions</p>
            <p className="text-lg font-semibold" data-testid="active-positions">
              {summary?.activePositions || 0}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total Exposure</p>
            <p className="text-lg font-semibold" data-testid="total-exposure">
              {formatCurrency(summary?.totalExposure || 0)}
            </p>
          </div>
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
              {summary.positions.map((position) => {
                const unrealizedPnl = parseFloat(position.unrealizedPnl);
                const pnlPercent = (unrealizedPnl / parseFloat(position.totalCost)) * 100;
                
                return (
                  <div
                    key={position.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                    data-testid={`position-${position.symbol}`}
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{position.symbol}</span>
                          <Badge variant={position.side === 'long' ? 'default' : 'secondary'}>
                            {position.side === 'long' ? (
                              <TrendingUp className="h-3 w-3 mr-1" />
                            ) : (
                              <TrendingDown className="h-3 w-3 mr-1" />
                            )}
                            {position.side.toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {position.layersFilled}/{position.maxLayers}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {parseFloat(position.totalQuantity).toFixed(4)} @ {formatCurrency(parseFloat(position.avgEntryPrice))}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-medium ${getPnlColor(unrealizedPnl)}`}>
                        {formatCurrency(unrealizedPnl)}
                      </p>
                      <p className={`text-sm ${getPnlColor(pnlPercent)}`}>
                        {formatPercentage(pnlPercent)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No active positions</p>
            <p className="text-sm text-muted-foreground">Positions will appear here when your strategy triggers trades</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}