import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Target, Award, Activity } from "lucide-react";

interface PerformanceMetrics {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  totalPnl: number;
  averageWin: number;
  averageLoss: number;
  bestTrade: number;
  worstTrade: number;
  profitFactor: number;
}

export default function PerformanceOverview() {
  const { data: performance, isLoading } = useQuery<PerformanceMetrics>({
    queryKey: ['/api/performance/overview'],
    refetchInterval: 5000,
  });

  if (isLoading || !performance) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading performance metrics...</div>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const isProfitable = performance.totalPnl >= 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Performance Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* Total P&L */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Total P&L</div>
            <div className={`text-xl font-mono font-semibold ${isProfitable ? 'text-green-500' : 'text-red-500'}`} data-testid="text-total-pnl">
              {formatCurrency(performance.totalPnl)}
            </div>
          </div>

          {/* Realized P&L */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Realized P&L</div>
            <div className={`text-xl font-mono font-semibold ${performance.totalRealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid="text-realized-pnl">
              {formatCurrency(performance.totalRealizedPnl)}
            </div>
          </div>

          {/* Unrealized P&L */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Unrealized P&L</div>
            <div className={`text-xl font-mono font-semibold ${performance.totalUnrealizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid="text-unrealized-pnl">
              {formatCurrency(performance.totalUnrealizedPnl)}
            </div>
          </div>

          {/* Win Rate */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Target className="h-3 w-3" />
              Win Rate
            </div>
            <div className="text-xl font-mono font-semibold" data-testid="text-win-rate">
              {formatPercent(performance.winRate)}
            </div>
            <div className="text-xs text-muted-foreground">
              {performance.winningTrades}W / {performance.losingTrades}L
            </div>
          </div>

          {/* Profit Factor */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Profit Factor</div>
            <div className={`text-xl font-mono font-semibold ${performance.profitFactor >= 1 ? 'text-green-500' : 'text-red-500'}`} data-testid="text-profit-factor">
              {performance.profitFactor >= 999 ? '∞' : performance.profitFactor.toFixed(2)}
            </div>
          </div>

          {/* Total Trades */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Total Trades</div>
            <div className="text-xl font-mono font-semibold" data-testid="text-total-trades">
              {performance.totalTrades}
            </div>
            <div className="text-xs text-muted-foreground">
              {performance.openTrades} open / {performance.closedTrades} closed
            </div>
          </div>

          {/* Average Win */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Avg Win
            </div>
            <div className="text-xl font-mono font-semibold text-green-500" data-testid="text-avg-win">
              {formatCurrency(performance.averageWin)}
            </div>
          </div>

          {/* Average Loss */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              Avg Loss
            </div>
            <div className="text-xl font-mono font-semibold text-red-500" data-testid="text-avg-loss">
              {formatCurrency(performance.averageLoss)}
            </div>
          </div>

          {/* Best Trade */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Award className="h-3 w-3" />
              Best Trade
            </div>
            <div className="text-xl font-mono font-semibold text-green-500" data-testid="text-best-trade">
              {formatCurrency(performance.bestTrade)}
            </div>
          </div>

          {/* Worst Trade */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Worst Trade</div>
            <div className="text-xl font-mono font-semibold text-red-500" data-testid="text-worst-trade">
              {formatCurrency(performance.worstTrade)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
