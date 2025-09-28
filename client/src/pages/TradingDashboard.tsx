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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Save,
  RotateCcw,
  Plus,
  BarChart3,
  History,
  Percent,
  Edit,
  Clock,
  ListOrdered
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
  triggeringLiquidation?: {
    id: string;
    symbol: string;
    side: string;
    size: string;
    price: string;
    value: string;
    timestamp: string;
  };
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
  dcaEnabled: boolean;
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

interface Trade {
  id: string;
  positionId: string;
  strategyId: string;
  portfolioId: string;
  symbol: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: string;
  exitPrice: string;
  realizedPnl: string;
  feesPaid: string;
  tradingMode: 'paper' | 'real';
  exitReason: string;
  triggeredByLiquidation?: string;
  duration?: number;
  volatilityAtEntry?: string;
  volatilityAtExit?: string;
  createdAt: string;
  closedAt: string;
}

interface TradingFees {
  id: string;
  sessionId: string;
  paperMarketOrderFeePercent: string;
  paperLimitOrderFeePercent: string;
  realMarketOrderFeePercent: string;
  realLimitOrderFeePercent: string;
  simulateRealisticFees: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function TradingDashboard() {
  // Generate or get persistent session ID that survives forever (same as Dashboard)
  const getSessionId = () => {
    // Try multiple storage locations for maximum persistence
    let sessionId = localStorage.getItem('aster-permanent-session-id');
    
    if (!sessionId) {
      sessionId = sessionStorage.getItem('aster-permanent-session-id');
    }
    
    if (!sessionId) {
      sessionId = 'aster-user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 12);
    }
    
    // Store in multiple locations for maximum persistence
    try {
      localStorage.setItem('aster-permanent-session-id', sessionId);
      sessionStorage.setItem('aster-permanent-session-id', sessionId);
    } catch (error) {
      console.warn('Could not save session ID to storage:', error);
    }
    
    return sessionId;
  };

  const [sessionId] = useState(getSessionId());
  const { toast } = useToast();
  
  // State for configuration dialog
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<TradingStrategy | null>(null);
  const [configFormData, setConfigFormData] = useState<Partial<TradingStrategy>>({});
  
  // State for create strategy dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    name: '',
    type: 'counter_liquidation',
    riskRewardRatio: '2.0',
    maxPositionSize: '1000.00',
    stopLossPercent: '2.0',
    takeProfitPercent: '4.0',
    volatilityThreshold: '5.0',
    liquidationThresholdPercentile: '50.0',
    dcaEnabled: false,
    cascadeDetectionEnabled: true,
    cascadeCooldownMinutes: 10,
    symbols: [] as string[]
  });
  
  // State for risk settings
  const [riskSettingsFormData, setRiskSettingsFormData] = useState<Partial<RiskSettings>>({});
  const [isUpdatingRiskSettings, setIsUpdatingRiskSettings] = useState(false);
  
  // State for global settings form
  const [globalSettingsFormData, setGlobalSettingsFormData] = useState<Partial<RiskSettings>>({});
  const [isUpdatingGlobalSettings, setIsUpdatingGlobalSettings] = useState(false);

  // State for analytics features
  const [paperBalanceDialogOpen, setPaperBalanceDialogOpen] = useState(false);
  const [customPaperBalance, setCustomPaperBalance] = useState('');
  const [tradingFeesFormData, setTradingFeesFormData] = useState<Partial<TradingFees>>({});
  const [isUpdatingTradingFees, setIsUpdatingTradingFees] = useState(false);


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

  // Fetch completed trades
  const { data: completedTrades = [] } = useQuery<Trade[]>({
    queryKey: [`/api/trading/trades?portfolioId=${portfolio?.id || ''}&limit=50`],
    enabled: !!portfolio?.id,
  });

  // Fetch trading fees
  const { data: tradingFees } = useQuery<TradingFees | null>({
    queryKey: [`/api/trading/fees/${sessionId}`],
    select: (data) => data || null,
  });

  // Calculate portfolio metrics with error handling
  const activePositions = Array.isArray(positions) ? positions.filter((p: Position) => p?.status === 'open') : [];
  
  // Filter positions based on trading mode
  const filteredPositions = activePositions.filter((pos: Position) => pos?.tradingMode === portfolio?.tradingMode);
  
  const totalExposure = filteredPositions.reduce((sum: number, pos: Position) => {
    const size = pos?.size ? parseFloat(pos.size) : 0;
    const price = pos?.currentPrice ? parseFloat(pos.currentPrice) : 0;
    return sum + (size * price);
  }, 0);
  
  const totalUnrealizedPnl = filteredPositions.reduce((sum: number, pos: Position) => {
    const pnl = pos?.unrealizedPnl ? parseFloat(pos.unrealizedPnl) : 0;
    return sum + pnl;
  }, 0);

  // Trading analytics calculations
  const filteredCompletedTrades = completedTrades.filter((trade: Trade) => trade?.tradingMode === portfolio?.tradingMode);
  const winningTrades = filteredCompletedTrades.filter((trade: Trade) => parseFloat(trade.realizedPnl) > 0);
  const winRate = filteredCompletedTrades.length > 0 ? (winningTrades.length / filteredCompletedTrades.length) * 100 : 0;
  const avgTradeDuration = filteredCompletedTrades.length > 0 
    ? filteredCompletedTrades.reduce((sum, trade) => sum + (trade.duration || 0), 0) / filteredCompletedTrades.length 
    : 0;
  const totalRealizedPnl = filteredCompletedTrades.reduce((sum, trade) => sum + parseFloat(trade.realizedPnl), 0);
  
  // Strategy performance analytics
  const strategyPerformance = filteredCompletedTrades.reduce((acc, trade) => {
    const strategy = trade.triggeredByLiquidation ? 'Liquidation Counter-Trade' : 'Manual Trade';
    if (!acc[strategy]) {
      acc[strategy] = { trades: 0, pnl: 0, wins: 0 };
    }
    acc[strategy].trades++;
    acc[strategy].pnl += parseFloat(trade.realizedPnl);
    if (parseFloat(trade.realizedPnl) > 0) acc[strategy].wins++;
    return acc;
  }, {} as Record<string, { trades: number; pnl: number; wins: number }>);

  // Initialize risk settings form when data loads
  useEffect(() => {
    if (riskSettings) {
      setRiskSettingsFormData(riskSettings);
      setGlobalSettingsFormData(riskSettings);
    } else {
      // Set default values when no risk settings exist
      setRiskSettingsFormData({
        maxPositionsPerSymbol: 2,
        maxRiskPerTradePercent: '2.00',
        maxPortfolioExposurePercent: '80.00',
        maxSymbolConcentrationPercent: '20.00',
        warningPortfolioExposurePercent: '60.00',
        maxPositionSizePercent: '5.00',
      });
      
      // Set default global settings values
      setGlobalSettingsFormData({
        simulateOnly: false,
        maxTotalExposureUsd: '1400.00',
        volumeWindowSec: 60,
        orderTtlSec: 30,
        rateLimitBufferPercent: '10.00',
        timeInForce: 'GTC',
        marginType: 'cross',
        leverage: '1.00',
        maxOpenOrdersPerSymbol: 20,
        batchOrders: true,
        enableOrderConsolidation: true,
        maxStopOrdersPerSymbol: 1,
        orderCleanupIntervalSec: 20,
        staleLimitOrderMin: 1,
        multiAssetsMode: true,
        hedgeMode: true,
        usePositionMonitor: true,
        useUsdtVolume: true,
        maxTranchesPerSymbolSide: 5,
        tranchePnlIncrementPercent: '5.00',
      });
    }
  }, [riskSettings]);

  // Initialize trading fees form when data loads
  useEffect(() => {
    if (tradingFees) {
      setTradingFeesFormData(tradingFees);
    } else {
      // Set default values when no trading fees exist
      setTradingFeesFormData({
        sessionId,
        paperMarketOrderFeePercent: '0.1000',
        paperLimitOrderFeePercent: '0.0750',
        realMarketOrderFeePercent: '0.1000',
        realLimitOrderFeePercent: '0.0750',
        simulateRealisticFees: true,
      });
    }
  }, [tradingFees, sessionId]);

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

  const createNewStrategy = async () => {
    try {
      const response = await fetch('/api/trading/strategies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...createFormData,
          sessionId,
          isActive: false // Start as inactive
        })
      });
      
      if (response.ok) {
        setCreateDialogOpen(false);
        // Reset form
        setCreateFormData({
          name: '',
          type: 'counter_liquidation',
          riskRewardRatio: '2.0',
          maxPositionSize: '1000.00',
          stopLossPercent: '2.0',
          takeProfitPercent: '4.0',
          volatilityThreshold: '5.0',
          liquidationThresholdPercentile: '50.0',
          dcaEnabled: false,
          cascadeDetectionEnabled: true,
          cascadeCooldownMinutes: 10,
          symbols: []
        });
        toast({
          title: "Strategy Created",
          description: "Your trading strategy has been created successfully.",
        });
        // The useQuery will automatically refetch strategies
      } else {
        throw new Error('Failed to create strategy');
      }
    } catch (error) {
      console.error('Failed to create strategy:', error);
      toast({
        title: "Error",
        description: "Failed to create trading strategy. Please try again.",
        variant: "destructive",
      });
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

  const resetPaperBalance = async () => {
    if (!confirm('Reset paper balance to $10,000? This will reset your paper trading balance.')) return;
    
    try {
      const response = await fetch(`/api/trading/portfolio/${portfolio?.id}/reset-paper-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to reset paper balance: ${response.statusText}`);
      }
      
      // Refetch portfolio data
      queryClient.invalidateQueries({ queryKey: [`/api/trading/portfolio?sessionId=${sessionId}`] });
      toast({
        title: "Paper Balance Reset",
        description: "Paper balance has been reset to $10,000",
      });
    } catch (error) {
      console.error('Reset paper balance error:', error);
      toast({
        title: "Error",
        description: "Failed to reset paper balance",
        variant: "destructive",
      });
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

  const handleSaveGlobalSettings = async () => {
    setIsUpdatingGlobalSettings(true);
    try {
      // Create a complete risk settings object by merging global settings with existing risk settings
      const mergedSettings = {
        // Use existing risk settings if available, otherwise use default values
        maxPositionsPerSymbol: riskSettingsFormData.maxPositionsPerSymbol || 2,
        maxRiskPerTradePercent: riskSettingsFormData.maxRiskPerTradePercent || '2.00',
        maxPortfolioExposurePercent: riskSettingsFormData.maxPortfolioExposurePercent || '80.00',
        maxSymbolConcentrationPercent: riskSettingsFormData.maxSymbolConcentrationPercent || '20.00',
        warningPortfolioExposurePercent: riskSettingsFormData.warningPortfolioExposurePercent || '60.00',
        maxPositionSizePercent: riskSettingsFormData.maxPositionSizePercent || '5.00',
        
        // Include other required risk settings fields
        minPositionSize: riskSettingsFormData.minPositionSize || '1.00',
        highVolatilityThreshold: riskSettingsFormData.highVolatilityThreshold || '15.00',
        extremeVolatilityThreshold: riskSettingsFormData.extremeVolatilityThreshold || '20.00',
        cascadeDetectionEnabled: riskSettingsFormData.cascadeDetectionEnabled !== false,
        cascadeCooldownMinutes: riskSettingsFormData.cascadeCooldownMinutes || 10,
        
        // Cascade detection thresholds
        lowLiquidationCount: riskSettingsFormData.lowLiquidationCount || 3,
        mediumLiquidationCount: riskSettingsFormData.mediumLiquidationCount || 7,
        highLiquidationCount: riskSettingsFormData.highLiquidationCount || 15,
        extremeLiquidationCount: riskSettingsFormData.extremeLiquidationCount || 25,
        
        lowVelocityPerMinute: riskSettingsFormData.lowVelocityPerMinute || '2.00',
        mediumVelocityPerMinute: riskSettingsFormData.mediumVelocityPerMinute || '5.00',
        highVelocityPerMinute: riskSettingsFormData.highVelocityPerMinute || '10.00',
        extremeVelocityPerMinute: riskSettingsFormData.extremeVelocityPerMinute || '20.00',
        
        lowVolumeThreshold: riskSettingsFormData.lowVolumeThreshold || '50000.00',
        mediumVolumeThreshold: riskSettingsFormData.mediumVolumeThreshold || '200000.00',
        highVolumeThreshold: riskSettingsFormData.highVolumeThreshold || '500000.00',
        extremeVolumeThreshold: riskSettingsFormData.extremeVolumeThreshold || '1000000.00',
        
        cascadeAnalysisWindowMinutes: riskSettingsFormData.cascadeAnalysisWindowMinutes || 10,
        systemWideCascadeWindowMinutes: riskSettingsFormData.systemWideCascadeWindowMinutes || 15,
        
        // Merge global settings over the risk settings
        ...globalSettingsFormData,
        sessionId, // Always ensure sessionId is set
      };
      
      await apiRequest('PUT', '/api/risk-settings', mergedSettings);
      
      // Invalidate and refetch risk settings
      await queryClient.invalidateQueries({ queryKey: [`/api/risk-settings/${sessionId}`] });
      
      toast({
        title: "Global settings updated",
        description: "Your trading execution and order management settings have been saved.",
      });
      
    } catch (error) {
      console.error('Error saving global settings:', error);
      toast({
        title: "Error",
        description: "Failed to save global settings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingGlobalSettings(false);
    }
  };

  // Analytics handlers
  const handleSetCustomPaperBalance = async () => {
    if (!portfolio || !customPaperBalance || isNaN(parseFloat(customPaperBalance)) || parseFloat(customPaperBalance) < 0) {
      toast({
        title: "Error",
        description: "Please enter a valid balance amount.",
        variant: "destructive",
      });
      return;
    }

    try {
      await apiRequest('POST', `/api/trading/portfolio/${portfolio.id}/set-paper-balance`, {
        amount: customPaperBalance
      });
      
      // Refetch portfolio data
      queryClient.invalidateQueries({ queryKey: [`/api/trading/portfolio?sessionId=${sessionId}`] });
      
      setPaperBalanceDialogOpen(false);
      setCustomPaperBalance('');
      
      toast({
        title: "Paper Balance Updated",
        description: `Paper balance set to $${parseFloat(customPaperBalance).toLocaleString()}`,
      });
    } catch (error) {
      console.error('Set custom paper balance error:', error);
      toast({
        title: "Error",
        description: "Failed to set paper balance",
        variant: "destructive",
      });
    }
  };

  const handleSaveTradingFees = async () => {
    if (!tradingFeesFormData.sessionId) {
      tradingFeesFormData.sessionId = sessionId;
    }
    
    // Only save paper trading fees - real fees come from trading API
    const paperFeesOnly = {
      sessionId: tradingFeesFormData.sessionId,
      paperMarketOrderFeePercent: tradingFeesFormData.paperMarketOrderFeePercent,
      paperLimitOrderFeePercent: tradingFeesFormData.paperLimitOrderFeePercent,
      simulateRealisticFees: tradingFeesFormData.simulateRealisticFees,
    };
    
    setIsUpdatingTradingFees(true);
    try {
      await apiRequest('PUT', '/api/trading/fees', paperFeesOnly);
      
      // Invalidate and refetch trading fees
      await queryClient.invalidateQueries({ queryKey: [`/api/trading/fees/${sessionId}`] });
      
      toast({
        title: "Paper trading fees updated",
        description: "Your paper trading fee settings have been saved. Real fees are fetched from your trading API.",
      });
      
    } catch (error) {
      console.error('Error saving trading fees:', error);
      toast({
        title: "Error",
        description: "Failed to save trading fees. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingTradingFees(false);
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
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        {/* Balance Card - Shows current trading mode balance */}
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {portfolio?.tradingMode === 'paper' ? 'Paper Balance' : 'Real Balance'}
            </CardTitle>
            <div className="flex items-center gap-2">
              {portfolio?.tradingMode === 'paper' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetPaperBalance}
                  data-testid="reset-paper-balance"
                  title="Reset to $10,000"
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              )}
              <DollarSign className={`h-4 w-4 ${portfolio?.tradingMode === 'paper' ? 'text-blue-500' : 'text-green-500'}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {portfolio ? formatCurrency(portfolio?.tradingMode === 'paper' ? portfolio.paperBalance : (portfolio.realBalance || '0')) : '$0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              {portfolio?.tradingMode === 'paper' ? 'Simulated trading funds' : 'Actual trading funds'}
            </p>
          </CardContent>
        </Card>

        {/* Analytics Cards */}
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${winRate >= 60 ? 'text-green-500' : winRate >= 40 ? 'text-yellow-500' : 'text-red-500'}`}>
              {winRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {winningTrades.length}/{filteredCompletedTrades.length} trades
            </p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Realized P&L</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getPnlColor(totalRealizedPnl)}`}>
              {formatCurrency(totalRealizedPnl)}
            </div>
            <p className="text-xs text-muted-foreground">
              From {filteredCompletedTrades.length} closed trades
            </p>
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
              {filteredPositions.length} active positions
            </p>
          </CardContent>
        </Card>

        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Trade Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {avgTradeDuration > 0 ? `${(avgTradeDuration / 60).toFixed(1)}h` : '0h'}
            </div>
            <p className="text-xs text-muted-foreground">
              Average hold time
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
              {((totalExposure / parseFloat(
                portfolio?.tradingMode === 'paper' ? (portfolio?.paperBalance || '1') : (portfolio?.realBalance || '1')
              )) * 100).toFixed(1)}% portfolio exposure
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="positions" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="positions" data-testid="tab-positions">
            Active Positions ({filteredPositions.length})
          </TabsTrigger>
          <TabsTrigger value="strategies" data-testid="tab-strategies">
            Trading Strategies ({strategies.length})
          </TabsTrigger>
          <TabsTrigger value="risk" data-testid="tab-risk">
            Risk Management
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">
            Trading Analytics
          </TabsTrigger>
          <TabsTrigger value="global-settings" data-testid="tab-global-settings">
            Global Settings
          </TabsTrigger>
        </TabsList>

        {/* Active Positions Tab */}
        <TabsContent value="positions" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredPositions.map((position: Position) => (
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

                  {/* Liquidation Details */}
                  {position.triggeringLiquidation && (
                    <div className="bg-muted/50 rounded-md p-3 text-xs">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="h-3 w-3 text-orange-500" />
                        <span className="font-medium text-muted-foreground">Triggered by Liquidation</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-muted-foreground">Size:</span>
                          <span className="font-mono ml-1">{formatNumber(position.triggeringLiquidation.size, 4)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Price:</span>
                          <span className="font-mono ml-1">{formatCurrency(position.triggeringLiquidation.price)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Value:</span>
                          <span className="font-mono ml-1">{formatCurrency(position.triggeringLiquidation.value)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Time:</span>
                          <span className="font-mono ml-1">{new Date(position.triggeringLiquidation.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>
                  )}

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

          {filteredPositions.length === 0 && (
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
          {/* Create Strategy Button - Only show if no strategies exist */}
          {strategies.length === 0 && (
            <Card className="hover-elevate">
              <CardContent className="flex flex-col items-center justify-center py-8 space-y-4">
                <div className="text-center space-y-2">
                  <h3 className="text-lg font-semibold">No Trading Strategies</h3>
                  <p className="text-muted-foreground text-sm">
                    Create your first trading strategy to start automated counter-liquidation trading.
                  </p>
                </div>
                <Button 
                  onClick={() => setCreateDialogOpen(true)}
                  className="mt-4"
                  data-testid="create-first-strategy"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Strategy
                </Button>
              </CardContent>
            </Card>
          )}
          
          {/* Add Strategy Button - Always show at top when strategies exist */}
          {strategies.length > 0 && (
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Your Trading Strategies ({strategies.length})</h3>
              <Button 
                onClick={() => setCreateDialogOpen(true)}
                variant="outline"
                data-testid="add-strategy"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Strategy
              </Button>
            </div>
          )}
          
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
                    
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Liq. Threshold</p>
                        <p className="font-mono font-bold text-lg text-blue-500">
                          {(strategy as any).liquidationThresholdPercentile || '50'}th percentile
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Max Position Size</p>
                        <p className="font-mono font-bold text-lg">${parseFloat((strategy as any).maxPositionSize || '0').toFixed(0)}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-sm text-muted-foreground">Cascade Detection:</span>
                      <Badge variant={strategy.cascadeDetectionEnabled ? 'default' : 'secondary'}>
                        {strategy.cascadeDetectionEnabled ? 'ENABLED' : 'DISABLED'}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-sm text-muted-foreground">DCA (Dollar Cost Averaging):</span>
                      <Badge variant={(strategy as any).dcaEnabled ? 'default' : 'secondary'} data-testid={`dca-status-${strategy.name.toLowerCase().replace(/\s+/g, '-')}`}>
                        {(strategy as any).dcaEnabled ? 'ENABLED' : 'DISABLED'}
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
                  Global Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="maxSymbolConcentration" className="text-sm font-medium">Max symbol concentration (%):</Label>
                  <Input
                    id="maxSymbolConcentration"
                    type="number"
                    min="10"
                    max="50"
                    step="5"
                    value={riskSettingsFormData.maxSymbolConcentrationPercent || ''}
                    onChange={(e) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      maxSymbolConcentrationPercent: e.target.value
                    })}
                    className="h-8"
                    data-testid="input-max-symbol-concentration"
                  />
                  <p className="text-xs text-muted-foreground">Maximum percentage of portfolio allocated to any single asset</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="warningExposure" className="text-sm font-medium">Warning portfolio exposure (%):</Label>
                  <Input
                    id="warningExposure"
                    type="number"
                    min="30"
                    max="80"
                    step="5"
                    value={riskSettingsFormData.warningPortfolioExposurePercent || ''}
                    onChange={(e) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      warningPortfolioExposurePercent: e.target.value
                    })}
                    className="h-8"
                    data-testid="input-warning-exposure"
                  />
                  <p className="text-xs text-muted-foreground">Warning threshold before reaching max portfolio exposure</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxPositionSize" className="text-sm font-medium">Max position size (%):</Label>
                  <Input
                    id="maxPositionSize"
                    type="number"
                    min="1"
                    max="10"
                    step="0.5"
                    value={riskSettingsFormData.maxPositionSizePercent || ''}
                    onChange={(e) => setRiskSettingsFormData({
                      ...riskSettingsFormData, 
                      maxPositionSizePercent: e.target.value
                    })}
                    className="h-8"
                    data-testid="input-max-position-size"
                  />
                  <p className="text-xs text-muted-foreground">Maximum size of any single position as % of portfolio</p>
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

        {/* Trading Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Paper Balance Configuration */}
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-blue-500" />
                  <CardTitle>Paper Balance Configuration</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Current Paper Balance</span>
                    <span className="text-lg font-bold text-blue-600">
                      {portfolio ? formatCurrency(portfolio.paperBalance) : '$0.00'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your simulated trading funds for paper trading mode
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={resetPaperBalance}
                    data-testid="reset-paper-balance-analytics"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reset to $10k
                  </Button>
                  
                  <Dialog open={paperBalanceDialogOpen} onOpenChange={setPaperBalanceDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="default" data-testid="set-custom-balance">
                        <Edit className="h-4 w-4 mr-2" />
                        Set Custom
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-sm">
                      <DialogHeader>
                        <DialogTitle>Set Custom Paper Balance</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="customBalance">Balance Amount ($)</Label>
                          <Input
                            id="customBalance"
                            type="number"
                            min="0"
                            step="0.01"
                            value={customPaperBalance}
                            onChange={(e) => setCustomPaperBalance(e.target.value)}
                            placeholder="e.g., 25000"
                            data-testid="input-custom-balance"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            className="flex-1" 
                            onClick={handleSetCustomPaperBalance}
                            data-testid="button-save-custom-balance"
                          >
                            Set Balance
                          </Button>
                          <Button 
                            variant="outline" 
                            className="flex-1"
                            onClick={() => setPaperBalanceDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>

            {/* Trading Fees Configuration */}
            <Card className="hover-elevate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="flex items-center gap-2">
                  <Percent className="h-5 w-5 text-green-500" />
                  <CardTitle>Trading Fees Configuration</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Simulate Realistic Fees</Label>
                    <Switch
                      checked={tradingFeesFormData.simulateRealisticFees || false}
                      onCheckedChange={(checked) => 
                        setTradingFeesFormData({...tradingFeesFormData, simulateRealisticFees: checked})
                      }
                      data-testid="switch-simulate-fees"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Paper Market Orders (%)</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={tradingFeesFormData.paperMarketOrderFeePercent || ''}
                        onChange={(e) => setTradingFeesFormData({
                          ...tradingFeesFormData, 
                          paperMarketOrderFeePercent: e.target.value
                        })}
                        placeholder="0.1000"
                        data-testid="input-paper-market-fee"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Paper Limit Orders (%)</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={tradingFeesFormData.paperLimitOrderFeePercent || ''}
                        onChange={(e) => setTradingFeesFormData({
                          ...tradingFeesFormData, 
                          paperLimitOrderFeePercent: e.target.value
                        })}
                        placeholder="0.0750"
                        data-testid="input-paper-limit-fee"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Real Market Orders (%)</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm text-muted-foreground" data-testid="real-market-fee-display">
                        {tradingFeesFormData.realMarketOrderFeePercent || 'N/A (Trading API required)'}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Real Limit Orders (%)</Label>
                      <div className="px-3 py-2 bg-muted/50 rounded-md text-sm text-muted-foreground" data-testid="real-limit-fee-display">
                        {tradingFeesFormData.realLimitOrderFeePercent || 'N/A (Trading API required)'}
                      </div>
                    </div>
                  </div>
                  
                  <Button
                    className="w-full"
                    onClick={handleSaveTradingFees}
                    disabled={isUpdatingTradingFees}
                    data-testid="button-save-trading-fees"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {isUpdatingTradingFees ? 'Saving...' : 'Save Fee Settings'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Completed Trades Section */}
          <Card className="hover-elevate">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-purple-500" />
                <CardTitle>Completed Trades</CardTitle>
                <Badge variant="outline" className="ml-2">
                  {completedTrades.length} trades
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {completedTrades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No completed trades yet</p>
                  <p className="text-sm">Your trading history will appear here</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-auto">
                  {completedTrades.map((trade: Trade) => (
                    <div 
                      key={trade.id} 
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md hover:bg-muted/70 transition-colors"
                      data-testid={`trade-${trade.symbol}-${trade.side}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{trade.symbol}</span>
                            <Badge 
                              variant={trade.side === 'long' ? 'default' : 'destructive'}
                              className="text-xs"
                            >
                              {trade.side.toUpperCase()}
                            </Badge>
                            <Badge 
                              variant={trade.tradingMode === 'paper' ? 'outline' : 'secondary'}
                              className="text-xs"
                            >
                              {trade.tradingMode === 'paper' ? 'PAPER' : 'REAL'}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatNumber(trade.size, 4)} @ {formatCurrency(trade.entryPrice)} → {formatCurrency(trade.exitPrice)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4 text-right">
                        <div className="flex flex-col">
                          <span className={`font-medium ${getPnlColor(trade.realizedPnl)}`}>
                            {formatCurrency(trade.realizedPnl)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Fee: {formatCurrency(trade.feesPaid)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(trade.closedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Global Settings Tab */}
        <TabsContent value="global-settings" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Global Trading Settings */}
            <Card className="hover-elevate">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Global Trading Settings
                </CardTitle>
                <p className="text-sm text-muted-foreground">Core trading execution parameters</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="simulateOnly"
                    checked={globalSettingsFormData.simulateOnly || false}
                    onCheckedChange={(checked) => setGlobalSettingsFormData({...globalSettingsFormData, simulateOnly: checked})}
                    data-testid="switch-simulate-only"
                  />
                  <Label htmlFor="simulateOnly">Simulate Only</Label>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="maxTotalExposureUsd">Max Total Exposure (USD)</Label>
                  <Input
                    id="maxTotalExposureUsd"
                    type="number"
                    step="100"
                    value={globalSettingsFormData.maxTotalExposureUsd || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, maxTotalExposureUsd: e.target.value})}
                    placeholder="1400"
                    data-testid="input-max-exposure"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="volumeWindowSec">Volume Window (sec)</Label>
                  <Input
                    id="volumeWindowSec"
                    type="number"
                    min="1"
                    value={globalSettingsFormData.volumeWindowSec || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, volumeWindowSec: parseInt(e.target.value)})}
                    placeholder="60"
                    data-testid="input-volume-window"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="orderTtlSec">Order TTL (sec)</Label>
                  <Input
                    id="orderTtlSec"
                    type="number"
                    min="1"
                    value={globalSettingsFormData.orderTtlSec || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, orderTtlSec: parseInt(e.target.value)})}
                    placeholder="30"
                    data-testid="input-order-ttl"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="rateLimitBuffer">Rate Limit Buffer (%)</Label>
                  <Input
                    id="rateLimitBuffer"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={globalSettingsFormData.rateLimitBufferPercent || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, rateLimitBufferPercent: e.target.value})}
                    placeholder="10"
                    data-testid="input-rate-limit-buffer"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="timeInForce">Time in Force</Label>
                  <Select 
                    value={globalSettingsFormData.timeInForce || 'GTC'} 
                    onValueChange={(value) => setGlobalSettingsFormData({...globalSettingsFormData, timeInForce: value})}
                  >
                    <SelectTrigger data-testid="select-time-in-force">
                      <SelectValue placeholder="Select time in force" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GTC">GTC (Good Till Cancel)</SelectItem>
                      <SelectItem value="IOC">IOC (Immediate or Cancel)</SelectItem>
                      <SelectItem value="FOK">FOK (Fill or Kill)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="marginType">Margin Type</Label>
                  <Select 
                    value={globalSettingsFormData.marginType || 'cross'} 
                    onValueChange={(value) => setGlobalSettingsFormData({...globalSettingsFormData, marginType: value})}
                  >
                    <SelectTrigger data-testid="select-margin-type">
                      <SelectValue placeholder="Select margin type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cross">Cross Margin</SelectItem>
                      <SelectItem value="isolated">Isolated Margin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="leverage">Leverage</Label>
                  <Input
                    id="leverage"
                    type="number"
                    step="0.1"
                    min="1"
                    max="125"
                    value={globalSettingsFormData.leverage || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, leverage: e.target.value})}
                    placeholder="1"
                    data-testid="input-leverage"
                  />
                </div>
              </CardContent>
            </Card>
            
            {/* Order Management Settings */}
            <Card className="hover-elevate">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListOrdered className="h-5 w-5" />
                  Order Management
                </CardTitle>
                <p className="text-sm text-muted-foreground">Order execution and lifecycle controls</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="maxOpenOrdersPerSymbol">Max Open Orders Per Symbol</Label>
                  <Input
                    id="maxOpenOrdersPerSymbol"
                    type="number"
                    min="1"
                    value={globalSettingsFormData.maxOpenOrdersPerSymbol || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, maxOpenOrdersPerSymbol: parseInt(e.target.value)})}
                    placeholder="20"
                    data-testid="input-max-open-orders"
                  />
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="batchOrders"
                    checked={globalSettingsFormData.batchOrders !== false}
                    onCheckedChange={(checked) => setGlobalSettingsFormData({...globalSettingsFormData, batchOrders: checked})}
                    data-testid="switch-batch-orders"
                  />
                  <Label htmlFor="batchOrders">Batch Orders</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enableOrderConsolidation"
                    checked={globalSettingsFormData.enableOrderConsolidation !== false}
                    onCheckedChange={(checked) => setGlobalSettingsFormData({...globalSettingsFormData, enableOrderConsolidation: checked})}
                    data-testid="switch-order-consolidation"
                  />
                  <Label htmlFor="enableOrderConsolidation">Enable Order Consolidation</Label>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="maxStopOrdersPerSymbol">Max Stop Orders Per Symbol</Label>
                  <Input
                    id="maxStopOrdersPerSymbol"
                    type="number"
                    min="1"
                    value={globalSettingsFormData.maxStopOrdersPerSymbol || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, maxStopOrdersPerSymbol: parseInt(e.target.value)})}
                    placeholder="1"
                    data-testid="input-max-stop-orders"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="orderCleanupIntervalSec">Order Cleanup Interval (sec)</Label>
                  <Input
                    id="orderCleanupIntervalSec"
                    type="number"
                    min="1"
                    value={globalSettingsFormData.orderCleanupIntervalSec || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, orderCleanupIntervalSec: parseInt(e.target.value)})}
                    placeholder="20"
                    data-testid="input-cleanup-interval"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="staleLimitOrderMin">Stale Limit Order (min)</Label>
                  <Input
                    id="staleLimitOrderMin"
                    type="number"
                    min="1"
                    value={globalSettingsFormData.staleLimitOrderMin || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, staleLimitOrderMin: parseInt(e.target.value)})}
                    placeholder="1"
                    data-testid="input-stale-limit-order"
                  />
                </div>
              </CardContent>
            </Card>
            
            {/* Advanced Features */}
            <Card className="hover-elevate">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Advanced Features
                </CardTitle>
                <p className="text-sm text-muted-foreground">Portfolio and position management features</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="multiAssetsMode"
                    checked={globalSettingsFormData.multiAssetsMode !== false}
                    onCheckedChange={(checked) => setGlobalSettingsFormData({...globalSettingsFormData, multiAssetsMode: checked})}
                    data-testid="switch-multi-assets"
                  />
                  <Label htmlFor="multiAssetsMode">Multi-Assets Mode</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="hedgeMode"
                    checked={globalSettingsFormData.hedgeMode !== false}
                    onCheckedChange={(checked) => setGlobalSettingsFormData({...globalSettingsFormData, hedgeMode: checked})}
                    data-testid="switch-hedge-mode"
                  />
                  <Label htmlFor="hedgeMode">Hedge Mode</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="usePositionMonitor"
                    checked={globalSettingsFormData.usePositionMonitor !== false}
                    onCheckedChange={(checked) => setGlobalSettingsFormData({...globalSettingsFormData, usePositionMonitor: checked})}
                    data-testid="switch-position-monitor"
                  />
                  <Label htmlFor="usePositionMonitor">Use Position Monitor</Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Switch
                    id="useUsdtVolume"
                    checked={globalSettingsFormData.useUsdtVolume !== false}
                    onCheckedChange={(checked) => setGlobalSettingsFormData({...globalSettingsFormData, useUsdtVolume: checked})}
                    data-testid="switch-usdt-volume"
                  />
                  <Label htmlFor="useUsdtVolume">Use USDT Volume</Label>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="maxTranchesPerSymbolSide">Max Tranches Per Symbol Side</Label>
                  <Input
                    id="maxTranchesPerSymbolSide"
                    type="number"
                    min="1"
                    value={globalSettingsFormData.maxTranchesPerSymbolSide || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, maxTranchesPerSymbolSide: parseInt(e.target.value)})}
                    placeholder="5"
                    data-testid="input-max-tranches"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="tranchePnlIncrementPercent">Tranche P&L Increment (%)</Label>
                  <Input
                    id="tranchePnlIncrementPercent"
                    type="number"
                    step="0.1"
                    min="0"
                    value={globalSettingsFormData.tranchePnlIncrementPercent || ''}
                    onChange={(e) => setGlobalSettingsFormData({...globalSettingsFormData, tranchePnlIncrementPercent: e.target.value})}
                    placeholder="5"
                    data-testid="input-tranche-pnl"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Save Button */}
          <div className="flex justify-end">
            <Button 
              onClick={handleSaveGlobalSettings}
              disabled={isUpdatingGlobalSettings}
              data-testid="save-global-settings"
            >
              {isUpdatingGlobalSettings ? 'Saving...' : 'Save Global Settings'}
            </Button>
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
              
              <div className="space-y-2">
                <Label htmlFor="liquidationThresholdPercentile">Liquidation Threshold (percentile)</Label>
                <Input
                  id="liquidationThresholdPercentile"
                  type="number"
                  min="0"
                  max="99"
                  step="5"
                  value={(configFormData as any).liquidationThresholdPercentile || ''}
                  onChange={(e) => setConfigFormData({...configFormData, liquidationThresholdPercentile: e.target.value} as any)}
                  placeholder="e.g., 75 (only trade liquidations above 75th percentile)"
                />
                <p className="text-xs text-muted-foreground">Only enter trades for liquidations above this percentile. Set to 0 to trade all liquidations.</p>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="cascadeDetection"
                  checked={configFormData.cascadeDetectionEnabled || false}
                  onCheckedChange={(checked) => setConfigFormData({...configFormData, cascadeDetectionEnabled: checked})}
                />
                <Label htmlFor="cascadeDetection">Enable Cascade Detection</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="dcaEnabled"
                  checked={configFormData.dcaEnabled || false}
                  onCheckedChange={(checked) => setConfigFormData({...configFormData, dcaEnabled: checked})}
                />
                <Label htmlFor="dcaEnabled">Enable DCA (Dollar Cost Averaging)</Label>
              </div>
              <p className="text-xs text-muted-foreground">When enabled, adds to existing positions instead of skipping duplicate signals in the same direction.</p>
              
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
      
      {/* Create Strategy Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create New Trading Strategy
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="strategyName">Strategy Name</Label>
              <Input
                id="strategyName"
                value={createFormData.name}
                onChange={(e) => setCreateFormData({...createFormData, name: e.target.value})}
                placeholder="e.g., Counter Liquidation Strategy"
                data-testid="input-strategy-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="strategyType">Strategy Type</Label>
              <select
                id="strategyType"
                value={createFormData.type}
                onChange={(e) => setCreateFormData({...createFormData, type: e.target.value})}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                data-testid="select-strategy-type"
              >
                <option value="counter_liquidation">Counter Liquidation</option>
                <option value="volatility">Volatility Based</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="riskReward">Risk/Reward Ratio</Label>
                <Input
                  id="riskReward"
                  type="number"
                  step="0.1"
                  value={createFormData.riskRewardRatio}
                  onChange={(e) => setCreateFormData({...createFormData, riskRewardRatio: e.target.value})}
                  placeholder="2.0"
                  data-testid="input-risk-reward"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="maxPosition">Max Position Size ($)</Label>
                <Input
                  id="maxPosition"
                  type="number"
                  step="100"
                  value={createFormData.maxPositionSize}
                  onChange={(e) => setCreateFormData({...createFormData, maxPositionSize: e.target.value})}
                  placeholder="1000"
                  data-testid="input-max-position"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="stopLoss">Stop Loss %</Label>
                <Input
                  id="stopLoss"
                  type="number"
                  step="0.1"
                  value={createFormData.stopLossPercent}
                  onChange={(e) => setCreateFormData({...createFormData, stopLossPercent: e.target.value})}
                  placeholder="2.0"
                  data-testid="input-stop-loss"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="takeProfit">Take Profit %</Label>
                <Input
                  id="takeProfit"
                  type="number"
                  step="0.1"
                  value={createFormData.takeProfitPercent}
                  onChange={(e) => setCreateFormData({...createFormData, takeProfitPercent: e.target.value})}
                  placeholder="4.0"
                  data-testid="input-take-profit"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="volatility">Volatility Threshold %</Label>
                <Input
                  id="volatility"
                  type="number"
                  step="0.1"
                  value={createFormData.volatilityThreshold}
                  onChange={(e) => setCreateFormData({...createFormData, volatilityThreshold: e.target.value})}
                  placeholder="5.0"
                  data-testid="input-volatility"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="liquidationThreshold">Liquidation Threshold</Label>
                <Input
                  id="liquidationThreshold"
                  type="number"
                  min="0"
                  max="99"
                  step="5"
                  value={createFormData.liquidationThresholdPercentile}
                  onChange={(e) => setCreateFormData({...createFormData, liquidationThresholdPercentile: e.target.value})}
                  placeholder="50"
                  data-testid="input-liquidation-threshold"
                />
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Switch
                  id="cascadeDetection"
                  checked={createFormData.cascadeDetectionEnabled}
                  onCheckedChange={(checked) => setCreateFormData({...createFormData, cascadeDetectionEnabled: checked})}
                  data-testid="switch-cascade-detection"
                />
                <Label htmlFor="cascadeDetection">Enable Cascade Detection</Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="dcaEnabled"
                  checked={createFormData.dcaEnabled}
                  onCheckedChange={(checked) => setCreateFormData({...createFormData, dcaEnabled: checked})}
                  data-testid="switch-dca"
                />
                <Label htmlFor="dcaEnabled">Enable DCA (Dollar Cost Averaging)</Label>
              </div>
            </div>
            
            <div className="bg-muted/50 rounded-md p-3 text-sm">
              <p className="text-muted-foreground">
                <strong>Note:</strong> The strategy will use your selected assets from the Dashboard. 
                Make sure you have selected the assets you want to trade before activating the strategy.
              </p>
            </div>
            
            <div className="flex gap-2 pt-4">
              <Button 
                onClick={createNewStrategy} 
                className="flex-1"
                disabled={!createFormData.name.trim()}
                data-testid="create-strategy-submit"
              >
                Create Strategy
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setCreateDialogOpen(false)}
                className="flex-1"
                data-testid="create-strategy-cancel"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}