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

  // Pre-calculate all percentiles for efficiency (O(n log n) instead of O(n²))
  const allValues = useMemo(() => {
    return liquidations.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
  }, [liquidations]);

  const calculatePercentile = (value: number) => {
    if (allValues.length === 0) return 0;
    
    // Binary search for efficient O(log n) lookup
    let left = 0, right = allValues.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (allValues[mid] <= value) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return Math.round((left / allValues.length) * 100);
  };

  const getOrdinalSuffix = (n: number) => {
    const lastDigit = n % 10;
    const lastTwoDigits = n % 100;
    
    // Special cases for 11th, 12th, 13th
    if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
      return `${n}th`;
    }
    
    // Regular cases
    switch (lastDigit) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  };

  const getPercentileLabel = (percentile: number) => {
    const ordinal = getOrdinalSuffix(percentile);
    
    if (percentile >= 95) return { text: ordinal, color: 'bg-red-500 text-white' };
    if (percentile >= 90) return { text: ordinal, color: 'bg-orange-500 text-white' };
    if (percentile >= 75) return { text: ordinal, color: 'bg-yellow-500 text-black' };
    if (percentile >= 50) return { text: ordinal, color: 'bg-blue-500 text-white' };
    return { text: ordinal, color: 'bg-gray-500 text-white' };
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
      <div className="flex items-center justify-between" data-testid="pagination-controls">
        <div className="text-sm text-muted-foreground" data-testid="pagination-info">
          Showing {startIndex + 1}-{Math.min(startIndex + ITEMS_PER_PAGE, sortedLiquidations.length)} of {sortedLiquidations.length} liquidations
        </div>
        <div className="flex items-center gap-2" data-testid="pagination-buttons">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage === 1}
            data-testid="button-pagination-previous"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-2" data-testid="pagination-status">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            data-testid="button-pagination-next"
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
                    className={`flex items-center gap-1 w-fit text-xs ${
                      liquidation.side === 'long' 
                        ? 'bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/20' 
                        : 'bg-red-500/10 text-red-600 border-red-500/20 hover:bg-red-500/20'
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
                  <div className="flex items-center gap-2">
                    <span className={`${
                      parseFloat(liquidation.value) > 10000 ? 'text-orange-500' : 
                      parseFloat(liquidation.value) > 1000 ? 'text-yellow-600' : 'text-foreground'
                    }`}>
                      {formatValue(liquidation.value)}
                    </span>
                    {(() => {
                      const percentile = calculatePercentile(parseFloat(liquidation.value));
                      const label = getPercentileLabel(percentile);
                      return (
                        <Badge 
                          className={`text-xs px-1.5 py-0.5 ${label.color}`}
                          data-testid={`badge-percentile-${liquidation.id}`}
                        >
                          {label.text}
                        </Badge>
                      );
                    })()}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}