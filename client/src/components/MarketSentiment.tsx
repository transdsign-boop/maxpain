import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Newspaper,
  TrendingUpIcon,
  AlertTriangle,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ExternalLink,
  Filter
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

interface FearGreedData {
  value: string;
  value_classification: string;
  timestamp: string;
  time_until_update?: string;
}

interface NewsArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string | null;
}

interface LiquidationMetrics {
  totalValue: number;
  longValue: number;
  shortValue: number;
  longCount: number;
  shortCount: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  trend: 'up' | 'down' | 'stable';
}

export default function MarketSentiment() {
  const [newsCategory, setNewsCategory] = useState<'all' | 'economic' | 'crypto'>('all');

  // Fetch Crypto Fear & Greed Index (free API - no key needed)
  const fearGreedQuery = useQuery<{ data: FearGreedData[] }>({
    queryKey: ['/api/sentiment/fear-greed'],
    queryFn: async () => {
      const response = await fetch('https://api.alternative.me/fng/?limit=1');
      if (!response.ok) throw new Error('Failed to fetch Fear & Greed Index');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
    refetchInterval: 5 * 60 * 1000,
  });

  // Fetch recent liquidations for market metrics
  const liquidationsQuery = useQuery<any[]>({
    queryKey: ['/api/liquidations/recent'],
    queryFn: async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const response = await fetch(`/api/liquidations/since/${oneHourAgo.toISOString()}?limit=1000`);
      if (!response.ok) throw new Error('Failed to fetch liquidations');
      return response.json();
    },
    staleTime: 30 * 1000, // Refresh every 30 seconds
    refetchInterval: 30 * 1000,
  });

  // Fetch crypto news from NewsAPI
  const newsQuery = useQuery<{ articles: NewsArticle[] }>({
    queryKey: ['/api/sentiment/news', newsCategory],
    queryFn: async () => {
      const response = await fetch(`/api/sentiment/news?category=${newsCategory}`);
      if (!response.ok) throw new Error('Failed to fetch news');
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // Refresh every 10 minutes
    refetchInterval: 10 * 60 * 1000,
  });

  // Fetch social sentiment metrics
  const socialSentimentQuery = useQuery<any>({
    queryKey: ['/api/sentiment/social'],
    queryFn: async () => {
      const response = await fetch('/api/sentiment/social');
      if (!response.ok) throw new Error('Failed to fetch social sentiment');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Refresh every 5 minutes
    refetchInterval: 5 * 60 * 1000,
  });

  // Calculate liquidation metrics
  const liquidationMetrics = useMemo((): LiquidationMetrics => {
    const liquidations = liquidationsQuery.data || [];
    
    const longLiqs = liquidations.filter(l => l.side === 'long');
    const shortLiqs = liquidations.filter(l => l.side === 'short');
    
    const longValue = longLiqs.reduce((sum, l) => sum + parseFloat(l.value), 0);
    const shortValue = shortLiqs.reduce((sum, l) => sum + parseFloat(l.value), 0);
    const totalValue = longValue + shortValue;
    
    // Determine sentiment based on liquidation ratio
    // More long liquidations = bearish (longs getting rekt)
    // More short liquidations = bullish (shorts getting squeezed)
    const longRatio = totalValue > 0 ? longValue / totalValue : 0.5;
    let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    
    if (longRatio > 0.65) {
      sentiment = 'bearish'; // Longs getting liquidated
    } else if (longRatio < 0.35) {
      sentiment = 'bullish'; // Shorts getting liquidated
    }
    
    // Determine trend based on recent activity
    const recentLiqs = liquidations.slice(0, 20);
    const olderLiqs = liquidations.slice(20, 40);
    const recentValue = recentLiqs.reduce((sum, l) => sum + parseFloat(l.value), 0);
    const olderValue = olderLiqs.reduce((sum, l) => sum + parseFloat(l.value), 0);
    
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (recentValue > olderValue * 1.2) {
      trend = 'up';
    } else if (recentValue < olderValue * 0.8) {
      trend = 'down';
    }
    
    return {
      totalValue,
      longValue,
      shortValue,
      longCount: longLiqs.length,
      shortCount: shortLiqs.length,
      sentiment,
      trend,
    };
  }, [liquidationsQuery.data]);

  const fearGreedData = fearGreedQuery.data?.data?.[0];
  const fearGreedValue = fearGreedData ? parseInt(fearGreedData.value) : null;

  // Determine Fear & Greed color
  const getFearGreedColor = (value: number | null) => {
    if (value === null) return 'text-muted-foreground';
    if (value < 25) return 'text-orange-500'; // Extreme Fear
    if (value < 45) return 'text-yellow-500'; // Fear
    if (value < 55) return 'text-muted-foreground'; // Neutral
    if (value < 75) return 'text-lime-400'; // Greed
    return 'text-lime-500'; // Extreme Greed
  };

  const getFearGreedLabel = (value: number | null) => {
    if (value === null) return 'Loading...';
    if (value < 25) return 'Extreme Fear';
    if (value < 45) return 'Fear';
    if (value < 55) return 'Neutral';
    if (value < 75) return 'Greed';
    return 'Extreme Greed';
  };

  const formatCurrency = (value: number) => {
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`;
    } else if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Market Sentiment</h2>
        <Badge variant="outline" className="text-xs" data-testid="badge-live-data">
          Live Data
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1. Market Metrics Card */}
        <Card data-testid="card-market-metrics">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Liquidation Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Sentiment Indicator */}
            <div className="text-center">
              <div className={`text-4xl font-mono font-bold ${
                liquidationMetrics.sentiment === 'bullish' 
                  ? 'text-[rgb(190,242,100)]' 
                  : liquidationMetrics.sentiment === 'bearish'
                  ? 'text-[rgb(251,146,60)]'
                  : 'text-muted-foreground'
              }`} data-testid="icon-liq-sentiment">
                {liquidationMetrics.sentiment === 'bullish' && <TrendingUp className="h-10 w-10 mx-auto" />}
                {liquidationMetrics.sentiment === 'bearish' && <TrendingDown className="h-10 w-10 mx-auto" />}
                {liquidationMetrics.sentiment === 'neutral' && <Minus className="h-10 w-10 mx-auto" />}
              </div>
              <div className="text-sm font-medium mt-2 capitalize" data-testid="text-liq-sentiment">
                {liquidationMetrics.sentiment}
              </div>
            </div>

            {/* Liquidation Stats */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Total Volume (1h)</span>
                <span className="font-mono font-semibold" data-testid="value-liq-total">
                  {formatCurrency(liquidationMetrics.totalValue)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[rgb(251,146,60)]">Long Liquidations</span>
                <span className="font-mono" data-testid="value-liq-long">{formatCurrency(liquidationMetrics.longValue)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[rgb(190,242,100)]">Short Liquidations</span>
                <span className="font-mono" data-testid="value-liq-short">{formatCurrency(liquidationMetrics.shortValue)}</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-2 border-t">
                <span className="text-muted-foreground">Trend</span>
                <Badge 
                  variant={liquidationMetrics.trend === 'up' ? 'default' : 'outline'} 
                  className="text-xs"
                  data-testid="badge-liq-trend"
                >
                  {liquidationMetrics.trend === 'up' && <ArrowUpRight className="h-3 w-3 mr-1" />}
                  {liquidationMetrics.trend === 'down' && <ArrowDownRight className="h-3 w-3 mr-1" />}
                  {liquidationMetrics.trend === 'stable' && <Minus className="h-3 w-3 mr-1" />}
                  {liquidationMetrics.trend}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. Fear & Greed Index Card */}
        <Card data-testid="card-fear-greed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <TrendingUpIcon className="h-4 w-4" />
              Fear & Greed Index
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Gauge Display */}
            <div className="text-center">
              <div 
                className={`text-6xl font-mono font-bold ${getFearGreedColor(fearGreedValue)}`}
                data-testid="value-fear-greed"
              >
                {fearGreedValue ?? '--'}
              </div>
              <div className="text-sm font-medium mt-2" data-testid="text-fear-greed-label">
                {getFearGreedLabel(fearGreedValue)}
              </div>
            </div>

            {/* Gauge Bar */}
            <div className="space-y-2">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-500 rounded-full"
                  style={{
                    width: `${fearGreedValue || 0}%`,
                    background: fearGreedValue && fearGreedValue < 50 
                      ? 'rgb(251, 146, 60)' 
                      : 'rgb(190, 242, 100)'
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Extreme Fear</span>
                <span>Extreme Greed</span>
              </div>
            </div>

            {/* Last Update */}
            {fearGreedData && (
              <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                Updated: {format(new Date(parseInt(fearGreedData.timestamp) * 1000), 'MMM d, h:mm a')}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Social Sentiment Card */}
        <Card data-testid="card-social-sentiment">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Social Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {socialSentimentQuery.isLoading ? (
              <div className="text-center py-8 text-sm text-muted-foreground" data-testid="status-social-loading">
                Loading sentiment data...
              </div>
            ) : socialSentimentQuery.error ? (
              <div className="text-center py-8" data-testid="status-social-error">
                <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <div className="text-xs text-muted-foreground">
                  Social sentiment unavailable
                </div>
              </div>
            ) : (
              <>
                {/* Sentiment Score */}
                <div className="text-center">
                  <div 
                    className={`text-5xl font-mono font-bold ${
                      (socialSentimentQuery.data?.score || 0) > 60 
                        ? 'text-[rgb(190,242,100)]' 
                        : (socialSentimentQuery.data?.score || 0) < 40
                        ? 'text-[rgb(251,146,60)]'
                        : 'text-muted-foreground'
                    }`}
                    data-testid="value-social-score"
                  >
                    {socialSentimentQuery.data?.score || '--'}
                  </div>
                  <div className="text-sm font-medium mt-2" data-testid="text-social-label">
                    {(socialSentimentQuery.data?.score || 0) > 60 
                      ? 'Positive' 
                      : (socialSentimentQuery.data?.score || 0) < 40
                      ? 'Negative'
                      : 'Neutral'}
                  </div>
                </div>

                {/* Trending Topics */}
                <div className="space-y-2 pt-2 border-t">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Trending Topics
                  </div>
                  {socialSentimentQuery.data?.trending?.slice(0, 3).map((topic: string, i: number) => (
                    <Badge 
                      key={i} 
                      variant="outline" 
                      className="text-xs mr-1 mb-1"
                      data-testid={`badge-trending-${i}`}
                    >
                      #{topic}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 4. News Feed Card */}
        <Card data-testid="card-news-feed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <Newspaper className="h-4 w-4" />
                Market News
              </div>
              <select
                value={newsCategory}
                onChange={(e) => setNewsCategory(e.target.value as any)}
                className="text-xs bg-background border border-border rounded px-2 py-1"
                data-testid="select-news-category"
              >
                <option value="all">All</option>
                <option value="economic">Economic</option>
                <option value="crypto">Crypto</option>
              </select>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {newsQuery.isLoading ? (
              <div className="text-center py-8 text-sm text-muted-foreground" data-testid="status-news-loading">
                Loading news...
              </div>
            ) : newsQuery.error ? (
              <div className="text-center py-8" data-testid="status-news-error">
                <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <div className="text-xs text-muted-foreground">
                  News feed unavailable
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Configure NEWS_API_KEY to enable
                </div>
              </div>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {newsQuery.data?.articles?.slice(0, 5).map((article, i) => (
                  <a
                    key={i}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 rounded-md border border-border hover-elevate active-elevate-2 transition-all"
                    data-testid={`news-article-${i}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium line-clamp-2 mb-1">
                          {article.title}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1 mb-1">
                          {article.description}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{article.source.name}</span>
                          <span>•</span>
                          <span>{format(new Date(article.publishedAt), 'MMM d, h:mm a')}</span>
                        </div>
                      </div>
                      <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
