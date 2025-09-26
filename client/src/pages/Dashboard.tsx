import { useState, useEffect } from "react";
import ConnectionStatus from "@/components/ConnectionStatus";
import StatsCards from "@/components/StatsCards";
import FilterControls from "@/components/FilterControls";
import LiquidationTable from "@/components/LiquidationTable";
import ThemeToggle from "@/components/ThemeToggle";

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

export default function Dashboard() {
  const [isConnected, setIsConnected] = useState(true);
  const [timeRange, setTimeRange] = useState("1h");
  const [sideFilter, setSideFilter] = useState<"all" | "long" | "short">("all");
  const [minValue, setMinValue] = useState("0");
  
  // Mock data for prototype - TODO: replace with real WebSocket data
  const [liquidations, setLiquidations] = useState<Liquidation[]>([
    {
      id: "1",
      symbol: "BTC/USDT",
      side: "long",
      size: "1.5",
      price: "45250.50",
      value: "67875.75",
      timestamp: new Date()
    },
    {
      id: "2", 
      symbol: "ETH/USDT",
      side: "short",
      size: "12.8",
      price: "2850.25",
      value: "36483.20",
      timestamp: new Date(Date.now() - 60000)
    },
    {
      id: "3",
      symbol: "SOL/USDT", 
      side: "long",
      size: "250.0",
      price: "98.75",
      value: "24687.50",
      timestamp: new Date(Date.now() - 120000)
    },
    {
      id: "4",
      symbol: "AVAX/USDT",
      side: "short",
      size: "500.0",
      price: "35.20",
      value: "17600.00",
      timestamp: new Date(Date.now() - 180000)
    },
    {
      id: "5",
      symbol: "MATIC/USDT",
      side: "long",
      size: "1000.0",
      price: "0.85",
      value: "850.00",
      timestamp: new Date(Date.now() - 240000)
    }
  ]);

  // Simulate real-time data updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (isConnected && Math.random() > 0.7) {
        const newLiquidation: Liquidation = {
          id: Date.now().toString(),
          symbol: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "AVAX/USDT"][Math.floor(Math.random() * 4)],
          side: Math.random() > 0.5 ? "long" : "short",
          size: (Math.random() * 10 + 0.1).toFixed(2),
          price: (Math.random() * 50000 + 1000).toFixed(2),
          value: (Math.random() * 100000 + 1000).toFixed(2),
          timestamp: new Date()
        };
        
        setLiquidations(prev => [newLiquidation, ...prev.slice(0, 99)]);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isConnected]);

  // Filter liquidations based on current filters
  const filteredLiquidations = liquidations.filter(liq => {
    if (sideFilter !== "all" && liq.side !== sideFilter) return false;
    if (parseFloat(liq.value) < parseFloat(minValue)) return false;
    return true;
  });

  // Calculate stats
  const totalVolume = filteredLiquidations.reduce((sum, liq) => sum + parseFloat(liq.value), 0).toString();
  const longLiquidations = filteredLiquidations.filter(liq => liq.side === "long").length;
  const shortLiquidations = filteredLiquidations.filter(liq => liq.side === "short").length;
  
  const largestLiquidation = filteredLiquidations.length > 0 ? 
    filteredLiquidations.reduce((largest, current) => 
      parseFloat(current.value) > parseFloat(largest.value) ? current : largest
    ) : null;

  const handleRefresh = () => {
    console.log("Refreshing data...");
    // TODO: Implement actual refresh logic
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-app-title">
              Aster DEX Liquidations
            </h1>
            <p className="text-sm text-muted-foreground">
              Real-time liquidation monitoring and analysis
            </p>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionStatus isConnected={isConnected} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 space-y-6">
        {/* Stats Overview */}
        <StatsCards
          totalLiquidations={filteredLiquidations.length}
          totalVolume={totalVolume}
          longLiquidations={longLiquidations}
          shortLiquidations={shortLiquidations}
          largestLiquidation={largestLiquidation ? {
            value: largestLiquidation.value,
            timestamp: largestLiquidation.timestamp,
            symbol: largestLiquidation.symbol
          } : undefined}
        />

        {/* Filters */}
        <FilterControls
          timeRange={timeRange}
          sideFilter={sideFilter}
          minValue={minValue}
          onTimeRangeChange={setTimeRange}
          onSideFilterChange={setSideFilter}
          onMinValueChange={setMinValue}
          onRefresh={handleRefresh}
          isConnected={isConnected}
        />

        {/* Liquidations Table */}
        <LiquidationTable liquidations={filteredLiquidations} />
      </main>

      {/* Debug Controls */}
      <div className="fixed bottom-4 right-4 space-y-2">
        <button
          onClick={() => setIsConnected(!isConnected)}
          className="bg-primary text-primary-foreground px-3 py-1 rounded text-xs hover-elevate"
          data-testid="button-debug-connection"
        >
          Debug: Toggle Connection
        </button>
      </div>
    </div>
  );
}