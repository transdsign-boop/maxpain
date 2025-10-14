import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { AlertCircle } from "lucide-react";

interface TradeEntryError {
  id: string;
  timestamp: string;
  symbol: string;
  side: string;
  attemptType: string;
  reason: string;
  errorDetails: string | null;
  liquidationValue: string | null;
  strategySettings: {
    leverage: number;
    maxPortfolioRiskPercent: string;
    maxOpenPositions: number;
    isActive: boolean;
  };
}

interface TradeErrorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TradeErrorsDialog({ open, onOpenChange }: TradeErrorsDialogProps) {
  const [symbolFilter, setSymbolFilter] = useState<string>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");

  const { data: errors = [], isLoading } = useQuery<TradeEntryError[]>({
    queryKey: ['/api/trade-errors'],
    enabled: open,
    refetchInterval: 30000, // Refresh every 30 seconds when open
  });

  // Extract unique symbols and reasons from errors
  const uniqueSymbols = Array.from(new Set(errors.map(e => e.symbol))).sort();
  const uniqueReasons = Array.from(new Set(errors.map(e => e.reason))).sort();

  // Filter errors based on selected filters
  const filteredErrors = errors.filter(error => {
    const symbolMatch = symbolFilter === "all" || error.symbol === symbolFilter;
    const reasonMatch = reasonFilter === "all" || error.reason === reasonFilter;
    return symbolMatch && reasonMatch;
  });

  const getReasonBadgeColor = (reason: string) => {
    switch (reason) {
      case 'aggregate_filter':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/40';
      case 'risk_limit_exceeded':
        return 'bg-red-500/20 text-red-400 border-red-500/40';
      case 'leverage_set_failed':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40';
      case 'order_placement_failed':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/40';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const formatReason = (reason: string) => {
    return reason
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col" data-testid="dialog-trade-errors">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-400" />
            Trade Entry Errors
          </DialogTitle>
          <DialogDescription>
            Detailed log of all failed trade entry attempts with rejection reasons
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 py-2">
          <Select value={symbolFilter} onValueChange={setSymbolFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-symbol-filter">
              <SelectValue placeholder="Filter by symbol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Symbols</SelectItem>
              {uniqueSymbols.map(symbol => (
                <SelectItem key={symbol} value={symbol}>{symbol}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger className="w-[250px]" data-testid="select-reason-filter">
              <SelectValue placeholder="Filter by reason" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reasons</SelectItem>
              {uniqueReasons.map(reason => (
                <SelectItem key={reason} value={reason}>{formatReason(reason)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto text-sm text-muted-foreground self-center">
            {filteredErrors.length} error{filteredErrors.length !== 1 ? 's' : ''}
          </div>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Loading errors...
            </div>
          ) : filteredErrors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <AlertCircle className="w-12 h-12 mb-2 opacity-20" />
              <p>No trade entry errors found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredErrors.map((error) => (
                <div
                  key={error.id}
                  className="border rounded-lg p-4 space-y-2"
                  data-testid={`error-${error.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {error.symbol}
                      </Badge>
                      <Badge
                        variant={error.side === 'long' ? 'default' : 'secondary'}
                        className="capitalize"
                      >
                        {error.side}
                      </Badge>
                      <Badge variant="outline" className="capitalize">
                        {error.attemptType}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(error.timestamp), 'MMM dd, HH:mm:ss')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge className={getReasonBadgeColor(error.reason)}>
                      {formatReason(error.reason)}
                    </Badge>
                  </div>

                  {error.errorDetails && (
                    <p className="text-sm text-muted-foreground">
                      {error.errorDetails}
                    </p>
                  )}

                  {error.liquidationValue && (
                    <div className="text-xs text-muted-foreground">
                      Liquidation value: ${parseFloat(error.liquidationValue).toFixed(2)}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground pt-1 border-t">
                    Settings: {error.strategySettings.leverage}x leverage, {error.strategySettings.maxPortfolioRiskPercent}% max risk
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
