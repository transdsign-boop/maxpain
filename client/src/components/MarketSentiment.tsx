import { useState, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Newspaper,
  TrendingUpIcon,
  AlertTriangle,
  Minus,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatPST } from "@/lib/utils";

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
  sourceType?: 'market' | 'crypto' | 'political';
  sentiment?: 'bullish' | 'bearish' | 'neutral' | 'positive' | 'negative';
  engagement?: { likes: number };
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

// Helper functions
const formatCurrency = (value: number) => {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
};

const getFearGreedColor = (value: number | null) => {
  if (value === null) return 'text-muted-foreground';
  if (value < 25) return 'text-orange-500';
  if (value < 45) return 'text-yellow-500';
  if (value < 55) return 'text-muted-foreground';
  if (value < 75) return 'text-lime-400';
  return 'text-lime-500';
};

const getFearGreedLabel = (value: number | null) => {
  if (value === null) return 'Loading...';
  if (value < 25) return 'Extreme Fear';
  if (value < 45) return 'Fear';
  if (value < 55) return 'Neutral';
  if (value < 75) return 'Greed';
  return 'Extreme Greed';
};

// Market Sentiment Metric Component
const MarketMetric = memo(({ data, isLoading, error, showDetails }: {
  data?: MarketSentimentData;
  isLoading: boolean;
  error: Error | null;
  showDetails: boolean;
}) => {
  if (isLoading) {
    return (
      <div className="text-center py-2 text-xs text-muted-foreground" data-testid="status-market-loading">
        Analyzing...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-2" data-testid="status-market-error">
        <AlertTriangle className="h-4 w-4 mx-auto text-muted-foreground mb-0.5" />
        <div className="text-xs text-muted-foreground">Data unavailable</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Sentiment Indicator */}
      <div className="text-center">
        <div className={`text-2xl font-mono font-bold ${
          data.sentiment === 'bullish'
            ? 'text-[rgb(190,242,100)]'
            : data.sentiment === 'bearish'
            ? 'text-[rgb(251,146,60)]'
            : 'text-muted-foreground'
        }`} data-testid="icon-market-sentiment">
          {data.sentiment === 'bullish' && <TrendingUp className="h-6 w-6 mx-auto" />}
          {data.sentiment === 'bearish' && <TrendingDown className="h-6 w-6 mx-auto" />}
          {data.sentiment === 'neutral' && <Minus className="h-6 w-6 mx-auto" />}
        </div>
        <div className="text-xs font-medium mt-0.5 capitalize" data-testid="text-market-sentiment">
          {data.sentiment}
        </div>
        <div className="text-xs text-muted-foreground">
          {(data.combinedScore * 100).toFixed(0)}%
        </div>
      </div>

      {showDetails && (
        <>
          {/* Order Book */}
          <div className="space-y-0.5 pt-1.5 border-t">
            <div className="text-xs font-medium text-muted-foreground">Order Book</div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Bid</span>
              <span className="font-mono text-[rgb(190,242,100)]" data-testid="value-bid-depth">
                {formatCurrency(parseFloat(data.orderBook.bidDepth))}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Ask</span>
              <span className="font-mono text-[rgb(251,146,60)]" data-testid="value-ask-depth">
                {formatCurrency(parseFloat(data.orderBook.askDepth))}
              </span>
            </div>
          </div>

          {/* Liquidations */}
          <div className="space-y-0.5 pt-1.5 border-t">
            <div className="text-xs font-medium text-muted-foreground">Liquidations (1h)</div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[rgb(251,146,60)]">Long</span>
              <span className="font-mono" data-testid="value-liq-long">
                {formatCurrency(parseFloat(data.liquidations.longValue))}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[rgb(190,242,100)]">Short</span>
              <span className="font-mono" data-testid="value-liq-short">
                {formatCurrency(parseFloat(data.liquidations.shortValue))}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// Fear & Greed Metric Component
const FearGreedMetric = memo(({ data, isLoading, error, showDetails }: {
  data?: { data: FearGreedData[] };
  isLoading: boolean;
  error: Error | null;
  showDetails: boolean;
}) => {
  const fearGreedData = data?.data?.[0];
  const fearGreedValue = fearGreedData ? parseInt(fearGreedData.value) : null;

  if (isLoading) {
    return (
      <div className="text-center py-2 text-xs text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-center">
        <div
          className={`text-3xl font-mono font-bold ${getFearGreedColor(fearGreedValue)}`}
          data-testid="value-fear-greed"
        >
          {fearGreedValue ?? '--'}
        </div>
        <div className="text-xs font-medium mt-0.5" data-testid="text-fear-greed-label">
          {getFearGreedLabel(fearGreedValue)}
        </div>
      </div>

      {showDetails && (
        <>
          {/* Gauge Bar */}
          <div className="space-y-0.5">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
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
              <span>Fear</span>
              <span>Greed</span>
            </div>
          </div>

          {fearGreedData && (
            <div className="text-xs text-muted-foreground text-center pt-1.5 border-t">
              {formatPST(parseInt(fearGreedData.timestamp) * 1000, 'MMM d, h:mm a')}
            </div>
          )}
        </>
      )}
    </div>
  );
});

// Social Sentiment Metric Component
const SocialMetric = memo(({ data, isLoading, error, showDetails }: {
  data?: any;
  isLoading: boolean;
  error: Error | null;
  showDetails: boolean;
}) => {
  if (isLoading) {
    return (
      <div className="text-center py-2 text-xs text-muted-foreground" data-testid="status-social-loading">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-2" data-testid="status-social-error">
        <AlertTriangle className="h-4 w-4 mx-auto text-muted-foreground mb-0.5" />
        <div className="text-xs text-muted-foreground">Data unavailable</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-center">
        <div
          className={`text-3xl font-mono font-bold ${
            (data?.score || 0) > 60
              ? 'text-[rgb(190,242,100)]'
              : (data?.score || 0) < 40
              ? 'text-[rgb(251,146,60)]'
              : 'text-muted-foreground'
          }`}
          data-testid="value-social-score"
        >
          {data?.score || '--'}
        </div>
        <div className="text-xs font-medium mt-0.5" data-testid="text-social-label">
          {(data?.score || 0) > 60
            ? 'Positive'
            : (data?.score || 0) < 40
            ? 'Negative'
            : 'Neutral'}
        </div>
      </div>

      {showDetails && (
        <>
          {/* Trending Topics */}
          <div className="space-y-0.5 pt-1.5 border-t">
            <div className="text-xs font-medium text-muted-foreground">
              Trending
            </div>
            <div className="flex flex-wrap gap-1">
              {data?.trending?.slice(0, 3).map((topic: string, i: number) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-xs"
                  data-testid={`badge-trending-${i}`}
                >
                  #{topic}
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// News Ticker Component with CSS Marquee
const NewsTicker = memo(({ articles, category, onCategoryChange }: { 
  articles: NewsArticle[]; 
  category: string;
  onCategoryChange: (value: string) => void;
}) => {
  const tickerArticles = articles.slice(0, 20); // Limit for performance
  
  // Duplicate articles for seamless loop
  const duplicatedArticles = [...tickerArticles, ...tickerArticles];

  return (
    <div className="border-t bg-muted/30">
      {/* Ticker Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <div className="flex items-center gap-1.5">
          <Newspaper className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Market News
          </span>
        </div>
        <ToggleGroup 
          type="single" 
          value={category} 
          onValueChange={(value) => value && onCategoryChange(value)}
          className="gap-0.5"
        >
          <ToggleGroupItem value="all" className="h-5 px-2 text-xs" data-testid="toggle-news-all">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="economic" className="h-5 px-2 text-xs" data-testid="toggle-news-market">
            Market
          </ToggleGroupItem>
          <ToggleGroupItem value="crypto" className="h-5 px-2 text-xs" data-testid="toggle-news-crypto">
            Crypto
          </ToggleGroupItem>
          <ToggleGroupItem value="political" className="h-5 px-2 text-xs" data-testid="toggle-news-political">
            Political
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Scrolling Ticker */}
      <div className="relative overflow-hidden h-8">
        <div className="ticker-wrapper absolute inset-0 flex items-center">
          <div className="ticker-content flex gap-8 whitespace-nowrap">
            {duplicatedArticles.map((article, i) => {
              const sourceIcon = 
                article.sourceType === 'market' ? '📊' :
                article.sourceType === 'crypto' ? '💰' : 
                article.sourceType === 'political' ? '🇺🇸' : '📰';
              
              const sentimentIcon = 
                article.sentiment === 'bullish' || article.sentiment === 'positive' ? '↗' :
                article.sentiment === 'bearish' || article.sentiment === 'negative' ? '↘' :
                article.sentiment ? '→' : '';

              return (
                <a
                  key={`${article.url}-${i}`}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-xs hover:text-primary transition-colors"
                  data-testid={`ticker-article-${i % tickerArticles.length}`}
                >
                  <span className="opacity-60">{sourceIcon}</span>
                  <span className="font-medium">{article.title}</span>
                  {sentimentIcon && (
                    <span className={
                      article.sentiment === 'bullish' || article.sentiment === 'positive' 
                        ? 'text-lime-500' 
                        : article.sentiment === 'bearish' || article.sentiment === 'negative'
                        ? 'text-orange-500'
                        : 'text-muted-foreground'
                    }>
                      {sentimentIcon}
                    </span>
                  )}
                  <span className="opacity-40">•</span>
                </a>
              );
            })}
          </div>
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        .ticker-wrapper {
          mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
          -webkit-mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
        }
        
        .ticker-content {
          animation: ticker 60s linear infinite;
          will-change: transform;
        }
        
        .ticker-content:hover {
          animation-play-state: paused;
        }
        
        @keyframes ticker {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
});

export default function MarketSentiment() {
  const [newsCategory, setNewsCategory] = useState<'all' | 'economic' | 'crypto' | 'political'>('all');
  const [showDetails, setShowDetails] = useState(false);

  // Fetch Fear & Greed Index
  const fearGreedQuery = useQuery<{ data: FearGreedData[] }>({
    queryKey: ['/api/sentiment/fear-greed'],
    queryFn: async () => {
      const response = await fetch('https://api.alternative.me/fng/?limit=1');
      if (!response.ok) throw new Error('Failed to fetch Fear & Greed Index');
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // Fetch market sentiment
  const marketSentimentQuery = useQuery<MarketSentimentData>({
    queryKey: ['/api/sentiment/market'],
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });

  // Fetch news
  const newsQuery = useQuery<{ articles: NewsArticle[] }>({
    queryKey: ['/api/sentiment/news', newsCategory],
    queryFn: async () => {
      const response = await fetch(`/api/sentiment/news?category=${newsCategory}`);
      if (!response.ok) throw new Error('Failed to fetch news');
      return response.json();
    },
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });

  // Fetch social sentiment
  const socialSentimentQuery = useQuery<any>({
    queryKey: ['/api/sentiment/social'],
    queryFn: async () => {
      const response = await fetch('/api/sentiment/social');
      if (!response.ok) throw new Error('Failed to fetch social sentiment');
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Market Sentiment</h2>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs" data-testid="badge-live-data">
            Live Data
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
            className="gap-1"
          >
            {showDetails ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Hide Details
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                Show Details
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Consolidated Card */}
      <Card data-testid="card-market-sentiment">
        <CardHeader className="pb-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Market Sentiment Column */}
            <div>
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Activity className="h-3.5 w-3.5" />
                Market Sentiment
              </CardTitle>
              <MarketMetric
                data={marketSentimentQuery.data}
                isLoading={marketSentimentQuery.isLoading}
                error={marketSentimentQuery.error}
                showDetails={showDetails}
              />
            </div>

            {/* Fear & Greed Column */}
            <div className="md:border-l md:pl-3">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <TrendingUpIcon className="h-3.5 w-3.5" />
                Fear & Greed
              </CardTitle>
              <FearGreedMetric
                data={fearGreedQuery.data}
                isLoading={fearGreedQuery.isLoading}
                error={fearGreedQuery.error}
                showDetails={showDetails}
              />
            </div>

            {/* Social Sentiment Column */}
            <div className="md:border-l md:pl-3">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Activity className="h-3.5 w-3.5" />
                Social Sentiment
              </CardTitle>
              <SocialMetric
                data={socialSentimentQuery.data}
                isLoading={socialSentimentQuery.isLoading}
                error={socialSentimentQuery.error}
                showDetails={showDetails}
              />
            </div>
          </div>
        </CardHeader>

        {/* News Ticker at Bottom - only show when details are expanded */}
        {showDetails && (
          newsQuery.data?.articles && newsQuery.data.articles.length > 0 ? (
            <NewsTicker
              articles={newsQuery.data.articles}
              category={newsCategory}
              onCategoryChange={(value) => setNewsCategory(value as any)}
            />
          ) : newsQuery.isLoading ? (
            <div className="border-t py-2 text-center text-xs text-muted-foreground" data-testid="status-news-loading">
              Loading news...
            </div>
          ) : (
            <div className="border-t py-2 text-center" data-testid="status-news-error">
              <AlertTriangle className="h-4 w-4 mx-auto text-muted-foreground mb-0.5" />
              <div className="text-xs text-muted-foreground">
                News feed unavailable
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Configure API keys: ALPHA_VANTAGE_API_KEY, CRYPTO_NEWS_API_KEY, TRUTH_SOCIAL_API_KEY
              </div>
            </div>
          )
        )}
      </Card>
    </div>
  );
}
