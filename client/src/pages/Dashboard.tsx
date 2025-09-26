import { useState, useEffect } from "react";
import ConnectionStatus from "@/components/ConnectionStatus";
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
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  
  // Real liquidation data from WebSocket and API
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);

  // Generate or get persistent session ID
  const getSessionId = () => {
    let sessionId = localStorage.getItem('aster-session-id');
    if (!sessionId) {
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('aster-session-id', sessionId);
    }
    return sessionId;
  };

  // Save settings to database
  const saveSettings = async () => {
    try {
      const sessionId = getSessionId();
      await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          selectedAssets,
          sideFilter,
          minValue,
          timeRange,
        }),
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  // Load settings from database
  const loadSettings = async () => {
    try {
      const sessionId = getSessionId();
      const response = await fetch(`/api/settings/${sessionId}`);
      if (response.ok) {
        const settings = await response.json();
        if (settings) {
          setSelectedAssets(settings.selectedAssets || []);
          setSideFilter(settings.sideFilter || "all");
          setMinValue(settings.minValue || "0");
          setTimeRange(settings.timeRange || "1h");
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      // Mark settings as loaded to enable saving
      setSettingsLoaded(true);
    }
  };

  // Real-time WebSocket connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;
    let isMounted = true;

    const normalizeTimestamp = (timestamp: string | Date): Date => {
      return typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    };

    const connectWebSocket = () => {
      if (!isMounted) return;

      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          if (!isMounted) return;
          console.log('Connected to WebSocket');
          setIsConnected(true);
        };
        
        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'liquidation' && message.data) {
              // Normalize the timestamp to ensure it's a Date object
              const normalizedLiquidation = {
                ...message.data,
                timestamp: normalizeTimestamp(message.data.timestamp)
              };
              setLiquidations(prev => [normalizedLiquidation, ...prev.slice(0, 99)]);
            }
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };
        
        ws.onclose = () => {
          if (!isMounted) return;
          console.log('WebSocket disconnected');
          setIsConnected(false);
          // Only reconnect if component is still mounted
          if (isMounted) {
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
          }
        };
        
        ws.onerror = (error) => {
          if (!isMounted) return;
          console.error('WebSocket error:', error);
          setIsConnected(false);
        };
        
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to connect to WebSocket:', error);
        setIsConnected(false);
        // Retry connection after 5 seconds if component is still mounted
        if (isMounted) {
          reconnectTimeout = setTimeout(connectWebSocket, 5000);
        }
      }
    };

    // Load initial liquidations from API
    const loadInitialData = async () => {
      if (!isMounted) return;
      try {
        const response = await fetch('/api/liquidations?limit=50');
        if (response.ok) {
          const data = await response.json();
          // Normalize timestamps in initial data
          const normalizedData = data.map((liq: any) => ({
            ...liq,
            timestamp: normalizeTimestamp(liq.timestamp)
          }));
          setLiquidations(normalizedData);
        }
      } catch (error) {
        console.error('Failed to load initial liquidations:', error);
      }
    };

    loadSettings();
    loadInitialData();
    connectWebSocket();

    return () => {
      isMounted = false;
      if (ws) {
        // Remove event handlers to prevent any state updates
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, []);

  // Save settings when they change (only after initial load)
  useEffect(() => {
    if (settingsLoaded) {
      saveSettings();
    }
  }, [selectedAssets, sideFilter, minValue, timeRange, settingsLoaded]);

  // Filter liquidations based on current filters
  const filteredLiquidations = liquidations.filter(liq => {
    // Only show liquidations for assets that are specifically selected to be watched
    if (!selectedAssets.includes(liq.symbol)) return false;
    if (sideFilter !== "all" && liq.side !== sideFilter) return false;
    if (parseFloat(liq.value) < parseFloat(minValue)) return false;
    
    // Apply time range filter
    if (timeRange) {
      const now = new Date();
      const liquidationTime = new Date(liq.timestamp);
      const timeDiffMs = now.getTime() - liquidationTime.getTime();
      
      let maxTimeMs: number;
      switch (timeRange) {
        case "1m": maxTimeMs = 1 * 60 * 1000; break;
        case "5m": maxTimeMs = 5 * 60 * 1000; break;
        case "15m": maxTimeMs = 15 * 60 * 1000; break;
        case "1h": maxTimeMs = 60 * 60 * 1000; break;
        case "4h": maxTimeMs = 4 * 60 * 60 * 1000; break;
        case "1d": maxTimeMs = 24 * 60 * 60 * 1000; break;
        default: maxTimeMs = 60 * 60 * 1000; // default 1 hour
      }
      
      if (timeDiffMs > maxTimeMs) return false;
    }
    
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

  const handleRefresh = async () => {
    console.log("Refreshing data...");
    try {
      // Fetch liquidations filtered by selected assets if any are selected
      let url = '/api/liquidations?limit=100';
      if (selectedAssets.length > 0) {
        url = `/api/liquidations/by-symbol?symbols=${selectedAssets.join(',')}&limit=100`;
      }
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        // Normalize timestamps in refreshed data
        const normalizedData = data.map((liq: any) => ({
          ...liq,
          timestamp: typeof liq.timestamp === 'string' ? new Date(liq.timestamp) : liq.timestamp
        }));
        setLiquidations(normalizedData);
      }
    } catch (error) {
      console.error('Failed to refresh liquidations:', error);
    }
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Asset Selection */}
          <div className="lg:col-span-1">
            <AssetSelector
              selectedAssets={selectedAssets}
              onAssetsChange={setSelectedAssets}
            />
          </div>

          {/* Live Liquidations with Integrated Stats and Filters */}
          <div className="lg:col-span-2">
            <LiquidationTable 
              liquidations={filteredLiquidations}
              stats={{
                totalLiquidations: filteredLiquidations.length,
                totalVolume: totalVolume,
                longLiquidations: longLiquidations,
                shortLiquidations: shortLiquidations,
                largestLiquidation: largestLiquidation ? {
                  value: largestLiquidation.value,
                  timestamp: largestLiquidation.timestamp,
                  symbol: largestLiquidation.symbol
                } : undefined
              }}
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