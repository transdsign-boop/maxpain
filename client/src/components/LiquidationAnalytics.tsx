import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, TrendingUp, TrendingDown, Activity, AlertCircle, Clock, DollarSign } from "lucide-react";
import { format } from "date-fns";

interface AvailableAsset {
  symbol: string;
  count: number;
  latestTimestamp: string;
}

interface PercentileData {
  symbol: string;
  hours: number;
  totalLiquidations: number;
  percentiles: {
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  } | null;
  breakdown: {
    longCount: number;
    shortCount: number;
    averageValue: number;
    maxValue: number;
    minValue: number;
  };
  latestLiquidation: any;
  message?: string;
}

interface DominantDirectionData {
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  analysis: {
    orderBook: {
      bidRatio: string;
      pressure: 'bullish' | 'bearish' | 'neutral';
    };
    funding: {
      currentRate: string;
      sentiment: 'bullish' | 'bearish' | 'neutral';
    };
  };
  timestamp: string;
}

const timeRangeOptions = [
  { value: '1', label: '1 Hour' },
  { value: '6', label: '6 Hours' },
  { value: '24', label: '24 Hours' },
  { value: '72', label: '3 Days' },
  { value: '168', label: '1 Week' },
];

// Helper function to calculate percentiles from complete dataset
function calculatePercentiles(liquidations: Liquidation[], symbol: string) {
  // Filter liquidations for the specific symbol and extract values
  const symbolLiquidations = liquidations.filter(liq => liq.symbol === symbol);
  const values = symbolLiquidations
    .map(liq => parseFloat(liq.value))
    .filter(val => !isNaN(val))
    .sort((a, b) => a - b);

  if (values.length === 0) {
    return null;
  }

  // Calculate percentiles using linear interpolation method
  const getPercentile = (percentile: number) => {
    const index = (percentile / 100) * (values.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;
    
    if (lower === upper) {
      return values[lower];
    }
    
    return values[lower] * (1 - weight) + values[upper] * weight;
  };

  // Calculate breakdown stats
  const longLiquidations = symbolLiquidations.filter(liq => liq.side === 'long');
  const shortLiquidations = symbolLiquidations.filter(liq => liq.side === 'short');
  const totalValue = values.reduce((sum, val) => sum + val, 0);

  return {
    percentiles: {
      p50: getPercentile(50),
      p75: getPercentile(75),
      p90: getPercentile(90),
      p95: getPercentile(95),
      p99: getPercentile(99),
    },
    breakdown: {
      longCount: longLiquidations.length,
      shortCount: shortLiquidations.length,
      averageValue: totalValue / values.length,
      maxValue: Math.max(...values),
      minValue: Math.min(...values),
    },
    totalLiquidations: symbolLiquidations.length,
  };
}

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface LiquidationAnalyticsProps {
  selectedAssets: string[];
  specificSymbol?: string; // Symbol to analyze when opened from a specific liquidation
  allLiquidations?: Liquidation[]; // Complete liquidation data for accurate totals
}

export default function LiquidationAnalytics({ selectedAssets, specificSymbol, allLiquidations }: LiquidationAnalyticsProps) {
  const [selectedAsset, setSelectedAsset] = useState<string>(specificSymbol || "");
  const [selectedHours, setSelectedHours] = useState<string>("24");

  // Fetch available assets
  const { data: availableAssets, isLoading: assetsLoading, error: assetsError } = useQuery<AvailableAsset[]>({
    queryKey: ['/api/analytics/assets'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch percentile data
  const { data: percentileData, isLoading: percentileLoading, error: percentileError } = useQuery<PercentileData>({
    queryKey: ['/api/analytics/percentiles', selectedAsset, selectedHours],
    queryFn: async () => {
      if (!selectedAsset) return null;
      const response = await fetch(`/api/analytics/percentiles?symbol=${selectedAsset}&hours=${selectedHours}`);
      if (!response.ok) {
        throw new Error('Failed to fetch percentile data');
      }
      return response.json();
    },
    enabled: !!selectedAsset,
    refetchInterval: 10000, // Refresh every 10 seconds when asset is selected
  });

  // Fetch dominant direction data
  const { data: dominantDirection, isLoading: directionLoading, error: directionError } = useQuery<DominantDirectionData>({
    queryKey: ['/api/analytics/dominant-direction', selectedAsset],
    queryFn: async () => {
      if (!selectedAsset) return null;
      const response = await fetch(`/api/analytics/dominant-direction?symbol=${selectedAsset}`);
      if (!response.ok) {
        throw new Error('Failed to fetch dominant direction data');
      }
      return response.json();
    },
    enabled: !!selectedAsset,
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  // Show all available assets with liquidation data
  const allAssets = availableAssets || [];

  // Auto-select the asset when data loads - use specificSymbol if provided, otherwise first available
  useEffect(() => {
    if (specificSymbol) {
      setSelectedAsset(specificSymbol);
    } else if (allAssets && allAssets.length > 0 && !selectedAsset) {
      setSelectedAsset(allAssets[0].symbol);
    }
  }, [allAssets, selectedAsset, specificSymbol]);

  // Calculate accurate percentiles from complete dataset when available
  const calculatedData = useMemo(() => {
    if (!allLiquidations || !selectedAsset || allLiquidations.length === 0) {
      return null;
    }
    return calculatePercentiles(allLiquidations, selectedAsset);
  }, [allLiquidations, selectedAsset]);

  // Use calculated data when available, otherwise fall back to API data
  const displayData = calculatedData || percentileData;

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(4)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(4)}K`;
    }
    return `$${value.toFixed(4)}`;
  };

  const formatTimestamp = (timestamp: string) => {
    return format(new Date(timestamp), 'MMM dd, HH:mm');
  };

  return (
    <Card data-testid="card-liquidation-analytics">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Liquidation Analytics
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Analyze liquidation percentiles and statistics for all available perpetual assets
        </p>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Loading State */}
        {percentileLoading && selectedAsset && (
          <div className="space-y-4" data-testid="loading-percentiles">
            <Skeleton className="h-8 w-full" />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          </div>
        )}

        {/* Error State */}
        {percentileError && (
          <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-md" data-testid="error-percentiles">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-sm text-destructive">Failed to load analytics data</span>
          </div>
        )}

        {/* Dominant Direction Analysis */}
        {selectedAsset && dominantDirection && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold" data-testid="title-dominant-direction">
                Market Direction - {selectedAsset}
              </h3>
              <Badge 
                variant={dominantDirection.direction === 'bullish' ? 'default' : dominantDirection.direction === 'bearish' ? 'destructive' : 'secondary'}
                data-testid={`badge-direction-${dominantDirection.direction}`}
              >
                {dominantDirection.direction.toUpperCase()}
              </Badge>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Overall Direction */}
              <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg" data-testid="card-overall-direction">
                {dominantDirection.direction === 'bullish' ? (
                  <TrendingUp className="h-8 w-8 text-lime-500" />
                ) : dominantDirection.direction === 'bearish' ? (
                  <TrendingDown className="h-8 w-8 text-red-600" />
                ) : (
                  <Activity className="h-8 w-8 text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Overall Direction</p>
                  <p className="text-lg font-bold" data-testid="text-direction">
                    {dominantDirection.direction.charAt(0).toUpperCase() + dominantDirection.direction.slice(1)}
                  </p>
                  <p className="text-xs text-muted-foreground" data-testid="text-confidence">
                    {dominantDirection.confidence}% confidence
                  </p>
                </div>
              </div>

              {/* Order Book Pressure */}
              <div className="p-4 bg-muted/50 rounded-lg" data-testid="card-orderbook-pressure">
                <p className="text-sm font-medium text-muted-foreground mb-2">Order Book Pressure</p>
                <div className="space-y-1">
                  <p className="text-sm" data-testid="text-bid-ratio">
                    Bid Ratio: <span className="font-mono">{(parseFloat(dominantDirection.analysis.orderBook.bidRatio) * 100).toFixed(1)}%</span>
                  </p>
                  <Badge 
                    variant={dominantDirection.analysis.orderBook.pressure === 'bullish' ? 'default' : dominantDirection.analysis.orderBook.pressure === 'bearish' ? 'destructive' : 'secondary'}
                    className="text-xs"
                    data-testid={`badge-orderbook-${dominantDirection.analysis.orderBook.pressure}`}
                  >
                    {dominantDirection.analysis.orderBook.pressure}
                  </Badge>
                </div>
              </div>

              {/* Funding Rate */}
              <div className="p-4 bg-muted/50 rounded-lg" data-testid="card-funding-rate">
                <p className="text-sm font-medium text-muted-foreground mb-2">Funding Rate</p>
                <div className="space-y-1">
                  <p className="text-sm" data-testid="text-funding-rate">
                    Current: <span className="font-mono">{dominantDirection.analysis.funding.currentRate}%</span>
                  </p>
                  <Badge 
                    variant={dominantDirection.analysis.funding.sentiment === 'bullish' ? 'default' : dominantDirection.analysis.funding.sentiment === 'bearish' ? 'destructive' : 'secondary'}
                    className="text-xs"
                    data-testid={`badge-funding-${dominantDirection.analysis.funding.sentiment}`}
                  >
                    {dominantDirection.analysis.funding.sentiment}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading state for dominant direction */}
        {selectedAsset && directionLoading && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">Market Direction - {selectedAsset}</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-20" data-testid={`skeleton-direction-${i}`} />
              ))}
            </div>
          </div>
        )}

        {/* Error state for dominant direction */}
        {selectedAsset && directionError && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">Market Direction - {selectedAsset}</h3>
            </div>
            <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg" data-testid="error-dominant-direction">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">Failed to load market direction data</p>
            </div>
          </div>
        )}


        {/* Results */}
        {displayData && !percentileLoading && (
          <div className="space-y-6">
            {/* No Data Message */}
            {displayData.totalLiquidations === 0 ? (
              <div className="text-center p-6 bg-muted/50 border rounded-lg" data-testid="message-no-data">
                <Clock className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No Liquidation Data</h3>
                <p className="text-sm text-muted-foreground">
                  No liquidations found for {selectedAsset} in the last {timeRangeOptions.find(o => o.value === selectedHours)?.label.toLowerCase()}
                </p>
              </div>
            ) : (
              <>
                {/* Summary - Only show when we have real data */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-card border rounded-lg" data-testid="stat-total-liquidations">
                    <div className="text-2xl font-bold">
                      {allLiquidations && selectedAsset ? 
                        allLiquidations.filter(liq => liq.symbol === selectedAsset).length : 
                        displayData.totalLiquidations
                      }
                    </div>
                    <div className="text-sm text-muted-foreground">Total Liquidations</div>
                  </div>
                  <div className="text-center p-4 bg-card border rounded-lg" data-testid="stat-average-value">
                    <div className="text-2xl font-bold">
                      {formatCurrency(displayData.breakdown?.averageValue || 0)}
                    </div>
                    <div className="text-sm text-muted-foreground">Average Value</div>
                  </div>
                  <div className="text-center p-4 bg-card border rounded-lg" data-testid="stat-long-count">
                    <div className="text-2xl font-bold text-destructive">
                      {allLiquidations && selectedAsset ? 
                        allLiquidations.filter(liq => liq.symbol === selectedAsset && liq.side === 'long').length : 
                        displayData.breakdown?.longCount || 0
                      }
                    </div>
                    <div className="text-sm text-muted-foreground">Long Liquidations</div>
                  </div>
                  <div className="text-center p-4 bg-card border rounded-lg" data-testid="stat-short-count">
                    <div className="text-2xl font-bold text-lime-500">
                      {allLiquidations && selectedAsset ? 
                        allLiquidations.filter(liq => liq.symbol === selectedAsset && liq.side === 'short').length : 
                        displayData.breakdown?.shortCount || 0
                      }
                    </div>
                    <div className="text-sm text-muted-foreground">Short Liquidations</div>
                  </div>
                </div>
              </>
            )}

            {/* Percentiles */}
            {displayData.percentiles && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Liquidation Value Percentiles</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border rounded-lg" data-testid="percentile-50">
                    <div className="text-xl font-bold">{formatCurrency(displayData.percentiles.p50)}</div>
                    <div className="text-sm text-muted-foreground">50th Percentile</div>
                    <div className="text-xs text-muted-foreground mt-1">(Median)</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950 dark:to-indigo-900 border rounded-lg" data-testid="percentile-75">
                    <div className="text-xl font-bold">{formatCurrency(displayData.percentiles.p75)}</div>
                    <div className="text-sm text-muted-foreground">75th Percentile</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border rounded-lg" data-testid="percentile-90">
                    <div className="text-xl font-bold">{formatCurrency(displayData.percentiles.p90)}</div>
                    <div className="text-sm text-muted-foreground">90th Percentile</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-pink-50 to-pink-100 dark:from-pink-950 dark:to-pink-900 border rounded-lg" data-testid="percentile-95">
                    <div className="text-xl font-bold">{formatCurrency(displayData.percentiles.p95)}</div>
                    <div className="text-sm text-muted-foreground">95th Percentile</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900 border rounded-lg" data-testid="percentile-99">
                    <div className="text-xl font-bold">{formatCurrency(displayData.percentiles.p99)}</div>
                    <div className="text-sm text-muted-foreground">99th Percentile</div>
                  </div>
                </div>
              </div>
            )}

            {/* Min/Max Values */}
            {displayData.breakdown && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-lime-50 dark:bg-lime-950 border border-lime-200 dark:border-lime-800 rounded-lg" data-testid="stat-min-value">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-4 w-4 text-lime-600" />
                    <span className="text-sm font-medium text-lime-800 dark:text-lime-200">Smallest Liquidation</span>
                  </div>
                  <div className="text-2xl font-bold text-lime-900 dark:text-lime-100">
                    {formatCurrency(displayData.breakdown.minValue)}
                  </div>
                </div>
                <div className="p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg" data-testid="stat-max-value">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-red-700" />
                    <span className="text-sm font-medium text-red-800 dark:text-red-200">Largest Liquidation</span>
                  </div>
                  <div className="text-2xl font-bold text-red-900 dark:text-red-100">
                    {formatCurrency(displayData.breakdown.maxValue)}
                  </div>
                </div>
              </div>
            )}

            {/* Latest Liquidation */}
            {percentileData?.latestLiquidation && (
              <div className="p-4 border rounded-lg bg-accent/5" data-testid="latest-liquidation">
                <h4 className="text-sm font-medium mb-2">Most Recent Liquidation</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Value:</span>{" "}
                    <span className="font-medium">{formatCurrency(parseFloat(percentileData.latestLiquidation.value))}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Side:</span>{" "}
                    <Badge className={`${percentileData.latestLiquidation.side === 'long' ? 'bg-lime-600 text-white' : 'bg-red-700 text-white'}`}>
                      {percentileData.latestLiquidation.side}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Size:</span>{" "}
                    <span className="font-medium">{parseFloat(percentileData.latestLiquidation.size).toFixed(4)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Time:</span>{" "}
                    <span className="font-medium">{formatTimestamp(percentileData.latestLiquidation.timestamp)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Call to Action when no asset selected */}
        {!selectedAsset && !assetsLoading && allAssets && allAssets.length > 0 && (
          <div className="text-center p-6 bg-muted/50 border rounded-lg" data-testid="select-asset-prompt">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">Select an Asset to Begin</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Choose an asset from the dropdown above to view detailed liquidation analytics
            </p>
            <Button 
              onClick={() => allAssets.length > 0 && setSelectedAsset(allAssets[0].symbol)}
              data-testid="button-auto-select"
            >
              Analyze {allAssets[0]?.symbol}
            </Button>
          </div>
        )}

      </CardContent>
    </Card>
  );
}