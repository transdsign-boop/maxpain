import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Target, 
  Shield, 
  Zap,
  AlertTriangle,
  Play,
  Pause,
  StopCircle,
  Settings,
  Save
} from "lucide-react";

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: string;
  currentPrice: string;
  unrealizedPnl: string;
  status: string;
  stopLossPrice: string;
  takeProfitPrice: string;
  createdAt: string;
}

interface Portfolio {
  id: string;
  paperBalance: string;
  realBalance?: string;
  tradingMode?: string;
  totalPnl: string;
}

interface TradingStrategy {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  riskRewardRatio: string;
  stopLossPercent: string;
  takeProfitPercent: string;
  volatilityThreshold: string;
  cascadeDetectionEnabled: boolean;
  symbols: string[];
}

interface RiskSettings {
  id: string;
  sessionId: string;
  maxPortfolioExposurePercent: string;
  warningPortfolioExposurePercent: string;
  maxSymbolConcentrationPercent: string;
  maxPositionsPerSymbol: number;
  maxPositionSizePercent: string;
  minPositionSize: string;
  maxRiskPerTradePercent: string;
  highVolatilityThreshold: string;
  extremeVolatilityThreshold: string;
  cascadeDetectionEnabled: boolean;
  cascadeCooldownMinutes: number;
  lowLiquidationCount: number;
  mediumLiquidationCount: number;
  highLiquidationCount: number;
  extremeLiquidationCount: number;
  lowVelocityPerMinute: string;
  mediumVelocityPerMinute: string;
  highVelocityPerMinute: string;
  extremeVelocityPerMinute: string;
  lowVolumeThreshold: string;
  mediumVolumeThreshold: string;
  highVolumeThreshold: string;
  extremeVolumeThreshold: string;
  cascadeAnalysisWindowMinutes: number;
  systemWideCascadeWindowMinutes: number;
}

export default function TradingDashboard() {
  // CRITICAL FIX: Use the same session as trading engine 
  const [sessionId] = useState('demo-session');
  const { toast } = useToast();
  
  // State for configuration dialog
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<TradingStrategy | null>(null);
  const [configFormData, setConfigFormData] = useState<Partial<TradingStrategy>>({});
  
  // State for risk settings
  const [riskSettingsFormData, setRiskSettingsFormData] = useState<Partial<RiskSettings>>({});
  const [isUpdatingRiskSettings, setIsUpdatingRiskSettings] = useState(false);

  // Fetch portfolio first to get the portfolio ID
  const { data: portfolio } = useQuery<Portfolio>({
    queryKey: [`/api/trading/portfolio?sessionId=${sessionId}`],
    refetchInterval: 2000,
  });

  // Use the portfolio ID from the portfolio response to fetch positions
  const { data: positions = [], refetch: refetchPositions } = useQuery<Position[]>({
    queryKey: [`/api/trading/positions?portfolioId=${portfolio?.id || ''}`],
    refetchInterval: 2000, // Real-time updates
    enabled: !!portfolio?.id, // Only fetch when we have a portfolio ID
  });

  // Fetch trading strategies
  const { data: strategies = [] } = useQuery<TradingStrategy[]>({
    queryKey: [`/api/trading/strategies?sessionId=${sessionId}`],
    refetchInterval: 5000,
  });
  
  // Fetch risk settings
  const { data: riskSettings } = useQuery<RiskSettings | null>({
    queryKey: [`/api/risk-settings/${sessionId}`],
    select: (data) => data || null,
  });

  // Calculate portfolio metrics with error handling
  const activePositions = Array.isArray(positions) ? positions.filter((p: Position) => p?.status === 'open') : [];
  const totalExposure = activePositions.reduce((sum: number, pos: Position) => {
    const size = pos?.size ? parseFloat(pos.size) : 0;
    const price = pos?.currentPrice ? parseFloat(pos.currentPrice) : 0;
    return sum + (size * price);
  }, 0);
  
  const totalUnrealizedPnl = activePositions.reduce((sum: number, pos: Position) => {
    const pnl = pos?.unrealizedPnl ? parseFloat(pos.unrealizedPnl) : 0;
    return sum + pnl;
  }, 0);

  // Initialize risk settings form when data loads
  useEffect(() => {
    if (riskSettings) {
      setRiskSettingsFormData(riskSettings);
    }
  }, [riskSettings]);

  // Debug logging
  console.log('TradingDashboard Debug:', {
    sessionId,
    portfolio,
    positionsCount: positions?.length || 0,
    activePositionsCount: activePositions.length,
    strategiesCount: strategies?.length || 0
  });

  const longPositions = activePositions.filter((p: Position) => p.side === 'long');
  const shortPositions = activePositions.filter((p: Position) => p.side === 'short');

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  const formatNumber = (value: string | number, decimals: number = 6) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return num.toFixed(decimals);
  };

  const getPnlColor = (pnl: string | number) => {
    const num = typeof pnl === 'string' ? parseFloat(pnl) : pnl;
    return num >= 0 ? 'text-green-500' : 'text-red-500';
  };

  // Configuration dialog handlers
  const openConfigDialog = (strategy: TradingStrategy) => {
    setSelectedStrategy(strategy);
    setConfigFormData({
      ...strategy
    });
    setConfigDialogOpen(true);
  };

  const saveStrategyConfig = async () => {
    if (!selectedStrategy || !configFormData) return;
    
    try {
      const response = await fetch(`/api/trading/strategies/${selectedStrategy.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(configFormData)
      });
      
      if (response.ok) {
        setConfigDialogOpen(false);
        // Refetch strategies to get updated data
        // The useQuery will automatically refetch
      }
    } catch (error) {
      console.error('Failed to update strategy:', error);
    }
  };

  const toggleStrategy = async (strategyId: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/trading/strategies/${strategyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to update strategy: ${response.statusText}`);
      }
      
      console.log(`Strategy ${strategyId} ${!isActive ? 'activated' : 'paused'}`);
      // The useQuery will automatically refetch the strategies
    } catch (error) {
      console.error('Failed to toggle strategy:', error);
      alert('Failed to update strategy. Please try again.');
    }
  };

  // Position management handlers

  // Emergency control handlers
  const handleEmergencyStop = async () => {
    if (!confirm('⚠️ This will STOP ALL TRADING immediately. Are you sure?')) return;
    
    try {
      const response = await fetch('/api/trading/emergency-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to stop trading: ${response.statusText}`);
      }
      
      const result = await response.json();
      alert(`✅ ${result.message}`);
    } catch (error) {
      console.error('Error stopping trading:', error);
      alert('Failed to stop trading. Please try again.');
    }
  };

  const handleCloseAllPositions = async () => {
    if (!confirm('⚠️ This will CLOSE ALL OPEN POSITIONS immediately. Are you sure?')) return;
    
    try {
      const response = await fetch('/api/trading/close-all-positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to close positions: ${response.statusText}`);
      }
      
      const result = await response.json();
      alert(`✅ ${result.message}`);
    } catch (error) {
      console.error('Error closing positions:', error);
      alert('Failed to close positions. Please try again.');
    }
  };

  const handlePauseAllStrategies = async () => {
    if (!confirm('⚠️ This will PAUSE ALL TRADING STRATEGIES. Are you sure?')) return;
    
    try {
      const response = await fetch('/api/trading/pause-all-strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to pause strategies: ${response.statusText}`);
      }
      
      const result = await response.json();
      alert(`✅ ${result.message}`);
    } catch (error) {
      console.error('Error pausing strategies:', error);
      alert('Failed to pause strategies. Please try again.');
    }
  };

  const toggleTradingMode = async () => {
    try {
      const newMode = portfolio?.tradingMode === 'paper' ? 'real' : 'paper';
      const response = await fetch(`/api/trading/portfolio/${portfolio?.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradingMode: newMode }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to update trading mode: ${response.statusText}`);
      }
      
      window.location.reload(); // Refresh to show new mode
      console.log(`Trading mode switched to: ${newMode}`);
    } catch (error) {
      console.error('Failed to toggle trading mode:', error);
      alert('Failed to update trading mode. Please try again.');
    }
  };

  const closePosition = async (positionId: string, currentPrice: string, symbol: string) => {
    try {
      const response = await fetch(`/api/trading/positions/${positionId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          exitPrice: currentPrice, 
          exitReason: 'manual_close' 
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to close position: ${response.statusText}`);
      }
      
      const trade = await response.json();
      console.log(`✅ Position closed: ${symbol} - P&L: $${trade.realizedPnl}`);
      // The useQuery will automatically refetch positions
    } catch (error) {
      console.error('Error closing position:', error);
      alert('Failed to close position. Please try again.');
    }
  };

  // Risk settings handlers
  const handleSaveRiskSettings = async () => {
    if (!riskSettingsFormData.sessionId) {
      riskSettingsFormData.sessionId = sessionId;
    }
    
    setIsUpdatingRiskSettings(true);
    try {
      await apiRequest('PUT', '/api/risk-settings', riskSettingsFormData);
      
      // Invalidate and refetch risk settings
      await queryClient.invalidateQueries({ queryKey: [`/api/risk-settings/${sessionId}`] });
      
      toast({
        title: "Risk settings updated",
        description: "Your position limits and cascade protection settings have been saved.",
      });
      
    } catch (error) {
      console.error('Error saving risk settings:', error);
      toast({
        title: "Error",
        description: "Failed to save risk settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingRiskSettings(false);
    }
  };

  return (
    <div className="p-6 space-y-6 h-full overflow-auto" data-testid="trading-dashboard">
      {/* Trading Mode Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Trading Dashboard</h1>
          <p className="text-muted-foreground">Real-time portfolio management and position tracking</p>
        </div>
        <Card className="p-4">
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="text-sm font-medium">Trading Mode</div>
              <div className={`text-lg font-bold ${portfolio?.tradingMode === 'real' ? 'text-green-500' : 'text-blue-500'}`}>
                {portfolio?.tradingMode === 'real' ? '🏦 REAL' : '📝 PAPER'}
              </div>
            </div>
            <Button 
              onClick={toggleTradingMode}
              variant={portfolio?.tradingMode === 'real' ? 'destructive' : 'default'}
              size="sm"
              data-testid="toggle-trading-mode"
            >
              Switch to {portfolio?.tradingMode === 'paper' ? 'Real' : 'Paper'}
            </Button>
          </div>
        </Card>
      </div>

      {/* Portfolio Overview */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paper Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {portfolio ? formatCurrency(portfolio.paperBalance) : '$0.00'}
            </div>
            <p className="text-xs text-muted-foreground">Simulated trading funds</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Real Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {portfolio ? formatCurrency(portfolio.realBalance || '0') : '$0.00'}
            </div>
            <p className="text-xs text-muted-foreground">Actual trading funds</p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Exposure</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalExposure)}</div>
            <p className="text-xs text-muted-foreground">
              {activePositions.length} active positions
            </p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unrealized P&L</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getPnlColor(totalUnrealizedPnl)}`}>
              {formatCurrency(totalUnrealizedPnl)}
            </div>
            <p className="text-xs text-muted-foreground">
              Real-time profit/loss
            </p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Risk Level</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">LOW</div>
            <p className="text-xs text-muted-foreground">
              {((totalExposure / parseFloat(portfolio?.paperBalance || '1')) * 100).toFixed(1)}% portfolio exposure
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="positions" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="positions" data-testid="tab-positions">
            Active Positions ({activePositions.length})
          </TabsTrigger>
          <TabsTrigger value="strategies" data-testid="tab-strategies">
            Trading Strategies ({strategies.length})
          </TabsTrigger>
          <TabsTrigger value="risk" data-testid="tab-risk">
            Risk Management
          </TabsTrigger>
        </TabsList>

        {/* Active Positions Tab */}
        <TabsContent value="positions" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {activePositions.map((position: Position) => (
              <Card key={position.id} className="hover-elevate" data-testid={`position-${position.symbol}`}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold">{position.symbol}</CardTitle>
                    <Badge 
                      variant={position.side === 'long' ? 'default' : 'destructive'}
                      className="text-xs"
                    >
                      {position.side.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {position.side === 'long' ? (
                      <TrendingUp className="h-4 w-4 text-green-500" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Size</p>
                      <p className="font-mono font-medium">{formatNumber(position.size, 4)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Entry Price</p>
                      <p className="font-mono font-medium">{formatCurrency(position.entryPrice)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Current Price</p>
                      <p className="font-mono font-medium">{formatCurrency(position.currentPrice)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Unrealized P&L</p>
                      <p className={`font-mono font-medium ${getPnlColor(position.unrealizedPnl)}`}>
                        {formatCurrency(position.unrealizedPnl)}
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-muted-foreground">Stop Loss</p>
                      <p className="font-mono text-red-500">{formatCurrency(position.stopLossPrice)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Take Profit</p>
                      <p className="font-mono text-green-500">{formatCurrency(position.takeProfitPrice)}</p>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t">
                    <p className="text-xs text-muted-foreground">
                      Opened: {new Date(position.createdAt).toLocaleTimeString()}
                    </p>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      data-testid={`close-position-${position.symbol}`}
                      onClick={() => closePosition(position.id, position.currentPrice, position.symbol)}
                    >
                      Close Position
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {activePositions.length === 0 && (
            <Card className="p-8 text-center">
              <CardContent>
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No Active Positions</h3>
                <p className="text-muted-foreground">
                  Trading strategies are running and will open positions when liquidations occur.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Trading Strategies Tab */}
        <TabsContent value="strategies" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {strategies.map((strategy: TradingStrategy) => (
              <Card key={strategy.id} className="hover-elevate" data-testid={`strategy-${strategy.name.toLowerCase().replace(/\s+/g, '-')}`}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="text-lg">{strategy.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{strategy.type}</p>
                  </div>
                  <Badge variant={strategy.isActive ? 'default' : 'secondary'}>
                    {strategy.isActive ? 'ACTIVE' : 'PAUSED'}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Tracked Symbols</p>
                    <div className="flex flex-wrap gap-1">
                      {(strategy.symbols || []).slice(0, 5).map((symbol: string) => (
                        <Badge key={symbol} variant="outline" className="text-xs">
                          {symbol}
                        </Badge>
                      ))}
                      {(strategy.symbols || []).length === 0 && (
                        <Badge variant="outline" className="text-xs">
                          All symbols
                        </Badge>
                      )}
                      {(strategy.symbols || []).length > 5 && (
                        <Badge variant="outline" className="text-xs">
                          +{(strategy.symbols || []).length - 5} more
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Risk/Reward Ratio</p>
                        <p className="font-mono font-bold text-lg">{strategy.riskRewardRatio}:1</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Stop Loss</p>
                        <p className="font-mono font-bold text-lg text-red-500">{strategy.stopLossPercent}%</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Take Profit</p>
                        <p className="font-mono font-bold text-lg text-green-500">{strategy.takeProfitPercent}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Vol. Threshold</p>
                        <p className="font-mono font-bold text-lg">{strategy.volatilityThreshold}%</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-sm text-muted-foreground">Cascade Detection:</span>
                      <Badge variant={strategy.cascadeDetectionEnabled ? 'default' : 'secondary'}>
                        {strategy.cascadeDetectionEnabled ? 'ENABLED' : 'DISABLED'}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={strategy.isActive ? "destructive" : "default"}
                      onClick={() => toggleStrategy(strategy.id, strategy.isActive)}
                      data-testid={`toggle-strategy-${strategy.name.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {strategy.isActive ? (
                        <>
                          <Pause className="h-3 w-3 mr-1" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3 mr-1" />
                          Start
                        </>
                      )}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => openConfigDialog(strategy)}
                      data-testid={`configure-strategy-${strategy.name.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <Settings className="h-3 w-3 mr-1" />
                      Configure
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Risk Management Tab */}
        <TabsContent value="risk" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover-elevate">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Position Limits
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="maxPositionsPerSymbol" className="text-sm font-medium">Max positions per symbol:</Label>
                  <Input
                    id="maxPositionsPerSymbol"
                    type="number"
                    min="1"
                    max="10"
                    value={riskSettingsFormData.maxPositionsPerSymbol || ''}
                    onChange={(e) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      maxPositionsPerSymbol: parseInt(e.target.value) || 0
                    })}
                    className="h-8"
                    data-testid="input-max-positions-per-symbol"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxRiskPerTrade" className="text-sm font-medium">Risk per trade (%):</Label>
                  <Input
                    id="maxRiskPerTrade"
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={riskSettingsFormData.maxRiskPerTradePercent || ''}
                    onChange={(e) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      maxRiskPerTradePercent: e.target.value
                    })}
                    className="h-8"
                    data-testid="input-max-risk-per-trade"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxPortfolioExposure" className="text-sm font-medium">Max portfolio exposure (%):</Label>
                  <Input
                    id="maxPortfolioExposure"
                    type="number"
                    min="10"
                    max="100"
                    step="5"
                    value={riskSettingsFormData.maxPortfolioExposurePercent || ''}
                    onChange={(e) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      maxPortfolioExposurePercent: e.target.value
                    })}
                    className="h-8"
                    data-testid="input-max-portfolio-exposure"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Cascade Detection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="cascadeDetectionEnabled" className="text-sm font-medium">Enable cascade detection:</Label>
                  <Switch
                    id="cascadeDetectionEnabled"
                    checked={riskSettingsFormData.cascadeDetectionEnabled || false}
                    onCheckedChange={(checked) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      cascadeDetectionEnabled: checked
                    })}
                    data-testid="switch-cascade-detection"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cascadeCooldown" className="text-sm font-medium">Cooldown period (minutes):</Label>
                  <Input
                    id="cascadeCooldown"
                    type="number"
                    min="1"
                    max="60"
                    value={riskSettingsFormData.cascadeCooldownMinutes || ''}
                    onChange={(e) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      cascadeCooldownMinutes: parseInt(e.target.value) || 0
                    })}
                    className="h-8"
                    data-testid="input-cascade-cooldown"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="highVolatilityThreshold" className="text-sm font-medium">High volatility threshold (%):</Label>
                  <Input
                    id="highVolatilityThreshold"
                    type="number"
                    min="5"
                    max="50"
                    step="1"
                    value={riskSettingsFormData.highVolatilityThreshold || ''}
                    onChange={(e) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      highVolatilityThreshold: e.target.value
                    })}
                    className="h-8"
                    data-testid="input-high-volatility-threshold"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Risk Settings & Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  variant="default" 
                  className="w-full" 
                  onClick={handleSaveRiskSettings}
                  disabled={isUpdatingRiskSettings}
                  data-testid="save-risk-settings"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isUpdatingRiskSettings ? 'Saving...' : 'Save Risk Settings'}
                </Button>
                <Button 
                  variant="destructive" 
                  className="w-full" 
                  onClick={handleEmergencyStop}
                  data-testid="emergency-stop-all"
                >
                  <StopCircle className="h-4 w-4 mr-2" />
                  Stop All Trading
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={handleCloseAllPositions}
                  data-testid="close-all-positions"
                >
                  Close All Positions
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={handlePauseAllStrategies}
                  data-testid="pause-strategies"
                >
                  Pause All Strategies
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
      
      {/* Configuration Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configure Strategy: {selectedStrategy?.name}
            </DialogTitle>
          </DialogHeader>
          
          {selectedStrategy && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="riskRewardRatio">Risk/Reward Ratio</Label>
                <Input
                  id="riskRewardRatio"
                  type="number"
                  step="0.1"
                  value={configFormData.riskRewardRatio || ''}
                  onChange={(e) => setConfigFormData({...configFormData, riskRewardRatio: e.target.value})}
                  placeholder="e.g., 2"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="stopLossPercent">Stop Loss %</Label>
                <Input
                  id="stopLossPercent"
                  type="number"
                  step="0.1"
                  value={configFormData.stopLossPercent || ''}
                  onChange={(e) => setConfigFormData({...configFormData, stopLossPercent: e.target.value})}
                  placeholder="e.g., 3"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="takeProfitPercent">Take Profit %</Label>
                <Input
                  id="takeProfitPercent"
                  type="number"
                  step="0.1"
                  value={configFormData.takeProfitPercent || ''}
                  onChange={(e) => setConfigFormData({...configFormData, takeProfitPercent: e.target.value})}
                  placeholder="e.g., 6"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="volatilityThreshold">Volatility Threshold %</Label>
                <Input
                  id="volatilityThreshold"
                  type="number"
                  step="0.1"
                  value={configFormData.volatilityThreshold || ''}
                  onChange={(e) => setConfigFormData({...configFormData, volatilityThreshold: e.target.value})}
                  placeholder="e.g., 10"
                />
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="cascadeDetection"
                  checked={configFormData.cascadeDetectionEnabled || false}
                  onCheckedChange={(checked) => setConfigFormData({...configFormData, cascadeDetectionEnabled: checked})}
                />
                <Label htmlFor="cascadeDetection">Enable Cascade Detection</Label>
              </div>
              
              <div className="flex gap-2 pt-4">
                <Button onClick={saveStrategyConfig} className="flex-1">
                  Save Changes
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setConfigDialogOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}