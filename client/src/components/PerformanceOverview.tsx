import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Target, Award, Activity, LineChart, ChevronDown } from "lucide-react";
import { ComposedChart, Line, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Label } from "recharts";
import { format } from "date-fns";
import { useState } from "react";

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
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  
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
          <p className={`text-sm font-mono font-semibold ${data.pnl >= 0 ? 'text-lime-500' : 'text-orange-500'}`}>
            P&L: {data.pnl >= 0 ? '+' : ''}${Math.abs(data.pnl).toFixed(2)}
          </p>
          <p className={`text-sm font-mono font-semibold ${data.cumulativePnl >= 0 ? 'text-lime-500' : 'text-orange-500'}`}>
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
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Performance Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 md:space-y-8">
        {/* Hero Metrics - Most Important */}
        <div className="flex flex-wrap items-end gap-6 md:gap-8">
          {/* Main P&L - Hero Size */}
          <div className="space-y-1 md:space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Total P&L</div>
            <div className={`text-4xl md:text-6xl font-mono font-bold ${isProfitable ? 'text-primary' : 'text-orange-500'}`} data-testid="text-total-pnl">
              {formatCurrency(performance.totalPnl)}
            </div>
            <div className={`text-lg md:text-xl font-mono ${isProfitable ? 'text-primary/80' : 'text-orange-500/80'}`}>
              {(performance.totalPnlPercent ?? 0) >= 0 ? '+' : ''}{(performance.totalPnlPercent ?? 0).toFixed(2)}%
            </div>
          </div>

          {/* Key Metrics - Large Size */}
          <div className="flex gap-4 md:gap-8 flex-wrap">
            <div className="space-y-1 md:space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Target className="h-3 w-3" />
                Win Rate
              </div>
              <div className="text-3xl md:text-4xl font-mono font-bold" data-testid="text-win-rate">
                {formatPercent(performance.winRate)}
              </div>
              <div className="text-xs md:text-sm text-muted-foreground">
                {performance.winningTrades}W · {performance.losingTrades}L
              </div>
            </div>

            <div className="space-y-1 md:space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Trades</div>
              <div className="text-3xl md:text-4xl font-mono font-bold" data-testid="text-total-trades">
                {performance.totalTrades}
              </div>
              <div className="text-xs md:text-sm text-muted-foreground">
                {performance.openTrades} open · {performance.closedTrades} closed
              </div>
            </div>

            <div className="space-y-1 md:space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Profit Factor</div>
              <div className={`text-3xl md:text-4xl font-mono font-bold ${(performance.profitFactor ?? 0) >= 1 ? 'text-primary' : 'text-orange-500'}`} data-testid="text-profit-factor">
                {(performance.profitFactor ?? 0) >= 999 ? '∞' : (performance.profitFactor ?? 0).toFixed(2)}
              </div>
              <div className="text-xs md:text-sm text-muted-foreground">
                {(performance.profitFactor ?? 0) >= 1 ? 'Profitable' : 'Unprofitable'}
              </div>
            </div>
          </div>
        </div>

        {/* Performance Chart */}
        <div className="relative h-64 md:h-80">
          {!chartLoading && chartData && chartData.length > 0 ? (
            <>
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
                  tick={false}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  domain={cumulativePnlDomain}
                  tick={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <ReferenceLine yAxisId="left" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <ReferenceLine yAxisId="right" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
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
                        yAxisId="left"
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
                  <linearGradient id="positivePnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(190, 242, 100)" stopOpacity={0.3}/>
                    <stop offset="100%" stopColor="rgb(190, 242, 100)" stopOpacity={0.05}/>
                  </linearGradient>
                  <linearGradient id="negativePnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(251, 146, 60)" stopOpacity={0.05}/>
                    <stop offset="100%" stopColor="rgb(251, 146, 60)" stopOpacity={0.3}/>
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
                      fill={entry.pnl >= 0 ? 'rgba(190, 242, 100, 0.7)' : 'rgba(251, 146, 60, 0.7)'} 
                    />
                  ))}
                </Bar>
                {/* Positive P&L line (above zero) */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={(entry: any) => entry.cumulativePnl >= 0 ? entry.cumulativePnl : null}
                  name="Cumulative P&L (Profit)"
                  stroke="rgb(190, 242, 100)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {/* Negative P&L line (below zero) */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={(entry: any) => entry.cumulativePnl <= 0 ? entry.cumulativePnl : null}
                  name="Cumulative P&L (Loss)"
                  stroke="rgb(251, 146, 60)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {/* Positive P&L area (above zero) */}
                <Area 
                  yAxisId="right"
                  type="monotone" 
                  dataKey={(entry: any) => entry.cumulativePnl >= 0 ? entry.cumulativePnl : null}
                  stroke="none"
                  fill="url(#positivePnlGradient)"
                  dot={false}
                  connectNulls={false}
                  baseValue={0}
                  isAnimationActive={false}
                />
                {/* Negative P&L area (below zero) */}
                <Area 
                  yAxisId="right"
                  type="monotone" 
                  dataKey={(entry: any) => entry.cumulativePnl <= 0 ? entry.cumulativePnl : null}
                  stroke="none"
                  fill="url(#negativePnlGradient)"
                  dot={false}
                  connectNulls={false}
                  baseValue={0}
                  isAnimationActive={false}
                />
              </ComposedChart>
              </ResponsiveContainer>
            </>
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

        {/* Trade Statistics Section */}
        <Collapsible open={isStatsOpen} onOpenChange={setIsStatsOpen} className="pt-4 border-t border-border">
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full justify-between p-0 h-auto hover:bg-transparent"
              data-testid="button-toggle-trade-stats"
            >
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Trade Statistics</div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isStatsOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Avg Win
              </div>
              <div className="text-lg font-mono font-semibold text-lime-500" data-testid="text-avg-win">
                {formatCurrency(performance.averageWin)}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                Avg Loss
              </div>
              <div className="text-lg font-mono font-semibold text-orange-500" data-testid="text-avg-loss">
                {formatCurrency(-Math.abs(performance.averageLoss))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Award className="h-3 w-3" />
                Best
              </div>
              <div className="text-lg font-mono font-semibold text-lime-500" data-testid="text-best-trade">
                {formatCurrency(performance.bestTrade)}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Worst</div>
              <div className="text-lg font-mono font-semibold text-orange-500" data-testid="text-worst-trade">
                {formatCurrency(-Math.abs(performance.worstTrade))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Fees Paid</div>
              <div className="text-lg font-mono font-semibold text-muted-foreground" data-testid="text-total-fees">
                -${(performance.totalFees ?? 0).toFixed(2)}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Realized</div>
              <div className={`text-lg font-mono font-semibold ${performance.totalRealizedPnl >= 0 ? 'text-lime-500' : 'text-orange-500'}`}>
                {formatCurrency(performance.totalRealizedPnl)}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Unrealized</div>
              <div className={`text-lg font-mono font-semibold ${performance.totalUnrealizedPnl >= 0 ? 'text-lime-500' : 'text-orange-500'}`}>
                {formatCurrency(performance.totalUnrealizedPnl)}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                Max Drawdown
              </div>
              <div className="text-lg font-mono font-semibold text-orange-500">
                {formatCurrency(performance.maxDrawdown ?? 0)}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Avg Time</div>
              <div className="text-lg font-mono font-semibold">
                {formatTradeTime(performance.averageTradeTimeMs)}
              </div>
            </div>
          </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
