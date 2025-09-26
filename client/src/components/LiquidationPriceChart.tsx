import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp } from "lucide-react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Scatter, ReferenceLine, Customized } from "recharts";
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

  // Create chart data for Recharts with individual candlesticks
  const getChartData = () => {
    if (!chartData?.priceData) return [];

    return chartData.priceData.map(candle => ({
      timestamp: candle.timestamp,
      time: format(new Date(candle.timestamp), 'HH:mm'),
      fullDate: format(new Date(candle.timestamp), 'MMM dd, HH:mm'),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      date: candle.date,
    }));
  };

  // Custom Candlestick Component using chart scales  
  const CandlestickRenderer = (props: any) => {
    const { xAxisMap, yAxisMap, chartWidth, chartHeight, data } = props;
    
    if (!data || data.length === 0) return null;
    
    const xScale = xAxisMap[Object.keys(xAxisMap)[0]]?.scale;
    const yScale = yAxisMap[Object.keys(yAxisMap)[0]]?.scale;
    
    if (!xScale || !yScale) return null;
    
    return (
      <g>
        {data.map((candle: any, index: number) => {
          if (!candle.open || !candle.close || !candle.high || !candle.low) return null;
          
          const { open, close, high, low, timestamp } = candle;
          const isUp = close > open;
          const color = isUp ? '#22c55e' : '#ef4444';
          const borderColor = isUp ? '#16a34a' : '#dc2626';
          
          // Use chart scales to get pixel coordinates
          const x = xScale(timestamp);
          const yOpen = yScale(open);
          const yClose = yScale(close);
          const yHigh = yScale(high);
          const yLow = yScale(low);
          
          // Calculate bar width based on data density
          const barWidth = Math.max(2, Math.min(8, chartWidth / data.length * 0.7));
          const centerX = x;
          
          const bodyTop = Math.min(yOpen, yClose);
          const bodyBottom = Math.max(yOpen, yClose);
          const bodyHeight = Math.max(1, bodyBottom - bodyTop);
          
          return (
            <g key={`candlestick-${index}`}>
              {/* Upper wick */}
              <line
                x1={centerX}
                y1={yHigh}
                x2={centerX}
                y2={bodyTop}
                stroke={borderColor}
                strokeWidth={1}
              />
              {/* Lower wick */}
              <line
                x1={centerX}
                y1={bodyBottom}
                x2={centerX}
                y2={yLow}
                stroke={borderColor}
                strokeWidth={1}
              />
              {/* Candlestick body */}
              <rect
                x={centerX - barWidth / 2}
                y={bodyTop}
                width={barWidth}
                height={bodyHeight}
                fill={isUp ? 'transparent' : color}
                stroke={borderColor}
                strokeWidth={2}
              />
            </g>
          );
        })}
      </g>
    );
  };

  const combinedData = getChartData();

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

            {/* Recharts Candlestick Chart */}
            <div className="h-96 w-full" data-testid="price-liquidation-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={combinedData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" opacity={0.3} />
                  <XAxis 
                    dataKey="timestamp"
                    domain={['dataMin', 'dataMax']}
                    scale="time"
                    type="number"
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
                        
                        return (
                          <div className="bg-card border rounded-lg p-3 shadow-lg">
                            <div className="font-medium">Candlestick Data</div>
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
                  
                  {/* Candlestick bars using proper chart scale mapping */}
                  <Customized 
                    component={CandlestickRenderer} 
                    data={combinedData}
                  />
                  
                  {/* Liquidation scatter points */}
                  <Scatter
                    data={chartData?.liquidations?.map(liq => ({
                      x: liq.timestamp,
                      y: liq.price,
                      value: liq.value,
                      side: liq.side,
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