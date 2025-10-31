import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface LiquidityData {
  symbol: string;
  minSideLiquidity: number;
  totalLiquidity: number;
  bidDepth: number;
  askDepth: number;
  limitingSide: string;
}

interface LiquidityStatus {
  status: 'excellent' | 'acceptable' | 'watch' | 'critical';
  color: string;
  ratio: number;
  tooltip: string;
}

/**
 * Hook to fetch and calculate liquidity status for symbols
 * Uses batch endpoint with 30s caching on server to minimize API calls
 */
export function useLiquidityStatus(symbols: string[], accountBalance: number, leverage: number = 5) {
  // Fetch liquidity data for all symbols in one request
  const { data: liquidityData, isLoading } = useQuery<LiquidityData[]>({
    queryKey: ['/api/analytics/liquidity/batch', [...symbols].sort().join(',')],
    queryFn: async () => {
      if (symbols.length === 0) return [];

      const response = await fetch('/api/analytics/liquidity/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch liquidity data');
      }

      return response.json();
    },
    enabled: symbols.length > 0 && accountBalance > 0,
    staleTime: 30000, // 30 seconds - matches server cache
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  // Calculate liquidity status for each symbol
  const liquidityStatusMap = useMemo(() => {
    if (!liquidityData || accountBalance <= 0) return new Map<string, LiquidityStatus>();

    // Calculate Layer 5 size based on DCA parameters
    // Layer 1: accountBalance * 0.004 (0.4%) * leverage
    // Layer 5: Layer 1 * (1.8^4) = Layer 1 * 10.4976
    const layer1Size = accountBalance * 0.004 * leverage;
    const layer5Size = layer1Size * Math.pow(1.8, 4); // 10.4976

    const statusMap = new Map<string, LiquidityStatus>();

    liquidityData.forEach((data) => {
      const ratio = data.minSideLiquidity / layer5Size;

      let status: LiquidityStatus['status'];
      let color: string;
      let tooltip: string;

      if (ratio >= 50) {
        status = 'excellent';
        color = 'bg-lime-500';
        tooltip = `Excellent liquidity (${ratio.toFixed(0)}x your largest layer)`;
      } else if (ratio >= 20) {
        status = 'acceptable';
        color = 'bg-yellow-500';
        tooltip = `Acceptable liquidity (${ratio.toFixed(0)}x your largest layer)`;
      } else if (ratio >= 5) {
        status = 'watch';
        color = 'bg-orange-500';
        tooltip = `Watch: Lower liquidity (${ratio.toFixed(1)}x your largest layer)`;
      } else {
        status = 'critical';
        color = 'bg-red-500';
        tooltip = `Critical: Very low liquidity (${ratio.toFixed(1)}x your largest layer)`;
      }

      statusMap.set(data.symbol, {
        status,
        color,
        ratio,
        tooltip,
      });
    });

    return statusMap;
  }, [liquidityData, accountBalance, leverage]);

  return {
    liquidityStatusMap,
    isLoading,
    layer5Size: accountBalance > 0 ? accountBalance * 0.004 * leverage * Math.pow(1.8, 4) : 0,
  };
}
