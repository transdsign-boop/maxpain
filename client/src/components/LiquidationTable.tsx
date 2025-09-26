import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import LiquidationRow from "./LiquidationRow";
import FilterControls from "./FilterControls";
import { Activity } from "lucide-react";

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface LiquidationTableProps {
  liquidations: Liquidation[];
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