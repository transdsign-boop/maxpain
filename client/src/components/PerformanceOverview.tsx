import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Target, Award, Activity, LineChart, DollarSign, Percent, ChevronLeft, ChevronRight } from "lucide-react";
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
  fundingCost: number;
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

interface AssetPerformance {
  symbol: string;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  totalTrades: number;
}

export default function PerformanceOverview() {
  // Pagination state for chart
  const [chartEndIndex, setChartEndIndex] = useState<number | null>(null);
  const TRADES_PER_PAGE = 50;
  
  // Fetch active strategy to check if live trading is enabled
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 15000,
  });
  const activeStrategy = strategies?.find(s => s.isActive);
  const isLiveMode = activeStrategy?.tradingMode === 'live';

  // Fetch paper session data
  const { data: paperSession, isLoading: paperSessionLoading } = useQuery<SessionSummary>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'],
    refetchInterval: 15000,
    enabled: !isLiveMode && !!activeStrategy,
    retry: 2,
  });

  // Fetch live account data when in live mode
  const { data: liveAccount, isLoading: liveAccountLoading } = useQuery<LiveAccountData>({
    queryKey: ['/api/live/account'],
    refetchInterval: 30000,
    enabled: !!isLiveMode && !!activeStrategy,
    retry: 2,
  });

  // Fetch performance overview (works for both modes)
  const { data: performance, isLoading } = useQuery<PerformanceMetrics>({
    queryKey: ['/api/performance/overview'],
    refetchInterval: 15000,
  });

  // Fetch chart data - unified endpoint for both modes
  const { data: rawChartData, isLoading: chartLoading } = useQuery<TradeDataPoint[]>({
    queryKey: ['/api/performance/chart'],
    refetchInterval: 15000,
  });

  // Fetch asset performance data
  const { data: assetPerformance } = useQuery<AssetPerformance[]>({
    queryKey: ['/api/analytics/asset-performance'],
    refetchInterval: 15000,
  });

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

  // Use unified chart data for both modes
  const sourceChartData = rawChartData || [];
  
  // Calculate pagination
  const totalTrades = sourceChartData.length;
  
  // Set initial end index when data loads and update when viewing latest trades
  useMemo(() => {
    if (sourceChartData.length > 0) {
      if (chartEndIndex === null) {
        // Initial load - show latest trades
        setChartEndIndex(sourceChartData.length);
      } else if (chartEndIndex === totalTrades && totalTrades < sourceChartData.length) {
        // User is viewing latest trades and new trades arrived - update to show them
        setChartEndIndex(sourceChartData.length);
      }
    }
  }, [sourceChartData.length, chartEndIndex, totalTrades]);
  const actualEndIndex = chartEndIndex ?? totalTrades;
  const startIndex = Math.max(0, actualEndIndex - TRADES_PER_PAGE);
  const paginatedSourceData = sourceChartData.slice(startIndex, actualEndIndex);
  const canGoBack = startIndex > 0;
  const canGoForward = actualEndIndex < totalTrades;
  
  // Add interpolated points at zero crossings for smooth color transitions
  const chartData = paginatedSourceData.flatMap((point, index, arr) => {
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
  const unrealizedPnl = isLiveMode 
    ? (liveAccount ? parseFloat(liveAccount.totalUnrealizedProfit) : 0)
    : (paperSession?.unrealizedPnl || 0);
  
  const totalBalance = isLiveMode 
    ? (liveAccount ? parseFloat(liveAccount.totalWalletBalance || '0') + unrealizedPnl : 0)
    : (paperSession?.currentBalance || 0);
  
  // Calculate available balance accounting for margin in use
  const leverage = activeStrategy?.leverage || 1;
  const paperMarginInUse = paperSession ? (paperSession.totalExposure / leverage) : 0;
  const availableBalance = isLiveMode 
    ? (liveAccount ? parseFloat(liveAccount.availableBalance) : 0)
    : (paperSession ? paperSession.currentBalance - paperMarginInUse : 0);

  // Calculate percentages
  const unrealizedPnlPercent = totalBalance > 0 ? (unrealizedPnl / totalBalance) * 100 : 0;
  
  // For realized P&L percentage, use starting balance
  const startingBalance = isLiveMode 
    ? totalBalance - displayPerformance.totalRealizedPnl - unrealizedPnl
    : (paperSession?.startingBalance || 0);
  const realizedPnlPercent = startingBalance > 0 ? (displayPerformance.totalRealizedPnl / startingBalance) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Account Performance
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
      <CardContent className="space-y-6">
        {/* Top 3 and Worst 3 Performing Assets - Combined on Desktop */}
        {(top3Assets.length > 0 || bottom3Assets.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-border pb-4">
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

        {/* Main Balance Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Total Balance - Prominent */}
          <div className="space-y-2 lg:col-span-1">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Balance</div>
            </div>
            <div className="text-5xl font-mono font-bold" data-testid="text-total-balance">
              ${totalBalance.toFixed(2)}
            </div>
            <div className={`text-sm font-mono ${unrealizedPnl >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`}>
              Unrealized: {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
            </div>
            <div className={`text-xs text-muted-foreground`}>
              {unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%
            </div>
          </div>

          {/* Available & Realized */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Available</div>
              <div className="text-3xl font-mono font-bold" data-testid="text-available-balance">
                ${availableBalance.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                For trading
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Realized P&L</div>
              <div className={`text-3xl font-mono font-bold ${displayPerformance.totalRealizedPnl >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`} data-testid="text-realized-pnl">
                {formatCurrency(displayPerformance.totalRealizedPnl)}
              </div>
              <div className="text-xs text-muted-foreground">
                {realizedPnlPercent >= 0 ? '+' : ''}{realizedPnlPercent.toFixed(2)}% · {displayPerformance.totalTrades} trades
              </div>
            </div>
          </div>
        </div>

        {/* Trading Statistics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {/* Win Rate */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Target className="h-3 w-3 text-muted-foreground" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Win Rate</div>
            </div>
            <div className="text-2xl font-mono font-bold" data-testid="text-win-rate">
              {formatPercent(displayPerformance.winRate)}
            </div>
            <div className="text-xs text-muted-foreground">
              {displayPerformance.winningTrades}W · {displayPerformance.losingTrades}L
            </div>
          </div>

          {/* Total Trades */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Trades</div>
            </div>
            <div className="text-2xl font-mono font-bold" data-testid="text-total-trades">
              {displayPerformance.totalTrades}
            </div>
            <div className="text-xs text-muted-foreground">
              {displayPerformance.openTrades} open
            </div>
          </div>

          {/* Profit Factor */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-muted-foreground" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Profit Factor</div>
            </div>
            <div className={`text-2xl font-mono font-bold ${(displayPerformance.profitFactor ?? 0) >= 1 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`} data-testid="text-profit-factor">
              {(displayPerformance.profitFactor ?? 0) >= 999 ? '∞' : (displayPerformance.profitFactor ?? 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              {(displayPerformance.profitFactor ?? 0) >= 1 ? 'Profitable' : 'Unprofitable'}
            </div>
          </div>

          {/* Fees Paid */}
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Trading Fees</div>
            <div className="text-2xl font-mono font-bold" data-testid="text-fees-paid">
              ${(displayPerformance.totalFees || 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              Commission
            </div>
          </div>

          {/* Funding Cost */}
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Funding Cost</div>
            <div className="text-2xl font-mono font-bold" data-testid="text-funding-cost">
              ${(displayPerformance.fundingCost || 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              Total funding
            </div>
          </div>
        </div>

        {/* Performance Chart */}
        <div className="space-y-3">
          {/* Chart Navigation Controls */}
          {totalTrades > TRADES_PER_PAGE && (
            <div className="flex items-center justify-between px-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChartEndIndex(Math.max(TRADES_PER_PAGE, actualEndIndex - TRADES_PER_PAGE))}
                disabled={!canGoBack}
                data-testid="button-chart-previous"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous {TRADES_PER_PAGE}
              </Button>
              
              <div className="text-xs text-muted-foreground">
                Showing trades {startIndex + 1}-{actualEndIndex} of {totalTrades}
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChartEndIndex(Math.min(totalTrades, actualEndIndex + TRADES_PER_PAGE))}
                disabled={!canGoForward}
                data-testid="button-chart-next"
              >
                Next {TRADES_PER_PAGE}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
          
          <div className="relative h-64 md:h-80 -mx-8" style={{
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
                <Legend 
                  verticalAlign="bottom" 
                  height={28} 
                  wrapperStyle={{ paddingTop: '8px', fontSize: '11px' }} 
                  iconSize={10}
                />
                <ReferenceLine yAxisId="left" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <ReferenceLine yAxisId="right" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                {/* Vertical lines for strategy changes */}
                {strategyChanges?.map((change) => {
                  const changeTime = new Date(change.changedAt).getTime();
                  let tradeIndex = chartData.findIndex(trade => trade.timestamp >= changeTime);
                  
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
                        strokeWidth={1}
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
                {/* Negative P&L line (below zero) */}
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
                {/* Strategy Update indicator for legend */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={() => null}
                  name="Strategy Update"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  dot={false}
                  isAnimationActive={false}
                />
                {/* Positive P&L area */}
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
                {/* Negative P&L area */}
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
        </div>

        {/* Additional Metrics Ticker */}
        <div className="-mx-6 overflow-hidden bg-muted/30 border-y border-border py-3">
          <div className="ticker-wrapper">
            <div className="ticker-content">
              {/* First set */}
              <div className="ticker-item">
                <Award className="h-3 w-3 text-[rgb(190,242,100)]" />
                <span className="text-xs text-muted-foreground">Best Trade</span>
                <span className="text-xs font-mono font-semibold text-[rgb(190,242,100)]">{formatCurrency(displayPerformance.bestTrade)}</span>
              </div>
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)]" />
                <span className="text-xs text-muted-foreground">Worst Trade</span>
                <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)]">{formatCurrency(displayPerformance.worstTrade)}</span>
              </div>
              <div className="ticker-item">
                <Activity className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Avg Trade Time</span>
                <span className="text-xs font-mono font-semibold">{formatTradeTime(displayPerformance.averageTradeTimeMs)}</span>
              </div>
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)]" />
                <span className="text-xs text-muted-foreground">Max Drawdown</span>
                <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)]">{formatCurrency(displayPerformance.maxDrawdown)} ({displayPerformance.maxDrawdownPercent.toFixed(2)}%)</span>
              </div>
              <div className="ticker-item">
                <TrendingUp className="h-3 w-3 text-[rgb(190,242,100)]" />
                <span className="text-xs text-muted-foreground">Avg Win</span>
                <span className="text-xs font-mono font-semibold text-[rgb(190,242,100)]">{formatCurrency(displayPerformance.averageWin)}</span>
              </div>
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)]" />
                <span className="text-xs text-muted-foreground">Avg Loss</span>
                <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)]">{formatCurrency(displayPerformance.averageLoss)}</span>
              </div>
              {/* Duplicate set for seamless loop */}
              <div className="ticker-item">
                <Award className="h-3 w-3 text-[rgb(190,242,100)]" />
                <span className="text-xs text-muted-foreground">Best Trade</span>
                <span className="text-xs font-mono font-semibold text-[rgb(190,242,100)]">{formatCurrency(displayPerformance.bestTrade)}</span>
              </div>
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)]" />
                <span className="text-xs text-muted-foreground">Worst Trade</span>
                <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)]">{formatCurrency(displayPerformance.worstTrade)}</span>
              </div>
              <div className="ticker-item">
                <Activity className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Avg Trade Time</span>
                <span className="text-xs font-mono font-semibold">{formatTradeTime(displayPerformance.averageTradeTimeMs)}</span>
              </div>
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)]" />
                <span className="text-xs text-muted-foreground">Max Drawdown</span>
                <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)]">{formatCurrency(displayPerformance.maxDrawdown)} ({displayPerformance.maxDrawdownPercent.toFixed(2)}%)</span>
              </div>
              <div className="ticker-item">
                <TrendingUp className="h-3 w-3 text-[rgb(190,242,100)]" />
                <span className="text-xs text-muted-foreground">Avg Win</span>
                <span className="text-xs font-mono font-semibold text-[rgb(190,242,100)]">{formatCurrency(displayPerformance.averageWin)}</span>
              </div>
              <div className="ticker-item">
                <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)]" />
                <span className="text-xs text-muted-foreground">Avg Loss</span>
                <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)]">{formatCurrency(displayPerformance.averageLoss)}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
