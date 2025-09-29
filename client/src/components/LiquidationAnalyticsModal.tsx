import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import LiquidationAnalytics from "./LiquidationAnalytics";
import LiquidationRow from "./LiquidationRow";
import HistoricalLiquidationTable from "./HistoricalLiquidationTable";
import { ScrollArea } from "@/components/ui/scroll-area";
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
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Liquidation Data
            {selectedLiquidation && (
              <span className="text-sm font-normal text-muted-foreground">
                - {selectedLiquidation.symbol}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="liquidations" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="liquidations">All Liquidations ({allLiquidations.length})</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>
          
          <TabsContent value="liquidations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  All {selectedLiquidation?.symbol} Liquidations
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Complete historical record of all liquidations for this asset
                </p>
              </CardHeader>
              <CardContent>
                {liquidationsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-sm text-muted-foreground">Loading liquidations...</div>
                  </div>
                ) : liquidationsError ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-sm text-destructive">Failed to load liquidations</div>
                  </div>
                ) : allLiquidations.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="text-sm text-muted-foreground">No liquidations found for this asset</div>
                  </div>
                ) : (
                  <ScrollArea className="h-96">
                    <div className="space-y-1">
                      <table className="w-full">
                        <thead className="sticky top-0 bg-background border-b">
                          <tr>
                            <th className="text-left p-2 text-sm font-medium">Time</th>
                            <th className="text-left p-2 text-sm font-medium">Symbol</th>
                            <th className="text-left p-2 text-sm font-medium">Side</th>
                            <th className="text-left p-2 text-sm font-medium">Size</th>
                            <th className="text-left p-2 text-sm font-medium">Price</th>
                            <th className="text-left p-2 text-sm font-medium">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allLiquidations.map((liquidation) => (
                            <LiquidationRow
                              key={liquidation.id}
                              id={liquidation.id}
                              symbol={liquidation.symbol}
                              side={liquidation.side}
                              size={liquidation.size}
                              price={liquidation.price}
                              value={liquidation.value}
                              timestamp={liquidation.timestamp}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="analytics" className="space-y-4">
            <LiquidationAnalytics 
              selectedAssets={[]} 
              specificSymbol={selectedLiquidation?.symbol}
              allLiquidations={allLiquidations}
            />
            
            {/* Historical Liquidations in Analytics */}
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
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}