import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp } from "lucide-react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Scatter, ReferenceArea } from "recharts";
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

  // Create combined data with both price and liquidations
  const getCombinedChartData = () => {
    if (!chartData?.priceData) return [];

    const priceData = chartData.priceData.map(candle => ({
      ...candle,
      time: format(new Date(candle.timestamp), 'HH:mm'),
      fullDate: format(new Date(candle.timestamp), 'MMM dd, HH:mm'),
      // Add liquidations that occurred during this candle's timeframe
      liquidations: chartData.liquidations?.filter(liq => {
        const liqTime = new Date(liq.timestamp).getTime();
        const candleTime = new Date(candle.timestamp).getTime();
        // Group liquidations within the same interval as the candle
        const intervalMs = getIntervalMs();
        return liqTime >= candleTime && liqTime < candleTime + intervalMs;
      }) || []
    }));

    return priceData;
  };

  const getIntervalMs = () => {
    switch (selectedInterval) {
      case '1m': return 60 * 1000;
      case '5m': return 5 * 60 * 1000;
      case '15m': return 15 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      default: return 15 * 60 * 1000;
    }
  };

  // Custom candlestick bar renderer that works with proper scale
  const CandlestickBar = (props: any) => {
    const { x, y, width, height, payload } = props;
    if (!payload || !payload.open) return null;

    const { open, close, high, low } = payload;
    const isUp = close > open;
    const color = isUp ? '#22c55e' : '#ef4444';
    
    // Calculate candlestick dimensions
    const candleWidth = Math.max(2, width * 0.8);
    const centerX = x + width / 2;
    
    // Body height and position (scaled to chart coordinates)
    const bodyTop = Math.min(open, close);
    const bodyBottom = Math.max(open, close);
    const bodyHeight = Math.abs(close - open);
    
    // Wick positions use actual price values
    return (
      <g>
        {/* Upper wick: from high to max(open, close) */}
        <line
          x1={centerX}
          y1={y} // Will be scaled by chart
          x2={centerX}
          y2={y} // Will be scaled by chart
          stroke={color}
          strokeWidth={1}
          data-high={high}
          data-body-top={Math.max(open, close)}
        />
        {/* Lower wick: from min(open, close) to low */}
        <line
          x1={centerX}
          y1={y}
          x2={centerX}
          y2={y}
          stroke={color}
          strokeWidth={1}
          data-body-bottom={Math.min(open, close)}
          data-low={low}
        />
        {/* Candlestick body */}
        <rect
          x={centerX - candleWidth / 2}
          y={y}
          width={candleWidth}
          height={height}
          fill={isUp ? 'transparent' : color}
          stroke={color}
          strokeWidth={2}
          data-open={open}
          data-close={close}
        />
      </g>
    );
  };

  const combinedData = getCombinedChartData();

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

            {/* Single Candlestick Chart with Liquidation Markers */}
            <div className="h-96" data-testid="price-liquidation-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={combinedData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" opacity={0.3} />
                  <XAxis 
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    dataKey="timestamp"
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(value) => {
                      try {
                        if (!value || isNaN(value)) return '';
                        const date = new Date(value);
                        if (isNaN(date.getTime())) return '';
                        return format(date, 'HH:mm');
                      } catch (error) {
                        return '';
                      }
                    }}
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
                        
                        // Check if this is a liquidation hover
                        const hasLiquidations = data.liquidations && data.liquidations.length > 0;
                        
                        return (
                          <div className="bg-card border rounded-lg p-3 shadow-lg">
                            <div className="font-medium">
                              {hasLiquidations ? `Price Data + ${data.liquidations.length} Liquidation${data.liquidations.length > 1 ? 's' : ''}` : 'Price Data'}
                            </div>
                            <div className="space-y-1 text-sm">
                              <div>Time: {data.fullDate}</div>
                              <div>Open: <span className="font-mono">{formatPrice(data.open)}</span></div>
                              <div>High: <span className="font-mono text-green-600">{formatPrice(data.high)}</span></div>
                              <div>Low: <span className="font-mono text-red-600">{formatPrice(data.low)}</span></div>
                              <div>Close: <span className="font-mono">{formatPrice(data.close)}</span></div>
                              <div>Volume: <span className="font-mono">{data.volume}</span></div>
                              
                              {hasLiquidations && (
                                <div className="mt-2 pt-2 border-t">
                                  <div className="font-medium text-destructive">Liquidations:</div>
                                  {data.liquidations.slice(0, 3).map((liq: any, idx: number) => (
                                    <div key={liq.id} className="text-xs">
                                      <span className={`font-medium ${liq.side === 'long' ? 'text-red-500' : 'text-green-500'}`}>
                                        {liq.side}
                                      </span> {formatPrice(liq.price)} ({formatCurrency(liq.value)})
                                    </div>
                                  ))}
                                  {data.liquidations.length > 3 && (
                                    <div className="text-xs text-muted-foreground">
                                      +{data.liquidations.length - 3} more...
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  
                  {/* Candlestick representation using ReferenceArea for proper scaling */}
                  {combinedData.map((candle, index) => {
                    const isUp = candle.close > candle.open;
                    const color = isUp ? '#22c55e' : '#ef4444';
                    
                    return (
                      <g key={`candle-${index}`}>
                        {/* Draw candlestick using reference areas that respect the chart scale */}
                        <ReferenceArea
                          x1={candle.timestamp}
                          x2={candle.timestamp + getIntervalMs() * 0.8}
                          y1={Math.min(candle.open, candle.close)}
                          y2={Math.max(candle.open, candle.close)}
                          fill={isUp ? 'transparent' : color}
                          stroke={color}
                          strokeWidth={2}
                          fillOpacity={isUp ? 0 : 0.8}
                        />
                      </g>
                    );
                  })}
                  
                  {/* Liquidation markers as scatter points on the same chart */}
                  <Scatter
                    data={chartData?.liquidations?.map(liq => ({
                      x: liq.timestamp,  // Bind to X-axis (timestamp)
                      y: liq.price,      // Bind to Y-axis (price)
                      value: liq.value,
                      side: liq.side,
                      size: liq.size,
                      id: liq.id
                    })) || []}
                    dataKey="y"
                    fill="#ef4444"
                    shape={(props: any) => {
                      const { cx, cy, payload } = props;
                      if (!payload || typeof payload.y === 'undefined') {
                        return <g />;
                      }
                      
                      const color = payload.side === 'long' ? '#ef4444' : '#22c55e';
                      const strokeColor = payload.side === 'long' ? '#dc2626' : '#16a34a';
                      const radius = Math.max(4, Math.min(12, Math.sqrt(payload.value / 1000) * 2));
                      
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}