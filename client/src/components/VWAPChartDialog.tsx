import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp, AlertCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";

interface VWAPChartDialogProps {
  symbol: string;
  strategyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentVWAP: number;
  currentPrice: number;
  bufferPercentage: number;
}

interface VWAPStatus {
  currentVWAP: number;
  currentPrice: number;
  upperBuffer: number;
  lowerBuffer: number;
}

export default function VWAPChartDialog({
  symbol,
  strategyId,
  open,
  onOpenChange,
  currentVWAP,
  currentPrice,
  bufferPercentage
}: VWAPChartDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  const { data: vwapStatus } = useQuery<VWAPStatus>({
    queryKey: [`/api/strategies/${strategyId}/vwap/status`],
    enabled: open && !!symbol && !!strategyId,
    refetchInterval: 2000,
    select: (data: any) => {
      const symbolData = data.symbols?.find((s: any) => s.symbol === symbol);
      return {
        currentVWAP: symbolData?.currentVWAP || currentVWAP,
        currentPrice: symbolData?.currentPrice || currentPrice,
        upperBuffer: symbolData?.upperBuffer || 0,
        lowerBuffer: symbolData?.lowerBuffer || 0,
      };
    }
  });

  const formatPrice = (value: number) => {
    if (value >= 1000) return `$${value.toFixed(2)}`;
    if (value >= 1) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(6)}`;
  };

  useEffect(() => {
    if (!open || !containerRef.current) return;

    // Load TradingView widget script
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (containerRef.current && (window as any).TradingView) {
        // Clear any existing widget
        containerRef.current.innerHTML = '';

        // Create new TradingView widget
        // Using Binance Futures since Aster DEX is Binance-compatible
        widgetRef.current = new (window as any).TradingView.widget({
          autosize: true,
          symbol: `BINANCE:${symbol.replace('USDT', '')}/USDT.P`, // Binance Futures perpetual
          interval: '1', // 1-minute candles to match bot
          timezone: 'America/Los_Angeles', // PST/PDT
          theme: 'dark',
          style: '1',
          locale: 'en',
          toolbar_bg: '#f1f3f6',
          enable_publishing: false,
          allow_symbol_change: false,
          container_id: containerRef.current.id,
          studies: [
            {
              id: "VWAP@tv-basicstudies",
              inputs: {
                anchor: "session"
              }
            }
          ],
          hide_side_toolbar: false,
          details: true,
          hotlist: false,
          calendar: false,
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      if (widgetRef.current && widgetRef.current.remove) {
        widgetRef.current.remove();
      }
      script.remove();
    };
  }, [open, symbol]);

  const botVWAP = vwapStatus?.currentVWAP || currentVWAP;
  const price = vwapStatus?.currentPrice || currentPrice;
  const difference = ((botVWAP - price) / price) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[95vh] h-[95vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {symbol} - TradingView Chart with VWAP
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {/* Bot VWAP Comparison Panel */}
          <div className="grid grid-cols-3 gap-4 p-4 border rounded-lg bg-muted/50">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Bot's Calculated VWAP</div>
              <div className="font-mono text-lg font-bold text-blue-500">{formatPrice(botVWAP)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Buffer: ±{(bufferPercentage * 100).toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Current Price</div>
              <div className="font-mono text-lg font-bold">{formatPrice(price)}</div>
              <div className={`text-xs font-semibold mt-1 ${difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {difference > 0 ? '+' : ''}{difference.toFixed(2)}% from bot VWAP
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-500" />
              <div className="text-xs text-muted-foreground">
                Compare the <span className="font-semibold text-blue-500">blue VWAP line</span> on TradingView's chart
                with the bot's calculated value. They should match closely if using the same 4-hour period.
              </div>
            </div>
          </div>

          {/* TradingView Chart Container */}
          <div className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-[#131722]">
            <div
              ref={containerRef}
              id={`tradingview_${symbol}`}
              className="w-full h-full"
            />
          </div>

          {/* Instructions */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-3">
            <Badge variant="outline" className="bg-blue-500/10 text-blue-600">
              TradingView VWAP
            </Badge>
            <span>→</span>
            <span>Look for the blue VWAP line on the chart above</span>
            <span className="mx-2">|</span>
            <Badge variant="outline" className="bg-blue-500/10 text-blue-600">
              Bot VWAP: {formatPrice(botVWAP)}
            </Badge>
            <span>→</span>
            <span>What your bot uses for trading decisions</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
