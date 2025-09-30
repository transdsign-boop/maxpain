import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Target, Award, Activity, LineChart } from "lucide-react";
import { ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { format } from "date-fns";

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

interface TradeDataPoint {
  tradeNumber: number;
  timestamp: number;
  symbol: string;
  side: string;
  pnl: number;
  cumulativePnl: number;
  entryPrice: number;
  quantity: number;
}

export default function PerformanceOverview() {
  const { data: performance, isLoading } = useQuery<PerformanceMetrics>({
    queryKey: ['/api/performance/overview'],
    refetchInterval: 5000,
  });

  const { data: chartData, isLoading: chartLoading } = useQuery<TradeDataPoint[]>({
    queryKey: ['/api/performance/chart'],
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

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border border-border rounded-md p-3 shadow-lg">
          <p className="text-sm font-semibold mb-1">Trade #{data.tradeNumber}</p>
          <p className="text-xs text-muted-foreground mb-2">{format(new Date(data.timestamp), "MMM d, h:mm a")}</p>
          <p className="text-xs mb-1"><span className="font-medium">{data.symbol}</span> {data.side}</p>
          <p className={`text-sm font-mono font-semibold ${data.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            P&L: {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
          </p>
          <p className={`text-sm font-mono font-semibold ${data.cumulativePnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            Cumulative: {data.cumulativePnl >= 0 ? '+' : ''}${data.cumulativePnl.toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
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

    {/* Performance Chart */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LineChart className="h-5 w-5" />
          Trading Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          {!chartLoading && chartData && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="tradeNumber" 
                  label={{ value: 'Trade #', position: 'insideBottom', offset: -5 }}
                  className="text-xs"
                />
                <YAxis 
                  yAxisId="left"
                  label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft' }}
                  className="text-xs"
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  label={{ value: 'Cumulative P&L ($)', angle: 90, position: 'insideRight' }}
                  className="text-xs"
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <ReferenceLine yAxisId="left" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Bar 
                  yAxisId="left"
                  dataKey="pnl" 
                  name="Trade P&L"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.6}
                  data-testid="chart-bar-pnl"
                >
                  {chartData.map((entry, index) => (
                    <rect 
                      key={`bar-${index}`}
                      fill={entry.pnl >= 0 ? 'hsl(142, 76%, 36%)' : 'hsl(0, 84%, 60%)'}
                    />
                  ))}
                </Bar>
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="cumulativePnl" 
                  name="Cumulative P&L"
                  stroke="hsl(217, 91%, 60%)"
                  strokeWidth={3}
                  dot={{ fill: 'hsl(217, 91%, 60%)', r: 4 }}
                  activeDot={{ r: 6 }}
                  data-testid="chart-line-cumulative"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center space-y-2">
                <LineChart className="h-12 w-12 mx-auto opacity-50" />
                <p className="text-sm font-medium">No Completed Trades Yet</p>
                <p className="text-xs">Start trading to see your performance chart</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
