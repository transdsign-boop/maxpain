import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Target, Award, Activity, LineChart, DollarSign, Percent, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { ComposedChart, Line, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, Label } from "recharts";
import { format } from "date-fns";
import { useStrategyData } from "@/hooks/use-strategy-data";

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
  totalInitialMargin: string;
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
  // Pagination and zoom state for chart
  const [chartEndIndex, setChartEndIndex] = useState<number | null>(null);
  const [tradesPerPage, setTradesPerPage] = useState<number>(50);
  
  // Use centralized hook for all strategy-related data (reduces API calls by 10-20x)
  const {
    activeStrategy,
    liveAccount,
    liveAccountLoading,
    performance,
    performanceLoading: isLoading,
    chartData: rawChartData,
    chartDataLoading: chartLoading,
    assetPerformance,
    livePositions,
    strategyChanges,
    transfers,
  } = useStrategyData();

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
  useEffect(() => {
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
  const startIndex = Math.max(0, actualEndIndex - tradesPerPage);
  const paginatedSourceData = sourceChartData.slice(startIndex, actualEndIndex);
  const canGoBack = startIndex > 0;
  const canGoForward = actualEndIndex < totalTrades;
  
  // Add interpolated points at zero crossings for smooth color transitions
  const chartData = useMemo(() => {
    if (paginatedSourceData.length === 0) return [];
    
    // Rebase cumulative P&L to start at zero for the visible window
    const baseline = paginatedSourceData[0].cumulativePnl;
    const rebasedData = paginatedSourceData.map(trade => ({
      ...trade,
      cumulativePnl: trade.cumulativePnl - baseline,
    }));
    
    // Add starting point at zero for cumulative P&L line
    const firstTrade = rebasedData[0];
    const startingPoint = {
      ...firstTrade,
      tradeNumber: firstTrade.tradeNumber - 0.5,
      timestamp: firstTrade.timestamp - 1000,
      pnl: 0,
      cumulativePnl: 0,
    };
    
    const withStartPoint = [startingPoint, ...rebasedData];
    
    return withStartPoint.flatMap((point, index, arr) => {
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
  }, [paginatedSourceData]);

  // Group trades by day for visual blocks - MOVED HERE to fix React Hooks order
  const dayGroups = useMemo(() => {
    if (!chartData || chartData.length === 0) return [];
    
    const groups: Array<{
      dateTimestamp: number;
      startTrade: number;
      endTrade: number;
      trades: number;
    }> = [];
    
    let currentDate: string | null = null;
    let currentDateTimestamp: number | null = null;
    let startTrade: number | null = null;
    
    chartData.forEach((trade, index) => {
      // Use local date for grouping
      const tradeLocalDate = new Date(trade.timestamp);
      const tradeDate = format(tradeLocalDate, 'yyyy-MM-dd');
      
      if (tradeDate !== currentDate) {
        // Save previous group
        if (currentDate && startTrade !== null && currentDateTimestamp !== null) {
          groups.push({
            dateTimestamp: currentDateTimestamp,
            startTrade,
            endTrade: chartData[index - 1].tradeNumber,
            trades: index - chartData.findIndex(t => {
              const tLocalDate = new Date(t.timestamp);
              return format(tLocalDate, 'yyyy-MM-dd') === currentDate;
            })
          });
        }
        
        // Start new group - store the actual timestamp
        currentDate = tradeDate;
        currentDateTimestamp = trade.timestamp;
        startTrade = trade.tradeNumber;
      }
    });
    
    // Add final group
    if (currentDate && startTrade !== null && currentDateTimestamp !== null) {
      const lastTrade = chartData[chartData.length - 1];
      groups.push({
        dateTimestamp: currentDateTimestamp,
        startTrade,
        endTrade: lastTrade.tradeNumber,
        trades: chartData.length - chartData.findIndex(t => {
          const tLocalDate = new Date(t.timestamp);
          return format(tLocalDate, 'yyyy-MM-dd') === currentDate;
        })
      });
    }
    
    return groups;
  }, [chartData]);

  // Calculate total risk (live-only mode)
  const { totalRisk, riskPercentage } = useMemo(() => {
    if (!activeStrategy) return { totalRisk: 0, riskPercentage: 0 };

    const stopLossPercent = Number(activeStrategy.stopLossPercent) || 2;
    const positions = livePositions ? livePositions.filter(p => parseFloat(p.positionAmt) !== 0) : [];

    // Calculate total balance for percentage
    const unrealizedPnl = liveAccount ? (parseFloat(liveAccount.totalUnrealizedProfit) || 0) : 0;
    const totalBalance = liveAccount ? (parseFloat(liveAccount.totalWalletBalance || '0') || 0) + unrealizedPnl : 0;

    const totalPotentialLoss = positions.reduce((sum, position) => {
      const entryPrice = parseFloat(position.entryPrice) || 0;
      const quantity = Math.abs(parseFloat(position.positionAmt) || 0);
      const isLong = (parseFloat(position.positionAmt) || 0) > 0;
      
      const stopLossPrice = isLong 
        ? entryPrice * (1 - stopLossPercent / 100)
        : entryPrice * (1 + stopLossPercent / 100);
      
      const lossPerUnit = isLong 
        ? entryPrice - stopLossPrice
        : stopLossPrice - entryPrice;
      
      const positionLoss = lossPerUnit * quantity;
      return sum + positionLoss;
    }, 0);

    const riskPct = totalBalance > 0 ? (totalPotentialLoss / totalBalance) * 100 : 0;
    return { totalRisk: totalPotentialLoss, riskPercentage: riskPct };
  }, [activeStrategy, livePositions, liveAccount]);

  // Use unified performance data (live-only mode)
  const displayPerformance = performance;
  const displayLoading = isLoading || chartLoading || liveAccountLoading;

  if (displayLoading || !displayPerformance) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" />
            Performance Overview
          </CardTitle>
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

  // Calculate unified domain that aligns zero across both axes
  const calculateUnifiedDomain = (): [number, number] => {
    if (!chartData || chartData.length === 0) return [-100, 100];
    
    // Get all values from both pnl bars and cumulative line
    const pnlValues = chartData.map(d => d.pnl);
    const cumulativeValues = chartData.map(d => d.cumulativePnl);
    
    // Find the overall min and max across both datasets
    const minValue = Math.min(...pnlValues, ...cumulativeValues, 0);
    const maxValue = Math.max(...pnlValues, ...cumulativeValues, 0);
    
    // Calculate range and add 15% padding to fill vertical space
    const range = maxValue - minValue;
    const padding = range * 0.15;
    
    // Return unified domain so zero aligns on both axes
    return [minValue - padding, maxValue + padding];
  };

  const unifiedDomain = calculateUnifiedDomain();
  const pnlDomain = unifiedDomain;
  const cumulativePnlDomain = unifiedDomain;

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

  // Calculate total deposited capital (only positive deposits, exclude withdrawals)
  const { totalDeposited, depositCount } = useMemo(() => {
    if (!transfers || transfers.length === 0) return { totalDeposited: 0, depositCount: 0 };
    
    // Filter to only include deposits (positive amounts)
    const deposits = transfers.filter(t => parseFloat(t.amount || '0') > 0);
    const totalDeposited = deposits.reduce((sum, transfer) => sum + parseFloat(transfer.amount || '0'), 0);
    
    return { totalDeposited, depositCount: deposits.length };
  }, [transfers]);

  // Calculate unified account metrics (live-only mode)
  const unrealizedPnl = liveAccount ? (parseFloat(liveAccount.totalUnrealizedProfit) || 0) : 0;
  const totalBalance = liveAccount ? (parseFloat(liveAccount.totalWalletBalance || '0') || 0) + unrealizedPnl : 0;
  
  // Calculate available balance
  const leverage = activeStrategy?.leverage || 1;
  const availableBalance = liveAccount ? (parseFloat(liveAccount.availableBalance) || 0) : 0;

  // Calculate margin in use and exposure (live-only mode)
  const marginInUse = liveAccount ? (parseFloat(liveAccount.totalInitialMargin || '0') || 0) : 0;
  const totalExposure = marginInUse * leverage;

  // Calculate percentages
  const unrealizedPnlPercent = totalBalance > 0 ? (unrealizedPnl / totalBalance) * 100 : 0;
  
  // Calculate true ROI based on deposited capital
  const totalPnl = (displayPerformance.totalRealizedPnl || 0) + unrealizedPnl;
  const trueROI = totalDeposited > 0 ? (totalPnl / totalDeposited) * 100 : 0;
  
  // For realized P&L percentage, use deposited capital
  const realizedPnlPercent = totalDeposited > 0 ? ((displayPerformance.totalRealizedPnl || 0) / totalDeposited) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Account Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main Balance Section with Risk Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr_auto] gap-6">
          {/* Total Balance - Prominent */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div className="text-sm text-muted-foreground uppercase tracking-wider">Total Balance</div>
            </div>
            <div className="text-7xl font-mono font-bold" data-testid="text-total-balance">
              ${totalBalance.toFixed(2)}
            </div>
            <div className={`text-base font-mono ${unrealizedPnl >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`}>
              Unrealized: {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
            </div>
            <div className={`text-sm text-muted-foreground`}>
              {unrealizedPnlPercent >= 0 ? '+' : ''}{unrealizedPnlPercent.toFixed(2)}%
            </div>
          </div>

          {/* Available, Deposited & Realized */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground uppercase tracking-wider">Available</div>
              <div className="text-4xl font-mono font-bold" data-testid="text-available-balance">
                ${availableBalance.toFixed(2)}
              </div>
              <div className="text-sm text-muted-foreground">
                For trading
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm text-muted-foreground uppercase tracking-wider">Total Deposited</div>
              </div>
              <div className="text-4xl font-mono font-bold" data-testid="text-total-deposited">
                ${totalDeposited.toFixed(2)}
              </div>
              <div className="text-sm text-muted-foreground">
                {depositCount} {depositCount === 1 ? 'deposit' : 'deposits'}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm text-muted-foreground uppercase tracking-wider">Realized P&L</div>
              <div className={`text-4xl font-mono font-bold ${displayPerformance.totalRealizedPnl >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`} data-testid="text-realized-pnl">
                {formatCurrency(displayPerformance.totalRealizedPnl)}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Percent className="h-3 w-3 text-muted-foreground" />
                <span className={`font-mono font-semibold ${trueROI >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`} data-testid="text-roi">
                  ROI: {trueROI >= 0 ? '+' : ''}{trueROI.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          {/* Risk Pressure Bar */}
          <div className="flex flex-col items-center gap-2 lg:border-l lg:pl-6" data-testid="container-risk-bar">
            <div className="text-xs text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap">Total Risk</div>
            <div className="relative flex flex-col items-center">
              {/* Vertical Bar Container */}
              <div className="relative h-40 w-12 bg-muted rounded-md overflow-hidden border border-border">
                {/* Risk Fill */}
                <div 
                  className={`absolute bottom-0 left-0 right-0 transition-all duration-300 ${
                    (() => {
                      const maxRisk = activeStrategy ? parseFloat(activeStrategy.maxPortfolioRiskPercent) : 15;
                      const redThreshold = maxRisk * 0.9; // Red at 90% of max
                      const orangeThreshold = maxRisk * 0.75; // Orange at 75% of max
                      
                      return riskPercentage >= redThreshold ? 'bg-red-600 dark:bg-red-500' :
                        riskPercentage >= orangeThreshold ? 'bg-orange-500 dark:bg-orange-400' :
                        'bg-lime-600 dark:bg-lime-500';
                    })()
                  }`}
                  style={{ height: `${Math.min(100, riskPercentage)}%` }}
                  data-testid="bar-risk-fill"
                />
                {/* Percentage Label Inside Bar */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-mono font-bold text-white mix-blend-difference">
                    {riskPercentage.toFixed(1)}%
                  </span>
                </div>
              </div>
              {/* Dollar Amount Below Bar */}
              <div className="mt-2 text-center">
                <div className="text-sm font-mono font-bold text-red-600 dark:text-red-400" data-testid="text-risk-amount">
                  -${totalRisk.toFixed(2)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  if all SL hit
                </div>
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
          {/* Chart Navigation & Zoom Controls */}
          <div className="flex items-center justify-between px-4 gap-3">
            {/* Pagination Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChartEndIndex(Math.max(tradesPerPage, actualEndIndex - tradesPerPage))}
                disabled={!canGoBack}
                data-testid="button-chart-previous"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev
              </Button>
              
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                {tradesPerPage >= totalTrades ? (
                  `All ${totalTrades} trades`
                ) : (
                  `${startIndex + 1}-${actualEndIndex} of ${totalTrades}`
                )}
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChartEndIndex(Math.min(totalTrades, actualEndIndex + tradesPerPage))}
                disabled={!canGoForward}
                data-testid="button-chart-next"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const newZoom = Math.min(totalTrades, tradesPerPage * 2);
                  setTradesPerPage(newZoom);
                  // Adjust view to keep current position centered
                  const centerTrade = startIndex + Math.floor((actualEndIndex - startIndex) / 2);
                  const newEnd = Math.min(totalTrades, centerTrade + Math.floor(newZoom / 2));
                  setChartEndIndex(newEnd);
                }}
                disabled={tradesPerPage >= totalTrades}
                data-testid="button-chart-zoom-out"
                title="Zoom out (see more trades)"
              >
                <ZoomOut className="h-4 w-4 mr-1" />
                {tradesPerPage >= totalTrades ? 'All' : `${tradesPerPage}→${Math.min(totalTrades, tradesPerPage * 2)}`}
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const newZoom = Math.max(25, Math.floor(tradesPerPage / 2));
                  setTradesPerPage(newZoom);
                  // Adjust view to keep current position centered
                  const centerTrade = startIndex + Math.floor((actualEndIndex - startIndex) / 2);
                  const newEnd = Math.min(totalTrades, centerTrade + Math.floor(newZoom / 2));
                  setChartEndIndex(newEnd);
                }}
                disabled={tradesPerPage <= 25}
                data-testid="button-chart-zoom-in"
                title="Zoom in (see fewer trades)"
              >
                <ZoomIn className="h-4 w-4 mr-1" />
                {tradesPerPage <= 25 ? 'Min' : `${tradesPerPage}→${Math.max(25, Math.floor(tradesPerPage / 2))}`}
              </Button>
            </div>
          </div>
          
          <div className="relative h-64 md:h-80 -mx-8" style={{
            maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)'
          }}>
          {!chartLoading && chartData && chartData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 30 }}>
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
                
                {/* Day grouping blocks */}
                {dayGroups.map((group, index) => (
                  <ReferenceArea
                    key={`day-${group.dateTimestamp}`}
                    x1={group.startTrade}
                    x2={group.endTrade}
                    yAxisId="left"
                    fill={index % 2 === 0 ? 'hsl(var(--accent))' : 'transparent'}
                    fillOpacity={0.15}
                    stroke={index % 2 === 0 ? 'hsl(var(--accent-border))' : 'transparent'}
                    strokeOpacity={0.3}
                    label={{
                      value: `${format(new Date(group.dateTimestamp), 'MMM d')} • ${group.trades} trades`,
                      position: 'insideBottom',
                      fill: 'hsl(var(--foreground))',
                      fontSize: 12,
                      fontWeight: 600,
                      offset: 10
                    }}
                  />
                ))}
                
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

                {/* Vertical markers for transfer events (deposits) */}
                {transfers?.map((transfer) => {
                  const transferTime = new Date(transfer.timestamp).getTime();
                  let tradeIndex = chartData.findIndex(trade => trade.timestamp >= transferTime);
                  
                  if (tradeIndex === -1 && chartData.length > 0) {
                    tradeIndex = chartData.length - 1;
                  }
                  
                  if (tradeIndex >= 0) {
                    const amount = parseFloat(transfer.amount || '0');
                    return (
                      <ReferenceLine
                        key={transfer.id}
                        x={chartData[tradeIndex].tradeNumber}
                        yAxisId="left"
                        stroke="rgb(34, 197, 94)"
                        strokeWidth={2}
                        label={{
                          value: `+$${amount.toFixed(2)}`,
                          position: 'top',
                          fill: 'rgb(34, 197, 94)',
                          fontSize: 11,
                          fontWeight: 600,
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
                <DollarSign className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">In Use</span>
                <span className="text-xs font-mono font-semibold" data-testid="ticker-margin-in-use">{formatCurrency(marginInUse)}</span>
              </div>
              <div className="ticker-item">
                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Exposure</span>
                <span className="text-xs font-mono font-semibold" data-testid="ticker-total-exposure">{formatCurrency(totalExposure)}</span>
              </div>
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
                <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)]">{formatCurrency(displayPerformance.maxDrawdown)} ({(displayPerformance.maxDrawdownPercent ?? 0).toFixed(2)}%)</span>
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
                <DollarSign className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">In Use</span>
                <span className="text-xs font-mono font-semibold">{formatCurrency(marginInUse)}</span>
              </div>
              <div className="ticker-item">
                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Exposure</span>
                <span className="text-xs font-mono font-semibold">{formatCurrency(totalExposure)}</span>
              </div>
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
                <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)]">{formatCurrency(displayPerformance.maxDrawdown)} ({(displayPerformance.maxDrawdownPercent ?? 0).toFixed(2)}%)</span>
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
