import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Target, Award, Activity, LineChart } from "lucide-react";
import { ComposedChart, Line, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
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
  totalPnlPercent: number;
  averageWin: number;
  averageLoss: number;
  bestTrade: number;
  worstTrade: number;
  profitFactor: number;
  totalFees: number;
  averageTradeTimeMs: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
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

  // Fetch active strategy
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 5000,
  });
  const activeStrategy = strategies?.find(s => s.isActive);

  // Fetch strategy changes for vertical lines
  const { data: strategyChanges } = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'changes'],
    enabled: !!activeStrategy?.id,
    refetchInterval: 10000,
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
    const absValue = Math.abs(value);
    
    // For very large values, use K/M notation
    if (absValue >= 1000000) {
      return `${sign}$${(value / 1000000).toFixed(2)}M`;
    } else if (absValue >= 10000) {
      return `${sign}$${(value / 1000).toFixed(2)}K`;
    } else {
      // Standard currency format with 2 decimals
      return `${sign}$${Math.abs(value).toFixed(2)}`;
    }
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const formatTradeTime = (ms: number) => {
    if (ms === 0) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      const remainingHours = hours % 24;
      return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    }
    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    return `${seconds}s`;
  };

  const isProfitable = performance.totalPnl >= 0;

  // Calculate symmetric domain for 1:1 scale
  const calculateSymmetricDomain = (data: TradeDataPoint[] | undefined, key: 'pnl' | 'cumulativePnl') => {
    if (!data || data.length === 0) return [-100, 100];
    
    const values = data.map(d => d[key]);
    const maxAbsValue = Math.max(...values.map(Math.abs));
    
    // Add 10% padding and round to nice numbers
    const paddedMax = maxAbsValue * 1.1;
    
    return [-paddedMax, paddedMax];
  };

  const pnlDomain = calculateSymmetricDomain(chartData, 'pnl');
  const cumulativePnlDomain = calculateSymmetricDomain(chartData, 'cumulativePnl');

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border border-border rounded-md p-3 shadow-lg">
          <p className="text-sm font-semibold mb-1">Trade #{data.tradeNumber}</p>
          <p className="text-xs text-muted-foreground mb-2">{format(new Date(data.timestamp), "MMM d, h:mm a")}</p>
          <p className="text-xs mb-1"><span className="font-medium">{data.symbol}</span> {data.side}</p>
          <p className={`text-sm font-mono font-semibold ${data.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            P&L: {data.pnl >= 0 ? '+' : ''}${Math.abs(data.pnl).toFixed(2)}
          </p>
          <p className={`text-sm font-mono font-semibold ${data.cumulativePnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            Cumulative: {data.cumulativePnl >= 0 ? '+' : ''}${Math.abs(data.cumulativePnl).toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Performance Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Performance Chart - On Top */}
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
                  domain={pnlDomain}
                  label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft' }}
                  tick={false}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  domain={cumulativePnlDomain}
                  label={{ value: 'Cumulative P&L ($)', angle: 90, position: 'insideRight' }}
                  tick={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <ReferenceLine yAxisId="left" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                {/* Vertical lines for strategy changes */}
                {strategyChanges?.map((change) => {
                  // Find the trade number at or after this change timestamp
                  const changeTime = new Date(change.changedAt).getTime();
                  let tradeIndex = chartData.findIndex(trade => trade.timestamp >= changeTime);
                  
                  // If no trade after change, use the last trade
                  if (tradeIndex === -1 && chartData.length > 0) {
                    tradeIndex = chartData.length - 1;
                  }
                  
                  if (tradeIndex >= 0) {
                    return (
                      <ReferenceLine
                        key={change.id}
                        x={chartData[tradeIndex].tradeNumber}
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        label={{
                          value: 'Strategy Updated',
                          position: 'top',
                          fill: 'hsl(var(--primary))',
                          fontSize: 10,
                        }}
                      />
                    );
                  }
                  return null;
                })}
                <defs>
                  <linearGradient id="cumulativePnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.6}/>
                    <stop offset="100%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <Bar 
                  yAxisId="left"
                  dataKey="pnl" 
                  name="Trade P&L"
                  barSize={20}
                  data-testid="chart-bar-pnl"
                >
                  {chartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.pnl >= 0 ? 'hsl(199, 89%, 48%)' : 'hsl(0, 84%, 60%)'} 
                    />
                  ))}
                </Bar>
                <Area 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="cumulativePnl" 
                  name="Cumulative P&L"
                  stroke="hsl(199, 89%, 48%)"
                  strokeWidth={2}
                  fill="url(#cumulativePnlGradient)"
                  dot={false}
                  data-testid="chart-area-cumulative"
                  label={({ index, value }: { index: number; value: number }) => {
                    // Only show label on the last point
                    if (index === chartData.length - 1) {
                      const formattedValue = formatCurrency(value);
                      return (
                        <text
                          x={0}
                          y={0}
                          dx={10}
                          dy={-5}
                          fill={value >= 0 ? 'hsl(142, 76%, 36%)' : 'hsl(0, 84%, 60%)'}
                          fontSize={14}
                          fontWeight="bold"
                        >
                          {formattedValue}
                        </text>
                      );
                    }
                    return null;
                  }}
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

        {/* Performance Metrics - Below Chart */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* Live P&L */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Live P&L</div>
            <div className={`text-xl font-mono font-semibold ${isProfitable ? 'text-green-500' : 'text-red-500'}`} data-testid="text-total-pnl">
              {formatCurrency(performance.totalPnl)}
            </div>
            <div className={`text-xs font-mono ${isProfitable ? 'text-green-500' : 'text-red-500'}`}>
              {performance.totalPnlPercent >= 0 ? '+' : ''}{performance.totalPnlPercent.toFixed(2)}%
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

          {/* Max Drawdown */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              Max Drawdown
            </div>
            <div className="text-xl font-mono font-semibold text-red-500" data-testid="text-max-drawdown">
              {formatCurrency(-performance.maxDrawdown)}
            </div>
            <div className="text-xs font-mono text-red-500">
              {performance.maxDrawdownPercent.toFixed(2)}%
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

          {/* Total Fees */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Total Fees</div>
            <div className="text-xl font-mono font-semibold text-red-500" data-testid="text-total-fees">
              ${performance.totalFees.toFixed(2)}
            </div>
          </div>

          {/* Average Trade Time */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Avg Time</div>
            <div className="text-xl font-mono font-semibold" data-testid="text-avg-trade-time">
              {formatTradeTime(performance.averageTradeTimeMs)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
