import { useMemo, useState, useEffect, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { TrendingUp, TrendingDown, Target, Award, Activity, LineChart, DollarSign, Percent, Calendar as CalendarIcon, X } from "lucide-react";
import { ComposedChart, Line, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, Label } from "recharts";
import { format, subDays, subMinutes, subHours, startOfDay, endOfDay } from "date-fns";
import { useStrategyData } from "@/hooks/use-strategy-data";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

function PerformanceOverview() {
  // Date range filter state
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  
  // Pagination and zoom state for chart
  const [chartEndIndex, setChartEndIndex] = useState<number | null>(null);
  const [tradesPerPage, setTradesPerPage] = useState<number>(50);
  const [isDateFiltered, setIsDateFiltered] = useState(false);
  
  // Use centralized hook for all strategy-related data (reduces API calls by 10-20x)
  const {
    activeStrategy,
    liveAccount,
    liveAccountLoading,
    performance,
    performanceLoading: isLoading,
    performanceError,
    chartData: rawChartData,
    chartDataLoading: chartLoading,
    chartDataError,
    assetPerformance,
    livePositions,
    strategyChanges,
    transfers,
    realizedPnlEvents,
    realizedPnlTotal,
    realizedPnlCount,
    realizedPnlLoading,
  } = useStrategyData();

  // Fetch commissions and funding fees with date range filtering
  // Always enforce Oct 1st start date (1759276800000) as minimum
  const commissionsQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/commissions', dateRange.start?.getTime(), dateRange.end?.getTime()],
    queryFn: async () => {
      const params = new URLSearchParams();
      // Use Oct 1st as minimum start time
      const minStartTime = 1759276800000;
      const effectiveStartTime = dateRange.start 
        ? Math.max(dateRange.start.getTime(), minStartTime)
        : minStartTime;
      
      params.append('startTime', effectiveStartTime.toString());
      
      if (dateRange.end) {
        params.append('endTime', dateRange.end.getTime().toString());
      }
      
      const url = `/api/commissions?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch commissions');
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  const fundingFeesQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/funding-fees', dateRange.start?.getTime(), dateRange.end?.getTime()],
    queryFn: async () => {
      const params = new URLSearchParams();
      // Use Oct 1st as minimum start time
      const minStartTime = 1759276800000;
      const effectiveStartTime = dateRange.start 
        ? Math.max(dateRange.start.getTime(), minStartTime)
        : minStartTime;
      
      params.append('startTime', effectiveStartTime.toString());
      
      if (dateRange.end) {
        params.append('endTime', dateRange.end.getTime().toString());
      }
      
      const url = `/api/funding-fees?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch funding fees');
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
  });

  const commissions = commissionsQuery.data;
  const fundingFees = fundingFeesQuery.data;

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

  // Convert realized P&L events to chart data format
  const rawSourceData = useMemo(() => {
    if (!realizedPnlEvents || realizedPnlEvents.length === 0) return [];
    
    let cumulativePnl = 0;
    return realizedPnlEvents.map((event, index) => {
      const pnl = parseFloat(event.income || '0');
      cumulativePnl += pnl;
      
      return {
        tradeNumber: index + 1,
        timestamp: event.time,
        symbol: event.symbol,
        side: pnl > 0 ? 'long' : 'short', // Inferred from P&L direction
        pnl: pnl,
        cumulativePnl: cumulativePnl,
        entryPrice: 0, // Not available from P&L events
        quantity: 0, // Not available from P&L events
      };
    });
  }, [realizedPnlEvents]);
  
  // Apply date range filter
  const sourceChartData = useMemo(() => {
    if (!dateRange.start && !dateRange.end) return rawSourceData;
    
    // Use raw timestamps for sub-day filters (15 min, 1 hour, 2 hours, 4 hours)
    // This preserves exact time filtering without rounding to start/end of day
    const startTimestamp = dateRange.start ? dateRange.start.getTime() : 0;
    const endTimestamp = dateRange.end ? dateRange.end.getTime() : Date.now();
    
    return rawSourceData.filter(trade => 
      trade.timestamp >= startTimestamp && trade.timestamp <= endTimestamp
    );
  }, [rawSourceData, dateRange]);
  
  // Calculate pagination
  const totalTrades = sourceChartData.length;
  
  // Handle pagination and zoom based on date filter
  useEffect(() => {
    if (sourceChartData.length === 0) return;
    
    const hasFilter = !!(dateRange.start || dateRange.end);
    setIsDateFiltered(hasFilter);
    
    // Always show all trades in the range (zoom to fit)
    setChartEndIndex(sourceChartData.length);
    setTradesPerPage(sourceChartData.length);
  }, [dateRange, sourceChartData.length]);
  
  // Update chart when new trades arrive and user is viewing latest
  useEffect(() => {
    if (sourceChartData.length > 0 && chartEndIndex === totalTrades && totalTrades < sourceChartData.length) {
      setChartEndIndex(sourceChartData.length);
    }
  }, [sourceChartData.length, chartEndIndex, totalTrades]);
  
  // Clamp end index to prevent out-of-bounds slicing
  const actualEndIndex = Math.min(chartEndIndex ?? totalTrades, totalTrades);
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

  // Mutation to update max portfolio risk
  const updateRiskMutation = useMutation({
    mutationFn: async (newRisk: number) => {
      if (!activeStrategy) return;
      const response = await apiRequest('PUT', `/api/strategies/${activeStrategy.id}`, {
        maxPortfolioRiskPercent: newRisk.toFixed(2)
      });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
    },
  });

  // Local state for slider (to avoid updating on every drag)
  const [localRiskLimit, setLocalRiskLimit] = useState<number>(
    activeStrategy ? parseFloat(activeStrategy.maxPortfolioRiskPercent) : 15
  );

  // Update local state when strategy changes
  useEffect(() => {
    if (activeStrategy) {
      setLocalRiskLimit(parseFloat(activeStrategy.maxPortfolioRiskPercent));
    }
  }, [activeStrategy?.maxPortfolioRiskPercent]);

  // Use unified performance data (live-only mode)
  // Recalculate metrics when date filter is active
  const displayPerformance = useMemo(() => {
    const basePerformance = performance || {
      totalTrades: 0,
      openTrades: 0,
      closedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalRealizedPnl: 0,
      totalUnrealizedPnl: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      averageWin: 0,
      averageLoss: 0,
      bestTrade: 0,
      worstTrade: 0,
      profitFactor: 0,
      totalFees: 0,
      fundingCost: 0,
      averageTradeTimeMs: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
    };

    // Sum commissions and funding fees (already filtered by date range from API)
    const commissionRecords = commissions?.records || [];
    const totalCommissions = commissionRecords.reduce((sum: number, c: any) => 
      sum + Math.abs(parseFloat(c.income || '0')), 0
    );

    const fundingFeeRecords = fundingFees?.records || [];
    const totalFundingFees = fundingFeeRecords.reduce((sum: number, f: any) => 
      sum + parseFloat(f.income || '0'), 0
    );

    // Use realized P&L events from exchange as source of truth for trade counts
    // Filter by date range if active
    let filteredPnlEvents = realizedPnlEvents || [];
    if (dateRange.start || dateRange.end) {
      const startTimestamp = dateRange.start ? dateRange.start.getTime() : 0;
      const endTimestamp = dateRange.end ? dateRange.end.getTime() : Date.now();
      
      filteredPnlEvents = filteredPnlEvents.filter(event => 
        event.time >= startTimestamp && event.time <= endTimestamp
      );
    }

    // Calculate metrics from realized P&L events
    const winningTrades = filteredPnlEvents.filter(e => parseFloat(e.income) > 0);
    const losingTrades = filteredPnlEvents.filter(e => parseFloat(e.income) < 0);
    const totalWins = winningTrades.reduce((sum, e) => sum + parseFloat(e.income || '0'), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, e) => sum + parseFloat(e.income || '0'), 0));
    const totalRealizedPnl = filteredPnlEvents.reduce((sum, e) => sum + parseFloat(e.income || '0'), 0);
    
    return {
      ...basePerformance,
      totalTrades: filteredPnlEvents.length,
      closedTrades: filteredPnlEvents.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: filteredPnlEvents.length > 0 ? (winningTrades.length / filteredPnlEvents.length) * 100 : 0,
      totalRealizedPnl: totalRealizedPnl,
      totalPnl: totalRealizedPnl,
      averageWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
      averageLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
      bestTrade: filteredPnlEvents.length > 0 ? Math.max(...filteredPnlEvents.map(e => parseFloat(e.income || '0'))) : 0,
      worstTrade: filteredPnlEvents.length > 0 ? Math.min(...filteredPnlEvents.map(e => parseFloat(e.income || '0'))) : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 999 : 0),
      totalFees: totalCommissions,
      fundingCost: totalFundingFees,
    };
  }, [performance, dateRange, realizedPnlEvents, commissions, fundingFees]);
  const displayLoading = isLoading || chartLoading || liveAccountLoading;
  const showLoadingUI = displayLoading || !performance;

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

  // Calculate total deposited capital (only positive deposits, exclude withdrawals)
  const { totalDeposited, depositCount } = useMemo(() => {
    if (!transfers || transfers.length === 0) return { totalDeposited: 0, depositCount: 0 };
    
    // Filter to only include deposits (positive amounts)
    const deposits = transfers.filter(t => parseFloat(t.amount || '0') > 0);
    const totalDeposited = deposits.reduce((sum, transfer) => sum + parseFloat(transfer.amount || '0'), 0);
    
    return { totalDeposited, depositCount: deposits.length };
  }, [transfers]);

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

  // Calculate unified account metrics (live-only mode)
  const unrealizedPnl = liveAccount ? (parseFloat(liveAccount.totalUnrealizedProfit) || 0) : 0;
  const totalBalance = liveAccount ? (parseFloat(liveAccount.totalWalletBalance || '0') || 0) + unrealizedPnl : 0;
  
  // Calculate margin in use and exposure (live-only mode)
  const marginInUse = liveAccount ? (parseFloat(liveAccount.totalInitialMargin || '0') || 0) : 0;
  const leverage = activeStrategy?.leverage || 1;
  const totalExposure = marginInUse * leverage;
  
  // Calculate available balance for new positions (Total Balance - Margin Already In Use)
  const availableBalance = totalBalance - marginInUse;

  // Calculate percentages
  const unrealizedPnlPercent = totalBalance > 0 ? (unrealizedPnl / totalBalance) * 100 : 0;
  
  // Calculate true ROI based on deposited capital
  const totalPnl = (displayPerformance.totalRealizedPnl || 0) + unrealizedPnl;
  const trueROI = totalDeposited > 0 ? (totalPnl / totalDeposited) * 100 : 0;
  
  // For realized P&L percentage, use deposited capital
  const realizedPnlPercent = totalDeposited > 0 ? ((displayPerformance.totalRealizedPnl || 0) / totalDeposited) * 100 : 0;

  // Check if there's an error or loading (but don't return early - that breaks hooks order)
  const hasError = performanceError || chartDataError;

  // Render loading, error, or normal UI based on state
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Account Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {showLoadingUI ? (
          <div className="text-sm text-muted-foreground">Loading performance metrics...</div>
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-red-500 mb-4">⚠️ Failed to load performance data</div>
            <p className="text-sm text-muted-foreground mb-4">
              {performanceError ? "Performance metrics unavailable" : "Chart data unavailable"}
            </p>
            <Button 
              onClick={() => window.location.reload()} 
              variant="outline"
              size="sm"
            >
              Reload Page
            </Button>
          </div>
        ) : (
          <>
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
              
              {/* Risk Limit Slider */}
              <div className="mt-4 w-32 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Max Risk</span>
                  <span className="text-xs font-mono font-semibold">{localRiskLimit.toFixed(1)}%</span>
                </div>
                <Slider
                  value={[localRiskLimit]}
                  onValueChange={(value) => setLocalRiskLimit(value[0])}
                  onValueCommit={(value) => updateRiskMutation.mutate(value[0])}
                  min={1}
                  max={100}
                  step={0.5}
                  className="cursor-pointer"
                  data-testid="slider-max-risk"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>1%</span>
                  <span>100%</span>
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
          {/* Date Filter & Chart Controls */}
          <div className="flex items-center justify-between px-4 gap-3 flex-wrap">
            {/* Date Filter Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Preset Date Filters */}
              <Button
                variant={!dateRange.start && !dateRange.end ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: null, end: null })}
                data-testid="button-filter-all-time"
              >
                All Time
              </Button>
              <Button
                variant={(dateRange.start && Math.abs(dateRange.start.getTime() - subMinutes(new Date(), 15).getTime()) < 60000) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: subMinutes(new Date(), 15), end: new Date() })}
                data-testid="button-filter-15min"
              >
                15 Min
              </Button>
              <Button
                variant={(dateRange.start && Math.abs(dateRange.start.getTime() - subHours(new Date(), 1).getTime()) < 60000) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: subHours(new Date(), 1), end: new Date() })}
                data-testid="button-filter-1hour"
              >
                1 Hour
              </Button>
              <Button
                variant={(dateRange.start && Math.abs(dateRange.start.getTime() - subHours(new Date(), 2).getTime()) < 60000) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: subHours(new Date(), 2), end: new Date() })}
                data-testid="button-filter-2hours"
              >
                2 Hours
              </Button>
              <Button
                variant={(dateRange.start && Math.abs(dateRange.start.getTime() - subHours(new Date(), 4).getTime()) < 60000) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: subHours(new Date(), 4), end: new Date() })}
                data-testid="button-filter-4hours"
              >
                4 Hours
              </Button>
              <Button
                variant={(dateRange.start && Math.abs(dateRange.start.getTime() - subDays(new Date(), 1).getTime()) < 60000) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: subDays(new Date(), 1), end: new Date() })}
                data-testid="button-filter-1day"
              >
                Last 1 Day
              </Button>
              <Button
                variant={(dateRange.start && Math.abs(dateRange.start.getTime() - subDays(new Date(), 3).getTime()) < 60000) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: subDays(new Date(), 3), end: new Date() })}
                data-testid="button-filter-3days"
              >
                Last 3 Days
              </Button>
              <Button
                variant={(dateRange.start && Math.abs(dateRange.start.getTime() - subDays(new Date(), 7).getTime()) < 60000) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: subDays(new Date(), 7), end: new Date() })}
                data-testid="button-filter-7days"
              >
                Last 7 Days
              </Button>
              <Button
                variant={(dateRange.start && Math.abs(dateRange.start.getTime() - subDays(new Date(), 30).getTime()) < 60000) ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange({ start: subDays(new Date(), 30), end: new Date() })}
                data-testid="button-filter-30days"
              >
                Last 30 Days
              </Button>
              
              {/* Custom Date Picker */}
              <Popover open={dateFilterOpen} onOpenChange={setDateFilterOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-custom-date-filter">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    Custom Range
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-4" align="start">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Start Date</label>
                      <Calendar
                        mode="single"
                        selected={dateRange.start || undefined}
                        onSelect={(date) => setDateRange(prev => ({ ...prev, start: date || null }))}
                        data-testid="calendar-start-date"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">End Date</label>
                      <Calendar
                        mode="single"
                        selected={dateRange.end || undefined}
                        onSelect={(date) => setDateRange(prev => ({ ...prev, end: date || null }))}
                        disabled={(date) => dateRange.start ? date < dateRange.start : false}
                        data-testid="calendar-end-date"
                      />
                    </div>
                    <Button 
                      size="sm" 
                      className="w-full" 
                      onClick={() => setDateFilterOpen(false)}
                      data-testid="button-apply-date-filter"
                    >
                      Apply
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              
              {/* Active Filter Indicator */}
              {(dateRange.start || dateRange.end) && (
                <Badge variant="secondary" className="gap-1" data-testid="badge-active-filter">
                  <CalendarIcon className="h-3 w-3" />
                  {dateRange.start && format(dateRange.start, 'MMM d')}
                  {dateRange.start && dateRange.end && ' - '}
                  {dateRange.end && format(dateRange.end, 'MMM d')}
                  <X 
                    className="h-3 w-3 ml-1 cursor-pointer hover:text-destructive" 
                    onClick={() => setDateRange({ start: null, end: null })}
                    data-testid="button-clear-date-filter"
                  />
                </Badge>
              )}
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
                
                {/* Day grouping blocks - date labels at top */}
                {dayGroups.map((group, index) => (
                  <ReferenceArea
                    key={`day-date-${group.dateTimestamp}`}
                    x1={group.startTrade}
                    x2={group.endTrade}
                    yAxisId="left"
                    fill={index % 2 === 0 ? 'hsl(var(--accent))' : 'transparent'}
                    fillOpacity={0.15}
                    stroke={index % 2 === 0 ? 'hsl(var(--accent-border))' : 'transparent'}
                    strokeOpacity={0.3}
                    label={{
                      value: format(new Date(group.dateTimestamp), 'MMM d'),
                      position: 'insideTop',
                      fill: 'hsl(var(--foreground))',
                      fontSize: 12,
                      fontWeight: 600,
                      offset: 10
                    }}
                  />
                ))}
                
                {/* Day grouping blocks - trade count at bottom */}
                {dayGroups.map((group) => (
                  <ReferenceArea
                    key={`day-count-${group.dateTimestamp}`}
                    x1={group.startTrade}
                    x2={group.endTrade}
                    yAxisId="left"
                    fill="transparent"
                    label={{
                      value: `${group.trades} trades`,
                      position: 'insideBottom',
                      fill: 'hsl(var(--muted-foreground))',
                      fontSize: 11,
                      fontWeight: 500,
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
                          position: 'center',
                          fill: 'rgb(34, 197, 94)',
                          fontSize: 11,
                          fontWeight: 600,
                          angle: -90,
                          dx: -20,
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
        </>
        )}
      </CardContent>
    </Card>
  );
}

// Memoize component to prevent unnecessary re-renders when parent updates
export default memo(PerformanceOverview);
