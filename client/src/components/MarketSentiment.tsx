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

interface MarketSentimentData {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  combinedScore: number;
  orderBook: {
    bidDepth: string;
    askDepth: string;
    bidRatio: string;
    pressure: 'bullish' | 'bearish' | 'neutral';
    symbolsAnalyzed: number;
    distribution: {
      bullish: number;
      bearish: number;
      neutral: number;
    };
  };
  liquidations: {
    totalValue: string;
    longValue: string;
    shortValue: string;
    longRatio: string;
    count: number;
    longCount: number;
    shortCount: number;
  };
  topSymbols: string[];
  timestamp: string;
}

export default function MarketSentiment() {
  const [newsCategory, setNewsCategory] = useState<'all' | 'economic' | 'crypto' | 'political'>('all');

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

  // Fetch comprehensive market sentiment (order book + liquidations)
  const marketSentimentQuery = useQuery<MarketSentimentData>({
    queryKey: ['/api/sentiment/market'],
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

  // Extract market sentiment data
  const marketData = marketSentimentQuery.data;

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
        {/* 1. Market Metrics Card - Order Book + Liquidation Analysis */}
        <Card data-testid="card-market-metrics">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Market Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {marketSentimentQuery.isLoading ? (
              <div className="text-center py-8 text-sm text-muted-foreground" data-testid="status-market-loading">
                Analyzing markets...
              </div>
            ) : marketSentimentQuery.error || !marketData ? (
              <div className="text-center py-8" data-testid="status-market-error">
                <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <div className="text-xs text-muted-foreground">
                  Market data unavailable
                </div>
              </div>
            ) : (
              <>
                {/* Combined Sentiment Indicator */}
                <div className="text-center">
                  <div className={`text-4xl font-mono font-bold ${
                    marketData.sentiment === 'bullish' 
                      ? 'text-[rgb(190,242,100)]' 
                      : marketData.sentiment === 'bearish'
                      ? 'text-[rgb(251,146,60)]'
                      : 'text-muted-foreground'
                  }`} data-testid="icon-market-sentiment">
                    {marketData.sentiment === 'bullish' && <TrendingUp className="h-10 w-10 mx-auto" />}
                    {marketData.sentiment === 'bearish' && <TrendingDown className="h-10 w-10 mx-auto" />}
                    {marketData.sentiment === 'neutral' && <Minus className="h-10 w-10 mx-auto" />}
                  </div>
                  <div className="text-sm font-medium mt-2 capitalize" data-testid="text-market-sentiment">
                    {marketData.sentiment}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Score: {(marketData.combinedScore * 100).toFixed(0)}%
                  </div>
                </div>

                {/* Order Book Analysis */}
                <div className="space-y-2 pt-2 border-t">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Order Book Pressure</div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Bid Depth</span>
                    <span className="font-mono text-[rgb(190,242,100)]" data-testid="value-bid-depth">
                      {formatCurrency(parseFloat(marketData.orderBook.bidDepth))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Ask Depth</span>
                    <span className="font-mono text-[rgb(251,146,60)]" data-testid="value-ask-depth">
                      {formatCurrency(parseFloat(marketData.orderBook.askDepth))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Pressure</span>
                    <Badge 
                      variant={marketData.orderBook.pressure === 'bullish' ? 'default' : 'outline'} 
                      className="text-xs"
                      data-testid="badge-orderbook-pressure"
                    >
                      {marketData.orderBook.pressure}
                    </Badge>
                  </div>
                </div>

                {/* Liquidation Stats */}
                <div className="space-y-2 pt-2 border-t">
                  <div className="text-xs font-medium text-muted-foreground mb-2">Liquidations (1h)</div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[rgb(251,146,60)]">Long Liqs</span>
                    <span className="font-mono" data-testid="value-liq-long">
                      {formatCurrency(parseFloat(marketData.liquidations.longValue))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[rgb(190,242,100)]">Short Liqs</span>
                    <span className="font-mono" data-testid="value-liq-short">
                      {formatCurrency(parseFloat(marketData.liquidations.shortValue))}
                    </span>
                  </div>
                </div>
              </>
            )}
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
                <option value="economic">Market</option>
                <option value="crypto">Crypto</option>
                <option value="political">Political</option>
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
                  Configure API keys to enable:<br />
                  ALPHA_VANTAGE_API_KEY (market)<br />
                  CRYPTO_NEWS_API_KEY (crypto)<br />
                  TRUTH_SOCIAL_API_KEY (political)
                </div>
              </div>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {newsQuery.data?.articles?.slice(0, 10).map((article: any, i: number) => {
                  const sourceTypeColor = 
                    article.sourceType === 'market' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                    article.sourceType === 'crypto' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' :
                    article.sourceType === 'political' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' :
                    'bg-muted text-muted-foreground';
                  
                  const sentimentColor = 
                    article.sentiment === 'bullish' || article.sentiment === 'positive' ? 'text-lime-500' :
                    article.sentiment === 'bearish' || article.sentiment === 'negative' ? 'text-orange-500' :
                    'text-muted-foreground';
                  
                  return (
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
                          {/* Title with source badge */}
                          <div className="flex items-start gap-2 mb-1">
                            <div className="text-xs font-medium line-clamp-2 flex-1">
                              {article.title}
                            </div>
                            <Badge 
                              variant="outline" 
                              className={`text-xs px-1.5 py-0 ${sourceTypeColor} flex-shrink-0`}
                              data-testid={`badge-source-${i}`}
                            >
                              {article.sourceType === 'market' ? '📊' : 
                               article.sourceType === 'crypto' ? '💰' : '🇺🇸'}
                            </Badge>
                          </div>
                          
                          <div className="text-xs text-muted-foreground line-clamp-1 mb-1">
                            {article.description}
                          </div>
                          
                          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                            <span>{article.source.name}</span>
                            <span>•</span>
                            <span>{format(new Date(article.publishedAt), 'MMM d, h:mm a')}</span>
                            
                            {/* Sentiment indicator */}
                            {article.sentiment && (
                              <>
                                <span>•</span>
                                <span className={`font-medium ${sentimentColor}`} data-testid={`sentiment-${i}`}>
                                  {article.sentiment === 'bullish' || article.sentiment === 'positive' ? '↗ Bullish' :
                                   article.sentiment === 'bearish' || article.sentiment === 'negative' ? '↘ Bearish' :
                                   '→ Neutral'}
                                </span>
                              </>
                            )}
                            
                            {/* Engagement for political posts */}
                            {article.engagement && (
                              <>
                                <span>•</span>
                                <span data-testid={`engagement-${i}`}>
                                  👍 {article.engagement.likes.toLocaleString()}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
