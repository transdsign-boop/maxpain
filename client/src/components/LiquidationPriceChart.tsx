import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp } from "lucide-react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Scatter } from "recharts";
import { format } from "date-fns";

interface PricePoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  date: string;
}

interface LiquidationPoint {
  timestamp: number;
  price: number;
  value: number;
  size: number;
  side: string;
  date: string;
  id: string;
}

interface LiquidationChartData {
  symbol: string;
  hours: number;
  interval: string;
  priceData: PricePoint[];
  liquidations: LiquidationPoint[];
  priceDataCount: number;
  liquidationCount: number;
  timeRange: {
    start: string;
    end: string;
  };
}

interface LiquidationPriceChartProps {
  symbol: string;
  hours: number;
}

const intervalOptions = [
  { value: '1m', label: '1 Minute' },
  { value: '5m', label: '5 Minutes' },
  { value: '15m', label: '15 Minutes' },
  { value: '1h', label: '1 Hour' },
  { value: '4h', label: '4 Hours' },
];

export default function LiquidationPriceChart({ symbol, hours }: LiquidationPriceChartProps) {
  const [selectedInterval, setSelectedInterval] = useState<string>("15m");

  // Fetch combined chart data
  const { data: chartData, isLoading, error } = useQuery<LiquidationChartData>({
    queryKey: ['/api/analytics/liquidation-chart', symbol, hours, selectedInterval],
    queryFn: async () => {
      if (!symbol) return null;
      const response = await fetch(`/api/analytics/liquidation-chart?symbol=${symbol}&hours=${hours}&interval=${selectedInterval}`);
      if (!response.ok) {
        throw new Error('Failed to fetch chart data');
      }
      return response.json();
    },
    enabled: !!symbol,
    refetchInterval: 30000, // Refresh every 30 seconds
  });


  const formatCurrency = (value: number) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(2)}`;
  };

  const formatPrice = (value: number) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(3)}K`;
    }
    return `$${value.toFixed(4)}`;
  };

  // Custom candlestick component for Recharts
  const CustomCandlestick = (props: any) => {
    const { payload, x, y, width, height } = props;
    if (!payload) return null;

    const { open, close, high, low } = payload;
    const isUp = close > open;
    const color = isUp ? '#22c55e' : '#ef4444';
    
    // Calculate positions
    const bodyTop = isUp ? close : open;
    const bodyBottom = isUp ? open : close;
    const bodyHeight = Math.abs(close - open);
    
    // Wick positions
    const wickTop = high;
    const wickBottom = low;
    
    // Scale to chart coordinates
    const candleWidth = Math.max(2, width * 0.8);
    const centerX = x + width / 2;
    
    // Y scaling (simplified - would need proper scale in real implementation)
    const priceRange = Math.max(high - low, 0.0001); // Avoid division by zero
    const topY = y;
    const bottomY = y + height;
    
    const getY = (price: number) => {
      const ratio = (wickTop - price) / (wickTop - wickBottom);
      return topY + ratio * height;
    };
    
    return (
      <g>
        {/* Upper wick */}
        <line
          x1={centerX}
          y1={getY(wickTop)}
          x2={centerX}
          y2={getY(bodyTop)}
          stroke={color}
          strokeWidth={1}
        />
        {/* Lower wick */}
        <line
          x1={centerX}
          y1={getY(bodyBottom)}
          x2={centerX}
          y2={getY(wickBottom)}
          stroke={color}
          strokeWidth={1}
        />
        {/* Body */}
        <rect
          x={centerX - candleWidth / 2}
          y={getY(bodyTop)}
          width={candleWidth}
          height={Math.abs(getY(bodyBottom) - getY(bodyTop))}
          fill={isUp ? color : color}
          stroke={color}
          strokeWidth={1}
          fillOpacity={isUp ? 0.3 : 1}
        />
      </g>
    );
  };

  // Transform data for chart
  const transformChartData = () => {
    if (!chartData?.priceData) return [];

    return chartData.priceData.map(candle => ({
      ...candle,
      time: format(new Date(candle.timestamp), 'HH:mm'),
      fullDate: format(new Date(candle.timestamp), 'MMM dd, HH:mm')
    }));
  };

  // Transform liquidations for scatter overlay
  const getLiquidationScatterData = () => {
    if (!chartData?.liquidations) return [];

    return chartData.liquidations.map(liq => ({
      timestamp: liq.timestamp,
      liquidationPrice: liq.price,
      liquidationValue: liq.value,
      liquidationSize: liq.size,
      liquidationSide: liq.side,
      liquidationId: liq.id,
      time: format(new Date(liq.timestamp), 'HH:mm:ss'),
      fullDate: format(new Date(liq.timestamp), 'MMM dd, HH:mm:ss'),
      scatterSize: Math.max(6, Math.min(20, Math.sqrt(liq.value / 1000) * 3))
    }));
  };

  const chartDataFormatted = transformChartData();
  const liquidationScatter = getLiquidationScatterData();

  // Custom tooltip for liquidations
  const LiquidationTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      if (!data || !data.liquidationPrice) return null;
      
      return (
        <div className="bg-card border rounded-lg p-3 shadow-lg">
          <div className="font-medium text-destructive">Liquidation Event</div>
          <div className="space-y-1 text-sm">
            <div>Time: {data.fullDate}</div>
            <div>Side: <span className={`font-medium ${data.liquidationSide === 'long' ? 'text-red-500' : 'text-green-500'}`}>{data.liquidationSide}</span></div>
            <div>Price: <span className="font-mono">{formatPrice(data.liquidationPrice)}</span></div>
            <div>Value: <span className="font-mono">{formatCurrency(data.liquidationValue)}</span></div>
            <div>Size: <span className="font-mono">{data.liquidationSize}</span></div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (!symbol) {
    return null;
  }

  return (
    <Card data-testid="card-liquidation-price-chart">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <CardTitle>Price Chart with Liquidations - {symbol}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedInterval} onValueChange={setSelectedInterval} data-testid="select-interval">
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {intervalOptions.map(option => (
                  <SelectItem key={option.value} value={option.value} data-testid={`option-interval-${option.value}`}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Liquidations shown as circles sized by value • Long liquidations in red • Short liquidations in green
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" data-testid="skeleton-chart-header" />
            <Skeleton className="h-96 w-full" data-testid="skeleton-chart" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg" data-testid="error-chart">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-sm text-destructive">Failed to load chart data</span>
          </div>
        ) : !chartData || !chartData.priceData || chartData.priceData.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground" data-testid="no-chart-data">
            <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No price data available for the selected time range</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Chart stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="text-center p-2 bg-muted/50 rounded">
                <div className="font-medium">{chartData.priceDataCount}</div>
                <div className="text-muted-foreground">Price Points</div>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded">
                <div className="font-medium text-destructive">{chartData.liquidationCount}</div>
                <div className="text-muted-foreground">Liquidations</div>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded">
                <div className="font-medium">{selectedInterval}</div>
                <div className="text-muted-foreground">Interval</div>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded">
                <div className="font-medium">{hours}h</div>
                <div className="text-muted-foreground">Time Range</div>
              </div>
            </div>

            {/* Recharts Candlestick Chart with Liquidation Markers */}
            <div className="h-96" data-testid="price-liquidation-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartDataFormatted} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" opacity={0.3} />
                  <XAxis 
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    dataKey="timestamp"
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(value) => format(new Date(value), 'HH:mm')}
                  />
                  <YAxis 
                    domain={[(dataMin: number) => dataMin * 0.998, (dataMax: number) => dataMax * 1.002]}
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={formatPrice}
                  />
                  <Tooltip 
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0]?.payload;
                        if (!data) return null;
                        
                        return (
                          <div className="bg-card border rounded-lg p-3 shadow-lg">
                            <div className="font-medium">Price Data</div>
                            <div className="space-y-1 text-sm">
                              <div>Time: {data.fullDate}</div>
                              <div>Open: <span className="font-mono">{formatPrice(data.open)}</span></div>
                              <div>High: <span className="font-mono text-green-600">{formatPrice(data.high)}</span></div>
                              <div>Low: <span className="font-mono text-red-600">{formatPrice(data.low)}</span></div>
                              <div>Close: <span className="font-mono">{formatPrice(data.close)}</span></div>
                              <div>Volume: <span className="font-mono">{data.volume}</span></div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  
                  {/* Custom Candlestick bars */}
                  <Scatter
                    dataKey="close"
                    shape={CustomCandlestick}
                    fill="transparent"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Liquidation Circles Overlay */}
            {liquidationScatter.length > 0 && (
              <div className="h-96 relative -mt-96 pointer-events-none" data-testid="liquidation-scatter-overlay">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={liquidationScatter} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <XAxis 
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      dataKey="timestamp"
                      tick={false}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis 
                      domain={[(dataMin: number) => dataMin * 0.998, (dataMax: number) => dataMax * 1.002]}
                      dataKey="liquidationPrice"
                      tick={false}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<LiquidationTooltip />} cursor={false} />
                    
                    {/* Liquidation scatter points */}
                    <Scatter
                      dataKey="liquidationPrice"
                      fill="#ef4444"
                      shape={(props: any) => {
                        const { cx, cy, payload } = props;
                        if (!payload || !payload.liquidationPrice) {
                          return <g></g>;
                        }
                        
                        const color = payload.liquidationSide === 'long' ? '#ef4444' : '#22c55e';
                        const strokeColor = payload.liquidationSide === 'long' ? '#dc2626' : '#16a34a';
                        const radius = payload.scatterSize || 8;
                        
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={radius}
                            fill={color}
                            stroke={strokeColor}
                            strokeWidth={2}
                            fillOpacity={0.8}
                          />
                        );
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}