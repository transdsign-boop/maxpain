import LiquidationTable from '../LiquidationTable';

export default function LiquidationTableExample() {
  // Mock liquidation data for prototype
  const mockLiquidations = [
    {
      id: "1",
      symbol: "BTC/USDT",
      side: "long" as const,
      size: "1.5",
      price: "45250.50",
      value: "67875.75",
      timestamp: new Date()
    },
    {
      id: "2", 
      symbol: "ETH/USDT",
      side: "short" as const,
      size: "12.8",
      price: "2850.25",
      value: "36483.20",
      timestamp: new Date(Date.now() - 60000)
    },
    {
      id: "3",
      symbol: "SOL/USDT", 
      side: "long" as const,
      size: "250.0",
      price: "98.75",
      value: "24687.50",
      timestamp: new Date(Date.now() - 120000)
    },
    {
      id: "4",
      symbol: "AVAX/USDT",
      side: "short" as const,
      size: "500.0",
      price: "35.20",
      value: "17600.00",
      timestamp: new Date(Date.now() - 180000)
    }
  ];

  return (
    <div className="p-4 h-[500px]">
      <LiquidationTable liquidations={mockLiquidations} />
    </div>
  );
}