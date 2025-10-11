import { useQuery } from "@tanstack/react-query";
import { useWebSocketStatus } from "@/contexts/WebSocketContext";
import { useEffect } from "react";
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
  const { isConnected: wsConnected } = useWebSocketStatus();

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
      return data?.snapshot?.positions || [];
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

  // Fetch closed positions ONCE (no polling - WebSocket provides updates)
  const closedPositionsQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'closed'],
    enabled: !!activeStrategy?.id,
    staleTime: Infinity, // Never refetch - WebSocket provides updates
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
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  // Fetch transfers for chart markers (static historical data)
  const transfersQuery = useQuery<any[]>({
    queryKey: ['/api/transfers'],
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  // Fetch commissions for fee calculation (fetched from exchange API, not database)
  // Starting from October 1st, 2025 (timestamp: 1759276800000)
  const commissionsQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/commissions'],
    queryFn: async () => {
      const response = await fetch('/api/commissions?startTime=1759276800000');
      if (!response.ok) return { records: [], total: 0 };
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  // Fetch funding fees for fee calculation (fetched from exchange API, not database)
  // Starting from October 1st, 2025 (timestamp: 1759276800000)
  const fundingFeesQuery = useQuery<{ records: any[]; total: number }>({
    queryKey: ['/api/funding-fees'],
    queryFn: async () => {
      const response = await fetch('/api/funding-fees?startTime=1759276800000');
      if (!response.ok) return { records: [], total: 0 };
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
  });

  const snapshot = liveSnapshotQuery.data;

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

    closedPositions: closedPositionsQuery.data,
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
  };
}
