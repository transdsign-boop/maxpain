import { useQuery } from "@tanstack/react-query";
import { useWebSocketData } from "./useWebSocketData";
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
  const { isConnected: wsConnected } = useWebSocketData({ enabled: true });

  // Fetch strategies ONCE (60s refetch as fallback)
  const strategiesQuery = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 60000, // 60s fallback, WebSocket provides real-time
    staleTime: 30000, // Consider data fresh for 30s, prevents reload spam
  });

  const strategies = strategiesQuery.data;
  const activeStrategy = strategies?.find(s => s.isActive);

  // Live account data (cached with 5-minute TTL on server)
  const liveAccountQuery = useQuery<any>({
    queryKey: ['/api/live/account'],
    refetchInterval: 60000, // Refetch every minute (server has 5-min cache)
    staleTime: 30000, // Consider fresh for 30s
    enabled: !!activeStrategy,
    retry: 2,
  });

  // Live positions data (cached with 5-minute TTL on server)
  const livePositionsQuery = useQuery<any[]>({
    queryKey: ['/api/live/positions'],
    refetchInterval: 60000, // Refetch every minute (server has 5-min cache)
    staleTime: 30000, // Consider fresh for 30s
    enabled: !!activeStrategy,
    retry: 2,
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

  // Fetch position summary ONCE (30s refetch)
  const positionSummaryQuery = useQuery<any>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'],
    queryFn: async () => {
      const response = await fetch(`/api/strategies/${activeStrategy!.id}/positions/summary`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!activeStrategy?.id,
    refetchInterval: 30000,
    staleTime: 20000, // Fresh for 20s
  });

  // Fetch strategy changes ONCE (10s refetch for recent changes)
  const strategyChangesQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'changes'],
    enabled: !!activeStrategy?.id,
    refetchInterval: 10000,
    staleTime: 5000, // Fresh for 5s
  });

  // Fetch performance overview ONCE (60s refetch)
  const performanceQuery = useQuery<any>({
    queryKey: ['/api/performance/overview'],
    refetchInterval: 60000,
    staleTime: 30000, // Fresh for 30s
  });

  // Fetch chart data ONCE (60s refetch)
  const chartDataQuery = useQuery<any[]>({
    queryKey: ['/api/performance/chart'],
    refetchInterval: 60000,
    staleTime: 30000, // Fresh for 30s
  });

  // Fetch asset performance ONCE (60s refetch)
  const assetPerformanceQuery = useQuery<any[]>({
    queryKey: ['/api/analytics/asset-performance'],
    refetchInterval: 60000,
    staleTime: 30000, // Fresh for 30s
  });

  // Fetch closed positions ONCE (60s refetch)
  const closedPositionsQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'closed'],
    enabled: !!activeStrategy?.id,
    refetchInterval: 60000,
    staleTime: 30000, // Fresh for 30s
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

    chartData: chartDataQuery.data,
    chartDataLoading: chartDataQuery.isLoading,

    assetPerformance: assetPerformanceQuery.data,
    assetPerformanceLoading: assetPerformanceQuery.isLoading,

    closedPositions: closedPositionsQuery.data,
    closedPositionsLoading: closedPositionsQuery.isLoading,
  };
}
