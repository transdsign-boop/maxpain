import { useState, useEffect } from "react";
import ConnectionStatus from "@/components/ConnectionStatus";
import StatsCards from "@/components/StatsCards";
import FilterControls from "@/components/FilterControls";
import LiquidationTable from "@/components/LiquidationTable";
import AssetSelector from "@/components/AssetSelector";
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
  const [selectedAssets, setSelectedAssets] = useState<string[]>(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
  
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
      if (isConnected && Math.random() > 0.7 && selectedAssets.length > 0) {
        // Generate liquidation for one of the selected assets
        const randomAsset = selectedAssets[Math.floor(Math.random() * selectedAssets.length)];
        
        // Asset-specific price ranges for realistic mock data
        const getPriceRange = (symbol: string) => {
          switch (symbol) {
            case "BTC/USDT": return { min: 40000, max: 70000 };
            case "ETH/USDT": return { min: 2000, max: 4000 };
            case "SOL/USDT": return { min: 80, max: 200 };
            case "BNB/USDT": return { min: 300, max: 600 };
            case "ASTER/USDT": return { min: 0.1, max: 2 };
            case "AAPL/USDT": return { min: 150, max: 250 };
            case "TSLA/USDT": return { min: 200, max: 400 };
            case "SHIB/USDT": return { min: 0.00001, max: 0.0001 };
            case "PEPE/USDT": return { min: 0.000001, max: 0.00005 };
            default: return { min: 1, max: 1000 };
          }
        };

        const priceRange = getPriceRange(randomAsset);
        const price = (Math.random() * (priceRange.max - priceRange.min) + priceRange.min);
        const size = Math.random() * 10 + 0.1;
        const value = price * size;

        const newLiquidation: Liquidation = {
          id: Date.now().toString(),
          symbol: randomAsset,
          side: Math.random() > 0.5 ? "long" : "short",
          size: size.toFixed(4),
          price: price.toFixed(4),
          value: value.toFixed(2),
          timestamp: new Date()
        };
        
        setLiquidations(prev => [newLiquidation, ...prev.slice(0, 99)]);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isConnected, selectedAssets]);

  // Filter liquidations based on current filters
  const filteredLiquidations = liquidations.filter(liq => {
    if (sideFilter !== "all" && liq.side !== sideFilter) return false;
    if (parseFloat(liq.value) < parseFloat(minValue)) return false;
    if (selectedAssets.length > 0 && !selectedAssets.includes(liq.symbol)) return false;
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Asset Selection */}
          <div className="lg:col-span-1">
            <AssetSelector
              selectedAssets={selectedAssets}
              onAssetsChange={setSelectedAssets}
            />
          </div>

          {/* Filters */}
          <div className="lg:col-span-2">
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
          </div>
        </div>

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