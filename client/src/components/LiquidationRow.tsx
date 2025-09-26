import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp } from "lucide-react";

interface LiquidationRowProps {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
  isHighlighted?: boolean;
}

export default function LiquidationRow({
  id,
  symbol,
  side,
  size,
  price,
  value,
  timestamp,
  isHighlighted = false
}: LiquidationRowProps) {
  const sideColor = side === "long" ? "text-chart-1" : "text-chart-2";
  const sideIcon = side === "long" ? TrendingUp : TrendingDown;
  const SideIcon = sideIcon;

  const formatNumber = (num: string) => {
    const parsed = parseFloat(num);
    if (parsed >= 1000000) {
      return `${(parsed / 1000000).toFixed(2)}M`;
    } else if (parsed >= 1000) {
      return `${(parsed / 1000).toFixed(2)}K`;
    }
    return parsed.toFixed(2);
  };

  return (
    <tr
      className={`border-b hover-elevate ${
        isHighlighted ? "bg-primary/5" : ""
      }`}
      data-testid={`row-liquidation-${id}`}
    >
      <td className="p-2 font-mono text-sm" data-testid={`text-timestamp-${id}`}>
        {timestamp.toLocaleTimeString()}
      </td>
      <td className="p-2 font-medium" data-testid={`text-symbol-${id}`}>
        {symbol}
      </td>
      <td className="p-2" data-testid={`badge-side-${id}`}>
        <Badge
          variant={side === "long" ? "default" : "destructive"}
          className="flex items-center gap-1 w-fit"
        >
          <SideIcon className="h-3 w-3" />
          {side.toUpperCase()}
        </Badge>
      </td>
      <td className={`p-2 font-mono text-sm ${sideColor}`} data-testid={`text-size-${id}`}>
        {formatNumber(size)}
      </td>
      <td className="p-2 font-mono text-sm" data-testid={`text-price-${id}`}>
        ${formatNumber(price)}
      </td>
      <td className={`p-2 font-mono text-sm font-semibold ${sideColor}`} data-testid={`text-value-${id}`}>
        ${formatNumber(value)}
      </td>
    </tr>
  );
}