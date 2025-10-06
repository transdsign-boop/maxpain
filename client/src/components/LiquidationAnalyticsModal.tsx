import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import HistoricalLiquidationTable from "./HistoricalLiquidationTable";
import LiquidationPriceChart from "./LiquidationPriceChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface LiquidationAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLiquidation?: Liquidation;
}

export default function LiquidationAnalyticsModal({
  isOpen,
  onClose,
  selectedLiquidation
}: LiquidationAnalyticsModalProps) {
  // Fetch ALL liquidations for the specific symbol using shared query client
  const { data: symbolLiquidations, isLoading: liquidationsLoading, error: liquidationsError } = useQuery<Liquidation[]>({
    queryKey: [`/api/liquidations/by-symbol?symbols=${selectedLiquidation?.symbol}&limit=10000`],
    enabled: !!selectedLiquidation?.symbol && isOpen,
    refetchInterval: 10000, // Refresh every 10 seconds
    select: (data: any) => {
      // Normalize timestamps in the select function
      return data.map((liq: any) => ({
        ...liq,
        timestamp: typeof liq.timestamp === 'string' ? new Date(liq.timestamp) : liq.timestamp
      }));
    }
  });

  const allLiquidations = symbolLiquidations || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Liquidation Analytics
            {selectedLiquidation && (
              <span className="text-sm font-normal text-muted-foreground">
                - {selectedLiquidation.symbol}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Liquidation Price Chart */}
          {selectedLiquidation && (
            <LiquidationPriceChart 
              symbol={selectedLiquidation.symbol}
              hours={24}
            />
          )}

          {/* Historical Liquidations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                All {selectedLiquidation?.symbol} Liquidations
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Complete historical record with pagination and advanced formatting
              </p>
            </CardHeader>
            <CardContent>
              <HistoricalLiquidationTable 
                liquidations={allLiquidations}
                isLoading={liquidationsLoading}
              />
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}