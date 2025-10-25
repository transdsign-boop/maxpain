import { useMemo, useState, useEffect, memo, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { TrendingUp, TrendingDown, Target, Award, Activity, LineChart, DollarSign, Percent, Calendar as CalendarIcon, X, Wallet, Settings, ChevronDown, ChevronUp } from "lucide-react";
import AccountLedger from "@/components/AccountLedger";
import { ComposedChart, Line, Area, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot, Label } from "recharts";
import { format, subDays, subMinutes, subHours, startOfDay, endOfDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
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
  intervalPnlPercent: number;
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
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  expectancy: number;
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
  // Date range filter state - load from localStorage
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>(() => {
    const saved = localStorage.getItem('chart-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        start: parsed.dateRange?.start ? new Date(parsed.dateRange.start) : null,
        end: parsed.dateRange?.end ? new Date(parsed.dateRange.end) : null,
      };
    }
    return { start: null, end: null };
  });
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [depositFilterOpen, setDepositFilterOpen] = useState(false);
  const [selectedDepositId, setSelectedDepositId] = useState<string | null>(null);
  const [accountLedgerExpanded, setAccountLedgerExpanded] = useState(false);

  // Pagination and zoom state for chart
  const [chartEndIndex, setChartEndIndex] = useState<number | null>(null);
  const [tradesPerPage, setTradesPerPage] = useState<number>(50);
  const [isDateFiltered, setIsDateFiltered] = useState(false);

  // Manual trade selection state
  const [manualSelectionMode, setManualSelectionMode] = useState(false);
  const [selectedTradeRange, setSelectedTradeRange] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  // Strategy change dialog state
  const [selectedChange, setSelectedChange] = useState<any>(null);
  
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
    closedPositions,
    realizedPnlEvents,
    realizedPnlTotal,
    realizedPnlCount,
    realizedPnlLoading,
    portfolioRisk,
  } = useStrategyData();

  // Fetch commissions and funding fees with date range filtering
  // No minimum start date - fetch all historical data unless user specifies a range
  const commissionsQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/commissions', dateRange.start?.getTime(), dateRange.end?.getTime()],
    queryFn: async () => {
      const params = new URLSearchParams();

      if (dateRange.start) {
        params.append('startTime', dateRange.start.getTime().toString());
      }

      if (dateRange.end) {
        params.append('endTime', dateRange.end.getTime().toString());
      }

      const url = `/api/commissions?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch commissions');
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes (exchange API - avoid rate limits!)
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const fundingFeesQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/funding-fees', dateRange.start?.getTime(), dateRange.end?.getTime()],
    queryFn: async () => {
      const params = new URLSearchParams();

      if (dateRange.start) {
        params.append('startTime', dateRange.start.getTime().toString());
      }

      if (dateRange.end) {
        params.append('endTime', dateRange.end.getTime().toString());
      }

      const url = `/api/funding-fees?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch funding fees');
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes (exchange API - avoid rate limits!)
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const commissions = commissionsQuery.data;
  const fundingFees = fundingFeesQuery.data;

  // Fetch ALL commissions and funding fees (unfiltered) for accurate account size calculation
  // These queries don't respect date range filters and fetch all historical data
  // Starting from October 16, 2025 at 17:19:00 UTC / 09:19:00 PST (first deposit - excludes testing period)
  const allCommissionsQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/commissions', 'all', 'oct16-cutoff'],
    queryFn: async () => {
      const response = await fetch('/api/commissions?startTime=1760635140000&_=' + Date.now());
      if (!response.ok) return { records: [], total: 0 };
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const allFundingFeesQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/funding-fees', 'all', 'oct16-cutoff'],
    queryFn: async () => {
      const response = await fetch('/api/funding-fees?startTime=1760635140000&_=' + Date.now());
      if (!response.ok) return { records: [], total: 0 };
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const allCommissions = allCommissionsQuery.data;
  const allFundingFees = allFundingFeesQuery.data;


  // Use consolidated position data from database (rawChartData comes from /api/performance/chart)
  // Each trade represents a complete position with all DCA layers combined into one P&L value
  const rawSourceData = useMemo(() => {
    console.log('[DEBUG] rawChartData:', rawChartData ? rawChartData.length : 'null/undefined');
    if (!rawChartData || rawChartData.length === 0) return [];

    // rawChartData contains consolidated positions with cumulative P&L calculations
    // Each position may have had multiple fills (DCA layers) but shows as one trade
    const mapped = rawChartData.map((trade: any, index: number) => ({
      tradeNumber: trade.tradeNumber || index + 1,
      timestamp: trade.timestamp,
      symbol: trade.symbol,
      side: trade.side,
      pnl: trade.pnl,
      cumulativePnl: trade.cumulativePnl,
      entryPrice: trade.entryPrice || 0,
      quantity: trade.quantity || 0,
      commission: trade.commission || 0,
      layersFilled: trade.layersFilled || 1, // Number of DCA layers in this position
    }));
    console.log('[DEBUG] rawSourceData mapped:', mapped.length, 'trades');
    return mapped;
  }, [rawChartData]);
  
  // Calculate total deposited capital and transfer list EARLY (needed for chart data calculation)
  const { totalDeposited, depositCount, depositsList } = useMemo(() => {
    if (!transfers || transfers.length === 0) return { totalDeposited: 0, depositCount: 0, depositsList: [] };

    // Calculate total deposits (positive amounts only, excluding marked transfers)
    const deposits = transfers.filter(t =>
      parseFloat(t.amount || '0') > 0 && !(t as any).excluded
    );
    const totalDeposited = deposits.reduce((sum, transfer) => sum + parseFloat(transfer.amount || '0'), 0);

    // For the transfer filter, include ALL transfers (deposits AND withdrawals), excluding marked ones
    const allTransfers = transfers.filter(t => !(t as any).excluded);

    // Sort transfers by timestamp (newest first for easy selection)
    const sortedTransfers = [...allTransfers].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return { totalDeposited, depositCount: deposits.length, depositsList: sortedTransfers };
  }, [transfers]);
  
  // Apply date range filter and manual selection filter
  const sourceChartData = useMemo(() => {
    console.log('[DEBUG] sourceChartData filtering - rawSourceData:', rawSourceData.length);
    console.log('[DEBUG] dateRange:', dateRange);
    let filtered = rawSourceData;

    // Apply date range filter first
    if (dateRange.start || dateRange.end) {
      const startTimestamp = dateRange.start ? dateRange.start.getTime() : 0;
      const endTimestamp = dateRange.end ? dateRange.end.getTime() : Date.now();

      console.log('[DEBUG] Applying date filter:', { startTimestamp, endTimestamp });
      filtered = filtered.filter(trade =>
        trade.timestamp >= startTimestamp && trade.timestamp <= endTimestamp
      );
      console.log('[DEBUG] After date filter:', filtered.length);
    }

    // Apply manual trade selection filter (takes precedence, shows only selected range)
    if (selectedTradeRange.start !== null && selectedTradeRange.end !== null) {
      console.log('[DEBUG] Applying manual selection filter:', selectedTradeRange);
      filtered = filtered.filter(trade =>
        trade.tradeNumber >= selectedTradeRange.start! && trade.tradeNumber <= selectedTradeRange.end!
      );
      console.log('[DEBUG] After manual selection filter:', filtered.length);
    }

    console.log('[DEBUG] Final sourceChartData:', filtered.length);
    return filtered;
  }, [rawSourceData, dateRange, selectedTradeRange]);
  
  // Calculate pagination
  const totalTrades = sourceChartData.length;
  
  // Handle pagination and zoom based on filtered data
  useEffect(() => {
    const hasFilter = !!(dateRange.start || dateRange.end);
    setIsDateFiltered(hasFilter);

    // Optimize for large datasets: cap display at 2000 trades for performance
    // For datasets > 2000, show the most recent 2000 trades
    const MAX_DISPLAY_TRADES = 2000;
    const displayCount = Math.min(sourceChartData.length, MAX_DISPLAY_TRADES);

    // Always show all trades in the filtered range (zoom to fit), up to max limit
    // Update even if sourceChartData.length is 0 to show empty chart
    setChartEndIndex(sourceChartData.length);
    setTradesPerPage(displayCount || 1); // Minimum 1 to prevent division by zero
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

  // Helper function to calculate cumulative deposits up to a given timestamp
  // Extracted outside useMemos so it can be used by both chartData and displayPerformance
  const getCumulativeDepositsAtTime = useMemo(() => {
    return (timestamp: number): number => {
      if (!transfers || transfers.length === 0) return 0;

      // Sum all non-excluded deposits that occurred before or at this timestamp
      return transfers
        .filter(t => {
          const transferTime = new Date(t.timestamp).getTime();
          const amount = parseFloat(t.amount || '0');
          return transferTime <= timestamp && !(t as any).excluded && amount !== 0;
        })
        .reduce((sum, t) => sum + parseFloat(t.amount || '0'), 0);
    };
  }, [transfers]);

  // Helper function to calculate cumulative fee income up to a given timestamp
  // Income can be negative (costs) or positive (received)
  // Only count COMMISSION and FUNDING_FEE transaction types
  // Extracted outside useMemos so it can be used by both chartData and displayPerformance
  const getCumulativeFeeIncomeAtTime = useMemo(() => {
    return (timestamp: number): number => {
      let cumulativeFeeIncome = 0;

      // Sum all commission income up to this timestamp (negative = cost)
      if (allCommissions?.records) {
        cumulativeFeeIncome += allCommissions.records
          .filter(record => record.incomeType === 'COMMISSION' && record.time <= timestamp)
          .reduce((sum, record) => sum + parseFloat(record.income || '0'), 0);
      }

      // Sum all funding fee income up to this timestamp (negative = cost, positive = received)
      if (allFundingFees?.records) {
        cumulativeFeeIncome += allFundingFees.records
          .filter(record => record.incomeType === 'FUNDING_FEE' && record.time <= timestamp)
          .reduce((sum, record) => sum + parseFloat(record.income || '0'), 0);
      }

      return cumulativeFeeIncome;
    };
  }, [allCommissions, allFundingFees]);

  // Add interpolated points at zero crossings for smooth color transitions
  const chartData = useMemo(() => {
    if (paginatedSourceData.length === 0) return [];

    // Rebase cumulative P&L to start at zero for the visible window
    const baseline = paginatedSourceData[0].cumulativePnl;
    const rebasedData = paginatedSourceData.map(trade => {
      // Calculate cumulative deposits at this trade's timestamp
      const depositsAtTime = getCumulativeDepositsAtTime(trade.timestamp);

      return {
        ...trade,
        cumulativePnl: trade.cumulativePnl - baseline,
        // Calculate account size = cumulative deposits + cumulative NET P&L (fees already subtracted by backend)
        // The backend now provides net P&L with fees already subtracted, so we don't double-count fees
        accountSize: depositsAtTime + trade.cumulativePnl,
      };
    });

    // Add starting point at zero for cumulative P&L line
    const firstTrade = rebasedData[0];
    const depositsAtStart = getCumulativeDepositsAtTime(paginatedSourceData[0].timestamp);
    const startingPoint = {
      ...firstTrade,
      tradeNumber: firstTrade.tradeNumber - 0.5,
      timestamp: firstTrade.timestamp - 1000,
      pnl: 0,
      cumulativePnl: 0,
      accountSize: depositsAtStart + (paginatedSourceData[0].cumulativePnl - baseline), // Starting account size (fees already in net P&L)
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
        
        // Interpolate account size at crossing point
        const interpolatedAccountSize = prev.accountSize + ratio * (curr.accountSize - prev.accountSize);
        
        return [
          {
            ...prev,
            tradeNumber: interpolatedTradeNumber - 0.001,
            timestamp: interpolatedTimestamp - 1,
            cumulativePnl: 0,
            pnl: 0,
            accountSize: interpolatedAccountSize,
          },
          {
            ...curr,
            tradeNumber: interpolatedTradeNumber + 0.001,
            timestamp: interpolatedTimestamp + 1,
            cumulativePnl: 0,
            pnl: 0,
            accountSize: interpolatedAccountSize,
          },
          curr
        ];
      }

      return [curr];
    });
  }, [paginatedSourceData, getCumulativeDepositsAtTime]);

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

  // Calculate portfolio risk metrics
  const { totalRisk, riskPercentage, filledRisk, reservedRisk, filledRiskPercentage, reservedRiskPercentage, marginUsedPercentage, marginUsed } = useMemo(() => {
    // Try to use WebSocket risk data first (includes filled vs reserved metrics + actual margin)
    if (portfolioRisk?.filledRiskDollars !== undefined && portfolioRisk?.actualMarginUsed !== undefined) {
      // Use actual margin from backend calculation (includes ALL assets: USDF + USDT)
      const actualMarginUsed = portfolioRisk.actualMarginUsed;
      const actualMarginUsedPct = portfolioRisk.actualMarginUsedPercentage;
      
      // Calculate total potential risk (filled + reserved)
      const totalPotentialRisk = portfolioRisk.filledRiskDollars + portfolioRisk.reservedRiskDollars;
      
      return {
        totalRisk: totalPotentialRisk,
        riskPercentage: actualMarginUsedPct, // Use backend's actual margin percentage
        filledRisk: portfolioRisk.filledRiskDollars,
        reservedRisk: totalPotentialRisk, // Show total potential risk (not just reserved)
        filledRiskPercentage: portfolioRisk.filledRiskPercentage,
        reservedRiskPercentage: portfolioRisk.filledRiskPercentage + portfolioRisk.reservedRiskPercentage,
        marginUsedPercentage: actualMarginUsedPct,
        marginUsed: actualMarginUsed,
      };
    }
    
    // Fallback: Calculate from exchange data if WebSocket data not available
    const marginUsed = liveAccount ? parseFloat(liveAccount.totalInitialMargin || '0') : 0;
    const totalMargin = liveAccount ? parseFloat(liveAccount.totalMarginBalance || '0') : 0;
    const marginUsedPercentage = totalMargin > 0 ? (marginUsed / totalMargin) * 100 : 0;
    
    // If we have partial WebSocket data (without actualMarginUsed), use it with fallback margin
    if (portfolioRisk?.filledRiskDollars !== undefined) {
      const totalPotentialRisk = portfolioRisk.filledRiskDollars + portfolioRisk.reservedRiskDollars;
      
      return {
        totalRisk: totalPotentialRisk,
        riskPercentage: marginUsedPercentage, // Fallback to calculated margin
        filledRisk: portfolioRisk.filledRiskDollars,
        reservedRisk: totalPotentialRisk,
        filledRiskPercentage: portfolioRisk.filledRiskPercentage,
        reservedRiskPercentage: portfolioRisk.filledRiskPercentage + portfolioRisk.reservedRiskPercentage,
        marginUsedPercentage,
        marginUsed,
      };
    }

    // Fallback: Calculate risk locally (legacy behavior)
    if (!activeStrategy) return { totalRisk: 0, riskPercentage: 0, filledRisk: 0, reservedRisk: 0, filledRiskPercentage: 0, reservedRiskPercentage: 0, marginUsedPercentage: 0, marginUsed: 0 };

    const stopLossPercent = Number(activeStrategy.stopLossPercent) || 2;
    const positions = livePositions ? livePositions.filter(p => parseFloat(p.positionAmt) !== 0) : [];

    // ✅ Use exchange-provided values directly - don't recalculate
    const unrealizedPnl = liveAccount ? (parseFloat(liveAccount.totalUnrealizedProfit) || 0) : 0;
    const walletBalance = liveAccount ? (parseFloat(liveAccount.totalWalletBalance || '0') || 0) : 0;
    const totalBalance = walletBalance + unrealizedPnl; // Wallet balance adjusted for unrealized P&L

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
    return { 
      totalRisk: totalPotentialLoss, 
      riskPercentage: marginUsedPercentage, // Use actual margin instead of theoretical risk
      filledRisk: totalPotentialLoss,
      reservedRisk: totalPotentialLoss,
      filledRiskPercentage: riskPct,
      reservedRiskPercentage: riskPct,
      marginUsedPercentage,
      marginUsed,
    };
  }, [activeStrategy, livePositions, liveAccount, portfolioRisk]);

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

  // Memoized risk color helper - uses server-backed limit to avoid desynchronization
  const getRiskColorClass = useMemo(() => {
    const serverRiskLimit = activeStrategy ? parseFloat(activeStrategy.maxPortfolioRiskPercent) : 15;
    const isOverLimit = filledRiskPercentage > serverRiskLimit;
    const warningThreshold = serverRiskLimit * 0.8; // 80% of max
    
    return isOverLimit ? 'text-red-600 dark:text-red-500' :
      filledRiskPercentage >= warningThreshold ? 'text-orange-500 dark:text-orange-400' :
      'text-blue-500 dark:text-blue-400';
  }, [activeStrategy?.maxPortfolioRiskPercent, filledRiskPercentage]);

  const getRiskStrokeClass = useMemo(() => {
    const serverRiskLimit = activeStrategy ? parseFloat(activeStrategy.maxPortfolioRiskPercent) : 15;
    const isOverLimit = filledRiskPercentage > serverRiskLimit;
    const warningThreshold = serverRiskLimit * 0.8; // 80% of max
    
    return isOverLimit ? 'stroke-red-600 dark:stroke-red-500' :
      filledRiskPercentage >= warningThreshold ? 'stroke-orange-500 dark:stroke-orange-400' :
      'stroke-blue-500 dark:stroke-blue-400';
  }, [activeStrategy?.maxPortfolioRiskPercent, filledRiskPercentage]);

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
      intervalPnlPercent: 0,
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
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      expectancy: 0,
    };

    // Use filtered events from rawSourceData (already excludes synthetic fills)
    // Filter by date range or manual selection if active
    let filteredPnlEvents = rawSourceData.map(trade => ({
      symbol: trade.symbol,
      time: trade.timestamp,
      income: trade.pnl.toString(),
    }));

    // Determine the time range for filtering fees
    let startTimestamp = 0;
    let endTimestamp = Date.now();

    // Manual selection takes precedence over date range
    if (selectedTradeRange.start !== null && selectedTradeRange.end !== null) {
      // Filter by trade numbers (manual selection)
      const selectedTrades = sourceChartData.filter(trade =>
        trade.tradeNumber >= selectedTradeRange.start! && trade.tradeNumber <= selectedTradeRange.end!
      );

      // Get timestamps from selected trades
      const selectedTimestamps = new Set(selectedTrades.map(t => t.timestamp));
      filteredPnlEvents = filteredPnlEvents.filter(event =>
        selectedTimestamps.has(event.time)
      );

      // For fees, use min/max of selected timestamps
      if (selectedTrades.length > 0) {
        startTimestamp = Math.min(...selectedTrades.map(t => t.timestamp));
        endTimestamp = Math.max(...selectedTrades.map(t => t.timestamp));
      }
    } else if (dateRange.start || dateRange.end) {
      // Filter by date range
      startTimestamp = dateRange.start ? dateRange.start.getTime() : 0;
      endTimestamp = dateRange.end ? dateRange.end.getTime() : Date.now();

      filteredPnlEvents = filteredPnlEvents.filter(event =>
        event.time >= startTimestamp && event.time <= endTimestamp
      );
    }

    // Filter commission and funding fees by the same time range
    // Use allCommissions/allFundingFees which have ALL data, then filter by time range
    // Only count COMMISSION and FUNDING_FEE transaction types
    const filteredCommissions = (allCommissions?.records || [])
      .filter(record =>
        record.incomeType === 'COMMISSION' &&
        record.time >= startTimestamp &&
        record.time <= endTimestamp
      );

    const filteredFundingFees = (allFundingFees?.records || [])
      .filter(record =>
        record.incomeType === 'FUNDING_FEE' &&
        record.time >= startTimestamp &&
        record.time <= endTimestamp
      );

    // Calculate filtered totals (negative = cost, positive = received)
    const totalCommissionIncome = filteredCommissions.reduce(
      (sum, record) => sum + parseFloat(record.income || '0'),
      0
    );
    const totalFundingFeeIncome = filteredFundingFees.reduce(
      (sum, record) => sum + parseFloat(record.income || '0'),
      0
    );

    // Keep fees as actual income values (negative = cost paid, positive = received)
    // This way they display correctly as negative when you paid fees
    const totalCommissionCost = totalCommissionIncome; // Negative value = cost
    const totalFundingFeeCost = totalFundingFeeIncome; // Negative value = cost, positive = received

    // Calculate metrics from realized P&L events
    const winningTrades = filteredPnlEvents.filter(e => parseFloat(e.income) > 0);
    const losingTrades = filteredPnlEvents.filter(e => parseFloat(e.income) < 0);
    const totalWins = winningTrades.reduce((sum, e) => sum + parseFloat(e.income || '0'), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, e) => sum + parseFloat(e.income || '0'), 0));

    // IMPORTANT: Calculate interval P&L from the filtered chart data
    // The backend chart endpoint (server/routes.ts:4275) provides cumulativePnl that includes:
    // 1. All trading P&L from realized positions
    // 2. All commissions (subtracted)
    // 3. All funding fees up to each timestamp (added/subtracted)
    // 4. Scaled to match actual wallet balance (accounts for insurance fees, liquidation penalties, etc.)

    // Calculate the cumulative P&L at the START of the interval (before first trade)
    // and at the END of the interval (after last trade)
    const startCumulativePnl = sourceChartData && sourceChartData.length > 0 && sourceChartData[0] &&
      typeof sourceChartData[0].cumulativePnl === 'number' && typeof sourceChartData[0].pnl === 'number'
      ? (sourceChartData[0].cumulativePnl - sourceChartData[0].pnl)
      : 0;

    const endCumulativePnl = sourceChartData && sourceChartData.length > 0 && sourceChartData[sourceChartData.length - 1]?.cumulativePnl
      ? sourceChartData[sourceChartData.length - 1].cumulativePnl
      : 0;

    // Interval P&L = difference between end and start
    const totalRealizedPnl = endCumulativePnl - startCumulativePnl;

    // Calculate percentage based on total deposits (initial capital)
    // This shows % return on the money you actually put in
    // Use 3900 as fallback if totalDeposited is not loaded yet
    const depositBase = totalDeposited > 0 ? totalDeposited : 3900;
    const intervalPnlPercent = depositBase > 0
      ? (totalRealizedPnl / depositBase) * 100
      : 0;

    // Debug logging
    if (totalRealizedPnl !== 0) {
      console.log('Interval P&L Calculation:', {
        totalRealizedPnl,
        totalDeposited,
        depositBase,
        intervalPnlPercent
      });
    }

    // Keep the individual calculation for validation (should match closely if no filtering)
    const totalRealizedPnlFromTrades = filteredPnlEvents.reduce((sum, e) => sum + parseFloat(e.income || '0'), 0);
    const totalRealizedPnlFromTradesWithFunding = totalRealizedPnlFromTrades + totalFundingFeeIncome;
    
    // Calculate max drawdown from filtered interval data
    // Use cumulativePnl directly (already includes fees and scaling adjustments)
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let peakCumulativePnl = startCumulativePnl; // Start from P&L before interval

    sourceChartData.forEach(trade => {
      // Track the peak cumulative P&L reached
      if (trade.cumulativePnl > peakCumulativePnl) {
        peakCumulativePnl = trade.cumulativePnl;
      }

      // Calculate drawdown from peak
      const drawdown = peakCumulativePnl - trade.cumulativePnl;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });

    // Calculate percentage based on starting capital (deposits)
    maxDrawdownPercent = depositBase > 0 ? (maxDrawdown / depositBase) * 100 : 0;
    
    // Calculate average trade time from filtered closed positions
    let avgTradeTimeMs = 0;
    if (closedPositions && closedPositions.length > 0) {
      let filteredClosedPositions = closedPositions;

      if (selectedTradeRange.start !== null && selectedTradeRange.end !== null) {
        // Filter by manual selection
        const selectedTrades = sourceChartData.filter(trade =>
          trade.tradeNumber >= selectedTradeRange.start! && trade.tradeNumber <= selectedTradeRange.end!
        );
        const selectedTimestamps = new Set(selectedTrades.map(t => t.timestamp));

        filteredClosedPositions = closedPositions.filter(pos => {
          if (!pos.closedAt) return false;
          const closeTime = new Date(pos.closedAt).getTime();
          return selectedTimestamps.has(closeTime);
        });
      } else if (dateRange.start || dateRange.end) {
        // Filter by date range
        const startTimestamp = dateRange.start ? dateRange.start.getTime() : 0;
        const endTimestamp = dateRange.end ? dateRange.end.getTime() : Date.now();

        filteredClosedPositions = closedPositions.filter(pos => {
          if (!pos.closedAt) return false;
          const closeTime = new Date(pos.closedAt).getTime();
          return closeTime >= startTimestamp && closeTime <= endTimestamp;
        });
      }
      
      if (filteredClosedPositions.length > 0) {
        const totalTime = filteredClosedPositions.reduce((sum, pos) => {
          if (!pos.openedAt || !pos.closedAt) return sum;
          const openTime = new Date(pos.openedAt).getTime();
          const closeTime = new Date(pos.closedAt).getTime();
          return sum + (closeTime - openTime);
        }, 0);
        
        avgTradeTimeMs = totalTime / filteredClosedPositions.length;
      }
    }
    
    // Calculate risk-adjusted return metrics for high-frequency crypto trading
    // These metrics account for volatility and risk in trading performance

    // Expectancy: Average profit/loss per trade (includes fees)
    const expectancy = filteredPnlEvents.length > 0
      ? totalRealizedPnl / filteredPnlEvents.length
      : 0;

    // Calmar Ratio: Annualized return / Max drawdown (higher is better)
    // Measures return relative to worst drawdown
    const timeRangeDays = sourceChartData.length > 1
      ? (sourceChartData[sourceChartData.length - 1].timestamp - sourceChartData[0].timestamp) / (1000 * 60 * 60 * 24)
      : 1;
    const annualizedReturn = timeRangeDays > 0 && depositBase > 0
      ? (totalRealizedPnl / depositBase) * (365 / timeRangeDays) * 100
      : 0;
    const calmarRatio = maxDrawdown > 0 && depositBase > 0
      ? annualizedReturn / maxDrawdownPercent
      : 0;

    // Calculate daily returns from chart data (time-based, not per-trade)
    // This is the standard method for crypto (24/7 markets) and institutional reporting
    const dailyReturns: number[] = [];
    const tradesByDate = new Map<string, any[]>();

    // Group trades by date
    sourceChartData.forEach(trade => {
      const date = new Date(trade.timestamp).toISOString().split('T')[0];
      if (!tradesByDate.has(date)) {
        tradesByDate.set(date, []);
      }
      tradesByDate.get(date)!.push(trade);
    });

    // Calculate daily P&L changes (end of day cumulative P&L - previous day)
    // IMPORTANT: For filtered intervals, start from the cumulative P&L before the first trade
    const dates = Array.from(tradesByDate.keys()).sort();
    if (dates.length > 1) {
      let prevCumulativePnl = startCumulativePnl; // Start from P&L before the interval (not 0)
      dates.forEach(date => {
        const tradesOnDay = tradesByDate.get(date)!;
        const lastTradeOfDay = tradesOnDay[tradesOnDay.length - 1];
        const dailyChange = lastTradeOfDay.cumulativePnl - prevCumulativePnl;
        dailyReturns.push(dailyChange);
        prevCumulativePnl = lastTradeOfDay.cumulativePnl;
      });
    }

    // Period-Adjusted Sharpe Ratio: Adapts to viewing time range
    // Formula: (Avg Daily Return / Daily Std Dev) × √(days in period)
    // Scales to the actual viewing period instead of always annualizing to 365 days
    let sharpeRatio = 0;
    if (dailyReturns.length > 1) {
      const avgDailyReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
      const dailyVariance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / dailyReturns.length;
      const dailyStdDev = Math.sqrt(dailyVariance);

      // Scale to viewing period (adapts to selected time range)
      const periodAdjustmentFactor = Math.sqrt(Math.max(timeRangeDays, 1));
      sharpeRatio = dailyStdDev > 0 ? (avgDailyReturn / dailyStdDev) * periodAdjustmentFactor : 0;
    }

    // Period-Adjusted Sortino Ratio: Like Sharpe but only considers downside deviation
    // Adapts to viewing time range (uses same period adjustment as Sharpe)
    let sortinoRatio = 0;
    if (dailyReturns.length > 1) {
      const avgDailyReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
      const downsideReturns = dailyReturns.filter(r => r < 0);

      if (downsideReturns.length > 0) {
        const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length;
        const downsideStdDev = Math.sqrt(downsideVariance);

        // Scale to viewing period (adapts to selected time range)
        const periodAdjustmentFactor = Math.sqrt(Math.max(timeRangeDays, 1));
        sortinoRatio = downsideStdDev > 0 ? (avgDailyReturn / downsideStdDev) * periodAdjustmentFactor : 0;
      } else {
        sortinoRatio = avgDailyReturn > 0 ? 999 : 0; // No downside = excellent
      }
    }

    // ===== VALIDATION LOGGING: Show all calculations with actual data =====
    console.log('📊 PERFORMANCE METRICS VALIDATION');
    console.log('='.repeat(80));
    console.log('\n🔢 INPUT DATA:');
    console.log(`  Total Positions: ${sourceChartData.length} (DCA layers grouped)`);
    console.log(`  Trading Days: ${dailyReturns.length}`);
    console.log(`  Winning Trades: ${winningTrades.length}`);
    console.log(`  Losing Trades: ${losingTrades.length}`);
    console.log(`  Total Realized P&L (after all fees): $${totalRealizedPnl.toFixed(2)}`);
    console.log(`  Total Commission Income: $${totalCommissionIncome.toFixed(2)} (included in chart cumulative P&L)`);
    console.log(`  Total Funding Fee Income: $${totalFundingFeeIncome.toFixed(2)} (included in chart cumulative P&L)`);
    console.log(`  Total Wins: $${totalWins.toFixed(2)}`);
    console.log(`  Total Losses: $${totalLosses.toFixed(2)}`);
    console.log(`  Total Deposited: $${totalDeposited.toFixed(2)}`);
    console.log(`  Time Range Days: ${timeRangeDays.toFixed(2)}`);

    console.log('\n📈 EXPECTANCY CALCULATION:');
    console.log(`  Formula: Total Realized P&L / Number of Trades`);
    console.log(`  Calculation: ${totalRealizedPnl.toFixed(2)} / ${filteredPnlEvents.length}`);
    console.log(`  Result: $${expectancy.toFixed(2)} per trade`);

    console.log('\n📉 MAX DRAWDOWN CALCULATION:');
    console.log(`  Formula: Peak Interval P&L - Lowest Interval P&L`);
    console.log(`  Max Drawdown: $${maxDrawdown.toFixed(2)}`);
    console.log(`  Max Drawdown %: ${maxDrawdownPercent.toFixed(2)}%`);

    console.log('\n📊 CALMAR RATIO CALCULATION:');
    console.log(`  Formula: Annualized Return / Max Drawdown %`);
    console.log(`  Step 1 - Annualized Return:`);
    console.log(`    (Total P&L / Total Deposited) × (365 / Days)`);
    console.log(`    (${totalRealizedPnl.toFixed(2)} / ${totalDeposited.toFixed(2)}) × (365 / ${timeRangeDays.toFixed(2)})`);
    console.log(`    ${(totalRealizedPnl / totalDeposited).toFixed(4)} × ${(365 / timeRangeDays).toFixed(2)}`);
    console.log(`    = ${annualizedReturn.toFixed(2)}%`);
    console.log(`  Step 2 - Calmar Ratio:`);
    console.log(`    ${annualizedReturn.toFixed(2)} / ${maxDrawdownPercent.toFixed(2)} = ${calmarRatio.toFixed(2)}`);

    if (dailyReturns.length > 1) {
      const avgDailyReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
      const dailyVariance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / dailyReturns.length;
      const dailyStdDev = Math.sqrt(dailyVariance);
      const periodAdjustmentFactor = Math.sqrt(Math.max(timeRangeDays, 1));

      console.log('\n📊 PERIOD-ADJUSTED SHARPE RATIO (Adapts to Viewing Range):');
      console.log(`  Formula: (Avg Daily Return / Daily Std Dev) × √(days in period)`);
      console.log(`  Data Source: ${dailyReturns.length} trading days over ${timeRangeDays.toFixed(1)} calendar days`);
      console.log(`  Viewing Period: ${timeRangeDays.toFixed(1)} days`);
      console.log(`  Step 1 - Average Daily Return:`);
      console.log(`    = $${avgDailyReturn.toFixed(2)}`);
      console.log(`  Step 2 - Daily Standard Deviation:`);
      console.log(`    = $${dailyStdDev.toFixed(2)}`);
      console.log(`  Step 3 - Per-Day Sharpe Ratio:`);
      console.log(`    ${avgDailyReturn.toFixed(2)} / ${dailyStdDev.toFixed(2)} = ${(avgDailyReturn / dailyStdDev).toFixed(4)}`);
      console.log(`  Step 4 - Scale to Viewing Period (√${timeRangeDays.toFixed(1)}):`);
      console.log(`    ${(avgDailyReturn / dailyStdDev).toFixed(4)} × ${periodAdjustmentFactor.toFixed(2)} = ${sharpeRatio.toFixed(2)}`);
      console.log(`  ✅ Interpretation: >1.0 Good, >2.0 Excellent, >3.0 Outstanding`);

      const downsideReturns = dailyReturns.filter(r => r < 0);
      console.log('\n📊 PERIOD-ADJUSTED SORTINO RATIO (Adapts to Viewing Range):');
      console.log(`  Formula: (Avg Daily Return / Downside Daily Std Dev) × √(days in period)`);
      console.log(`  Losing Days: ${downsideReturns.length} of ${dailyReturns.length} (${(downsideReturns.length / dailyReturns.length * 100).toFixed(1)}%)`);
      if (downsideReturns.length > 0) {
        const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length;
        const downsideStdDev = Math.sqrt(downsideVariance);
        console.log(`  Downside Standard Deviation: $${downsideStdDev.toFixed(2)}`);
        console.log(`  Per-Day Sortino: ${(avgDailyReturn / downsideStdDev).toFixed(4)}`);
        console.log(`  Period-Adjusted Sortino Ratio:`);
        console.log(`    ${(avgDailyReturn / downsideStdDev).toFixed(4)} × ${periodAdjustmentFactor.toFixed(2)} = ${sortinoRatio.toFixed(2)}`);
        console.log(`  ✅ Sortino < Sharpe = More upside volatility (good for crypto!)`);
      } else {
        console.log(`  No losing days - Sortino Ratio set to 999 (perfect)`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ METHODOLOGY: Time-based calculation for crypto 24/7 markets');
    console.log('  • Daily returns (not per-trade) for institutional standard');
    console.log('  • √365 annualization factor (not √252 for traditional markets)');
    console.log('  • Chart data with DCA layers properly grouped');
    console.log('  • All calculations use your actual trading data\n');

    return {
      ...basePerformance,
      totalTrades: filteredPnlEvents.length,
      closedTrades: filteredPnlEvents.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: filteredPnlEvents.length > 0 ? (winningTrades.length / filteredPnlEvents.length) * 100 : 0,
      totalRealizedPnl: totalRealizedPnl, // Interval P&L (scaled, includes all fees)
      intervalPnlPercent: intervalPnlPercent, // Percentage gain for the interval
      totalPnl: totalRealizedPnl,
      averageWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
      averageLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
      bestTrade: filteredPnlEvents.length > 0 ? Math.max(...filteredPnlEvents.map(e => parseFloat(e.income || '0'))) : 0,
      worstTrade: filteredPnlEvents.length > 0 ? Math.min(...filteredPnlEvents.map(e => parseFloat(e.income || '0'))) : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 999 : 0),
      totalFees: totalCommissionCost, // Filtered by date range
      fundingCost: totalFundingFeeCost, // Filtered by date range
      averageTradeTimeMs: avgTradeTimeMs,
      maxDrawdown: maxDrawdown,
      maxDrawdownPercent: maxDrawdownPercent,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      expectancy,
    };
  }, [performance, dateRange, selectedTradeRange, realizedPnlEvents, allCommissions, allFundingFees, sourceChartData, closedPositions, rawSourceData, getCumulativeDepositsAtTime, getCumulativeFeeIncomeAtTime, totalDeposited]);
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
  
  // Handle deposit event selection
  const handleDepositSelect = (depositId: string) => {
    const deposit = depositsList.find(d => d.id === depositId);
    if (deposit) {
      const depositTime = new Date(deposit.timestamp);
      setDateRange({ start: depositTime, end: new Date() });
      setSelectedDepositId(depositId);
      setDepositFilterOpen(false);
    }
  };
  
  // Clear deposit filter
  const clearDepositFilter = () => {
    setSelectedDepositId(null);
    setDateRange({ start: null, end: null });
  };

  // Handle drag selection for manual trade range selection
  const handleMouseDown = (data: any) => {
    if (!manualSelectionMode) return;

    const tradeNumber = data?.activePayload?.[0]?.payload?.tradeNumber;
    console.log('Mouse down on trade:', tradeNumber);

    if (tradeNumber !== undefined && Number.isInteger(tradeNumber) && tradeNumber > 0) {
      setIsDragging(true);
      setDragStart(tradeNumber);
      setDragEnd(tradeNumber);
      // Clear any existing selection
      setSelectedTradeRange({ start: null, end: null });
    }
  };

  const handleMouseMove = (data: any) => {
    if (!manualSelectionMode || !isDragging) return;

    const tradeNumber = data?.activePayload?.[0]?.payload?.tradeNumber;
    if (tradeNumber !== undefined && Number.isInteger(tradeNumber) && tradeNumber > 0) {
      setDragEnd(tradeNumber);
    }
  };

  const handleMouseUp = () => {
    if (!manualSelectionMode || !isDragging) return;

    console.log('Mouse up - completing selection:', { dragStart, dragEnd });

    if (dragStart !== null && dragEnd !== null) {
      const start = Math.min(dragStart, dragEnd);
      const end = Math.max(dragStart, dragEnd);
      console.log('Setting selected range:', { start, end });
      setSelectedTradeRange({ start, end });
    }

    setIsDragging(false);
    setDragStart(null);
    setDragEnd(null);
  };

  // Chart visibility toggles
  // Load chart settings from localStorage
  const [showStrategyUpdates, setShowStrategyUpdates] = useState(() => {
    const saved = localStorage.getItem('chart-settings');
    return saved ? JSON.parse(saved).showStrategyUpdates ?? true : true;
  });
  const [showDeposits, setShowDeposits] = useState(() => {
    const saved = localStorage.getItem('chart-settings');
    return saved ? JSON.parse(saved).showDeposits ?? true : true;
  });
  const [showAccountSize, setShowAccountSize] = useState(() => {
    const saved = localStorage.getItem('chart-settings');
    return saved ? JSON.parse(saved).showAccountSize ?? true : true;
  });

  // Save chart settings to localStorage whenever they change
  useEffect(() => {
    const settings = {
      showStrategyUpdates,
      showDeposits,
      showAccountSize,
      dateRange: {
        start: dateRange.start ? dateRange.start.toISOString() : null,
        end: dateRange.end ? dateRange.end.toISOString() : null,
      },
    };
    localStorage.setItem('chart-settings', JSON.stringify(settings));
  }, [showStrategyUpdates, showDeposits, showAccountSize, dateRange]);
  
  // Get selected deposit info
  const selectedDeposit = useMemo(() => {
    if (!selectedDepositId) return null;
    return depositsList.find(d => d.id === selectedDepositId);
  }, [selectedDepositId, depositsList]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background border border-border rounded-md p-3 shadow-lg">
          <p className="text-sm font-semibold mb-1">Trade #{data.tradeNumber}</p>
          <p className="text-xs text-muted-foreground mb-2">{formatInTimeZone(new Date(data.timestamp), "America/Los_Angeles", "MMM d, h:mm a")} PT</p>
          <p className="text-xs mb-1"><span className="font-medium">{data.symbol}</span> {data.side}</p>
          <p className={`text-sm font-mono font-semibold ${data.pnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>
            Net P&L: {data.pnl >= 0 ? '+' : ''}${Math.abs(data.pnl).toFixed(2)}
          </p>
          {data.commission !== undefined && data.commission > 0 && (
            <p className="text-xs font-mono text-orange-500">
              Commission: -${data.commission.toFixed(2)}
            </p>
          )}
          <p className={`text-sm font-mono font-semibold ${data.cumulativePnl >= 0 ? 'text-lime-500' : 'text-red-600'}`}>
            Cumulative: {data.cumulativePnl >= 0 ? '+' : ''}${Math.abs(data.cumulativePnl).toFixed(2)}
          </p>
          {data.accountSize !== undefined && (
            <p className="text-sm font-mono font-semibold text-blue-500">
              Account: ${data.accountSize.toFixed(2)}
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  // ✅ Use exchange-provided values directly - don't recalculate
  const unrealizedPnl = liveAccount ? (parseFloat(liveAccount.totalUnrealizedProfit) || 0) : 0;
  const walletBalance = liveAccount ? (parseFloat(liveAccount.totalWalletBalance || '0') || 0) : 0;
  const totalBalance = walletBalance + unrealizedPnl; // Wallet balance adjusted for unrealized P&L

  // Calculate margin in use from open positions
  const positions = livePositions ? livePositions.filter(p => parseFloat(p.positionAmt) !== 0) : [];
  const leverage = activeStrategy?.leverage || 10;
  const marginInUse = positions.reduce((sum, position) => {
    const positionAmt = Math.abs(parseFloat(position.positionAmt) || 0);
    const entryPrice = parseFloat(position.entryPrice) || 0;
    const positionValue = positionAmt * entryPrice;
    const margin = positionValue / leverage;
    return sum + margin;
  }, 0);
  const totalExposure = marginInUse * leverage;

  // ✅ Use exchange's available balance calculation (accounts for maintenance margin, unrealized losses, etc.)
  // Exchange calculates: availableBalance = marginBalance - initialMargin - maintenanceMargin buffer
  const availableBalance = liveAccount?.availableBalance
    ? parseFloat(liveAccount.availableBalance)
    : totalBalance - marginInUse; // Fallback to simple calculation if exchange data not available

  // Calculate percentages
  const unrealizedPnlPercent = totalBalance > 0 ? (unrealizedPnl / totalBalance) * 100 : 0;

  // Calculate ROI based on the chart interval
  // Get the starting account balance for the interval from chartData
  const intervalStartingBalance = useMemo(() => {
    if (!chartData || chartData.length === 0) return totalDeposited;

    // Get the account size at the first data point in the chart
    const firstDataPoint = chartData[0];
    return firstDataPoint.accountSize || totalDeposited;
  }, [chartData, totalDeposited]);

  // ROI = Realized P&L from interval / Starting balance of interval
  // This shows the return on the capital you had at the start of this time period
  const trueROI = intervalStartingBalance > 0
    ? ((displayPerformance.totalRealizedPnl || 0) / intervalStartingBalance) * 100
    : 0;

  // For realized P&L percentage display (legacy - kept for compatibility)
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
          {/* Current Balance - Prominent */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div className="text-sm text-muted-foreground uppercase tracking-wider">Current Balance</div>
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

          {/* Available Balance + Interval P&L */}
          <div className="space-y-3">
            {/* Interval P&L - Shows P&L for currently viewed chart interval */}
            <div className="mb-4 pb-4 border-b">
              <div className="text-sm text-muted-foreground uppercase tracking-wider">Interval P&L</div>
              <div className={`text-3xl font-mono font-bold mt-2 ${displayPerformance.totalRealizedPnl >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`}>
                {displayPerformance.totalRealizedPnl >= 0 ? '+' : ''}${displayPerformance.totalRealizedPnl.toFixed(2)}
              </div>
              <div className={`text-lg font-mono font-bold ${displayPerformance.intervalPnlPercent >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`}>
                {displayPerformance.intervalPnlPercent >= 0 ? '+' : ''}{displayPerformance.intervalPnlPercent.toFixed(2)}%
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {dateRange.start || dateRange.end
                  ? 'Filtered period'
                  : selectedTradeRange.start !== null
                    ? 'Manual selection'
                    : 'All time'}
              </div>
            </div>

            <div className="text-sm text-muted-foreground uppercase tracking-wider">Total Balance</div>
            <div className="text-4xl font-mono font-bold" data-testid="text-wallet-balance">
              ${walletBalance.toFixed(2)}
            </div>
            <div className="text-sm text-muted-foreground">
              Wallet only
            </div>
            <div className="text-sm text-muted-foreground uppercase tracking-wider mt-4">Available</div>
            <div className="text-3xl font-mono font-bold" data-testid="text-available-balance">
              ${availableBalance.toFixed(2)}
            </div>
            <div className="text-sm text-muted-foreground">
              For trading
            </div>
          </div>

          {/* Margin Usage Meter - Dual Ring (Margin Used vs Projected Risk) */}
          <div className="flex flex-col items-center gap-3 lg:border-l lg:pl-6" data-testid="container-risk-bar">
            <div className="text-xs text-muted-foreground uppercase tracking-wider text-center whitespace-nowrap">Margin Usage</div>
            <div className="relative flex flex-col items-center">
              {/* Dual Ring Meter */}
              <div className="relative w-36 h-36">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  {/* Outer ring background (filled risk - loss if all current positions hit SL) */}
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke="rgb(100, 116, 139)"
                    strokeWidth="6"
                    className="opacity-60"
                  />
                  {/* Outer ring progress (filled risk) */}
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    strokeWidth="6"
                    strokeLinecap="butt"
                    className={`transition-all duration-300 ${getRiskStrokeClass}`}
                    strokeDasharray={`${2 * Math.PI * 42}`}
                    strokeDashoffset={`${2 * Math.PI * 42 * (1 - Math.min(100, filledRiskPercentage) / 100)}`}
                    data-testid="bar-filled-risk"
                  />
                  
                  {/* Inner ring background (margin used) */}
                  <circle
                    cx="50"
                    cy="50"
                    r="36"
                    fill="none"
                    stroke="rgb(100, 116, 139)"
                    strokeWidth="8"
                    className="opacity-60"
                  />
                  {/* Inner ring progress (margin used) */}
                  <circle
                    cx="50"
                    cy="50"
                    r="36"
                    fill="none"
                    strokeWidth="8"
                    strokeLinecap="butt"
                    className="stroke-lime-600 dark:stroke-lime-500 transition-all duration-300"
                    strokeDasharray={`${2 * Math.PI * 36}`}
                    strokeDashoffset={`${2 * Math.PI * 36 * (1 - Math.min(100, marginUsedPercentage) / 100)}`}
                    data-testid="bar-margin-used"
                  />
                </svg>
                {/* Centered content */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-sm font-mono text-muted-foreground">Margin</div>
                  <div className="text-xl font-mono font-bold">{marginUsedPercentage.toFixed(1)}%</div>
                  <div className={`text-[10px] font-mono mt-0.5 ${getRiskColorClass}`}>
                    Risk: {filledRiskPercentage.toFixed(1)}%
                  </div>
                </div>
              </div>
              
              <div className="text-[10px] text-muted-foreground text-center mt-1">
                <div>Used: ${marginUsed.toFixed(2)}</div>
                <div className={getRiskColorClass}>Risk: ${filledRisk.toFixed(2)}</div>
              </div>
              
              {/* Risk Limit Slider */}
              <div className="mt-3 w-36 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Max</span>
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
              </div>
            </div>
          </div>
        </div>

        {/* Risk-Adjusted Return Metrics */}
        <div className="bg-muted/30 rounded-lg p-4 border">
          <div className="text-sm text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Risk-Adjusted Returns
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Sharpe Ratio */}
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Sharpe Ratio</div>
              <div className={`text-2xl font-mono font-bold ${displayPerformance.sharpeRatio >= 3 ? 'text-[rgb(190,242,100)]' : displayPerformance.sharpeRatio >= 1 ? 'text-muted-foreground' : 'text-[rgb(251,146,60)]'}`}>
                {displayPerformance.sharpeRatio.toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground">Period-Adjusted</div>
            </div>

            {/* Sortino Ratio */}
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Sortino Ratio</div>
              <div className={`text-2xl font-mono font-bold ${displayPerformance.sortinoRatio >= 3 ? 'text-[rgb(190,242,100)]' : displayPerformance.sortinoRatio >= 1 ? 'text-muted-foreground' : 'text-[rgb(251,146,60)]'}`}>
                {displayPerformance.sortinoRatio > 99 ? '99+' : displayPerformance.sortinoRatio.toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground">Period-Adjusted</div>
            </div>

            {/* Calmar Ratio */}
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Calmar Ratio</div>
              <div className={`text-2xl font-mono font-bold ${displayPerformance.calmarRatio >= 3 ? 'text-[rgb(190,242,100)]' : displayPerformance.calmarRatio >= 0 ? 'text-muted-foreground' : 'text-[rgb(251,146,60)]'}`}>
                {displayPerformance.calmarRatio.toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground">Return / Drawdown</div>
            </div>

            {/* Expectancy */}
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Expectancy</div>
              <div className={`text-2xl font-mono font-bold ${displayPerformance.expectancy >= 0 ? 'text-[rgb(190,242,100)]' : 'text-[rgb(251,146,60)]'}`}>
                {formatCurrency(displayPerformance.expectancy)}
              </div>
              <div className="text-[10px] text-muted-foreground">Avg $ Per Trade</div>
            </div>
          </div>
        </div>

        {/* Trading Statistics Grid - Positioned closer to balance metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 -mt-2">
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
            <div className={`text-2xl font-mono font-bold ${(displayPerformance.totalFees || 0) < 0 ? 'text-[rgb(251,146,60)]' : 'text-[rgb(190,242,100)]'}`} data-testid="text-fees-paid">
              {(displayPerformance.totalFees || 0) >= 0 ? '+' : ''}${(displayPerformance.totalFees || 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              Commission
            </div>
          </div>

          {/* Funding Cost */}
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Funding Cost</div>
            <div className={`text-2xl font-mono font-bold ${(displayPerformance.fundingCost || 0) < 0 ? 'text-[rgb(251,146,60)]' : 'text-[rgb(190,242,100)]'}`} data-testid="text-funding-cost">
              {(displayPerformance.fundingCost || 0) >= 0 ? '+' : ''}${(displayPerformance.fundingCost || 0).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground">
              Total funding
            </div>
          </div>
        </div>

        {/* Account Ledger - Capital Tracking with Manual Entry */}
        <div className="space-y-3">
          <Button
            variant="ghost"
            className="w-full justify-between px-4 py-3 h-auto border-2 border-white rounded-lg"
            onClick={() => setAccountLedgerExpanded(!accountLedgerExpanded)}
          >
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              <span className="font-semibold">Account Ledger</span>
            </div>
            {accountLedgerExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
          {accountLedgerExpanded && <AccountLedger />}
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
                      <label className="text-sm font-medium mb-2 block">Start Date & Time</label>
                      <Calendar
                        mode="single"
                        selected={dateRange.start || undefined}
                        onSelect={(date) => {
                          if (date) {
                            const existing = dateRange.start || new Date();
                            date.setHours(existing.getHours());
                            date.setMinutes(existing.getMinutes());
                          }
                          setDateRange(prev => ({ ...prev, start: date || null }));
                        }}
                        data-testid="calendar-start-date"
                      />
                      <div className="flex gap-2 mt-2">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Hour</label>
                          <Input
                            type="number"
                            min="1"
                            max="12"
                            value={(() => {
                              const hours24 = dateRange.start?.getHours() ?? 0;
                              const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;
                              return hours12;
                            })()}
                            onChange={(e) => {
                              const hours12 = parseInt(e.target.value) || 12;
                              const clampedHours12 = Math.min(12, Math.max(1, hours12));
                              setDateRange(prev => {
                                const newStart = prev.start ? new Date(prev.start) : new Date();
                                const currentHours24 = newStart.getHours();
                                const isPM = currentHours24 >= 12;
                                let hours24 = clampedHours12;
                                if (isPM && clampedHours12 !== 12) hours24 = clampedHours12 + 12;
                                else if (!isPM && clampedHours12 === 12) hours24 = 0;
                                newStart.setHours(hours24);
                                return { ...prev, start: newStart };
                              });
                            }}
                            className="h-8"
                            data-testid="input-start-hour"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Minute</label>
                          <Input
                            type="number"
                            min="0"
                            max="59"
                            value={dateRange.start?.getMinutes() ?? 0}
                            onChange={(e) => {
                              const minutes = parseInt(e.target.value) || 0;
                              setDateRange(prev => {
                                const newStart = prev.start ? new Date(prev.start) : new Date();
                                newStart.setMinutes(Math.min(59, Math.max(0, minutes)));
                                return { ...prev, start: newStart };
                              });
                            }}
                            className="h-8"
                            data-testid="input-start-minute"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Period</label>
                          <Select
                            value={(dateRange.start?.getHours() ?? 0) >= 12 ? "PM" : "AM"}
                            onValueChange={(value) => {
                              setDateRange(prev => {
                                const newStart = prev.start ? new Date(prev.start) : new Date();
                                const currentHours24 = newStart.getHours();
                                const currentHours12 = currentHours24 === 0 ? 12 : currentHours24 > 12 ? currentHours24 - 12 : currentHours24;
                                let newHours24 = currentHours24;
                                if (value === "PM" && currentHours24 < 12) {
                                  newHours24 = currentHours12 === 12 ? 12 : currentHours12 + 12;
                                } else if (value === "AM" && currentHours24 >= 12) {
                                  newHours24 = currentHours12 === 12 ? 0 : currentHours12;
                                }
                                newStart.setHours(newHours24);
                                return { ...prev, start: newStart };
                              });
                            }}
                          >
                            <SelectTrigger className="h-8" data-testid="select-start-period">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AM">AM</SelectItem>
                              <SelectItem value="PM">PM</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">End Date & Time</label>
                      <Calendar
                        mode="single"
                        selected={dateRange.end || undefined}
                        onSelect={(date) => {
                          if (date) {
                            const existing = dateRange.end || new Date();
                            date.setHours(existing.getHours());
                            date.setMinutes(existing.getMinutes());
                          }
                          setDateRange(prev => ({ ...prev, end: date || null }));
                        }}
                        disabled={(date) => dateRange.start ? date < dateRange.start : false}
                        data-testid="calendar-end-date"
                      />
                      <div className="flex gap-2 mt-2">
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Hour</label>
                          <Input
                            type="number"
                            min="1"
                            max="12"
                            value={(() => {
                              const hours24 = dateRange.end?.getHours() ?? 23;
                              const hours12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;
                              return hours12;
                            })()}
                            onChange={(e) => {
                              const hours12 = parseInt(e.target.value) || 12;
                              const clampedHours12 = Math.min(12, Math.max(1, hours12));
                              setDateRange(prev => {
                                const newEnd = prev.end ? new Date(prev.end) : new Date();
                                const currentHours24 = newEnd.getHours();
                                const isPM = currentHours24 >= 12;
                                let hours24 = clampedHours12;
                                if (isPM && clampedHours12 !== 12) hours24 = clampedHours12 + 12;
                                else if (!isPM && clampedHours12 === 12) hours24 = 0;
                                newEnd.setHours(hours24);
                                return { ...prev, end: newEnd };
                              });
                            }}
                            className="h-8"
                            data-testid="input-end-hour"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Minute</label>
                          <Input
                            type="number"
                            min="0"
                            max="59"
                            value={dateRange.end?.getMinutes() ?? 59}
                            onChange={(e) => {
                              const minutes = parseInt(e.target.value) || 0;
                              setDateRange(prev => {
                                const newEnd = prev.end ? new Date(prev.end) : new Date();
                                newEnd.setMinutes(Math.min(59, Math.max(0, minutes)));
                                return { ...prev, end: newEnd };
                              });
                            }}
                            className="h-8"
                            data-testid="input-end-minute"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-xs text-muted-foreground">Period</label>
                          <Select
                            value={(dateRange.end?.getHours() ?? 23) >= 12 ? "PM" : "AM"}
                            onValueChange={(value) => {
                              setDateRange(prev => {
                                const newEnd = prev.end ? new Date(prev.end) : new Date();
                                const currentHours24 = newEnd.getHours();
                                const currentHours12 = currentHours24 === 0 ? 12 : currentHours24 > 12 ? currentHours24 - 12 : currentHours24;
                                let newHours24 = currentHours24;
                                if (value === "PM" && currentHours24 < 12) {
                                  newHours24 = currentHours12 === 12 ? 12 : currentHours12 + 12;
                                } else if (value === "AM" && currentHours24 >= 12) {
                                  newHours24 = currentHours12 === 12 ? 0 : currentHours12;
                                }
                                newEnd.setHours(newHours24);
                                return { ...prev, end: newEnd };
                              });
                            }}
                          >
                            <SelectTrigger className="h-8" data-testid="select-end-period">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="AM">AM</SelectItem>
                              <SelectItem value="PM">PM</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
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

              {/* Transfer Event Filter */}
              {depositsList.length > 0 && (
                <Popover open={depositFilterOpen} onOpenChange={setDepositFilterOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-deposit-filter">
                      <Wallet className="h-4 w-4 mr-2" />
                      From Transfer
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3" align="start">
                    <div className="space-y-2">
                      <label className="text-sm font-medium block">Select Transfer Event</label>
                      <div className="max-h-60 overflow-y-auto space-y-1">
                        {depositsList.map((deposit) => {
                          const amount = parseFloat(deposit.amount || '0');
                          const depositDate = new Date(deposit.timestamp);
                          const isDeposit = amount > 0;
                          const displayAmount = isDeposit ? `+$${amount.toFixed(2)}` : `-$${Math.abs(amount).toFixed(2)}`;
                          const amountColor = isDeposit ? 'text-[rgb(34,197,94)]' : 'text-[rgb(251,146,60)]';
                          return (
                            <Button
                              key={deposit.id}
                              variant={selectedDepositId === deposit.id ? "default" : "ghost"}
                              size="sm"
                              className="w-full justify-start text-left"
                              onClick={() => handleDepositSelect(deposit.id)}
                              data-testid={`button-deposit-${deposit.id}`}
                            >
                              <div className="flex items-center justify-between w-full gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {format(depositDate, 'MMM d, yyyy HH:mm')}
                                </span>
                                <span className={`font-mono font-semibold ${amountColor}`}>
                                  {displayAmount}
                                </span>
                              </div>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              {/* Manual Trade Selection Button */}
              <Button
                variant={manualSelectionMode ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setManualSelectionMode(!manualSelectionMode);
                  if (manualSelectionMode) {
                    // Exiting selection mode - clear selection
                    setSelectedTradeRange({ start: null, end: null });
                  }
                  // Keep current date filters when entering selection mode
                }}
                data-testid="button-manual-selection"
              >
                <Target className="h-4 w-4 mr-2" />
                {manualSelectionMode ? 'Cancel Selection' : 'Select Trades'}
              </Button>

              {/* Active Transfer Filter Indicator */}
              {selectedDeposit && (
                <Badge variant="secondary" className="gap-1" data-testid="badge-active-deposit-filter">
                  <Wallet className="h-3 w-3" />
                  From {parseFloat(selectedDeposit.amount || '0') > 0 ? '+' : ''}{parseFloat(selectedDeposit.amount || '0') < 0 ? '-' : ''}${Math.abs(parseFloat(selectedDeposit.amount || '0')).toFixed(0)} transfer
                  <X
                    className="h-3 w-3 ml-1 cursor-pointer hover:text-destructive"
                    onClick={clearDepositFilter}
                    data-testid="button-clear-deposit-filter"
                  />
                </Badge>
              )}

              {/* Active Date Filter Indicator (only show if not from transfer) */}
              {(dateRange.start || dateRange.end) && !selectedDeposit && (
                <Badge variant="secondary" className="gap-1" data-testid="badge-active-filter">
                  <CalendarIcon className="h-3 w-3" />
                  {dateRange.start && (() => {
                    const hasTime = dateRange.start.getHours() !== 0 || dateRange.start.getMinutes() !== 0;
                    return format(dateRange.start, hasTime ? 'MMM d h:mm a' : 'MMM d');
                  })()}
                  {dateRange.start && dateRange.end && ' - '}
                  {dateRange.end && (() => {
                    const hasTime = dateRange.end.getHours() !== 23 || dateRange.end.getMinutes() !== 59;
                    return format(dateRange.end, hasTime ? 'MMM d h:mm a' : 'MMM d');
                  })()}
                  <X 
                    className="h-3 w-3 ml-1 cursor-pointer hover:text-destructive" 
                    onClick={() => setDateRange({ start: null, end: null })}
                    data-testid="button-clear-date-filter"
                  />
                </Badge>
              )}

              {/* Active Manual Selection Indicator */}
              {selectedTradeRange.start !== null && selectedTradeRange.end !== null && (
                <Badge variant="secondary" className="gap-1" data-testid="badge-active-manual-selection">
                  <Target className="h-3 w-3" />
                  Trades {selectedTradeRange.start} - {selectedTradeRange.end}
                  <X
                    className="h-3 w-3 ml-1 cursor-pointer hover:text-destructive"
                    onClick={() => setSelectedTradeRange({ start: null, end: null })}
                    data-testid="button-clear-manual-selection"
                  />
                </Badge>
              )}
            </div>

            {/* Performance Limit Indicator - shown when displaying subset */}
            {totalTrades > 2000 && (
              <Badge variant="outline" className="gap-1" data-testid="badge-chart-limit">
                <LineChart className="h-3 w-3" />
                Showing most recent {Math.min(totalTrades, 2000).toLocaleString()} of {totalTrades.toLocaleString()} trades
              </Badge>
            )}

            {/* Selection Mode Instructions */}
            {manualSelectionMode && !isDragging && selectedTradeRange.start === null && (
              <Badge variant="default" className="gap-1 bg-blue-600">
                <Target className="h-3 w-3" />
                Click and drag on the chart to select a range
              </Badge>
            )}
            {manualSelectionMode && isDragging && (
              <Badge variant="default" className="gap-1 bg-blue-600 animate-pulse">
                <Target className="h-3 w-3" />
                Dragging... Release to complete selection
              </Badge>
            )}

          </div>

          <div className="relative h-64 md:h-80 -mx-8" style={{
            maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)'
          }}>
          {(() => {
            console.log('[DEBUG] Chart render decision:', { chartLoading, chartDataLength: chartData?.length, chartDataExists: !!chartData });
            return !chartLoading && chartData && chartData.length > 0;
          })() ? (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 35, right: 0, left: 0, bottom: 30 }}
                  key={`chart-${showStrategyUpdates}-${showDeposits}`}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
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
                <YAxis 
                  yAxisId="accountSize"
                  orientation="right"
                  domain={['dataMin - 100', 'dataMax + 100']}
                  tick={false}
                  axisLine={false}
                  hide={!showAccountSize}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  verticalAlign="bottom" 
                  height={28} 
                  wrapperStyle={{ paddingTop: '8px', fontSize: '11px' }} 
                  iconSize={10}
                  content={(props) => {
                    const legendItems = [
                      { name: 'Cumulative P&L', color: 'rgb(190, 242, 100)', active: true, toggleable: false },
                      { name: 'Account Size', color: 'rgb(59, 130, 246)', active: showAccountSize, toggleable: true },
                      { name: 'Strategy Update', color: 'hsl(var(--primary))', active: showStrategyUpdates, toggleable: true },
                      { name: 'Transfers', color: 'rgb(34, 197, 94)', active: showDeposits, toggleable: true }
                    ];
                    
                    return (
                      <ul className="flex justify-center gap-4 pt-2" style={{ fontSize: '11px' }}>
                        {legendItems.map((item, index) => (
                          <li 
                            key={`legend-${index}`} 
                            className={item.toggleable ? 'flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity' : 'flex items-center gap-1'}
                            onClick={() => {
                              if (item.name === 'Strategy Update') {
                                setShowStrategyUpdates(!showStrategyUpdates);
                              } else if (item.name === 'Transfers') {
                                setShowDeposits(!showDeposits);
                              } else if (item.name === 'Account Size') {
                                setShowAccountSize(!showAccountSize);
                              }
                            }}
                            style={{
                              opacity: item.active ? 1 : 0.4
                            }}
                            data-testid={`legend-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            <span 
                              style={{ 
                                width: '10px', 
                                height: '10px', 
                                backgroundColor: item.color,
                                display: 'inline-block',
                                marginRight: '4px'
                              }} 
                            />
                            <span>{item.name}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  }}
                />
                <ReferenceLine yAxisId="left" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <ReferenceLine yAxisId="right" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />

                {/* Drag selection overlay - shows while dragging */}
                {isDragging && dragStart !== null && dragEnd !== null && (
                  <ReferenceArea
                    x1={Math.min(dragStart, dragEnd)}
                    x2={Math.max(dragStart, dragEnd)}
                    yAxisId="left"
                    fill="rgb(59, 130, 246)"
                    fillOpacity={0.2}
                    stroke="rgb(59, 130, 246)"
                    strokeWidth={2}
                    strokeOpacity={0.8}
                    label={{
                      value: `Trades ${Math.min(dragStart, dragEnd)} - ${Math.max(dragStart, dragEnd)}`,
                      position: 'insideTop',
                      fill: 'rgb(59, 130, 246)',
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  />
                )}

                {/* Day grouping blocks - date labels at top */}
                {dayGroups.map((group, index) => (
                  <ReferenceArea
                    key={`day-date-${index}-${group.dateTimestamp}`}
                    x1={group.startTrade}
                    x2={group.endTrade}
                    yAxisId="left"
                    fill={index % 2 === 0 ? 'hsl(var(--accent))' : 'transparent'}
                    fillOpacity={0.15}
                    stroke={index % 2 === 0 ? 'hsl(var(--accent-border))' : 'transparent'}
                    strokeOpacity={0.3}
                    label={{
                      value: format(new Date(group.dateTimestamp), 'M/d'),
                      position: 'insideTop',
                      fill: 'hsl(var(--foreground))',
                      fontSize: 12,
                      fontWeight: 600,
                      offset: 10
                    }}
                  />
                ))}
                
                {/* Day grouping blocks - day-of-week labels below dates */}
                {dayGroups.map((group, index) => (
                  <ReferenceArea
                    key={`day-week-${index}-${group.dateTimestamp}`}
                    x1={group.startTrade}
                    x2={group.endTrade}
                    yAxisId="left"
                    fill="transparent"
                    label={{
                      value: format(new Date(group.dateTimestamp), 'EEE'),
                      position: 'insideTop',
                      fill: 'hsl(var(--muted-foreground))',
                      fontSize: 10,
                      fontWeight: 500,
                      offset: 28
                    }}
                  />
                ))}
                
                {/* Day grouping blocks - trade count at bottom */}
                {dayGroups.map((group, index) => (
                  <ReferenceArea
                    key={`day-count-${index}-${group.dateTimestamp}`}
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
                
                {/* Vertical lines for strategy changes with clickable dots */}
                {showStrategyUpdates && strategyChanges?.map((change) => {
                  const changeTime = new Date(change.changedAt).getTime();
                  let tradeIndex = chartData.findIndex(trade => trade.timestamp >= changeTime);
                  
                  if (tradeIndex === -1 && chartData.length > 0) {
                    tradeIndex = chartData.length - 1;
                  }
                  
                  if (tradeIndex >= 0) {
                    const tradeNumber = chartData[tradeIndex].tradeNumber;
                    const yPosition = cumulativePnlDomain[1]; // Position at top of chart
                    
                    return (
                      <Fragment key={change.id}>
                        <ReferenceLine
                          x={tradeNumber}
                          yAxisId="left"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                        />
                        <ReferenceDot
                          x={tradeNumber}
                          y={yPosition}
                          yAxisId="right"
                          r={6}
                          fill="hsl(var(--primary))"
                          stroke="hsl(var(--background))"
                          strokeWidth={2}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedChange(change)}
                          data-testid={`strategy-change-dot-${change.id}`}
                        />
                      </Fragment>
                    );
                  }
                  return null;
                })}

                {/* Vertical markers for transfer events (deposits & withdrawals) */}
                {showDeposits && transfers?.filter((transfer) => {
                  // Filter transfers by date range
                  const transferTime = new Date(transfer.timestamp).getTime();
                  const startTimestamp = dateRange.start ? dateRange.start.getTime() : 0;
                  const endTimestamp = dateRange.end ? dateRange.end.getTime() : Date.now();
                  return transferTime >= startTimestamp && transferTime <= endTimestamp;
                }).map((transfer) => {
                  const transferTime = new Date(transfer.timestamp).getTime();
                  const amount = parseFloat(transfer.amount || '0');

                  // Skip zero amounts (but show both deposits and withdrawals)
                  if (amount === 0) return null;

                  // Determine if this is a deposit (positive) or withdrawal (negative)
                  const isDeposit = amount > 0;
                  const color = isDeposit ? 'rgb(34, 197, 94)' : 'rgb(251, 146, 60)'; // Green for deposits, orange for withdrawals
                  const label = isDeposit ? `+$${amount.toFixed(2)}` : `-$${Math.abs(amount).toFixed(2)}`;

                  // Debug logging for withdrawals
                  if (!isDeposit) {
                    console.log('Rendering withdrawal:', {
                      amount,
                      transferTime: new Date(transferTime),
                      label,
                      color
                    });
                  }

                  // Find the closest trade or create a position for the transfer
                  let tradeNumber;
                  if (chartData.length === 0) {
                    // No trades in visible range, place at position 1
                    tradeNumber = 1;
                  } else {
                    // Find first trade after transfer, or use last trade if transfer is most recent
                    const tradeIndex = chartData.findIndex(trade => trade.timestamp >= transferTime);
                    if (tradeIndex >= 0) {
                      tradeNumber = chartData[tradeIndex].tradeNumber;
                    } else {
                      // Transfer is after all trades, place slightly after the last trade
                      tradeNumber = chartData[chartData.length - 1].tradeNumber + 0.5;
                    }
                  }

                  return (
                    <ReferenceLine
                      key={transfer.id}
                      x={tradeNumber}
                      yAxisId="left"
                      stroke={color}
                      strokeWidth={2}
                      label={{
                        value: label,
                        position: 'center',
                        fill: color,
                        fontSize: 11,
                        fontWeight: 600,
                        angle: -90,
                        dx: -20,
                      }}
                    />
                  );
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
                  cursor={manualSelectionMode ? 'crosshair' : 'default'}
                >
                  {chartData.map((entry, index) => {
                    // Base color on P&L
                    const fillColor = entry.pnl >= 0 ? 'rgba(190, 242, 100, 0.7)' : 'rgba(220, 38, 38, 0.7)';

                    return (
                      <Cell
                        key={`cell-${index}`}
                        fill={fillColor}
                      />
                    );
                  })}
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
                  legendType="none"
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
                {/* Strategy Update indicator for legend - hidden via legendType but always rendered */}
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
                  legendType="none"
                  hide={true}
                />
                {/* Deposits indicator for legend - hidden via legendType but always rendered */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={() => null}
                  name="Deposit"
                  stroke="rgb(34, 197, 94)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                  hide={true}
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
                  legendType="none"
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
                  legendType="none"
                />
                {/* Account Size line */}
                {showAccountSize && (
                  <Line
                    yAxisId="accountSize"
                    type="monotone"
                    dataKey="accountSize"
                    name="Account Size"
                    stroke="rgb(59, 130, 246)"
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive={false}
                    legendType="none"
                  />
                )}
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

        {/* Additional Metrics - Multi-Column List */}
        <div className="-mx-6 bg-muted/30 border-y border-border py-3 px-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-x-6 gap-y-2">
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">In Use</span>
              <span className="text-xs font-mono font-semibold ml-auto" data-testid="ticker-margin-in-use">{formatCurrency(marginInUse)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Exposure</span>
              <span className="text-xs font-mono font-semibold ml-auto" data-testid="ticker-total-exposure">{formatCurrency(totalExposure)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Award className="h-3 w-3 text-[rgb(190,242,100)] flex-shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Best Trade</span>
              <span className="text-xs font-mono font-semibold text-[rgb(190,242,100)] ml-auto">{formatCurrency(displayPerformance.bestTrade)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)] flex-shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Worst Trade</span>
              <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)] ml-auto">{formatCurrency(-Math.abs(displayPerformance.worstTrade))}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Avg Trade Time</span>
              <span className="text-xs font-mono font-semibold ml-auto">{formatTradeTime(displayPerformance.averageTradeTimeMs)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)] flex-shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Max Drawdown</span>
              <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)] ml-auto">{formatCurrency(-displayPerformance.maxDrawdown)} ({(-(displayPerformance.maxDrawdownPercent ?? 0)).toFixed(2)}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-[rgb(190,242,100)] flex-shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Avg Win</span>
              <span className="text-xs font-mono font-semibold text-[rgb(190,242,100)] ml-auto">{formatCurrency(displayPerformance.averageWin)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingDown className="h-3 w-3 text-[rgb(251,146,60)] flex-shrink-0" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Avg Loss</span>
              <span className="text-xs font-mono font-semibold text-[rgb(251,146,60)] ml-auto">{formatCurrency(-displayPerformance.averageLoss)}</span>
            </div>
          </div>
        </div>
        </>
        )}
      </CardContent>
      
      {/* Strategy Settings Dialog */}
      <Dialog open={!!selectedChange} onOpenChange={(open) => !open && setSelectedChange(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-strategy-change">
          <DialogHeader>
            <DialogTitle>Strategy Settings at this Point</DialogTitle>
            <DialogDescription>
              {selectedChange && format(new Date(selectedChange.changedAt), 'MMM d, yyyy h:mm a')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            {selectedChange && activeStrategy && (() => {
              // Reconstruct strategy state at the selected point in time
              const reconstructedStrategy = { ...activeStrategy };
              
              // Find the selected change index (strategyChanges is ordered newest first)
              const selectedIndex = strategyChanges?.findIndex(c => c.id === selectedChange.id) ?? -1;
              
              // Determine which fields didn't exist yet at this point in time
              // A field didn't exist if it FIRST appears in a change AFTER this point
              const fieldsAddedLater = new Set<string>();
              
              if (selectedIndex >= 0 && strategyChanges) {
                // Track fields that appear in changes after this point
                const fieldsInLaterChanges = new Set<string>();
                for (let i = 0; i < selectedIndex; i++) {
                  const laterChange = strategyChanges[i];
                  Object.keys(laterChange.changes).forEach(key => {
                    fieldsInLaterChanges.add(key);
                  });
                }
                
                // Track fields that appear at or before this point
                const fieldsInEarlierChanges = new Set<string>();
                Object.keys(selectedChange.changes).forEach(key => {
                  fieldsInEarlierChanges.add(key);
                });
                for (let i = selectedIndex + 1; i < strategyChanges.length; i++) {
                  const earlierChange = strategyChanges[i];
                  Object.keys(earlierChange.changes).forEach(key => {
                    fieldsInEarlierChanges.add(key);
                  });
                }
                
                // A field was added later if it appears in later changes but not in earlier ones
                fieldsInLaterChanges.forEach(field => {
                  if (!fieldsInEarlierChanges.has(field)) {
                    fieldsAddedLater.add(field);
                  }
                });
              }
              
              // Apply all changes AFTER the selected one in reverse to undo them
              if (selectedIndex >= 0 && strategyChanges) {
                for (let i = 0; i < selectedIndex; i++) {
                  const laterChange = strategyChanges[i];
                  Object.entries(laterChange.changes).forEach(([key, value]: [string, any]) => {
                    if (value && typeof value === 'object' && 'old' in value && 'new' in value) {
                      // Reverse the change by applying the "old" value
                      (reconstructedStrategy as any)[key] = value.old;
                    }
                  });
                }
              }
              
              // Apply the selected change itself
              Object.entries(selectedChange.changes).forEach(([key, value]: [string, any]) => {
                if (value && typeof value === 'object' && 'old' in value && 'new' in value) {
                  (reconstructedStrategy as any)[key] = value.new;
                }
              });
              
              // Define all settings to display with categories
              const settingCategories = [
                {
                  name: "Assets & Risk",
                  settings: [
                    { key: 'selectedAssets', label: 'Selected Assets' },
                    { key: 'percentileThreshold', label: 'Percentile Threshold', suffix: '%' },
                    { key: 'maxOpenPositions', label: 'Max Open Positions' },
                    { key: 'maxPortfolioRiskPercent', label: 'Max Portfolio Risk', suffix: '%' },
                  ]
                },
                {
                  name: "Position Sizing",
                  settings: [
                    { key: 'marginAmount', label: 'Account Usage', suffix: '%' },
                    { key: 'leverage', label: 'Leverage', suffix: 'x' },
                    { key: 'maxLayers', label: 'Max DCA Layers' },
                  ]
                },
                {
                  name: "Take Profit & Stop Loss",
                  settings: [
                    { key: 'profitTargetPercent', label: 'Profit Target', suffix: '%' },
                    { key: 'stopLossPercent', label: 'Stop Loss', suffix: '%' },
                    { key: 'adaptiveTpEnabled', label: 'Adaptive TP' },
                    { key: 'adaptiveSlEnabled', label: 'Adaptive SL' },
                    { key: 'tpAtrMultiplier', label: 'TP ATR Multiplier', suffix: 'x' },
                    { key: 'slAtrMultiplier', label: 'SL ATR Multiplier', suffix: 'x' },
                  ]
                },
                {
                  name: "DCA Settings",
                  settings: [
                    { key: 'dcaStartStepPercent', label: 'DCA Start Step', suffix: '%' },
                    { key: 'dcaSpacingConvexity', label: 'Spacing Convexity' },
                    { key: 'dcaSizeGrowth', label: 'Size Growth' },
                    { key: 'dcaMaxRiskPercent', label: 'Max Risk per Layer', suffix: '%' },
                    { key: 'dcaVolatilityRef', label: 'Volatility Reference', suffix: '%' },
                    { key: 'dcaExitCushionMultiplier', label: 'Exit Cushion Multiplier', suffix: 'x' },
                  ]
                },
              ];
              
              const formatValue = (val: any, key: string) => {
                // Check if this field was added later (didn't exist at this point)
                if (fieldsAddedLater.has(key)) {
                  return 'N/A';
                }
                
                if (val === null || val === undefined) return 'N/A';
                if (typeof val === 'boolean') return val ? 'Yes' : 'No';
                if (Array.isArray(val)) {
                  return val.length > 3 ? `${val.length} assets` : val.join(', ');
                }
                return val.toString();
              };
              
              return settingCategories.map(category => (
                <div key={category.name} className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground">{category.name}</h3>
                  <div className="space-y-1">
                    {category.settings.map(setting => {
                      const value = (reconstructedStrategy as any)[setting.key];
                      const displayValue = formatValue(value, setting.key) + (setting.suffix || '');
                      
                      // Check if this setting was changed
                      const wasChanged = selectedChange.changes[setting.key] !== undefined;
                      
                      return (
                        <div 
                          key={setting.key} 
                          className={`flex items-center justify-between p-2 rounded-md ${wasChanged ? 'bg-primary/10 border border-primary/20' : 'bg-muted/30'}`}
                          data-testid={`setting-${setting.key}`}
                        >
                          <span className="text-sm">{setting.label}</span>
                          <span className={`text-sm font-mono font-semibold ${wasChanged ? 'text-primary' : ''}`}>
                            {displayValue}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Memoize component to prevent unnecessary re-renders when parent updates
export default memo(PerformanceOverview);
