import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, TrendingUp, TrendingDown, Activity, AlertCircle, Clock, DollarSign } from "lucide-react";
import { format } from "date-fns";
import LiquidationPriceChart from "./LiquidationPriceChart";

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

interface LiquidationAnalyticsProps {
  selectedAssets: string[];
}

export default function LiquidationAnalytics({ selectedAssets }: LiquidationAnalyticsProps) {
  const [selectedAsset, setSelectedAsset] = useState<string>("");
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

  // Filter available assets to only show those being tracked
  const trackedAssets = availableAssets?.filter(asset => 
    selectedAssets.includes(asset.symbol)
  ) || [];

  // Auto-select the asset with most liquidations when data loads (from tracked assets only)
  useEffect(() => {
    if (trackedAssets && trackedAssets.length > 0 && !selectedAsset) {
      setSelectedAsset(trackedAssets[0].symbol);
    }
  }, [trackedAssets, selectedAsset]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    }
    return `$${value.toFixed(2)}`;
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
          Analyze liquidation percentiles and statistics for your tracked assets
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Asset and Time Range Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Asset</label>
            {assetsLoading ? (
              <Skeleton className="h-10 w-full" data-testid="skeleton-asset-select" />
            ) : assetsError ? (
              <div className="text-sm text-destructive" data-testid="error-assets">
                Failed to load assets
              </div>
            ) : trackedAssets.length === 0 ? (
              <div className="text-sm text-muted-foreground" data-testid="no-tracked-assets">
                No tracked assets with liquidation data. Select assets to track in the panel above.
              </div>
            ) : (
              <Select value={selectedAsset} onValueChange={setSelectedAsset} data-testid="select-asset">
                <SelectTrigger>
                  <SelectValue placeholder="Select an asset to analyze" />
                </SelectTrigger>
                <SelectContent>
                  {trackedAssets.map(asset => (
                    <SelectItem key={asset.symbol} value={asset.symbol} data-testid={`option-asset-${asset.symbol}`}>
                      <div className="flex items-center justify-between w-full">
                        <span>{asset.symbol}</span>
                        <Badge variant="secondary" className="ml-2">
                          {asset.count} liquidations
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Time Range</label>
            <Select value={selectedHours} onValueChange={setSelectedHours} data-testid="select-timerange">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeRangeOptions.map(option => (
                  <SelectItem key={option.value} value={option.value} data-testid={`option-timerange-${option.value}`}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

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
                  <TrendingUp className="h-8 w-8 text-green-500" />
                ) : dominantDirection.direction === 'bearish' ? (
                  <TrendingDown className="h-8 w-8 text-red-500" />
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

        {/* Price Chart with Liquidations */}
        {selectedAsset && (
          <div className="mb-6">
            <LiquidationPriceChart symbol={selectedAsset} hours={parseInt(selectedHours)} />
          </div>
        )}

        {/* Results */}
        {percentileData && !percentileLoading && (
          <div className="space-y-6">
            {/* No Data Message */}
            {percentileData.totalLiquidations === 0 ? (
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
                    <div className="text-2xl font-bold">{percentileData.totalLiquidations}</div>
                    <div className="text-sm text-muted-foreground">Total Liquidations</div>
                  </div>
                  <div className="text-center p-4 bg-card border rounded-lg" data-testid="stat-average-value">
                    <div className="text-2xl font-bold">
                      {formatCurrency(percentileData.breakdown?.averageValue || 0)}
                    </div>
                    <div className="text-sm text-muted-foreground">Average Value</div>
                  </div>
                  <div className="text-center p-4 bg-card border rounded-lg" data-testid="stat-long-count">
                    <div className="text-2xl font-bold text-destructive">
                      {percentileData.breakdown?.longCount || 0}
                    </div>
                    <div className="text-sm text-muted-foreground">Long Liquidations</div>
                  </div>
                  <div className="text-center p-4 bg-card border rounded-lg" data-testid="stat-short-count">
                    <div className="text-2xl font-bold text-green-500">
                      {percentileData.breakdown?.shortCount || 0}
                    </div>
                    <div className="text-sm text-muted-foreground">Short Liquidations</div>
                  </div>
                </div>
              </>
            )}

            {/* Percentiles */}
            {percentileData.percentiles && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Liquidation Value Percentiles</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border rounded-lg" data-testid="percentile-50">
                    <div className="text-xl font-bold">{formatCurrency(percentileData.percentiles.p50)}</div>
                    <div className="text-sm text-muted-foreground">50th Percentile</div>
                    <div className="text-xs text-muted-foreground mt-1">(Median)</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950 dark:to-indigo-900 border rounded-lg" data-testid="percentile-75">
                    <div className="text-xl font-bold">{formatCurrency(percentileData.percentiles.p75)}</div>
                    <div className="text-sm text-muted-foreground">75th Percentile</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border rounded-lg" data-testid="percentile-90">
                    <div className="text-xl font-bold">{formatCurrency(percentileData.percentiles.p90)}</div>
                    <div className="text-sm text-muted-foreground">90th Percentile</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-pink-50 to-pink-100 dark:from-pink-950 dark:to-pink-900 border rounded-lg" data-testid="percentile-95">
                    <div className="text-xl font-bold">{formatCurrency(percentileData.percentiles.p95)}</div>
                    <div className="text-sm text-muted-foreground">95th Percentile</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900 border rounded-lg" data-testid="percentile-99">
                    <div className="text-xl font-bold">{formatCurrency(percentileData.percentiles.p99)}</div>
                    <div className="text-sm text-muted-foreground">99th Percentile</div>
                  </div>
                </div>
              </div>
            )}

            {/* Min/Max Values */}
            {percentileData.breakdown && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg" data-testid="stat-min-value">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800 dark:text-green-200">Smallest Liquidation</span>
                  </div>
                  <div className="text-2xl font-bold text-green-900 dark:text-green-100">
                    {formatCurrency(percentileData.breakdown.minValue)}
                  </div>
                </div>
                <div className="p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg" data-testid="stat-max-value">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-medium text-red-800 dark:text-red-200">Largest Liquidation</span>
                  </div>
                  <div className="text-2xl font-bold text-red-900 dark:text-red-100">
                    {formatCurrency(percentileData.breakdown.maxValue)}
                  </div>
                </div>
              </div>
            )}

            {/* Latest Liquidation */}
            {percentileData.latestLiquidation && (
              <div className="p-4 border rounded-lg bg-accent/5" data-testid="latest-liquidation">
                <h4 className="text-sm font-medium mb-2">Most Recent Liquidation</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Value:</span>{" "}
                    <span className="font-medium">{formatCurrency(parseFloat(percentileData.latestLiquidation.value))}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Side:</span>{" "}
                    <Badge variant={percentileData.latestLiquidation.side === 'long' ? 'destructive' : 'default'}>
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
        {!selectedAsset && !assetsLoading && trackedAssets && trackedAssets.length > 0 && (
          <div className="text-center p-6 bg-muted/50 border rounded-lg" data-testid="select-asset-prompt">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">Select an Asset to Begin</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Choose an asset from the dropdown above to view detailed liquidation analytics
            </p>
            <Button 
              onClick={() => trackedAssets.length > 0 && setSelectedAsset(trackedAssets[0].symbol)}
              data-testid="button-auto-select"
            >
              Analyze {trackedAssets[0]?.symbol}
            </Button>
          </div>
        )}

        {/* Show when no assets are being tracked */}
        {selectedAssets.length === 0 && !assetsLoading && (
          <div className="text-center p-6 bg-muted/50 border rounded-lg" data-testid="no-assets-tracked">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No Assets Selected</h3>
            <p className="text-sm text-muted-foreground">
              Select assets to track in the "Asset Selection" panel above to view liquidation analytics
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}