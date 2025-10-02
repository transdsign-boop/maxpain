import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Target, Award, Activity, LineChart } from "lucide-react";
import { ComposedChart, Line, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Label } from "recharts";
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

interface LiveAccountData {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  usdcBalance: string;
}

interface SessionSummary {
  sessionId: string;
  startingBalance: number;
  currentBalance: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalExposure: number;
}

export default function PerformanceOverview() {
  
  // Fetch active strategy to check if live trading is enabled
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 5000,
  });
  const activeStrategy = strategies?.find(s => s.isActive);
  const isLiveMode = activeStrategy?.tradingMode === 'live';

  // Fetch paper session data
  const { data: paperSession, isLoading: paperSessionLoading } = useQuery<SessionSummary>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'],
    refetchInterval: 5000,
    enabled: !isLiveMode && !!activeStrategy,
    retry: 2,
  });

  // Fetch live account data when in live mode
  const { data: liveAccount, isLoading: liveAccountLoading } = useQuery<LiveAccountData>({
    queryKey: ['/api/live/account'],
    refetchInterval: 5000,
    enabled: !!isLiveMode && !!activeStrategy,
    retry: 2,
  });

  // Fetch performance overview (works for both modes)
  const { data: performance, isLoading } = useQuery<PerformanceMetrics>({
    queryKey: ['/api/performance/overview'],
    refetchInterval: 5000,
  });

  // Fetch chart data - unified endpoint for both modes
  const { data: rawChartData, isLoading: chartLoading } = useQuery<TradeDataPoint[]>({
    queryKey: ['/api/performance/chart'],
    refetchInterval: 5000,
  });

  // Use unified chart data for both modes
  const sourceChartData = rawChartData || [];
  
  // Add interpolated points at zero crossings for smooth color transitions
  const chartData = sourceChartData.flatMap((point, index, arr) => {
    if (index === 0) return [point];
    
    const prev = arr[index - 1];
    const curr = point;
    
    // Check if line crosses zero
    if ((prev.cumulativePnl >= 0 && curr.cumulativePnl < 0) || 
        (prev.cumulativePnl < 0 && curr.cumulativePnl >= 0)) {
      // Calculate interpolated point at zero
      const ratio = Math.abs(prev.cumulativePnl) / (Math.abs(prev.cumulativePnl) + Math.abs(curr.cumulativePnl));
      const interpolatedTradeNumber = prev.tradeNumber + ratio * (curr.tradeNumber - prev.tradeNumber);
      const interpolatedTimestamp = prev.timestamp + ratio * (curr.timestamp - prev.timestamp);
      
      return [
        {
          ...prev,
          tradeNumber: interpolatedTradeNumber - 0.001,
          timestamp: interpolatedTimestamp - 1,
          cumulativePnl: 0,
          pnl: 0
        },
        {
          ...curr,
          tradeNumber: interpolatedTradeNumber + 0.001,
          timestamp: interpolatedTimestamp + 1,
          cumulativePnl: 0,
          pnl: 0
        },
        curr
      ];
    }
    
    return [curr];
  });

  // Fetch strategy changes for vertical lines
  const { data: strategyChanges } = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'changes'],
    enabled: !!activeStrategy?.id,
    refetchInterval: 10000,
  });

  // Use unified performance data for both modes
  const displayPerformance = performance;
  const displayLoading = isLoading || chartLoading || (isLiveMode && liveAccountLoading) || (!isLiveMode && paperSessionLoading);

  if (displayLoading || !displayPerformance) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <LineChart className="h-5 w-5" />
              Performance Overview
            </CardTitle>
            {isLiveMode && (
              <Badge 
                variant="default" 
                className="bg-[rgb(190,242,100)] text-black hover:bg-[rgb(190,242,100)] font-semibold"
              >
                LIVE MODE
              </Badge>
            )}
          </div>
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

  const isProfitable = displayPerformance.totalPnl >= 0;

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
          <p className={`text-sm font-mono font-semibold ${data.pnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>
            P&L: {data.pnl >= 0 ? '+' : ''}${Math.abs(data.pnl).toFixed(2)}
          </p>
          <p className={`text-sm font-mono font-semibold ${data.cumulativePnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>
            Cumulative: {data.cumulativePnl >= 0 ? '+' : ''}${Math.abs(data.cumulativePnl).toFixed(2)}
          </p>
        </div>
      );
    }
    return null;
  };

  // Calculate unified account metrics (same for both live and paper)
  // In live mode: Use totalMarginBalance (wallet balance + unrealized PnL) + USDC balance for total equity
  // This matches what users expect to see as their "total account value"
  const totalBalance = isLiveMode 
    ? (liveAccount ? parseFloat(liveAccount.totalMarginBalance) + parseFloat(liveAccount.usdcBalance || '0') : 0)
    : (paperSession?.currentBalance || 0);
  
  const unrealizedPnl = isLiveMode 
    ? (liveAccount ? parseFloat(liveAccount.totalUnrealizedProfit) : 0)
    : (paperSession?.unrealizedPnl || 0);
  
  // Calculate available balance accounting for margin in use
  // For paper mode, subtract margin usage (totalExposure / leverage)
  const leverage = activeStrategy?.leverage || 1;
  const paperMarginInUse = paperSession ? (paperSession.totalExposure / leverage) : 0;
  const availableBalance = isLiveMode 
    ? (liveAccount ? parseFloat(liveAccount.availableBalance) : 0)
    : (paperSession ? paperSession.currentBalance - paperMarginInUse : 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            {isLiveMode ? 'Account Performance' : 'Performance Overview'}
          </CardTitle>
          {isLiveMode && (
            <Badge 
              variant="default" 
              className="bg-[rgb(190,242,100)] text-black hover:bg-[rgb(190,242,100)] font-semibold"
              data-testid="badge-live-mode-performance"
            >
              LIVE MODE
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 md:space-y-8">
        {/* Unified Display for Both Modes */}
        <div className="flex flex-wrap items-end gap-6 md:gap-8">
          {/* Total Balance - Hero Size */}
          <div className="space-y-1 md:space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Balance</div>
            <div className="text-4xl md:text-6xl font-mono font-bold" data-testid="text-total-balance">
              ${totalBalance.toFixed(2)}
            </div>
            <div className={`text-lg md:text-xl font-mono ${unrealizedPnl >= 0 ? 'text-primary/80' : 'text-red-600/80'}`}>
              Unrealized: {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
            </div>
          </div>

          {/* Account Metrics */}
          <div className="flex gap-4 md:gap-8 flex-wrap">
            <div className="space-y-1 md:space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Available</div>
              <div className="text-3xl md:text-4xl font-mono font-bold" data-testid="text-available-balance">
                ${availableBalance.toFixed(2)}
              </div>
              <div className="text-xs md:text-sm text-muted-foreground">
                For trading
              </div>
            </div>

            <div className="space-y-1 md:space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Realized P&L</div>
              <div className={`text-3xl md:text-4xl font-mono font-bold ${displayPerformance.totalRealizedPnl >= 0 ? 'text-primary' : 'text-red-600'}`} data-testid="text-realized-pnl">
                {formatCurrency(displayPerformance.totalRealizedPnl)}
              </div>
              <div className="text-xs md:text-sm text-muted-foreground">
                {displayPerformance.totalTrades} trades
              </div>
            </div>
          </div>
        </div>

        {/* Secondary Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Target className="h-3 w-3" />
              Win Rate
            </div>
            <div className="text-2xl md:text-3xl font-mono font-bold" data-testid="text-win-rate">
              {formatPercent(displayPerformance.winRate)}
            </div>
            <div className="text-xs text-muted-foreground">
              {displayPerformance.winningTrades}W · {displayPerformance.losingTrades}L
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Trades</div>
            <div className="text-2xl md:text-3xl font-mono font-bold" data-testid="text-total-trades">
              {displayPerformance.totalTrades}
            </div>
            <div className="text-xs text-muted-foreground">
              {displayPerformance.openTrades} open · {displayPerformance.closedTrades} closed
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Profit Factor</div>
            <div className={`text-2xl md:text-3xl font-mono font-bold ${(displayPerformance.profitFactor ?? 0) >= 1 ? 'text-primary' : 'text-red-600'}`} data-testid="text-profit-factor">
              {(displayPerformance.profitFactor ?? 0) >= 999 ? '∞' : (displayPerformance.profitFactor ?? 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              {(displayPerformance.profitFactor ?? 0) >= 1 ? 'Profitable' : 'Unprofitable'}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Fees Paid</div>
            <div className="text-2xl md:text-3xl font-mono font-bold" data-testid="text-fees-paid">
              ${(displayPerformance.totalFees || 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              Total fees
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Max Drawdown</div>
            <div className="text-2xl md:text-3xl font-mono font-bold text-red-600" data-testid="text-max-drawdown">
              ${(displayPerformance.maxDrawdown || 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              {(displayPerformance.maxDrawdownPercent || 0).toFixed(1)}% peak
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Avg Time</div>
            <div className="text-2xl md:text-3xl font-mono font-bold" data-testid="text-avg-time">
              {formatTradeTime(displayPerformance.averageTradeTimeMs || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              Per trade
            </div>
          </div>
        </div>

        {/* Performance Chart */}
        <div className="relative h-64 md:h-80 -mx-8 mb-8" style={{
          maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)'
        }}>
          {!chartLoading && chartData && chartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <XAxis 
                  dataKey="tradeNumber" 
                  label={{ value: 'Trade #', position: 'insideBottom', offset: -5 }}
                  className="text-xs"
                  axisLine={false}
                />
                <YAxis 
                  yAxisId="left"
                  domain={pnlDomain}
                  tick={false}
                  axisLine={false}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  domain={cumulativePnlDomain}
                  tick={false}
                  axisLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={52} wrapperStyle={{ paddingTop: '16px' }} />
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
                    <stop offset="0%" stopColor="rgb(220, 38, 38)" stopOpacity={0.05}/>
                    <stop offset="100%" stopColor="rgb(220, 38, 38)" stopOpacity={0.3}/>
                  </linearGradient>
                  <linearGradient id="splitLineGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(190, 242, 100)" stopOpacity={1}/>
                    <stop offset="50%" stopColor="rgb(190, 242, 100)" stopOpacity={1}/>
                    <stop offset="50%" stopColor="rgb(220, 38, 38)" stopOpacity={1}/>
                    <stop offset="100%" stopColor="rgb(220, 38, 38)" stopOpacity={1}/>
                  </linearGradient>
                </defs>
                <Bar 
                  yAxisId="left"
                  dataKey="pnl" 
                  barSize={20}
                  data-testid="chart-bar-pnl"
                  legendType="none"
                >
                  {chartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.pnl >= 0 ? 'rgba(190, 242, 100, 0.7)' : 'rgba(220, 38, 38, 0.7)'} 
                    />
                  ))}
                </Bar>
                {/* Positive P&L line (above zero) */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={(entry: any) => entry.cumulativePnl >= 0 ? entry.cumulativePnl : null}
                  name="Cumulative P&L"
                  stroke="rgb(190, 242, 100)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={true}
                  isAnimationActive={false}
                />
                {/* Negative P&L line (below zero) - no legend entry */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={(entry: any) => entry.cumulativePnl <= 0 ? entry.cumulativePnl : null}
                  name="Negative P&L"
                  stroke="rgb(220, 38, 38)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={true}
                  isAnimationActive={false}
                  legendType="none"
                />
                {/* Strategy Update indicator for legend only */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={() => null}
                  name="Strategy Update"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  isAnimationActive={false}
                />
                {/* Positive P&L area (above zero) */}
                <Area 
                  yAxisId="right"
                  type="monotone" 
                  dataKey={(entry: any) => entry.cumulativePnl >= 0 ? entry.cumulativePnl : null}
                  name="Positive P&L Area"
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
                  name="Negative P&L Area"
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

        {/* Moving Ticker - Trade Statistics */}
        <div className="-mx-6 overflow-hidden bg-muted/30 border-y border-border py-3">
          <div className="ticker-wrapper">
            <div className="ticker-content">
              {/* First set of stats */}
              <div className="ticker-item">
                <TrendingUp className="h-3 w-3 text-lime-500" />
                <span className="text-xs text-muted-foreground">Avg Win</span>
                <span className="text-sm font-mono font-semibold text-lime-500" data-testid="text-avg-win">{formatCurrency(displayPerformance.averageWin)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs text-muted-foreground">Avg Loss</span>
                <span className="text-sm font-mono font-semibold text-red-600" data-testid="text-avg-loss">{formatCurrency(-Math.abs(displayPerformance.averageLoss))}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <Award className="h-3 w-3 text-lime-500" />
                <span className="text-xs text-muted-foreground">Best</span>
                <span className="text-sm font-mono font-semibold text-lime-500" data-testid="text-best-trade">{formatCurrency(displayPerformance.bestTrade)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Worst</span>
                <span className="text-sm font-mono font-semibold text-red-600" data-testid="text-worst-trade">{formatCurrency(-Math.abs(displayPerformance.worstTrade))}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Fees Paid</span>
                <span className="text-sm font-mono font-semibold text-muted-foreground" data-testid="text-total-fees">-${(displayPerformance.totalFees ?? 0).toFixed(2)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Realized</span>
                <span className={`text-sm font-mono font-semibold ${displayPerformance.totalRealizedPnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>{formatCurrency(displayPerformance.totalRealizedPnl)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Unrealized</span>
                <span className={`text-sm font-mono font-semibold ${displayPerformance.totalUnrealizedPnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>{formatCurrency(displayPerformance.totalUnrealizedPnl)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs text-muted-foreground">Max Drawdown</span>
                <span className="text-sm font-mono font-semibold text-red-600">{formatCurrency(displayPerformance.maxDrawdown ?? 0)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Avg Time</span>
                <span className="text-sm font-mono font-semibold">{formatTradeTime(displayPerformance.averageTradeTimeMs)}</span>
              </div>
              
              {/* Duplicate set for seamless loop */}
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingUp className="h-3 w-3 text-lime-500" />
                <span className="text-xs text-muted-foreground">Avg Win</span>
                <span className="text-sm font-mono font-semibold text-lime-500">{formatCurrency(displayPerformance.averageWin)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs text-muted-foreground">Avg Loss</span>
                <span className="text-sm font-mono font-semibold text-red-600">{formatCurrency(-Math.abs(displayPerformance.averageLoss))}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <Award className="h-3 w-3 text-lime-500" />
                <span className="text-xs text-muted-foreground">Best</span>
                <span className="text-sm font-mono font-semibold text-lime-500">{formatCurrency(displayPerformance.bestTrade)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Worst</span>
                <span className="text-sm font-mono font-semibold text-red-600">{formatCurrency(-Math.abs(displayPerformance.worstTrade))}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Fees Paid</span>
                <span className="text-sm font-mono font-semibold text-muted-foreground">-${(displayPerformance.totalFees ?? 0).toFixed(2)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Realized</span>
                <span className={`text-sm font-mono font-semibold ${displayPerformance.totalRealizedPnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>{formatCurrency(displayPerformance.totalRealizedPnl)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Unrealized</span>
                <span className={`text-sm font-mono font-semibold ${displayPerformance.totalUnrealizedPnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>{formatCurrency(displayPerformance.totalUnrealizedPnl)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs text-muted-foreground">Max Drawdown</span>
                <span className="text-sm font-mono font-semibold text-red-600">{formatCurrency(displayPerformance.maxDrawdown ?? 0)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Avg Time</span>
                <span className="text-sm font-mono font-semibold">{formatTradeTime(displayPerformance.averageTradeTimeMs)}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
