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
  allValues?: number[]; // Array of all liquidation values for percentile calculation
}

export default function LiquidationRow({
  id,
  symbol,
  side,
  size,
  price,
  value,
  timestamp,
  isHighlighted = false,
  allValues
}: LiquidationRowProps) {
  // BUY should be green (success), SELL should be red (destructive)
  const sideColor = side === "long" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  const sideIcon = side === "long" ? TrendingUp : TrendingDown;
  const SideIcon = sideIcon;

  const formatNumber = (num: string) => {
    const parsed = parseFloat(num);
    if (parsed >= 1000000) {
      return `${(parsed / 1000000).toFixed(4)}M`;
    } else if (parsed >= 1000) {
      return `${(parsed / 1000).toFixed(4)}K`;
    }
    return parsed.toFixed(4);
  };

  // Calculate percentile rank for this liquidation value (using pre-sorted values)
  const calculatePercentile = (currentValue: number) => {
    if (!allValues || allValues.length === 0) return null;
    
    // Binary search for efficient O(log n) lookup
    let left = 0, right = allValues.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (allValues[mid] <= currentValue) {
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

  const currentValue = parseFloat(value);
  const percentile = calculatePercentile(currentValue);
  const percentileLabel = percentile ? getPercentileLabel(percentile) : null;

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
        <div className="flex items-center gap-2">
          <span>${formatNumber(value)}</span>
          {percentileLabel && (
            <Badge 
              className={`text-xs px-1.5 py-0.5 ${percentileLabel.color}`}
              data-testid={`badge-percentile-${id}`}
            >
              {percentileLabel.text}
            </Badge>
          )}
        </div>
      </td>
    </tr>
  );
}