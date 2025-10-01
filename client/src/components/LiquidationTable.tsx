import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import LiquidationRow from "./LiquidationRow";
import FilterControls from "./FilterControls";
import { Activity, TrendingUp, TrendingDown, DollarSign, Clock } from "lucide-react";

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface Stats {
  totalLiquidations: number;
  totalVolume: string;
  longLiquidations: number;
  shortLiquidations: number;
  largestLiquidation?: {
    value: string;
    timestamp: Date;
    symbol: string;
  };
}

interface LiquidationTableProps {
  liquidations: Liquidation[];
  stats: Stats;
  maxRows?: number;
  timeRange: string;
  sideFilter: "all" | "long" | "short";
  minValue: string;
  onTimeRangeChange: (value: string) => void;
  onSideFilterChange: (value: "all" | "long" | "short") => void;
  onMinValueChange: (value: string) => void;
  onRefresh: () => void;
  isConnected: boolean;
}

export default function LiquidationTable({ 
  liquidations, 
  stats,
  maxRows = 100,
  timeRange,
  sideFilter,
  minValue,
  onTimeRangeChange,
  onSideFilterChange,
  onMinValueChange,
  onRefresh,
  isConnected
}: LiquidationTableProps) {
  const displayedLiquidations = liquidations.slice(0, maxRows);
  
  // Pre-calculate sorted values for percentile calculations
  const allValues = liquidations.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);

  // Formatting function from StatsCards
  const formatNumber = (num: string | number) => {
    const parsed = typeof num === 'string' ? parseFloat(num) : num;
    if (parsed >= 1000000) {
      return `${(parsed / 1000000).toFixed(4)}M`;
    } else if (parsed >= 1000) {
      return `${(parsed / 1000).toFixed(4)}K`;
    }
    return parsed.toFixed(4);
  };

  const longPercentage = stats.totalLiquidations > 0 ? 
    ((stats.longLiquidations / stats.totalLiquidations) * 100).toFixed(1) : "0";
  const shortPercentage = stats.totalLiquidations > 0 ? 
    ((stats.shortLiquidations / stats.totalLiquidations) * 100).toFixed(1) : "0";

  return (
    <Card className="h-full">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Activity className="h-5 w-5" />
            Live Liquidations
          </CardTitle>
          <div className="text-sm text-muted-foreground" data-testid="text-liquidation-count">
            {liquidations.length} total
          </div>
        </div>

        {/* Compact Stats Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-md">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-lg font-bold" data-testid="text-total-volume">
                ${formatNumber(stats.totalVolume)}
              </div>
              <div className="text-xs text-muted-foreground">Total Volume</div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-md">
            <TrendingUp className="h-4 w-4 text-lime-600 dark:text-lime-400" />
            <div>
              <div className="text-lg font-bold text-lime-600 dark:text-lime-400" data-testid="text-long-count">
                {stats.longLiquidations}
              </div>
              <div className="text-xs text-muted-foreground">Long ({longPercentage}%)</div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-md">
            <TrendingDown className="h-4 w-4 text-red-700 dark:text-red-500" />
            <div>
              <div className="text-lg font-bold text-red-700 dark:text-red-500" data-testid="text-short-count">
                {stats.shortLiquidations}
              </div>
              <div className="text-xs text-muted-foreground">Short ({shortPercentage}%)</div>
            </div>
          </div>

          <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-md">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              {stats.largestLiquidation ? (
                <>
                  <div className="text-lg font-bold" data-testid="text-largest-value">
                    ${formatNumber(stats.largestLiquidation.value)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {stats.largestLiquidation.symbol}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold text-muted-foreground" data-testid="text-no-largest">
                    --
                  </div>
                  <div className="text-xs text-muted-foreground">Largest</div>
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* Integrated Filter Controls */}
        <div className="border-t pt-4">
          <FilterControls
            timeRange={timeRange}
            sideFilter={sideFilter}
            minValue={minValue}
            onTimeRangeChange={onTimeRangeChange}
            onSideFilterChange={onSideFilterChange}
            onMinValueChange={onMinValueChange}
            onRefresh={onRefresh}
            isConnected={isConnected}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="min-w-full">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Time
                  </th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Symbol
                  </th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Side
                  </th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Size
                  </th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Price
                  </th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedLiquidations.map((liquidation, index) => (
                  <LiquidationRow
                    key={liquidation.id}
                    {...liquidation}
                    isHighlighted={index < 3} // Highlight recent liquidations
                    allValues={allValues}
                  />
                ))}
                {displayedLiquidations.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground" data-testid="text-no-data">
                      No liquidations data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}