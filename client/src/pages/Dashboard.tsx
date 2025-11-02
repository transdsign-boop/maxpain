import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import ConnectionStatus from "@/components/ConnectionStatus";
import MarketSentiment from "@/components/MarketSentiment";
import PerformanceOverview from "@/components/PerformanceOverview";
import TradingStrategyDialog from "@/components/TradingStrategyDialog";
import TradeErrorsDialog from "@/components/TradeErrorsDialog";
import { StrategyStatus } from "@/components/StrategyStatus";
import CascadeRiskIndicator from "@/components/CascadeRiskIndicator";
import VWAPStatusDisplay from "@/components/VWAPStatusDisplay";
import TradingHotspotsAnalytics from "@/components/TradingHotspotsAnalytics";
import ThemeToggle from "@/components/ThemeToggle";
import AsterLogo from "@/components/AsterLogo";
import { InvestorReport } from "@/components/InvestorReport";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Settings2, Pause, Play, AlertTriangle, Menu, BookOpen, AlertCircle, Send, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useStrategyData } from "@/hooks/use-strategy-data";

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface CollapsibleSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CollapsibleSection({ title, isOpen, onToggle, children }: CollapsibleSectionProps) {
  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function Dashboard() {
  const [isConnected, setIsConnected] = useState(true);
  const [timeRange, setTimeRange] = useState("1h");
  const [sideFilter, setSideFilter] = useState<"all" | "long" | "short">("all");
  const [minValue, setMinValue] = useState("0");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Trading strategy dialog state
  const [isStrategyDialogOpen, setIsStrategyDialogOpen] = useState(false);

  // Trade errors dialog state
  const [isTradeErrorsDialogOpen, setIsTradeErrorsDialogOpen] = useState(false);

  // Emergency stop dialog state
  const [isEmergencyStopDialogOpen, setIsEmergencyStopDialogOpen] = useState(false);
  const [emergencyStopPin, setEmergencyStopPin] = useState("");

  // Trade block status from WebSocket
  const [tradeBlockStatus, setTradeBlockStatus] = useState<{blocked: boolean; reason?: string} | null>(null);

  // Real liquidation data from WebSocket and API
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);

  // Track last viewed strategy to persist selection when pausing
  const [lastViewedStrategyId, setLastViewedStrategyId] = useState<string | null>(null);

  // Section collapse state (persisted in localStorage)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('dashboard-collapsed-sections');
    return saved ? JSON.parse(saved) : {
      cascadeRisk: false,
      marketSentiment: false,
      vwapStatus: false,
      performance: false,
      tradingHotspots: false,
      activePositions: false,
    };
  });

  // Save collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('dashboard-collapsed-sections', JSON.stringify(collapsedSections));
  }, [collapsedSections]);

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Use centralized hook for all strategy-related data (reduces API calls by 10-20x)
  const {
    strategies,
    activeStrategy: baseActiveStrategy,
    liveAccount,
    liveAccountError,
    livePositions,
    livePositionsError,
    positionSummary,
    wsConnected,
  } = useStrategyData();

  // Smart strategy selection: Keep showing the same strategy after pausing
  // Priority: 1) Active strategy, 2) Last viewed strategy, 3) First strategy
  const activeStrategy = baseActiveStrategy 
    || (lastViewedStrategyId ? strategies?.find(s => s.id === lastViewedStrategyId) : null)
    || strategies?.[0];
    
  // Update last viewed strategy whenever active strategy changes
  useEffect(() => {
    if (activeStrategy?.id && activeStrategy.id !== lastViewedStrategyId) {
      setLastViewedStrategyId(activeStrategy.id);
    }
  }, [activeStrategy?.id]);

  // Show toast for live data errors (but suppress rate limit errors - they're expected)
  useEffect(() => {
    if (liveAccountError) {
      const error = liveAccountError as any;
      const isRateLimit = error?.message?.includes('429') || error?.message?.includes('Rate limit');
      
      if (!isRateLimit) {
        toast({
          title: "Live Account Error",
          description: "Failed to fetch live account data from Aster DEX. Check your API keys.",
          variant: "destructive",
        });
      }
    }
  }, [liveAccountError]);

  useEffect(() => {
    if (livePositionsError) {
      const error = livePositionsError as any;
      const isRateLimit = error?.message?.includes('429') || error?.message?.includes('Rate limit');
      
      if (!isRateLimit) {
        toast({
          title: "Live Positions Error",
          description: "Failed to fetch live positions from Aster DEX.",
          variant: "destructive",
        });
      }
    }
  }, [livePositionsError]);

  // Pause trading mutation
  const pauseMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/strategies/${activeStrategy?.id}/pause`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      toast({
        title: "Trading Paused",
        description: "Bot is paused. Resume anytime to continue trading.",
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

  // Resume trading mutation
  const resumeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/strategies/${activeStrategy?.id}/resume`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      toast({
        title: "Trading Resumed",
        description: "Bot is active and processing liquidations.",
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

  // Send manual Telegram report mutation
  const sendReportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/telegram/daily-report`, { 
        strategyId: activeStrategy?.id 
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Report Sent",
        description: "Performance report sent to Telegram successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send Telegram report. Check your bot configuration.",
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
            } else if (message.type === 'trade_block' && message.data) {
              // Handle trade block status (pause/resume)
              console.log('🔴 Dashboard received trade_block:', message.data);

              // IMPORTANT: Only set global trade block for non-symbol-specific blocks
              // Per-symbol cascade blocks (cascade_auto_block_symbol) should NOT affect the global trade light
              const isPerSymbolBlock = message.data.type === 'cascade_auto_block_symbol';

              if (isPerSymbolBlock) {
                console.log(`🟡 Per-symbol cascade block for ${message.data.symbol} - NOT blocking all trades`);
                // Don't set global trade block status for per-symbol cascade blocks
                // The cascade risk indicator will show orange/red for this specific symbol
              } else {
                // Global blocks (pause, global cascade, etc.) affect all trades
                setTradeBlockStatus(message.data.blocked ? message.data : null);
              }
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

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header - Optimized for Mobile */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b bg-card/80 backdrop-blur-md">
        {/* Desktop Layout */}
        <div className="hidden lg:flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <AsterLogo data-testid="app-logo" />
          </div>

          <div className="flex items-center gap-8">
            <ConnectionStatus isConnected={isConnected} tradeBlockStatus={tradeBlockStatus} />
            
            {/* Pause/Resume Button */}
            {activeStrategy && (
              <Button
                variant={activeStrategy.paused ? "default" : "outline"}
                size="icon"
                onClick={() => activeStrategy.paused ? resumeMutation.mutate() : pauseMutation.mutate()}
                disabled={pauseMutation.isPending || resumeMutation.isPending}
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
            
            {/* Documentation Button */}
            <Link href="/documentation">
              <Button
                variant="outline"
                size="icon"
                data-testid="button-documentation"
                title="Professional Documentation"
              >
                <BookOpen className="h-4 w-4" />
              </Button>
            </Link>

            {/* Investor Report Button */}
            <InvestorReport />

            {/* Trade Errors Button */}
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => setIsTradeErrorsDialogOpen(true)}
              data-testid="button-trade-errors"
              title="View Trade Entry Errors"
            >
              <AlertCircle className="h-4 w-4" />
            </Button>
            
            {/* Send Telegram Report Button */}
            {activeStrategy && (
              <Button 
                variant="outline" 
                size="icon"
                onClick={() => sendReportMutation.mutate()}
                disabled={sendReportMutation.isPending}
                data-testid="button-send-report"
                title="Send Performance Report to Telegram"
              >
                <Send className="h-4 w-4" />
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
        <div className="lg:hidden px-2 py-1.5">
          <div className="flex items-center justify-between gap-1">
            {/* Left: Logo Text Only */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-bold whitespace-nowrap">MPI™</span>
            </div>

            {/* Right: Critical Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <div className="scale-90 origin-right">
                <ConnectionStatus isConnected={isConnected} tradeBlockStatus={tradeBlockStatus} />
              </div>
              
              {activeStrategy && (
                <Button
                  variant={activeStrategy.paused ? "default" : "outline"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => activeStrategy.paused ? resumeMutation.mutate() : pauseMutation.mutate()}
                  disabled={pauseMutation.isPending || resumeMutation.isPending}
                  data-testid="button-pause-resume-mobile"
                >
                  {activeStrategy.paused ? (
                    <Play className="h-3 w-3" />
                  ) : (
                    <Pause className="h-3 w-3" />
                  )}
                </Button>
              )}
              
              {activeStrategy && positionSummary && positionSummary.activePositions > 0 && (
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setIsEmergencyStopDialogOpen(true)}
                  disabled={!activeStrategy.isActive}
                  data-testid="button-emergency-stop-mobile"
                >
                  <AlertTriangle className="h-3 w-3" />
                </Button>
              )}
              
              <Sheet>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="h-7 w-7"
                  asChild
                >
                  <SheetTrigger data-testid="button-mobile-menu">
                    <Menu className="h-3.5 w-3.5" />
                  </SheetTrigger>
                </Button>
                <SheetContent side="right" className="w-64">
                  <SheetHeader className="mb-6">
                    <SheetTitle>Settings</SheetTitle>
                  </SheetHeader>
                  <div className="space-y-4">
                    <Link href="/documentation" className="block">
                      <Button 
                        variant="outline" 
                        className="w-full justify-start"
                        data-testid="button-documentation-mobile"
                      >
                        <BookOpen className="h-4 w-4 mr-2" />
                        Documentation
                      </Button>
                    </Link>
                    {activeStrategy && (
                      <Button 
                        variant="outline" 
                        className="w-full justify-start"
                        onClick={() => sendReportMutation.mutate()}
                        disabled={sendReportMutation.isPending}
                        data-testid="button-send-report-mobile"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Send Telegram Report
                      </Button>
                    )}
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => {
                        setIsStrategyDialogOpen(true);
                      }}
                      data-testid="button-trading-strategy-mobile"
                    >
                      <Settings2 className="h-4 w-4 mr-2" />
                      Trading Strategy
                    </Button>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Theme</span>
                      <ThemeToggle />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

        </div>
      </header>

      {/* Main Content with Trading Controls */}
      <main
        className="p-3 md:p-6 space-y-4 md:space-y-6"
        style={{ paddingTop: '56px' }}
      >
        {/* Cascade Risk Indicator */}
        <CollapsibleSection
          title="Cascade Risk Indicator"
          isOpen={!collapsedSections.cascadeRisk}
          onToggle={() => toggleSection('cascadeRisk')}
        >
          <CascadeRiskIndicator />
        </CollapsibleSection>

        {/* Market Sentiment Dashboard */}
        <MarketSentiment />

        {/* VWAP Direction Filter Status */}
        {activeStrategy && (
          <CollapsibleSection
            title="Assets Traded"
            isOpen={!collapsedSections.vwapStatus}
            onToggle={() => toggleSection('vwapStatus')}
          >
            <VWAPStatusDisplay strategyId={activeStrategy.id} liquidations={liquidations} />
          </CollapsibleSection>
        )}

        {/* Active Positions */}
        <CollapsibleSection
          title="Transactions"
          isOpen={!collapsedSections.activePositions}
          onToggle={() => toggleSection('activePositions')}
        >
          <StrategyStatus />
        </CollapsibleSection>

        {/* Performance Overview */}
        <CollapsibleSection
          title="Account Performance"
          isOpen={!collapsedSections.performance}
          onToggle={() => toggleSection('performance')}
        >
          <PerformanceOverview />
        </CollapsibleSection>

        {/* Trading Activity Analysis */}
        {activeStrategy && (
          <CollapsibleSection
            title="Trading Activity Analysis"
            isOpen={!collapsedSections.tradingHotspots}
            onToggle={() => toggleSection('tradingHotspots')}
          >
            <TradingHotspotsAnalytics strategyId={activeStrategy.id} />
          </CollapsibleSection>
        )}
      </main>

      {/* Trading Strategy Dialog */}
      <TradingStrategyDialog
        open={isStrategyDialogOpen}
        onOpenChange={setIsStrategyDialogOpen}
      />

      {/* Trade Errors Dialog */}
      <TradeErrorsDialog
        open={isTradeErrorsDialogOpen}
        onOpenChange={setIsTradeErrorsDialogOpen}
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
              Enter your PIN code to confirm.
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