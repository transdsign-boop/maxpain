import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface HistoricalLiquidationTableProps {
  liquidations: Liquidation[];
  isLoading?: boolean;
}

const ITEMS_PER_PAGE = 100;

export default function HistoricalLiquidationTable({
  liquidations,
  isLoading = false
}: HistoricalLiquidationTableProps) {
  const [currentPage, setCurrentPage] = useState(1);

  // Sort liquidations by timestamp (newest first)
  const sortedLiquidations = useMemo(() => {
    return [...liquidations].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [liquidations]);

  // Paginate data for performance
  const totalPages = Math.ceil(sortedLiquidations.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedLiquidations = sortedLiquidations.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const formatValue = (value: string) => {
    const num = parseFloat(value);
    if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
    return `$${num.toFixed(2)}`;
  };

  const formatSize = (size: string) => {
    const num = parseFloat(size);
    if (num >= 1000000) return `${(num / 1000000).toFixed(3)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(3)}K`;
    return num.toFixed(4);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">Loading historical liquidations...</div>
      </div>
    );
  }

  if (liquidations.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">No historical liquidations found</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pagination Controls */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {startIndex + 1}-{Math.min(startIndex + ITEMS_PER_PAGE, sortedLiquidations.length)} of {sortedLiquidations.length} liquidations
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-2">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Historical Table */}
      <ScrollArea className="h-96 border rounded-md">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr>
              <th className="text-left p-3 font-medium">Date & Time</th>
              <th className="text-left p-3 font-medium">Symbol</th>
              <th className="text-left p-3 font-medium">Side</th>
              <th className="text-left p-3 font-medium">Size</th>
              <th className="text-left p-3 font-medium">Price</th>
              <th className="text-left p-3 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {paginatedLiquidations.map((liquidation, index) => (
              <tr
                key={liquidation.id}
                className={`border-b hover-elevate ${index % 2 === 0 ? 'bg-muted/20' : 'bg-background'}`}
                data-testid={`row-historical-liquidation-${liquidation.id}`}
              >
                <td className="p-3 font-mono text-xs">
                  <div className="space-y-1">
                    <div className="font-medium">
                      {format(liquidation.timestamp, 'MMM dd, yyyy')}
                    </div>
                    <div className="text-muted-foreground">
                      {format(liquidation.timestamp, 'HH:mm:ss')}
                    </div>
                  </div>
                </td>
                <td className="p-3 font-medium">
                  {liquidation.symbol}
                </td>
                <td className="p-3">
                  <Badge
                    variant={liquidation.side === 'long' ? 'destructive' : 'default'}
                    className={`flex items-center gap-1 w-fit text-xs ${
                      liquidation.side === 'long' 
                        ? 'bg-red-500/10 text-red-600 border-red-500/20 hover:bg-red-500/20' 
                        : 'bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/20'
                    }`}
                  >
                    {liquidation.side === 'long' ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {liquidation.side.toUpperCase()}
                  </Badge>
                </td>
                <td className="p-3 font-mono text-xs">
                  {formatSize(liquidation.size)}
                </td>
                <td className="p-3 font-mono text-xs">
                  ${parseFloat(liquidation.price).toFixed(6)}
                </td>
                <td className="p-3 font-mono text-xs font-semibold">
                  <span className={`${
                    parseFloat(liquidation.value) > 10000 ? 'text-orange-500' : 
                    parseFloat(liquidation.value) > 1000 ? 'text-yellow-600' : 'text-foreground'
                  }`}>
                    {formatValue(liquidation.value)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}