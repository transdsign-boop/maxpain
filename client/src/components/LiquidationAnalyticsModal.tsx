import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LiquidationAnalytics from "./LiquidationAnalytics";
import AssetSelector from "./AssetSelector";

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
  // Default to analyzing the selected liquidation's symbol
  const [selectedAssets, setSelectedAssets] = useState<string[]>(
    selectedLiquidation ? [selectedLiquidation.symbol] : []
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Liquidation Analytics
            {selectedLiquidation && (
              <span className="text-sm font-normal text-muted-foreground">
                - Analyzing {selectedLiquidation.symbol}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Asset Selection */}
          <div className="w-full">
            <AssetSelector
              selectedAssets={selectedAssets}
              onAssetsChange={setSelectedAssets}
            />
          </div>

          {/* Liquidation Analytics */}
          <div className="w-full">
            <LiquidationAnalytics selectedAssets={selectedAssets} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}