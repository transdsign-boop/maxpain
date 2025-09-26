import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Clock } from "lucide-react";

interface StatsCardsProps {
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

export default function StatsCards({
  totalLiquidations,
  totalVolume,
  longLiquidations,
  shortLiquidations,
  largestLiquidation
}: StatsCardsProps) {
  const formatNumber = (num: string | number) => {
    const parsed = typeof num === 'string' ? parseFloat(num) : num;
    if (parsed >= 1000000) {
      return `${(parsed / 1000000).toFixed(2)}M`;
    } else if (parsed >= 1000) {
      return `${(parsed / 1000).toFixed(2)}K`;
    }
    return parsed.toLocaleString();
  };

  const longPercentage = totalLiquidations > 0 ? 
    ((longLiquidations / totalLiquidations) * 100).toFixed(1) : "0";
  const shortPercentage = totalLiquidations > 0 ? 
    ((shortLiquidations / totalLiquidations) * 100).toFixed(1) : "0";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-total-volume">
            ${formatNumber(totalVolume)}
          </div>
          <p className="text-xs text-muted-foreground">
            {totalLiquidations} liquidations
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Long Liquidations</CardTitle>
          <TrendingUp className="h-4 w-4 text-chart-1" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-chart-1" data-testid="text-long-count">
            {longLiquidations}
          </div>
          <p className="text-xs text-muted-foreground">
            {longPercentage}% of total
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Short Liquidations</CardTitle>
          <TrendingDown className="h-4 w-4 text-chart-2" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-chart-2" data-testid="text-short-count">
            {shortLiquidations}
          </div>
          <p className="text-xs text-muted-foreground">
            {shortPercentage}% of total
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Largest Liquidation</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {largestLiquidation ? (
            <>
              <div className="text-2xl font-bold" data-testid="text-largest-value">
                ${formatNumber(largestLiquidation.value)}
              </div>
              <p className="text-xs text-muted-foreground">
                {largestLiquidation.symbol} • {largestLiquidation.timestamp.toLocaleTimeString()}
              </p>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-muted-foreground" data-testid="text-no-largest">
                --
              </div>
              <p className="text-xs text-muted-foreground">
                No data available
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}