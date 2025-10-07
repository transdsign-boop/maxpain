import { useQuery } from "@tanstack/react-query";
import { useWebSocketData } from "./useWebSocketData";

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
  });

  const strategies = strategiesQuery.data;
  const activeStrategy = strategies?.find(s => s.isActive);

  // Fetch live account data ONCE (2min refetch as fallback)
  const liveAccountQuery = useQuery<any>({
    queryKey: ['/api/live/account'],
    refetchInterval: 120000, // 2min fallback, WebSocket provides real-time
    enabled: !!activeStrategy,
    retry: 2,
  });

  // Fetch live positions ONCE (2min refetch as fallback)
  const livePositionsQuery = useQuery<any[]>({
    queryKey: ['/api/live/positions'],
    refetchInterval: 120000, // 2min fallback, WebSocket provides real-time
    enabled: !!activeStrategy,
    retry: 2,
  });

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
  });

  // Fetch strategy changes ONCE (10s refetch for recent changes)
  const strategyChangesQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'changes'],
    enabled: !!activeStrategy?.id,
    refetchInterval: 10000,
  });

  // Fetch performance overview ONCE (60s refetch)
  const performanceQuery = useQuery<any>({
    queryKey: ['/api/performance/overview'],
    refetchInterval: 60000,
  });

  // Fetch chart data ONCE (60s refetch)
  const chartDataQuery = useQuery<any[]>({
    queryKey: ['/api/performance/chart'],
    refetchInterval: 60000,
  });

  // Fetch asset performance ONCE (60s refetch)
  const assetPerformanceQuery = useQuery<any[]>({
    queryKey: ['/api/analytics/asset-performance'],
    refetchInterval: 60000,
  });

  // Fetch closed positions ONCE (60s refetch)
  const closedPositionsQuery = useQuery<any[]>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'closed'],
    enabled: !!activeStrategy?.id,
    refetchInterval: 60000,
  });

  return {
    // WebSocket connection status
    wsConnected,

    // Strategy data
    strategies,
    activeStrategy,
    strategiesLoading: strategiesQuery.isLoading,

    // Live exchange data
    liveAccount: liveAccountQuery.data,
    liveAccountLoading: liveAccountQuery.isLoading,
    liveAccountError: liveAccountQuery.error,

    livePositions: livePositionsQuery.data,
    livePositionsLoading: livePositionsQuery.isLoading,
    livePositionsError: livePositionsQuery.error,

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
