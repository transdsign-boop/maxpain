import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Scatter, ScatterChart, ComposedChart, Area, AreaChart } from "recharts";
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

    // Create a combined dataset with price data and liquidations
    const combined = chartData.priceData.map(price => {
      // Find liquidations that occurred during this price candle period
      const liquidationsInPeriod = chartData.liquidations.filter(liq => {
        const liquidationTime = liq.timestamp;
        const candleStart = price.timestamp;
        const candleEnd = price.timestamp + (15 * 60 * 1000); // Assuming 15m intervals
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

  // Prepare scatter data for liquidations
  const getLiquidationScatterData = () => {
    if (!chartData?.liquidations) return [];

    return chartData.liquidations.map(liq => ({
      x: liq.timestamp,
      y: liq.price,
      size: Math.max(5, Math.min(50, Math.sqrt(liq.value) * 2)), // Size based on liquidation value
      value: liq.value,
      side: liq.side,
      time: format(new Date(liq.timestamp), 'HH:mm:ss'),
      fullDate: format(new Date(liq.timestamp), 'MMM dd, HH:mm:ss')
    }));
  };

  const combinedData = combineDataForChart();
  const liquidationScatter = getLiquidationScatterData();

  // Custom tooltip for the chart
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-card border rounded-lg p-3 shadow-lg">
          <p className="font-medium">{data.fullDate}</p>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <span>Open:</span>
              <span className="font-mono">{formatPrice(data.open)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>High:</span>
              <span className="font-mono text-green-600">{formatPrice(data.high)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Low:</span>
              <span className="font-mono text-red-600">{formatPrice(data.low)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Close:</span>
              <span className="font-mono">{formatPrice(data.close)}</span>
            </div>
            {data.liquidations && data.liquidations.length > 0 && (
              <div className="border-t pt-1 mt-2">
                <p className="font-medium text-destructive">Liquidations: {data.liquidations.length}</p>
                {data.liquidations.slice(0, 3).map((liq: LiquidationPoint, idx: number) => (
                  <div key={idx} className="text-xs">
                    {liq.side} {formatCurrency(liq.value)} @ {formatPrice(liq.price)}
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
  };

  // Custom tooltip for liquidation scatter points
  const LiquidationTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-card border rounded-lg p-3 shadow-lg">
          <div className="font-medium text-destructive">Liquidation</div>
          <div className="space-y-1 text-sm">
            <div>{data.fullDate}</div>
            <div>Side: <span className={`font-medium ${data.side === 'long' ? 'text-red-500' : 'text-green-500'}`}>{data.side}</span></div>
            <div>Price: <span className="font-mono">{formatPrice(data.y)}</span></div>
            <div>Value: <span className="font-mono">{formatCurrency(data.value)}</span></div>
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
        ) : !chartData || combinedData.length === 0 ? (
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

            {/* Combined Chart */}
            <div className="h-96" data-testid="price-liquidation-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={combinedData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground))" opacity={0.3} />
                  <XAxis 
                    dataKey="time"
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis 
                    domain={['dataMin - 10', 'dataMax + 10']}
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={formatPrice}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  
                  {/* Price line */}
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: "hsl(var(--primary))", strokeWidth: 2 }}
                  />
                  
                  {/* High/Low area */}
                  <Area
                    type="monotone"
                    dataKey="high"
                    stroke="transparent"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.1}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Separate scatter chart for liquidations overlay */}
            <div className="h-96 relative -mt-96 pointer-events-none" data-testid="liquidation-scatter-overlay">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart data={liquidationScatter} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <XAxis 
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    dataKey="x"
                    axisLine={false}
                    tickLine={false}
                    tick={false}
                  />
                  <YAxis 
                    type="number"
                    domain={['dataMin - 10', 'dataMax + 10']}
                    dataKey="y"
                    axisLine={false}
                    tickLine={false}
                    tick={false}
                  />
                  <Tooltip content={<LiquidationTooltip />} cursor={false} />
                  <Scatter
                    dataKey="size"
                    fill="#ef4444"
                    stroke="#dc2626"
                    strokeWidth={1}
                    fillOpacity={0.7}
                    shape={(props: any) => {
                      const { cx, cy, payload } = props;
                      const color = payload.side === 'long' ? '#ef4444' : '#22c55e';
                      const strokeColor = payload.side === 'long' ? '#dc2626' : '#16a34a';
                      const radius = Math.max(3, Math.min(15, Math.sqrt(payload.size)));
                      
                      return (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={radius}
                          fill={color}
                          stroke={strokeColor}
                          strokeWidth={1}
                          fillOpacity={0.7}
                        />
                      );
                    }}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}