import LiquidationRow from '../LiquidationRow';

export default function LiquidationRowExample() {
  const mockLiquidation = {
    id: "1",
    symbol: "BTC/USDT",
    side: "long" as const,
    size: "1.5",
    price: "45250.50",
    value: "67875.75",
    timestamp: new Date(),
    isHighlighted: false
  };

  const mockLiquidation2 = {
    id: "2", 
    symbol: "ETH/USDT",
    side: "short" as const,
    size: "12.8",
    price: "2850.25",
    value: "36483.20",
    timestamp: new Date(Date.now() - 60000),
    isHighlighted: true
  };

  return (
    <div className="p-4">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2 text-sm font-medium text-muted-foreground">Time</th>
            <th className="p-2 text-sm font-medium text-muted-foreground">Symbol</th>
            <th className="p-2 text-sm font-medium text-muted-foreground">Side</th>
            <th className="p-2 text-sm font-medium text-muted-foreground">Size</th>
            <th className="p-2 text-sm font-medium text-muted-foreground">Price</th>
            <th className="p-2 text-sm font-medium text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody>
          <LiquidationRow {...mockLiquidation} />
          <LiquidationRow {...mockLiquidation2} />
        </tbody>
      </table>
    </div>
  );
}