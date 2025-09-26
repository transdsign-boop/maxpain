import StatsCards from '../StatsCards';

export default function StatsCardsExample() {
  const mockStats = {
    totalLiquidations: 156,
    totalVolume: "2850000",
    longLiquidations: 94,
    shortLiquidations: 62,
    largestLiquidation: {
      value: "125000",
      timestamp: new Date(Date.now() - 300000),
      symbol: "BTC/USDT"
    }
  };

  return (
    <div className="p-4">
      <StatsCards {...mockStats} />
    </div>
  );
}