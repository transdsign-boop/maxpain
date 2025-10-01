import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import ConnectionStatus from "@/components/ConnectionStatus";
import LiveLiquidationsSidebar from "@/components/LiveLiquidationsSidebar";
import LiquidationAnalyticsModal from "@/components/LiquidationAnalyticsModal";
import PerformanceOverview from "@/components/PerformanceOverview";
import TradingStrategyDialog from "@/components/TradingStrategyDialog";
import { StrategyStatus } from "@/components/StrategyStatus";
import ThemeToggle from "@/components/ThemeToggle";
import AsterLogo from "@/components/AsterLogo";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Settings, Download, Upload, Settings2 } from "lucide-react";

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // Modal state for liquidation analytics
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLiquidation, setSelectedLiquidation] = useState<Liquidation | undefined>(undefined);
  
  // Trading strategy dialog state
  const [isStrategyDialogOpen, setIsStrategyDialogOpen] = useState(false);
  
  // Real liquidation data from WebSocket and API
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
  
  // File input ref for settings import
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch active strategies
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 5000,
  });

  const activeStrategy = strategies?.find(s => s.isActive);

  // Fetch position summary for header display
  const { data: positionSummary } = useQuery<any>({
    queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'],
    queryFn: async () => {
      const response = await fetch(`/api/strategies/${activeStrategy.id}/positions/summary`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!activeStrategy?.id,
    refetchInterval: 1000, // Refresh every second for real-time updates
  });

  // Save settings to database
  const saveSettings = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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

  // Export settings as JSON
  const exportSettings = () => {
    const settings = {
      selectedAssets,
      sideFilter,
      minValue,
      timeRange,
      exportedAt: new Date().toISOString(),
    };
    const dataStr = JSON.stringify(settings, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'max-pain-settings.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  // Import settings from JSON
  const importSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const result = e.target?.result as string;
        const importedSettings = JSON.parse(result);
        
        if (importedSettings.selectedAssets) setSelectedAssets(importedSettings.selectedAssets);
        if (importedSettings.sideFilter) setSideFilter(importedSettings.sideFilter);
        if (importedSettings.minValue) setMinValue(importedSettings.minValue);
        if (importedSettings.timeRange) setTimeRange(importedSettings.timeRange);
        
        // Reset file input
        event.target.value = '';
        
        console.log('Settings imported successfully');
      } catch (error) {
        console.error('Failed to import settings:', error);
      }
    };
    reader.readAsText(file);
  };

  // Load settings from database
  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings');
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
    let liquidationQueue: any[] = [];
    let processingQueue = false;

    const normalizeTimestamp = (timestamp: string | Date): Date => {
      return typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    };

    const processQueue = async () => {
      if (processingQueue || liquidationQueue.length === 0) return;
      
      processingQueue = true;
      
      while (liquidationQueue.length > 0 && isMounted) {
        const liquidation = liquidationQueue.shift();
        
        if (liquidation) {
          setLiquidations(prev => {
            const exists = prev.some(liq => liq.id === liquidation.id);
            if (exists) {
              return prev;
            }
            return [liquidation, ...prev.slice(0, 9999)];
          });
          
          // Wait 1 second before processing the next item
          if (liquidationQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      processingQueue = false;
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
              
              // Add to queue instead of directly to state
              liquidationQueue.push(normalizedLiquidation);
              processQueue();
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

    // Load initial liquidations from API (last 8 hours)
    const loadInitialData = async () => {
      if (!isMounted) return;
      try {
        const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
        const response = await fetch(`/api/liquidations/since/${eightHoursAgo.toISOString()}?limit=10000`);
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

    loadInitialData();
    connectWebSocket();
    loadSettings();

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
      // Fetch all liquidations from the last 8 hours
      const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
      const response = await fetch(`/api/liquidations/since/${eightHoursAgo.toISOString()}?limit=10000`);
      
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

  // Handle liquidation click to open analytics modal
  const handleLiquidationClick = (liquidation: Liquidation) => {
    setSelectedLiquidation(liquidation);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedLiquidation(undefined);
  };

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  // Calculate metrics
  const leverage = activeStrategy?.leverage || 1;
  const currentBalanceWithUnrealized = positionSummary 
    ? positionSummary.currentBalance + (positionSummary.unrealizedPnl || 0)
    : 0;
  const marginInUse = positionSummary ? (positionSummary.totalExposure / leverage) : 0;
  const availableMargin = positionSummary ? (positionSummary.currentBalance - marginInUse) : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b bg-card">
        <div className="flex items-center justify-between px-6 py-3">
          <AsterLogo data-testid="app-logo" />

          <div className="flex items-center gap-8">
            {/* Trading Account Metrics with Visual Hierarchy */}
            {positionSummary && (
              <div className="flex items-center gap-6">
                {/* PRIMARY: Account Balance (Largest & Most Prominent) */}
                <div className="flex flex-col">
                  <div className="text-xs text-muted-foreground">Account Balance</div>
                  <div className="text-2xl font-mono font-bold" data-testid="text-current-balance">
                    {formatCurrency(currentBalanceWithUnrealized)}
                  </div>
                </div>

                <div className="h-10 w-px bg-border" />

                {/* SECONDARY: Key Metrics (Medium Prominence) */}
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <div className="text-xs text-muted-foreground">Available</div>
                    <div className="text-lg font-mono font-semibold text-emerald-600 dark:text-emerald-400" data-testid="text-available-margin">
                      {formatCurrency(availableMargin)}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <div className="text-xs text-muted-foreground">Positions</div>
                    <div className="text-lg font-mono font-semibold" data-testid="text-active-positions">
                      {positionSummary.activePositions}
                    </div>
                  </div>
                </div>

                <div className="h-10 w-px bg-border" />

                {/* TERTIARY: Supporting Details (Smaller) */}
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex flex-col">
                    <div className="text-muted-foreground">In Use</div>
                    <div className="font-mono font-semibold" data-testid="text-margin-in-use">
                      {formatCurrency(marginInUse)}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <div className="text-muted-foreground">Exposure</div>
                    <div className="font-mono font-semibold" data-testid="text-total-exposure">
                      {formatCurrency(positionSummary.totalExposure)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="h-10 w-px bg-border" />

            <ConnectionStatus isConnected={isConnected} />
            
            {/* Trading Strategy Button */}
            <Button 
              variant="default" 
              size="sm"
              onClick={() => setIsStrategyDialogOpen(true)}
              data-testid="button-trading-strategy"
              className="gap-2"
            >
              <Settings2 className="h-4 w-4" />
              Trading Strategy
            </Button>
            
            {/* Settings Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-settings">
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportSettings} data-testid="button-export-settings">
                  <Download className="mr-2 h-4 w-4" />
                  Export Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()} data-testid="button-import-settings">
                  <Upload className="mr-2 h-4 w-4" />
                  Import Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content with Trading Controls */}
      <main 
        className={`p-6 space-y-6 transition-all duration-300 ${
          isSidebarCollapsed ? 'md:mr-12' : 'md:mr-80'
        }`}
        style={{ paddingTop: 'calc(73px + 1.5rem)' }}
      >
        {/* Performance Overview */}
        <PerformanceOverview />
        
        {/* Active Positions */}
        <StrategyStatus />
      </main>

      {/* Live Liquidations Sidebar */}
      <LiveLiquidationsSidebar 
        liquidations={liquidations}
        isConnected={isConnected}
        selectedAssets={selectedAssets}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={setIsSidebarCollapsed}
        onLiquidationClick={handleLiquidationClick}
      />

      {/* Hidden file input for settings import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={importSettings}
        style={{ display: 'none' }}
        data-testid="input-import-settings"
      />

      {/* Liquidation Analytics Modal */}
      <LiquidationAnalyticsModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        selectedLiquidation={selectedLiquidation}
      />

      {/* Trading Strategy Dialog */}
      <TradingStrategyDialog
        open={isStrategyDialogOpen}
        onOpenChange={setIsStrategyDialogOpen}
      />

      {/* Debug Controls */}
      <div className="fixed bottom-4 left-4 space-y-2 z-30">
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