import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  StopCircle
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
  totalPnl: string;
}

interface TradingStrategy {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  symbolFilter: string[];
}

export default function TradingDashboard() {
  // CRITICAL FIX: Use the same session as trading engine 
  const [sessionId] = useState('demo-session');

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

  const toggleStrategy = async (strategyId: string, isActive: boolean) => {
    try {
      await fetch(`/api/strategies/${strategyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      });
      // Refetch strategies after update
      // queryClient.invalidateQueries(['/api/strategies']);
    } catch (error) {
      console.error('Failed to toggle strategy:', error);
    }
  };

  return (
    <div className="p-6 space-y-6 h-full overflow-auto" data-testid="trading-dashboard">
      {/* Portfolio Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="hover-elevate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paper Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {portfolio ? formatCurrency(portfolio.paperBalance) : '$0.00'}
            </div>
            <p className="text-xs text-muted-foreground">Available for trading</p>
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
                    <Button size="sm" variant="outline" data-testid={`close-position-${position.symbol}`}>
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
                      {(strategy.symbolFilter || []).slice(0, 5).map((symbol: string) => (
                        <Badge key={symbol} variant="outline" className="text-xs">
                          {symbol}
                        </Badge>
                      ))}
                      {(strategy.symbolFilter || []).length > 5 && (
                        <Badge variant="outline" className="text-xs">
                          +{(strategy.symbolFilter || []).length - 5} more
                        </Badge>
                      )}
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
                    <Button size="sm" variant="outline" data-testid={`configure-strategy-${strategy.name.toLowerCase().replace(/\s+/g, '-')}`}>
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
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm">Max positions per symbol:</span>
                  <span className="font-medium">1</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Risk per trade:</span>
                  <span className="font-medium">2%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Max portfolio exposure:</span>
                  <span className="font-medium">80%</span>
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
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm">Status:</span>
                  <Badge variant="default" className="bg-green-500">ACTIVE</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Risk threshold:</span>
                  <span className="font-medium">High</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Cooldown period:</span>
                  <span className="font-medium">10 min</span>
                </div>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Emergency Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="destructive" className="w-full" data-testid="emergency-stop-all">
                  <StopCircle className="h-4 w-4 mr-2" />
                  Stop All Trading
                </Button>
                <Button variant="outline" className="w-full" data-testid="close-all-positions">
                  Close All Positions
                </Button>
                <Button variant="outline" className="w-full" data-testid="pause-strategies">
                  Pause All Strategies
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}