import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LiquidationAnalytics from "./LiquidationAnalytics";

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
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
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
        
        <div className="w-full">
          <LiquidationAnalytics selectedAssets={[]} />
        </div>
      </DialogContent>
    </Dialog>
  );
}