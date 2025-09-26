import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp } from "lucide-react";
import { Chart as ChartJS, CategoryScale, LinearScale, TimeScale, PointElement, Title, Tooltip, Legend } from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
import 'chartjs-adapter-date-fns';
import { format } from "date-fns";

// Register Chart.js components including financial charts
ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  Title,
  Tooltip,
  Legend,
  CandlestickController,
  CandlestickElement
);

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

  // Prepare Chart.js data and options
  const getChartData = () => {
    if (!chartData?.priceData) return { datasets: [] };

    // Convert price data to Chart.js candlestick format
    const candlestickData = chartData.priceData.map(candle => ({
      x: new Date(candle.timestamp),
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
    }));

    // Convert liquidations to scatter plot data
    const liquidationData = chartData.liquidations?.map(liq => ({
      x: new Date(liq.timestamp),
      y: liq.price,
      value: liq.value,
      side: liq.side,
      id: liq.id,
    })) || [];

    return {
      datasets: [
        {
          type: 'candlestick' as const,
          label: 'Price',
          data: candlestickData,
          backgroundColors: {
            up: '#22c55e',
            down: '#ef4444',
            unchanged: '#64748b',
          },
          borderColors: {
            up: '#16a34a',
            down: '#dc2626',
            unchanged: '#475569',
          },
        },
        {
          type: 'scatter' as const,
          label: 'Liquidations',
          data: liquidationData,
          backgroundColor: (context: any) => {
            const point = context.raw;
            return point.side === 'long' ? '#ef4444cc' : '#22c55ecc';
          },
          borderColor: (context: any) => {
            const point = context.raw;
            return point.side === 'long' ? '#dc2626' : '#16a34a';
          },
          pointRadius: (context: any) => {
            const point = context.raw;
            return Math.max(4, Math.min(12, Math.sqrt(point.value / 1000) * 2));
          },
          borderWidth: 2,
        },
      ],
    };
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'nearest' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
      },
      tooltip: {
        callbacks: {
          title: (context: any) => {
            return format(new Date(context[0].parsed.x), 'MMM dd, HH:mm');
          },
          label: (context: any) => {
            if (context.dataset.type === 'candlestick') {
              const data = context.raw;
              return [
                `Open: ${formatPrice(data.o)}`,
                `High: ${formatPrice(data.h)}`,
                `Low: ${formatPrice(data.l)}`,
                `Close: ${formatPrice(data.c)}`,
              ];
            } else if (context.dataset.type === 'scatter') {
              const data = context.raw;
              return [
                `${data.side.toUpperCase()} Liquidation`,
                `Price: ${formatPrice(data.y)}`,
                `Value: ${formatCurrency(data.value)}`,
              ];
            }
            return '';
          },
        },
      },
    },
    scales: {
      x: {
        type: 'time' as const,
        time: {
          unit: 'minute' as const,
          displayFormats: {
            minute: 'HH:mm',
            hour: 'HH:mm',
          },
        },
        grid: {
          color: 'hsl(var(--border))',
        },
      },
      y: {
        type: 'linear' as const,
        position: 'right' as const,
        grid: {
          color: 'hsl(var(--border))',
        },
        ticks: {
          callback: (value: any) => formatPrice(value),
        },
      },
    },
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

            {/* Chart.js Financial Chart */}
            <div className="h-96 w-full" data-testid="price-liquidation-chart">
              <Chart type="candlestick" data={getChartData()} options={chartOptions} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}