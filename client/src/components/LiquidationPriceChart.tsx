import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp } from "lucide-react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Scatter, ComposedChart, Area, Line } from "recharts";
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

  // Transform data for combined chart
  const combineDataForChart = () => {
    if (!chartData?.priceData || !chartData?.liquidations) return [];

    // Calculate interval duration in milliseconds based on selected interval
    const getIntervalMs = (interval: string) => {
      const intervalMap: Record<string, number> = {
        '1m': 60 * 1000,
        '5m': 5 * 60 * 1000,
        '15m': 15 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
      };
      return intervalMap[interval] || 15 * 60 * 1000; // Default to 15m
    };

    const intervalMs = getIntervalMs(selectedInterval);

    // Create a combined dataset with price data and liquidations
    const combined = chartData.priceData.map(price => {
      // Find liquidations that occurred during this price candle period
      const liquidationsInPeriod = chartData.liquidations.filter(liq => {
        const liquidationTime = liq.timestamp;
        const candleStart = price.timestamp;
        const candleEnd = price.timestamp + intervalMs;
        return liquidationTime >= candleStart && liquidationTime < candleEnd;
      });

      return {
        ...price,
        liquidations: liquidationsInPeriod,
        time: format(new Date(price.timestamp), 'HH:mm'),
        fullDate: format(new Date(price.timestamp), 'MMM dd, HH:mm')
      };
    });

    return combined;
  };

  // Prepare scatter data for liquidations positioned at their exact time and price
  const getLiquidationScatterData = () => {
    if (!chartData?.liquidations) return [];

    return chartData.liquidations.map((liq) => {
      return {
        // Use actual liquidation timestamp for X positioning
        timestamp: liq.timestamp,
        time: format(new Date(liq.timestamp), 'HH:mm:ss'),
        fullDate: format(new Date(liq.timestamp), 'MMM dd, HH:mm:ss'),
        
        // Position liquidation at its actual price
        liquidationPrice: liq.price,
        liquidationValue: liq.value,
        liquidationSize: liq.size,
        liquidationSide: liq.side,
        liquidationId: liq.id,
        liquidationTime: format(new Date(liq.timestamp), 'HH:mm:ss'),
        liquidationFullDate: format(new Date(liq.timestamp), 'MMM dd, HH:mm:ss'),
        
        // Calculate circle size based on liquidation value
        scatterSize: Math.max(4, Math.min(15, Math.sqrt(liq.value / 1000) * 2))
      };
    });
  };

  const combinedData = combineDataForChart();
  const liquidationScatter = getLiquidationScatterData();

  // Custom tooltip for liquidation scatter points  
  const LiquidationTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload;
      if (!data || !data.liquidationPrice) return null;
      
      return (
        <div className="bg-card border rounded-lg p-3 shadow-lg">
          <div className="font-medium text-destructive">Liquidation Event</div>
          <div className="space-y-1 text-sm">
            <div>Time: {data.liquidationFullDate}</div>
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

            {/* Price Chart with Liquidation Circles */}
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
                    tickFormatter={(value) => format(new Date(value), 'HH:mm')}
                  />
                  <YAxis 
                    domain={['dataMin - 10', 'dataMax + 10']}
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={formatPrice}
                  />
                  <Tooltip />
                  
                  {/* Close price line (main line) */}
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 4, stroke: "hsl(var(--primary))", strokeWidth: 2 }}
                  />
                  
                  {/* High price area */}
                  <Area
                    type="monotone"
                    dataKey="high"
                    stroke="#22c55e"
                    fill="#22c55e"
                    fillOpacity={0.1}
                    strokeWidth={1}
                  />
                  
                  {/* Low price area */}
                  <Area
                    type="monotone"
                    dataKey="low"
                    stroke="#ef4444"
                    fill="#ef4444"
                    fillOpacity={0.1}
                    strokeWidth={1}
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
                      type="number"
                      domain={['dataMin - 10', 'dataMax + 10']}
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
                          return <g></g>; // Return empty group instead of null
                        }
                        
                        const color = payload.liquidationSide === 'long' ? '#ef4444' : '#22c55e';
                        const strokeColor = payload.liquidationSide === 'long' ? '#dc2626' : '#16a34a';
                        const radius = Math.max(4, Math.min(15, Math.sqrt(payload.liquidationValue / 1000) * 2));
                        
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