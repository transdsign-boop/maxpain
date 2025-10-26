import { useQuery, useMutation } from "@tanstack/react-query";
import { useWebSocketData } from "./useWebSocketData";
import { useEffect, useMemo, useRef } from "react";
import { queryClient } from "@/lib/queryClient";

/**
 * Centralized hook for all strategy-related data fetching.
 * This consolidates API calls from Dashboard, PerformanceOverview, and StrategyStatus
 * to dramatically reduce redundant polling and API rate limiting.
 * 
 * All components should use this hook instead of individual useQuery calls.
 */
export function useStrategyData() {
  // Connect to WebSocket for real-time updates (single connection shared across app)
  const { isConnected: wsConnected } = useWebSocketData({ enabled: true });

  // Fallback polling interval when WebSocket is disconnected (60 seconds)
  // Longer interval reduces API load when multiple clients are connected
  const fallbackInterval = wsConnected ? false : 60000;

  // Log when fallback mode activates/deactivates
  const prevWsConnected = useRef(wsConnected);
  useEffect(() => {
    if (prevWsConnected.current !== wsConnected) {
      if (wsConnected) {
        console.log('✅ WebSocket connected - real-time updates enabled');
      } else {
        console.log('⚠️ WebSocket disconnected - using HTTP fallback polling (60s intervals)');
        console.log('💡 Tip: Close other browser tabs to reduce API load and avoid rate limits');
      }
      prevWsConnected.current = wsConnected;
    }
  }, [wsConnected]);

  // Fetch strategies with fallback polling when WebSocket disconnected
  const strategiesQuery = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    staleTime: wsConnected ? Infinity : 10000,
    refetchInterval: fallbackInterval,
  });

  const strategies = strategiesQuery.data;
  const activeStrategy = strategies?.find(s => s.isActive);

  // Live account data - WebSocket first, HTTP fallback when disconnected
  const liveAccountQuery = useQuery<any>({
    queryKey: ['/api/live/account'],
    queryFn: async () => {
      const response = await fetch('/api/live/snapshot');
      if (!response.ok) return null;
      const data = await response.json();
      return data?.snapshot?.account || null;
    },
    staleTime: wsConnected ? Infinity : 10000,
    gcTime: Infinity,
    retry: 1,
    refetchOnMount: true, // Fetch on mount
    refetchOnWindowFocus: false,
    refetchInterval: fallbackInterval, // Poll when WebSocket disconnected
  });

  // Live positions data - WebSocket first, HTTP fallback when disconnected
  const livePositionsQuery = useQuery<any[]>({
    queryKey: ['/api/live/positions'],
    queryFn: async () => {
      const response = await fetch('/api/live/snapshot');
      if (!response.ok) return [];
      const data = await response.json();
      return data?.positions || [];
    },
    staleTime: wsConnected ? Infinity : 10000,
    gcTime: Infinity,
    retry: 1,
    refetchOnMount: true, // Fetch on mount
    refetchOnWindowFocus: false,
    refetchInterval: fallbackInterval, // Poll when WebSocket disconnected
  });

  // Construct snapshot from individual queries (orchestrator disabled to avoid rate limits)
  const liveSnapshotQuery = {
    data: liveAccountQuery.data && livePositionsQuery.data ? {
      account: liveAccountQuery.data,
      positions: livePositionsQuery.data,
      summary: {
        totalPositions: livePositionsQuery.data?.length || 0,
        totalValue: livePositionsQuery.data?.reduce((sum: number, p: any) => 
          sum + Math.abs(parseFloat(p.positionAmt || 0) * parseFloat(p.markPrice || 0)), 0) || 0,
      }
    } : null,
    isLoading: liveAccountQuery.isLoading || livePositionsQuery.isLoading,
    error: liveAccountQuery.error || livePositionsQuery.error,
  };

  // Fetch position summary with fallback polling when WebSocket disconnected
  const positionSummaryQuery = useQuery<any>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'],
    queryFn: async () => {
      const response = await fetch(`/api/strategies/${activeStrategy!.id}/positions/summary`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!activeStrategy?.id,
    staleTime: wsConnected ? Infinity : 10000,
    refetchInterval: fallbackInterval,
  });

  // Fetch portfolio risk metrics with fallback polling when WebSocket disconnected
  const portfolioRiskQuery = useQuery<any>({
    queryKey: ['/api/live/positions-summary'],
    queryFn: async () => {
      const response = await fetch('/api/live/snapshot');
      if (!response.ok) return null;
      const data = await response.json();
      return data?.positionsSummary || null;
    },
    staleTime: wsConnected ? Infinity : 10000,
    gcTime: Infinity,
    retry: 1,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchInterval: fallbackInterval, // Poll when WebSocket disconnected
  });

  // Fetch strategy changes with fallback polling when WebSocket disconnected
  const strategyChangesQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'changes'],
    enabled: !!activeStrategy?.id,
    staleTime: wsConnected ? Infinity : 10000,
    refetchInterval: fallbackInterval,
  });

  // Fetch performance overview with fallback polling when WebSocket disconnected
  const performanceQuery = useQuery<any>({
    queryKey: ['/api/performance/overview', 'v2'],
    queryFn: async () => {
      const response = await fetch('/api/performance/overview');
      if (!response.ok) throw new Error('Failed to fetch performance overview');
      return response.json();
    },
    staleTime: 2 * 60 * 1000, // 2 minutes - changes slowly
    refetchInterval: wsConnected ? false : 2 * 60 * 1000, // Only poll every 2 min if WebSocket down
  });

  // Fetch chart data with fallback polling when WebSocket disconnected
  const chartDataQuery = useQuery<any[]>({
    queryKey: ['/api/performance/chart', 'v4-oct16-cutoff'],
    queryFn: async () => {
      const response = await fetch('/api/performance/chart?_=' + Date.now());
      if (!response.ok) throw new Error('Failed to fetch chart data');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - historical data doesn't change often
    refetchInterval: false, // Never auto-refresh - user can manually refresh page
  });

  // Fetch asset performance ONCE (no polling - WebSocket provides updates)
  const assetPerformanceQuery = useQuery<any[]>({
    queryKey: ['/api/analytics/asset-performance'],
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  // Fetch closed positions (refresh every 2 minutes - reduces load)
  const closedPositionsQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'closed', 'oct16-cutoff'],
    enabled: !!activeStrategy?.id,
    queryFn: async () => {
      const response = await fetch(`/api/strategies/${activeStrategy?.id}/positions/closed?_=` + Date.now());
      if (!response.ok) throw new Error('Failed to fetch closed positions');
      return response.json();
    },
    staleTime: 2 * 60 * 1000, // Refresh every 2 minutes
    refetchInterval: 2 * 60 * 1000, // Auto-refetch every 2 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Fetch realized P&L events from exchange (actual closed trades - source of truth)
  // Starting from October 16, 2025 at 17:19:00 UTC (first deposit - excludes testing period)
  const realizedPnlEventsQuery = useQuery<{ events: any[]; total: number; count: number; dateRange?: any }>({
    queryKey: ['/api/realized-pnl-events', 'oct16-cutoff'],
    queryFn: async () => {
      const response = await fetch('/api/realized-pnl-events?startTime=1760635140000&_=' + Date.now());
      if (!response.ok) return { events: [], total: 0, count: 0 };
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes (exchange API - avoid rate limits!)
    refetchInterval: 5 * 60 * 1000, // Auto-refetch every 5 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Fetch transfers for chart markers (from account ledger)
  // Only shows transfers that have been manually added to the ledger
  const transfersQuery = useQuery<any[]>({
    queryKey: ['/api/account/ledger'],
    queryFn: async () => {
      const response = await fetch('/api/account/ledger');
      if (!response.ok) return [];
      const ledger = await response.json();

      // Filter to only entries with tranId (transfers from exchange)
      // and convert to transfer format for chart compatibility
      return ledger
        .filter((entry: any) => entry.tranId) // Only entries from transfers
        .map((entry: any) => ({
          id: entry.id,
          tranId: entry.tranId,
          asset: entry.asset,
          amount: entry.type === 'withdrawal' ? `-${entry.amount}` : entry.amount,
          time: new Date(entry.timestamp).getTime(),
          timestamp: entry.timestamp,
          incomeType: entry.type === 'withdrawal' ? 'TRANSFER_WITHDRAWAL' : 'TRANSFER_DEPOSIT',
          investor: entry.investor,
          reason: entry.reason,
          notes: entry.notes,
        }));
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  // No longer need auto-sync since we're using account ledger
  // Users manually add transfers they want to track via Account Ledger component

  // Fetch commissions for fee calculation (fetched from exchange API, not database)
  // Starting from October 10, 2025 at 2:13 PM UTC (trade #370 - excludes testing period)
  const commissionsQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/commissions'],
    queryFn: async () => {
      const response = await fetch('/api/commissions');
      if (!response.ok) return { records: [], total: 0 };
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // Refresh every 10 minutes (exchange API - avoid rate limits!)
    refetchInterval: 10 * 60 * 1000, // Auto-refetch every 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Fetch funding fees for fee calculation (fetched from exchange API, not database)
  const fundingFeesQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/funding-fees'],
    queryFn: async () => {
      const response = await fetch('/api/funding-fees');
      if (!response.ok) return { records: [], total: 0 };
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // Refresh every 10 minutes (exchange API - avoid rate limits!)
    refetchInterval: 10 * 60 * 1000, // Auto-refetch every 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const snapshot = liveSnapshotQuery.data;

  // Enrich closed positions with exchange P&L and fees (match by symbol and timestamp)
  const closedPositionsWithExchangeData = useMemo(() => {
    const positions = closedPositionsQuery.data || [];
    const pnlEvents = realizedPnlEventsQuery.data?.events || [];
    const commissionRecords = commissionsQuery.data?.records || [];
    
    if (positions.length === 0) return positions;
    
    // Track which events have been matched to prevent reuse
    const usedPnlIndices = new Set<number>();
    const usedCommissionIndices = new Set<number>();
    
    // CRITICAL: Process positions in REVERSE chronological order (newest first)
    // This prevents newer position fees from being stolen by older positions
    const sortedPositions = [...positions].sort((a, b) => {
      const timeA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
      const timeB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
      return timeB - timeA; // Newest first
    });
    
    const enrichedMap = new Map();
    
    sortedPositions.forEach(position => {
      if (!position.closedAt) {
        enrichedMap.set(position.id, position);
        return;
      }
      
      const closeTime = new Date(position.closedAt).getTime();
      const openTime = new Date(position.openedAt).getTime();
      
      // Find best matching P&L event by symbol and close time
      let bestPnlEvent: any = null;
      let bestPnlIndex = -1;
      let bestPnlTimeDiff = Infinity;
      
      if (pnlEvents.length > 0) {
        pnlEvents.forEach((event, index) => {
          if (usedPnlIndices.has(index)) return;
          if (event.symbol !== position.symbol) return;
          
          const timeDiff = Math.abs(event.time - closeTime);
          if (timeDiff > 30000) return; // Outside 30-second window
          
          if (timeDiff < bestPnlTimeDiff) {
            bestPnlEvent = event;
            bestPnlIndex = index;
            bestPnlTimeDiff = timeDiff;
          }
        });
      }
      
      // Find all matching commission events for this position
      // Use tight time windows to prevent cross-position contamination:
      // - Entry fees: within 10s of open time
      // - Exit fees: within 10s of close time
      const matchedCommissions: any[] = [];
      commissionRecords.forEach((record, index) => {
        if (usedCommissionIndices.has(index)) return;
        if (record.symbol !== position.symbol) return;
        
        const commissionTime = record.time;
        
        // Check if commission is near open time (entry fee) - within 10 seconds
        const nearOpen = Math.abs(commissionTime - openTime) <= 10000;
        
        // Check if commission is near close time (exit fee) - within 10 seconds
        const nearClose = Math.abs(commissionTime - closeTime) <= 10000;
        
        if (nearOpen || nearClose) {
          matchedCommissions.push({ record, index });
        }
      });
      
      // Calculate total fees from matched commissions
      const totalFees = matchedCommissions.reduce((sum, { record }) => {
        return sum + Math.abs(parseFloat(record.income || '0'));
      }, 0);
      
      // Mark matched commissions as used
      matchedCommissions.forEach(({ index }) => {
        usedCommissionIndices.add(index);
      });
      
      // Mark P&L event as used if matched
      if (bestPnlEvent && bestPnlIndex >= 0) {
        usedPnlIndices.add(bestPnlIndex);
      }
      
      // Return enriched position
      const enriched: any = { ...position };
      
      if (bestPnlEvent) {
        enriched.realizedPnl = bestPnlEvent.income; // Exchange P&L in dollars
        enriched.exchangePnlMatched = true;
      }
      
      if (totalFees > 0) {
        enriched.totalFees = totalFees.toString();
        enriched.exchangeFeesMatched = true;
      }
      
      enrichedMap.set(position.id, enriched);
    });
    
    // Return positions in original order with enrichments applied
    return positions.map(p => enrichedMap.get(p.id) || p);
  }, [closedPositionsQuery.data, realizedPnlEventsQuery.data, commissionsQuery.data]);

  return {
    // WebSocket connection status
    wsConnected,

    // Strategy data
    strategies,
    activeStrategy,
    strategiesLoading: strategiesQuery.isLoading,

    // Live exchange data (from unified snapshot)
    liveAccount: snapshot?.account,
    liveAccountLoading: liveSnapshotQuery.isLoading,
    liveAccountError: liveSnapshotQuery.error,

    livePositions: snapshot?.positions,
    livePositionsLoading: liveSnapshotQuery.isLoading,
    livePositionsError: liveSnapshotQuery.error,

    // Position data
    positionSummary: positionSummaryQuery.data,
    positionSummaryLoading: positionSummaryQuery.isLoading,

    // Strategy changes
    strategyChanges: strategyChangesQuery.data,
    strategyChangesLoading: strategyChangesQuery.isLoading,

    // Performance data
    performance: performanceQuery.data,
    performanceLoading: performanceQuery.isLoading,
    performanceError: performanceQuery.error,

    chartData: chartDataQuery.data,
    chartDataLoading: chartDataQuery.isLoading,
    chartDataError: chartDataQuery.error,

    assetPerformance: assetPerformanceQuery.data,
    assetPerformanceLoading: assetPerformanceQuery.isLoading,
    assetPerformanceError: assetPerformanceQuery.error,

    closedPositions: closedPositionsWithExchangeData,
    closedPositionsLoading: closedPositionsQuery.isLoading,
    closedPositionsError: closedPositionsQuery.error,

    // Realized P&L events from exchange (actual closed trades)
    realizedPnlEvents: realizedPnlEventsQuery.data?.events || [],
    realizedPnlTotal: realizedPnlEventsQuery.data?.total || 0,
    realizedPnlCount: realizedPnlEventsQuery.data?.count || 0,
    realizedPnlLoading: realizedPnlEventsQuery.isLoading,
    realizedPnlError: realizedPnlEventsQuery.error,

    // Transfer events for chart markers
    transfers: transfersQuery.data,
    transfersLoading: transfersQuery.isLoading,
    transfersError: transfersQuery.error,

    // Commission and funding fee data for filtered calculations
    commissions: commissionsQuery.data,
    commissionsLoading: commissionsQuery.isLoading,
    commissionsError: commissionsQuery.error,

    fundingFees: fundingFeesQuery.data,
    fundingFeesLoading: fundingFeesQuery.isLoading,
    fundingFeesError: fundingFeesQuery.error,

    // Portfolio risk metrics (filled vs reserved)
    portfolioRisk: portfolioRiskQuery.data,
    portfolioRiskLoading: portfolioRiskQuery.isLoading,
    portfolioRiskError: portfolioRiskQuery.error,
  };
}
