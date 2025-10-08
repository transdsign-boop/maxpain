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

  // Fetch strategies ONCE (no polling - WebSocket provides real-time updates)
  const strategiesQuery = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  const strategies = strategiesQuery.data;
  const activeStrategy = strategies?.find(s => s.isActive);

  // Live account data - NO HTTP fetching, populated by WebSocket only
  const liveAccountQuery = useQuery<any>({
    queryKey: ['/api/live/account'],
    queryFn: () => null as any, // No-op queryFn - populated by WebSocket only
    enabled: false, // Never fetch - WebSocket populates cache
    staleTime: Infinity,
  });

  // Live positions data - NO HTTP fetching, populated by WebSocket only
  const livePositionsQuery = useQuery<any[]>({
    queryKey: ['/api/live/positions'],
    queryFn: () => null as any[], // No-op queryFn - populated by WebSocket only
    enabled: false, // Never fetch - WebSocket populates cache
    staleTime: Infinity,
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
