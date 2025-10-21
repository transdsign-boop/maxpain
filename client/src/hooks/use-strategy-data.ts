import { useQuery, useMutation } from "@tanstack/react-query";
import { useWebSocketData } from "./useWebSocketData";
import { useEffect, useMemo } from "react";
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

  // Fetch strategies ONCE (no polling - WebSocket provides real-time updates)
  const strategiesQuery = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  const strategies = strategiesQuery.data;
  const activeStrategy = strategies?.find(s => s.isActive);

  // Live account data - Fetch once, then rely on WebSocket updates
  const liveAccountQuery = useQuery<any>({
    queryKey: ['/api/live/account'],
    queryFn: async () => {
      // Fallback HTTP fetch if WebSocket hasn't populated the cache yet
      const response = await fetch('/api/live/snapshot');
      if (!response.ok) return null;
      const data = await response.json();
      return data?.snapshot?.account || null;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    refetchOnMount: false, // Only fetch on initial mount
    refetchOnWindowFocus: false, // WebSocket handles updates
  });

  // Live positions data - Fetch once, then rely on WebSocket updates
  const livePositionsQuery = useQuery<any[]>({
    queryKey: ['/api/live/positions'],
    queryFn: async () => {
      // Fallback HTTP fetch if WebSocket hasn't populated the cache yet
      const response = await fetch('/api/live/snapshot');
      if (!response.ok) return [];
      const data = await response.json();
      return data?.positions || [];
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    refetchOnMount: false, // Only fetch on initial mount
    refetchOnWindowFocus: false, // WebSocket handles updates
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

  // Fetch position summary ONCE (no polling - WebSocket provides updates)
  const positionSummaryQuery = useQuery<any>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'],
    queryFn: async () => {
      const response = await fetch(`/api/strategies/${activeStrategy!.id}/positions/summary`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!activeStrategy?.id,
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  // Fetch portfolio risk metrics from WebSocket cache (updated in real-time)
  const portfolioRiskQuery = useQuery<any>({
    queryKey: ['/api/live/positions-summary'],
    queryFn: async () => {
      // Fallback HTTP fetch if WebSocket hasn't populated the cache yet
      const response = await fetch('/api/live/snapshot');
      if (!response.ok) return null;
      const data = await response.json();
      // API returns snapshot directly, not wrapped
      return data?.positionsSummary || null;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    refetchOnMount: false, // Only fetch on initial mount
    refetchOnWindowFocus: false, // WebSocket handles updates
  });

  // Fetch strategy changes ONCE (no polling - WebSocket provides updates)
  const strategyChangesQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'changes'],
    enabled: !!activeStrategy?.id,
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  // Fetch performance overview ONCE (no polling - WebSocket provides updates)
  const performanceQuery = useQuery<any>({
    queryKey: ['/api/performance/overview'],
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  // Fetch chart data ONCE (no polling - WebSocket provides updates)
  const chartDataQuery = useQuery<any[]>({
    queryKey: ['/api/performance/chart'],
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  // Fetch asset performance ONCE (no polling - WebSocket provides updates)
  const assetPerformanceQuery = useQuery<any[]>({
    queryKey: ['/api/analytics/asset-performance'],
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  // Fetch closed positions (refresh every 30 seconds to stay in sync with P&L events)
  const closedPositionsQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'closed'],
    enabled: !!activeStrategy?.id,
    staleTime: 30 * 1000, // Refresh every 30 seconds (same as P&L events)
    refetchInterval: 30 * 1000, // Auto-refetch every 30 seconds
  });

  // Fetch realized P&L events from exchange (actual closed trades - source of truth)
  // Starting from October 1st, 2025 (timestamp: 1759276800000)
  const realizedPnlEventsQuery = useQuery<{ events: any[]; total: number; count: number; dateRange?: any }>({
    queryKey: ['/api/realized-pnl-events'],
    queryFn: async () => {
      const response = await fetch('/api/realized-pnl-events?startTime=1759276800000');
      if (!response.ok) return { events: [], total: 0, count: 0 };
      return response.json();
    },
    staleTime: 30 * 1000, // Refresh every 30 seconds for recent trades
    refetchInterval: 30 * 1000, // Auto-refetch every 30 seconds
  });

  // Fetch transfers for chart markers (fetched from exchange API)
  // Starting from October 1st, 2025 (timestamp: 1759276800000)
  const transfersQuery = useQuery<any[]>({
    queryKey: ['/api/transfers'],
    queryFn: async () => {
      const response = await fetch('/api/transfers?startTime=1759276800000');
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  // Auto-sync transfers from exchange every hour
  const syncTransfersMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/sync/transfers', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to sync transfers');
      return response.json();
    },
    onSuccess: () => {
      // Refetch transfers after successful sync
      transfersQuery.refetch();
    },
  });

  // Set up automatic syncing every hour (3,600,000 ms)
  useEffect(() => {
    // Sync immediately on mount
    syncTransfersMutation.mutate();

    // Then sync every hour
    const interval = setInterval(() => {
      syncTransfersMutation.mutate();
    }, 3600000); // 1 hour

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once on mount

  // Fetch commissions for fee calculation (fetched from exchange API, not database)
  // Starting from October 1st, 2025 (timestamp: 1759276800000)
  const commissionsQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/commissions'],
    queryFn: async () => {
      const response = await fetch('/api/commissions');
      if (!response.ok) return { records: [], total: 0 };
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  // Fetch funding fees for fee calculation (fetched from exchange API, not database)
  const fundingFeesQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/funding-fees'],
    queryFn: async () => {
      const response = await fetch('/api/funding-fees');
      if (!response.ok) return { records: [], total: 0 };
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
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
