import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import ConnectionStatus from "@/components/ConnectionStatus";
import LiveLiquidationsSidebar from "@/components/LiveLiquidationsSidebar";
import LiquidationAnalyticsModal from "@/components/LiquidationAnalyticsModal";
import PerformanceOverview from "@/components/PerformanceOverview";
import TradingStrategyDialog from "@/components/TradingStrategyDialog";
import { StrategyStatus } from "@/components/StrategyStatus";
import ThemeToggle from "@/components/ThemeToggle";
import AsterLogo from "@/components/AsterLogo";
import LiveModeToggle from "@/components/LiveModeToggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings2, Pause, Play, AlertTriangle, BarChart3, Menu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

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
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // Modal state for liquidation analytics
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLiquidation, setSelectedLiquidation] = useState<Liquidation | undefined>(undefined);
  
  // Trading strategy dialog state
  const [isStrategyDialogOpen, setIsStrategyDialogOpen] = useState(false);
  
  // Emergency stop dialog state
  const [isEmergencyStopDialogOpen, setIsEmergencyStopDialogOpen] = useState(false);
  const [emergencyStopPin, setEmergencyStopPin] = useState("");
  
  // Real liquidation data from WebSocket and API
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);

  // Fetch active strategies
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 5000,
  });

  const activeStrategy = strategies?.find(s => s.isActive);
  const isLiveMode = activeStrategy?.tradingMode === 'live';

  // Fetch live account data when in live mode
  const { data: liveAccount, error: liveAccountError } = useQuery<any>({
    queryKey: ['/api/live/account'],
    refetchInterval: 5000,
    enabled: !!isLiveMode && !!activeStrategy,
    retry: 2,
  });

  // Fetch live positions when in live mode
  const { data: livePositions, error: livePositionsError } = useQuery<any[]>({
    queryKey: ['/api/live/positions'],
    refetchInterval: 5000,
    enabled: !!isLiveMode && !!activeStrategy,
    retry: 2,
  });

  // Show toast for live data errors
  useEffect(() => {
    if (liveAccountError) {
      toast({
        title: "Live Account Error",
        description: "Failed to fetch live account data from Aster DEX. Check your API keys.",
        variant: "destructive",
      });
    }
  }, [liveAccountError]);

  useEffect(() => {
    if (livePositionsError) {
      toast({
        title: "Live Positions Error",
        description: "Failed to fetch live positions from Aster DEX.",
        variant: "destructive",
      });
    }
  }, [livePositionsError]);

  // Fetch position summary for header display (paper trading)
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

  // Pause strategy mutation
  const pauseMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/strategies/${activeStrategy?.id}/pause`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      toast({
        title: "Trading Paused",
        description: "Strategy has been paused. No new trades will be opened.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to pause trading",
        variant: "destructive",
      });
    },
  });

  // Resume strategy mutation
  const resumeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/strategies/${activeStrategy?.id}/resume`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      toast({
        title: "Trading Resumed",
        description: "Strategy is now active and will process new liquidations.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to resume trading",
        variant: "destructive",
      });
    },
  });

  // Emergency stop mutation
  const emergencyStopMutation = useMutation({
    mutationFn: async (pin: string) => {
      const response = await apiRequest('POST', `/api/strategies/${activeStrategy?.id}/emergency-stop`, { pin });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies', activeStrategy?.id, 'positions'] });
      toast({
        title: "Emergency Stop Complete",
        description: data.message,
      });
      setIsEmergencyStopDialogOpen(false);
      setEmergencyStopPin("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to execute emergency stop",
        variant: "destructive",
      });
    },
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
            } else if (message.type === 'trade_notification' && message.data) {
              // Show toast notification for trade
              const { symbol, side, tradeType, layerNumber, price, value } = message.data;
              
              const tradeTypeLabel = tradeType === 'entry' ? 'Entry' 
                : tradeType === 'layer' ? `Layer ${layerNumber}` 
                : tradeType === 'take_profit' ? 'Take Profit' 
                : 'Stop Loss';
              
              const sideLabel = side === 'long' ? '🟢 LONG' : '🔴 SHORT';
              
              toast({
                title: `${tradeTypeLabel}: ${symbol}`,
                description: `${sideLabel} @ $${price.toFixed(4)} • Value: $${value.toFixed(2)}`,
                duration: 3000,
              });
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
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value);
  };

  // Calculate metrics - use live data if in live mode, otherwise paper trading data
  const leverage = activeStrategy?.leverage || 1;
  
  const currentBalance = isLiveMode && liveAccount 
    ? parseFloat(liveAccount.totalWalletBalance)
    : (positionSummary?.currentBalance || 0);
    
  const unrealizedPnl = isLiveMode && liveAccount
    ? parseFloat(liveAccount.totalUnrealizedProfit)
    : (positionSummary?.unrealizedPnl || 0);
    
  const currentBalanceWithUnrealized = currentBalance + unrealizedPnl;
  
  const availableMargin = isLiveMode && liveAccount
    ? parseFloat(liveAccount.availableBalance)
    : (positionSummary ? (positionSummary.currentBalance - (positionSummary.totalExposure / leverage)) : 0);
    
  const activePositions = isLiveMode && livePositions
    ? livePositions.length
    : (positionSummary?.activePositions || 0);
    
  const marginInUse = isLiveMode && liveAccount
    ? (parseFloat(liveAccount.totalWalletBalance) - parseFloat(liveAccount.availableBalance))
    : (positionSummary ? (positionSummary.totalExposure / leverage) : 0);
    
  const totalExposure = isLiveMode && liveAccount
    ? (marginInUse * leverage)
    : (positionSummary?.totalExposure || 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header - Optimized for Mobile */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b bg-card/80 backdrop-blur-md">
        {/* Desktop Layout */}
        <div className="hidden lg:flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <AsterLogo data-testid="app-logo" />
            <LiveModeToggle />
          </div>

          <div className="flex items-center gap-8">
            {/* Trading Account Metrics with Visual Hierarchy */}
            {(positionSummary || (isLiveMode && liveAccount)) && (
              <div className="flex items-center gap-6">
                {/* PRIMARY: Account Balance (Largest & Most Prominent) */}
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground">Account Balance</div>
                    {isLiveMode && (
                      <Badge 
                        variant="default" 
                        className="bg-[rgb(190,242,100)] text-black hover:bg-[rgb(190,242,100)] font-semibold"
                        data-testid="badge-live-mode"
                      >
                        LIVE MODE
                      </Badge>
                    )}
                  </div>
                  <div className="text-2xl font-mono font-bold" data-testid="text-current-balance">
                    {formatCurrency(currentBalanceWithUnrealized)}
                  </div>
                </div>

                <div className="h-10 w-px bg-border" />

                {/* SECONDARY: Key Metrics (Medium Prominence) */}
                <div className="flex items-center gap-4">
                  <div className="flex flex-col">
                    <div className="text-xs text-muted-foreground">Available</div>
                    <div className="text-lg font-mono font-semibold text-lime-600 dark:text-lime-400" data-testid="text-available-margin">
                      {formatCurrency(availableMargin)}
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <div className="text-xs text-muted-foreground">
                      {isLiveMode && unrealizedPnl !== 0 ? "Unrealized P&L" : "Positions"}
                    </div>
                    <div 
                      className={`text-lg font-mono font-semibold ${
                        isLiveMode && unrealizedPnl !== 0 
                          ? unrealizedPnl >= 0 
                            ? "text-lime-600 dark:text-lime-400" 
                            : "text-red-600 dark:text-red-400"
                          : ""
                      }`}
                      data-testid={isLiveMode && unrealizedPnl !== 0 ? "text-unrealized-pnl" : "text-active-positions"}
                    >
                      {isLiveMode && unrealizedPnl !== 0 
                        ? `${unrealizedPnl >= 0 ? '+' : ''}${formatCurrency(unrealizedPnl)}`
                        : activePositions
                      }
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
                      {formatCurrency(totalExposure)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="h-10 w-px bg-border" />

            <ConnectionStatus isConnected={isConnected} />
            
            {/* Pause/Resume Button */}
            {activeStrategy && (
              <Button
                variant={activeStrategy.paused ? "default" : "outline"}
                size="icon"
                onClick={() => activeStrategy.paused ? resumeMutation.mutate() : pauseMutation.mutate()}
                disabled={!activeStrategy.isActive || pauseMutation.isPending || resumeMutation.isPending}
                data-testid="button-pause-resume"
                title={activeStrategy.paused ? "Resume Trading" : "Pause Trading"}
              >
                {activeStrategy.paused ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
              </Button>
            )}
            
            {/* Emergency Stop Button */}
            {activeStrategy && positionSummary && positionSummary.activePositions > 0 && (
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setIsEmergencyStopDialogOpen(true)}
                disabled={!activeStrategy.isActive}
                data-testid="button-emergency-stop"
                title="Emergency Stop - Close All Positions"
              >
                <AlertTriangle className="h-4 w-4" />
              </Button>
            )}
            
            {/* Trading Strategy Button */}
            <Button 
              variant="default" 
              size="icon"
              onClick={() => setIsStrategyDialogOpen(true)}
              data-testid="button-trading-strategy"
              title="Trading Strategy Settings"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            
            <ThemeToggle />
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="lg:hidden px-4 py-2 space-y-2">
          {/* Top Row: Logo and Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="scale-75 origin-left">
                <AsterLogo data-testid="app-logo" />
              </div>
              <div className="scale-90">
                <LiveModeToggle />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ConnectionStatus isConnected={isConnected} />
              {/* Pause/Resume Button */}
              {activeStrategy && (
                <Button
                  variant={activeStrategy.paused ? "default" : "outline"}
                  size="icon"
                  onClick={() => activeStrategy.paused ? resumeMutation.mutate() : pauseMutation.mutate()}
                  disabled={!activeStrategy.isActive || pauseMutation.isPending || resumeMutation.isPending}
                  data-testid="button-pause-resume-mobile"
                >
                  {activeStrategy.paused ? (
                    <Play className="h-4 w-4" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                </Button>
              )}
              {/* Emergency Stop Button */}
              {activeStrategy && positionSummary && positionSummary.activePositions > 0 && (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => setIsEmergencyStopDialogOpen(true)}
                  disabled={!activeStrategy.isActive}
                  data-testid="button-emergency-stop-mobile"
                >
                  <AlertTriangle className="h-4 w-4" />
                </Button>
              )}
              <Button 
                variant="default" 
                size="icon"
                onClick={() => setIsStrategyDialogOpen(true)}
                data-testid="button-trading-strategy"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              <ThemeToggle />
            </div>
          </div>

          {/* Bottom Row: Key Metrics Only (Mobile) */}
          {(positionSummary || (isLiveMode && liveAccount)) && (
            <div className="flex flex-col gap-1">
              {isLiveMode && (
                <Badge 
                  variant="default" 
                  className="bg-[rgb(190,242,100)] text-black hover:bg-[rgb(190,242,100)] font-semibold text-[10px] w-fit"
                  data-testid="badge-live-mode-mobile"
                >
                  LIVE MODE
                </Badge>
              )}
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex flex-col">
                  <div className="text-muted-foreground">Balance</div>
                  <div className="text-lg font-mono font-bold" data-testid="text-current-balance-mobile">
                    {formatCurrency(currentBalanceWithUnrealized)}
                  </div>
                </div>
                <div className="flex flex-col">
                  <div className="text-muted-foreground">Available</div>
                  <div className="text-sm font-mono font-semibold text-lime-600 dark:text-lime-400" data-testid="text-available-margin-mobile">
                    {formatCurrency(availableMargin)}
                  </div>
                </div>
                <div className="flex flex-col">
                  <div className="text-muted-foreground">
                    {isLiveMode && unrealizedPnl !== 0 ? "Unreal P&L" : "Positions"}
                  </div>
                  <div 
                    className={`text-sm font-mono font-semibold ${
                      isLiveMode && unrealizedPnl !== 0 
                        ? unrealizedPnl >= 0 
                          ? "text-lime-600 dark:text-lime-400" 
                          : "text-red-600 dark:text-red-400"
                        : ""
                    }`}
                    data-testid={isLiveMode && unrealizedPnl !== 0 ? "text-unrealized-pnl-mobile" : "text-active-positions-mobile"}
                  >
                    {isLiveMode && unrealizedPnl !== 0 
                      ? `${unrealizedPnl >= 0 ? '+' : ''}${formatCurrency(unrealizedPnl)}`
                      : activePositions
                    }
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content with Trading Controls */}
      <main 
        className={`p-3 md:p-6 space-y-4 md:space-y-6 transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:mr-12' : 'lg:mr-80'
        }`}
        style={{ paddingTop: 'calc(73px + 1.5rem)' }}
      >
        {/* Performance Overview */}
        <PerformanceOverview />
        
        {/* Active Positions */}
        <StrategyStatus />
      </main>

      {/* Live Liquidations Sidebar - Desktop only */}
      <div className="hidden lg:block">
        <LiveLiquidationsSidebar 
          liquidations={liquidations}
          isConnected={isConnected}
          selectedAssets={selectedAssets}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={setIsSidebarCollapsed}
          onLiquidationClick={handleLiquidationClick}
        />
      </div>

      {/* Floating Action Button - Mobile/Tablet only */}
      <button
        onClick={() => setIsMobileSidebarOpen(true)}
        className="lg:hidden fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center justify-center"
        data-testid="button-fab-liquidations"
        aria-label="View liquidations"
      >
        <BarChart3 className="h-6 w-6" />
      </button>

      {/* Mobile Liquidations Sheet */}
      <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
        <SheetContent side="right" className="w-full sm:w-96 p-0">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>Live Liquidations</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100vh-80px)]">
            <LiveLiquidationsSidebar 
              liquidations={liquidations}
              isConnected={isConnected}
              selectedAssets={selectedAssets}
              isCollapsed={false}
              onToggleCollapse={() => {}}
              onLiquidationClick={(liq) => {
                handleLiquidationClick(liq);
                setIsMobileSidebarOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

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

      {/* Emergency Stop Dialog */}
      <Dialog open={isEmergencyStopDialogOpen} onOpenChange={setIsEmergencyStopDialogOpen}>
        <DialogContent data-testid="dialog-emergency-stop">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Emergency Stop
            </DialogTitle>
            <DialogDescription>
              This will immediately close all open positions. This action cannot be undone.
              <br /><br />
              Enter PIN code <strong>2233</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="emergency-pin">PIN Code</Label>
              <Input
                id="emergency-pin"
                type="password"
                placeholder="Enter 4-digit PIN"
                value={emergencyStopPin}
                onChange={(e) => setEmergencyStopPin(e.target.value)}
                maxLength={4}
                data-testid="input-emergency-pin"
                className="font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsEmergencyStopDialogOpen(false);
                setEmergencyStopPin("");
              }}
              data-testid="button-cancel-emergency-stop"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => emergencyStopMutation.mutate(emergencyStopPin)}
              disabled={emergencyStopPin.length !== 4 || emergencyStopMutation.isPending}
              data-testid="button-confirm-emergency-stop"
            >
              {emergencyStopMutation.isPending ? "Closing Positions..." : "Confirm Emergency Stop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}