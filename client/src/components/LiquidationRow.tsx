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
  // BUY should be green (success), SELL should be red (destructive)
  const sideColor = side === "long" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
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
          className={`flex items-center gap-1 w-fit !text-white ${side === "long" ? "!bg-green-600 hover:!bg-green-700 dark:!bg-green-500 dark:hover:!bg-green-600" : "!bg-red-600 hover:!bg-red-700 dark:!bg-red-500 dark:hover:!bg-red-600"}`}
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