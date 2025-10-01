import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
}

export default function PerformanceOverview() {
  
  // Fetch active strategy to check if live trading is enabled
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 5000,
  });
  const activeStrategy = strategies?.find(s => s.isActive);
  const isLiveMode = activeStrategy?.isLiveTradingEnabled || false;

  // Fetch live account data when in live mode
  const { data: liveAccount } = useQuery<LiveAccountData>({
    queryKey: ['/api/live/account'],
    refetchInterval: 5000,
    enabled: isLiveMode,
  });

  const { data: performance, isLoading } = useQuery<PerformanceMetrics>({
    queryKey: ['/api/performance/overview'],
    refetchInterval: 5000,
  });

  const { data: rawChartData, isLoading: chartLoading } = useQuery<TradeDataPoint[]>({
    queryKey: ['/api/performance/chart'],
    refetchInterval: 5000,
  });

  // Add interpolated points at zero crossings for smooth color transitions
  const chartData = rawChartData ? rawChartData.flatMap((point, index, arr) => {
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
  }) : [];

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

  // Calculate live mode P&L if available
  const liveBalance = liveAccount ? parseFloat(liveAccount.totalWalletBalance) : 0;
  const liveUnrealizedPnl = liveAccount ? parseFloat(liveAccount.totalUnrealizedProfit) : 0;
  const liveAvailableBalance = liveAccount ? parseFloat(liveAccount.availableBalance) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            {isLiveMode ? 'Live Account Balance' : 'Performance Overview'}
          </CardTitle>
          {isLiveMode && (
            <Badge variant="default" className="bg-lime-500/20 text-lime-500 hover:bg-lime-500/30">
              LIVE DATA
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 md:space-y-8">
        {isLiveMode && liveAccount ? (
          /* Live Mode Display */
          <>
            <div className="flex flex-wrap items-end gap-6 md:gap-8">
              {/* Live Balance - Hero Size */}
              <div className="space-y-1 md:space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Balance</div>
                <div className="text-4xl md:text-6xl font-mono font-bold" data-testid="text-live-balance">
                  ${liveBalance.toFixed(2)}
                </div>
                <div className={`text-lg md:text-xl font-mono ${liveUnrealizedPnl >= 0 ? 'text-primary/80' : 'text-red-600/80'}`}>
                  Unrealized: {liveUnrealizedPnl >= 0 ? '+' : ''}${liveUnrealizedPnl.toFixed(2)}
                </div>
              </div>

              {/* Live Account Metrics */}
              <div className="flex gap-4 md:gap-8 flex-wrap">
                <div className="space-y-1 md:space-y-2">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Available</div>
                  <div className="text-3xl md:text-4xl font-mono font-bold" data-testid="text-available-balance">
                    ${liveAvailableBalance.toFixed(2)}
                  </div>
                  <div className="text-xs md:text-sm text-muted-foreground">
                    For trading
                  </div>
                </div>

                <div className="space-y-1 md:space-y-2">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Paper P&L</div>
                  <div className={`text-3xl md:text-4xl font-mono font-bold ${isProfitable ? 'text-primary' : 'text-red-600'}`}>
                    {formatCurrency(performance.totalPnl)}
                  </div>
                  <div className="text-xs md:text-sm text-muted-foreground">
                    {performance.totalTrades} trades
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Paper Trading Mode Display */
          <>
            <div className="flex flex-wrap items-end gap-6 md:gap-8">
              {/* Main P&L - Hero Size */}
              <div className="space-y-1 md:space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Total P&L</div>
                <div className={`text-4xl md:text-6xl font-mono font-bold ${isProfitable ? 'text-primary' : 'text-red-600'}`} data-testid="text-total-pnl">
                  {formatCurrency(performance.totalPnl)}
                </div>
                <div className={`text-lg md:text-xl font-mono ${isProfitable ? 'text-primary/80' : 'text-red-600/80'}`}>
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
                  <div className={`text-3xl md:text-4xl font-mono font-bold ${(performance.profitFactor ?? 0) >= 1 ? 'text-primary' : 'text-red-600'}`} data-testid="text-profit-factor">
                    {(performance.profitFactor ?? 0) >= 999 ? '∞' : (performance.profitFactor ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs md:text-sm text-muted-foreground">
                    {(performance.profitFactor ?? 0) >= 1 ? 'Profitable' : 'Unprofitable'}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

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

        {/* Moving Ticker - Trade Statistics */}
        <div className="-mx-6 overflow-hidden bg-muted/30 border-y border-border py-3">
          <div className="ticker-wrapper">
            <div className="ticker-content">
              {/* First set of stats */}
              <div className="ticker-item">
                <TrendingUp className="h-3 w-3 text-lime-500" />
                <span className="text-xs text-muted-foreground">Avg Win</span>
                <span className="text-sm font-mono font-semibold text-lime-500" data-testid="text-avg-win">{formatCurrency(performance.averageWin)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs text-muted-foreground">Avg Loss</span>
                <span className="text-sm font-mono font-semibold text-red-600" data-testid="text-avg-loss">{formatCurrency(-Math.abs(performance.averageLoss))}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <Award className="h-3 w-3 text-lime-500" />
                <span className="text-xs text-muted-foreground">Best</span>
                <span className="text-sm font-mono font-semibold text-lime-500" data-testid="text-best-trade">{formatCurrency(performance.bestTrade)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Worst</span>
                <span className="text-sm font-mono font-semibold text-red-600" data-testid="text-worst-trade">{formatCurrency(-Math.abs(performance.worstTrade))}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Fees Paid</span>
                <span className="text-sm font-mono font-semibold text-muted-foreground" data-testid="text-total-fees">-${(performance.totalFees ?? 0).toFixed(2)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Realized</span>
                <span className={`text-sm font-mono font-semibold ${performance.totalRealizedPnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>{formatCurrency(performance.totalRealizedPnl)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Unrealized</span>
                <span className={`text-sm font-mono font-semibold ${performance.totalUnrealizedPnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>{formatCurrency(performance.totalUnrealizedPnl)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs text-muted-foreground">Max Drawdown</span>
                <span className="text-sm font-mono font-semibold text-red-600">{formatCurrency(performance.maxDrawdown ?? 0)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Avg Time</span>
                <span className="text-sm font-mono font-semibold">{formatTradeTime(performance.averageTradeTimeMs)}</span>
              </div>
              
              {/* Duplicate set for seamless loop */}
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingUp className="h-3 w-3 text-lime-500" />
                <span className="text-xs text-muted-foreground">Avg Win</span>
                <span className="text-sm font-mono font-semibold text-lime-500">{formatCurrency(performance.averageWin)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs text-muted-foreground">Avg Loss</span>
                <span className="text-sm font-mono font-semibold text-red-600">{formatCurrency(-Math.abs(performance.averageLoss))}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <Award className="h-3 w-3 text-lime-500" />
                <span className="text-xs text-muted-foreground">Best</span>
                <span className="text-sm font-mono font-semibold text-lime-500">{formatCurrency(performance.bestTrade)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Worst</span>
                <span className="text-sm font-mono font-semibold text-red-600">{formatCurrency(-Math.abs(performance.worstTrade))}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Fees Paid</span>
                <span className="text-sm font-mono font-semibold text-muted-foreground">-${(performance.totalFees ?? 0).toFixed(2)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Realized</span>
                <span className={`text-sm font-mono font-semibold ${performance.totalRealizedPnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>{formatCurrency(performance.totalRealizedPnl)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Unrealized</span>
                <span className={`text-sm font-mono font-semibold ${performance.totalUnrealizedPnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>{formatCurrency(performance.totalUnrealizedPnl)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-red-600" />
                <span className="text-xs text-muted-foreground">Max Drawdown</span>
                <span className="text-sm font-mono font-semibold text-red-600">{formatCurrency(performance.maxDrawdown ?? 0)}</span>
              </div>
              <div className="ticker-separator" />
              <div className="ticker-item">
                <span className="text-xs text-muted-foreground">Avg Time</span>
                <span className="text-sm font-mono font-semibold">{formatTradeTime(performance.averageTradeTimeMs)}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
