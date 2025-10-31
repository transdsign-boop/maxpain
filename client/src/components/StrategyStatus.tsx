import React, { useState, useMemo, useRef, useEffect, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, DollarSign, Target, Layers, X, ChevronDown, ChevronUp, CheckCircle2, RefreshCw } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { soundNotifications } from "@/lib/soundNotifications";
import { useStrategyData } from "@/hooks/use-strategy-data";
import { useLiquidityStatus } from "@/hooks/use-liquidity-status";
import { formatPST, formatDateTimePST, formatTimePST, formatTimeSecondsPST } from "@/lib/utils";

interface Fill {
  id: string;
  orderId: string;
  sessionId: string;
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  value: string;
  layerNumber: number;
  filledAt: Date;
  fee?: string;
  source?: 'bot' | 'manual' | 'sync'; // Source of the fill
}

interface Position {
  id: string;
  sessionId: string;
  symbol: string;
  side: "long" | "short";
  totalQuantity: string;
  avgEntryPrice: string;
  totalCost: string;
  unrealizedPnl: string;
  realizedPnl: string;
  layersFilled: number;
  maxLayers: number;
  lastLayerPrice: string | null;
  isOpen: boolean;
  openedAt: Date;
  closedAt?: Date | null;
  updatedAt: Date;
  totalFees?: string; // Total fees paid for this position (entry + exit)
  liquidationPrice?: string; // Real liquidation price from exchange
}

interface PositionSummary {
  sessionId: string;
  startingBalance: number;
  currentBalance: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalExposure: number;
  activePositions: number;
  totalTrades: number;
  winRate: number;
  positions: Position[];
}

interface StrategyStatusProps {}

interface PositionCardProps{
  position: Position;
  strategy: any;
  onClose: () => void;
  isClosing: boolean;
  formatCurrency: (value: number) => string;
  formatPercentage: (value: number) => string;
  getPnlColor: (pnl: number) => string;
  isHedge?: boolean;
  actualTpPrice?: number | null;
  actualSlPrice?: number | null;
  liquidityStatus?: {
    status: 'excellent' | 'acceptable' | 'watch' | 'critical';
    color: string;
    ratio: number;
    tooltip: string;
  };
}

interface CompletedTradeCardProps {
  position: Position;
  formatCurrency: (value: number) => string;
  formatPercentage: (value: number) => string;
  getPnlColor: (pnl: number) => string;
  isHedge?: boolean;
}

interface RealizedPnlEventCardProps {
  event: {
    symbol: string;
    income: string;
    time: number;
    tradeId: string;
  };
  formatCurrency: (value: number) => string;
  getPnlColor: (pnl: number) => string;
}

interface AllTradesViewProps {
  formatCurrency: (value: number) => string;
  formatPercentage: (value: number) => string;
  getPnlColor: (pnl: number) => string;
}

interface Trade {
  tradeNumber: number;
  timestamp: number;
  date: string;
  symbol: string;
  pnl: number;
  asset: string;
  tradeId: string;
  hasDetails: boolean;
  positionId?: string;
  side?: string;
  quantity?: string;
  entryPrice?: string;
  openedAt?: Date;
  layersFilled?: number;
}

interface AssetPerformance {
  symbol: string;
  totalPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
}

// All Trades View - shows all trades from exchange with database details when available
function AllTradesView({ formatCurrency, formatPercentage, getPnlColor }: AllTradesViewProps) {
  const { data: allTradesData, isLoading } = useQuery<{ 
    trades: Trade[];
    total: number;
    withDetails: number;
    withoutDetails: number;
  }>({
    queryKey: ['/api/all-trades', 'oct10-cutoff'],
    queryFn: async () => {
      const response = await fetch('/api/all-trades?_=' + Date.now());
      if (!response.ok) throw new Error('Failed to fetch trades');
      return response.json();
    },
    staleTime: 0, // Always fetch fresh data
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!allTradesData || allTradesData.trades.length === 0) {
    return (
      <div className="text-center py-6">
        <CheckCircle2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground">No completed trades yet</p>
      </div>
    );
  }

  const { trades, total, withDetails, withoutDetails } = allTradesData;

  return (
    <div>
      <div className="mb-3 p-3 rounded-lg bg-muted/30 border">
        <p className="text-sm font-medium mb-1">All Exchange Trades</p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Total: <strong className="text-foreground">{total}</strong></span>
          <span>With details: <strong className="text-foreground">{withDetails}</strong></span>
          <span>P&L only: <strong className="text-foreground">{withoutDetails}</strong></span>
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar">
        {trades.map((trade) => (
          <Card key={`${trade.tradeId}-${trade.timestamp}`} className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{trade.symbol}</span>
                {trade.hasDetails && trade.side && (
                  <Badge className={trade.side === 'long' ? 'bg-lime-500/15 text-lime-300 border-lime-400/30' : 'bg-red-600/15 text-red-400 border-red-500/30'}>
                    {trade.side.toUpperCase()}
                  </Badge>
                )}
                {!trade.hasDetails && (
                  <Badge variant="outline" className="text-xs">
                    Exchange only
                  </Badge>
                )}
              </div>
              <div className={`text-lg font-mono font-bold ${getPnlColor(trade.pnl)}`}>
                {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date:</span>
                <span className="font-mono">{formatPST(trade.timestamp, 'MMM dd, h:mm a')} PST</span>
              </div>
              
              {trade.hasDetails && trade.quantity && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Qty:</span>
                  <span className="font-mono">{parseFloat(trade.quantity).toFixed(4)}</span>
                </div>
              )}
              
              {trade.hasDetails && trade.entryPrice && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Entry:</span>
                  <span className="font-mono">{formatCurrency(parseFloat(trade.entryPrice))}</span>
                </div>
              )}
              
              {trade.hasDetails && trade.layersFilled && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Layers:</span>
                  <span className="font-mono">{trade.layersFilled}</span>
                </div>
              )}

              {!trade.hasDetails && (
                <div className="col-span-2 text-center text-muted-foreground italic">
                  Position record not found in database
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Helper function to render fill source badge
function FillSourceBadge({ source }: { source?: 'bot' | 'manual' | 'sync' }) {
  if (!source || source === 'bot') return null; // Don't show badge for bot trades (default)

  const badgeStyles: Record<'manual' | 'sync', string> = {
    manual: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    sync: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  };

  const badgeLabels: Record<'manual' | 'sync', string> = {
    manual: 'Manual',
    sync: 'Synced',
  };

  return (
    <Badge
      variant="outline"
      className={`text-[10px] h-4 px-1 ${badgeStyles[source]}`}
    >
      {badgeLabels[source]}
    </Badge>
  );
}

// Expandable completed trade from chart data (with optional position details)
interface ExpandableCompletedTradeProps {
  trade: any; // Chart data point
  position?: any; // Matched database position (optional)
  formatCurrency: (value: number) => string;
  formatPercentage: (value: number) => string;
  getPnlColor: (pnl: number) => string;
}

function ExpandableCompletedTrade({ trade, position, formatCurrency, formatPercentage, getPnlColor }: ExpandableCompletedTradeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: fills } = useQuery<Fill[]>({
    queryKey: ['/api/positions', position?.id, 'fills'],
    enabled: isExpanded && !!position?.id,
  });

  const hasLayers = trade.layersFilled > 1;
  const canExpand = position && hasLayers;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="rounded-lg border bg-card hover-elevate">
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {canExpand && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
              )}
              <span className="font-semibold">{trade.symbol}</span>
              <Badge className={trade.pnl >= 0 ? 'bg-lime-500/15 text-lime-300 border-lime-400/30' : 'bg-red-600/15 text-red-400 border-red-500/30'}>
                {trade.side?.toUpperCase() || (trade.pnl >= 0 ? 'LONG' : 'SHORT')}
              </Badge>
              {hasLayers && (
                <Badge variant="outline" className="text-xs">
                  {trade.layersFilled} layers
                </Badge>
              )}
            </div>
            <div className={`text-lg font-mono font-bold ${getPnlColor(trade.pnl)}`}>
              {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date:</span>
              <span className="font-mono">{formatPST(trade.timestamp, 'MMM dd, h:mm a')} PST</span>
            </div>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Trade #:</span>
              <span className="font-mono">{trade.tradeNumber}</span>
            </div>

            {trade.commission !== undefined && trade.commission > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fees:</span>
                <span className="font-mono text-red-400">-${trade.commission.toFixed(2)}</span>
              </div>
            )}

            <div className="flex justify-between">
              <span className="text-muted-foreground">Cumulative:</span>
              <span className={`font-mono ${getPnlColor(trade.cumulativePnl)}`}>
                ${trade.cumulativePnl.toFixed(2)}
              </span>
            </div>

            {position && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Qty:</span>
                  <span className="font-mono">{parseFloat(position.totalQuantity).toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Entry:</span>
                  <span className="font-mono">{formatCurrency(parseFloat(position.avgEntryPrice))}</span>
                </div>
              </>
            )}
          </div>

          {!canExpand && !position && (
            <div className="mt-2 text-xs text-muted-foreground italic text-center">
              Position details not available in database
            </div>
          )}

          <CollapsibleContent>
            {fills && fills.length > 0 && (
              <div className="mt-3 pt-3 border-t space-y-2">
                <div className="text-xs font-semibold text-muted-foreground mb-2">DCA Layers</div>
                {fills
                  .filter(f => f.layerNumber > 0)
                  .sort((a, b) => a.layerNumber - b.layerNumber)
                  .map((fill) => (
                    <div key={fill.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          Layer {fill.layerNumber}
                        </Badge>
                        <span className="font-mono">{parseFloat(fill.quantity).toFixed(4)}</span>
                        <span className="text-muted-foreground">@</span>
                        <span className="font-mono">{formatCurrency(parseFloat(fill.price))}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>Fee: {formatCurrency(parseFloat(fill.fee || '0'))}</span>
                        <span className="text-xs">{formatTimeSecondsPST(fill.filledAt)}</span>
                      </div>
                    </div>
                  ))}

                {fills.filter(f => f.layerNumber === 0).length > 0 && (
                  <>
                    <div className="text-xs font-semibold text-muted-foreground mt-3 mb-2">Exit</div>
                    {fills
                      .filter(f => f.layerNumber === 0)
                      .map((fill) => (
                        <div key={fill.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">Exit</Badge>
                            <span className="font-mono">{parseFloat(fill.quantity).toFixed(4)}</span>
                            <span className="text-muted-foreground">@</span>
                            <span className="font-mono">{formatCurrency(parseFloat(fill.price))}</span>
                          </div>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>Fee: {formatCurrency(parseFloat(fill.fee || '0'))}</span>
                            <span className="text-xs">{formatTimeSecondsPST(fill.filledAt)}</span>
                          </div>
                        </div>
                      ))}
                  </>
                )}
              </div>
            )}
          </CollapsibleContent>
        </div>
      </div>
    </Collapsible>
  );
}

// Completed trade card with expandable layer details
function CompletedTradeCard({ position, formatCurrency, formatPercentage, getPnlColor, isHedge }: CompletedTradeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [fillSourceFilter, setFillSourceFilter] = useState<'all' | 'bot' | 'manual' | 'sync'>('all');

  const { data: fills } = useQuery<Fill[]>({
    queryKey: ['/api/positions', position.id, 'fills'],
    enabled: isExpanded,
  });

  // CRITICAL: realizedPnl is stored as DOLLAR AMOUNT (not percentage) in the database!
  // unrealizedPnl field contains the PERCENTAGE at close time
  const realizedPnlPercent = parseFloat(position.unrealizedPnl); // This is the percentage
  const realizedPnlDollar = parseFloat(position.realizedPnl || '0'); // This is ALREADY in dollars!
  const avgEntry = parseFloat(position.avgEntryPrice);

  // Filter fills by source
  const filteredFills = fills?.filter(f => {
    if (fillSourceFilter === 'all') return true;
    return f.source === fillSourceFilter || (!f.source && fillSourceFilter === 'bot'); // Treat missing source as 'bot'
  }) || [];

  // Separate entry and exit fills/fees
  const entryFills = filteredFills.filter(f => f.layerNumber > 0);
  const exitFills = filteredFills.filter(f => f.layerNumber === 0);
  const entryFees = entryFills.reduce((sum, f) => sum + parseFloat(f.fee || '0'), 0);
  const exitFees = exitFills.reduce((sum, f) => sum + parseFloat(f.fee || '0'), 0);
  const totalFees = entryFees + exitFees;
  
  // Use actual entry fills count if we have fills data, otherwise fall back to database value
  const actualLayersFilled = fills && entryFills.length > 0 ? entryFills.length : position.layersFilled;
  
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="rounded-lg border bg-card hover-elevate" data-testid={`completed-trade-${position.id}`}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" data-testid="button-toggle-trade-details">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <span className="font-semibold text-sm">{position.symbol}</span>
              <Badge 
                className={`text-xs ${position.side === 'long' ? 'bg-lime-600 text-white' : 'bg-red-700 text-white'}`}
              >
                {position.side.toUpperCase()}
              </Badge>
              {isHedge && (
                <Badge variant="secondary" className="text-xs">
                  HEDGE
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {actualLayersFilled}/{position.maxLayers} layers
              </Badge>
            </div>
            <div className={`text-sm font-semibold ${getPnlColor(realizedPnlDollar)}`}>
              {realizedPnlDollar >= 0 ? '+' : ''}{formatCurrency(realizedPnlDollar)}
              <span className="text-xs ml-1">
                ({realizedPnlPercent >= 0 ? '+' : ''}{formatPercentage(realizedPnlPercent)})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>
              Quantity: <span className="text-foreground">{parseFloat(position.totalQuantity).toFixed(4)}</span>
            </div>
            <div>
              Avg Entry: <span className="text-foreground">{formatCurrency(avgEntry)}</span>
            </div>
            <div>
              Opened: <span className="text-foreground">{formatDateTimePST(position.openedAt)}</span>
            </div>
            <div>
              Closed: <span className="text-foreground">{position.closedAt ? formatDateTimePST(position.closedAt) : 'N/A'}</span>
            </div>
            {fills && (
              <>
                <div>
                  Entry Fees: <span className="text-foreground">{formatCurrency(entryFees)}</span>
                </div>
                <div>
                  Exit Fees: <span className="text-foreground">{formatCurrency(exitFees)}</span>
                </div>
              </>
            )}
            {!fills && (
              <div className="col-span-2">
                Total Fees: <span className="text-foreground">{formatCurrency(parseFloat(position.totalFees || '0'))}</span>
                {parseFloat(position.totalFees || '0') > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">(0.035% taker)</span>
                )}
              </div>
            )}
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">Layer Details</p>
              {fills && fills.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">Filter:</label>
                  <select
                    value={fillSourceFilter}
                    onChange={(e) => setFillSourceFilter(e.target.value as 'all' | 'bot' | 'manual' | 'sync')}
                    className="text-xs bg-background border border-input rounded px-2 py-1 cursor-pointer"
                  >
                    <option value="all">All Fills</option>
                    <option value="bot">Bot Only</option>
                    <option value="manual">Manual Only</option>
                    <option value="sync">Synced Only</option>
                  </select>
                </div>
              )}
            </div>
            {fills && fills.length > 0 ? (
              <div className="space-y-2">
                {entryFills.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground/70 mb-1">Entry Layers ({entryFills.length})</p>
                    <div className="space-y-1">
                      {entryFills.sort((a, b) => a.layerNumber - b.layerNumber).map((fill) => (
                        <div key={fill.id} className="text-xs py-1 px-2 rounded bg-muted/30 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs h-5">L{fill.layerNumber}</Badge>
                              <FillSourceBadge source={fill.source} />
                              <span className="text-foreground">
                                {parseFloat(fill.quantity).toFixed(4)} @ {formatCurrency(parseFloat(fill.price))}
                              </span>
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {formatCurrency(parseFloat(fill.fee || '0'))}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            {formatDateTimePST(fill.filledAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {exitFills.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground/70 mb-1">Exit</p>
                    <div className="space-y-1">
                      {exitFills.map((fill) => (
                        <div key={fill.id} className="text-xs py-1 px-2 rounded bg-muted/30 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs h-5">Exit</Badge>
                              <FillSourceBadge source={fill.source} />
                              <span className="text-foreground">
                                {parseFloat(fill.quantity).toFixed(4)} @ {formatCurrency(parseFloat(fill.price))}
                              </span>
                            </div>
                            <span className="text-muted-foreground text-xs">
                              {formatCurrency(parseFloat(fill.fee || '0'))}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            {formatDateTimePST(fill.filledAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No layer details available</p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// Simplified card for realized P&L events from exchange
function RealizedPnlEventCard({ event, formatCurrency, getPnlColor }: RealizedPnlEventCardProps) {
  const pnl = parseFloat(event.income);
  
  return (
    <div className="rounded-lg border bg-card hover-elevate p-4" data-testid={`pnl-event-${event.tradeId}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{event.symbol}</span>
          <Badge variant="outline" className="text-xs">
            Closed Trade
          </Badge>
        </div>
        <div className={`text-sm font-semibold ${getPnlColor(pnl)}`}>
          {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div>
          Closed: <span className="text-foreground">{formatDateTimePST(event.time)}</span>
        </div>
        <div>
          Trade ID: <span className="text-foreground font-mono text-xs">{event.tradeId}</span>
        </div>
      </div>
    </div>
  );
}

function PositionCard({ position, strategy, onClose, isClosing, formatCurrency, formatPercentage, getPnlColor, isHedge, actualTpPrice, actualSlPrice, liquidityStatus }: PositionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [fillSourceFilter, setFillSourceFilter] = useState<'all' | 'bot' | 'manual' | 'sync'>('all');
  const prevLayersRef = useRef(position.layersFilled);

  const { data: fills } = useQuery<Fill[]>({
    queryKey: ['/api/positions', position.id, 'fills'],
    enabled: isExpanded, // Only fetch when expanded
  });

  // Calculate actual layers from ALL entry fills (layerNumber > 0)
  const allEntryFills = (fills || []).filter(f => f.layerNumber > 0);
  const uniqueEntryLayers = new Set(allEntryFills.map(f => f.layerNumber));
  const actualLayersFilled = fills && uniqueEntryLayers.size > 0 ? uniqueEntryLayers.size : position.layersFilled;

  // Filter fills by source (for display only)
  const filteredFills = fills?.filter(f => {
    if (fillSourceFilter === 'all') return true;
    return f.source === fillSourceFilter || (!f.source && fillSourceFilter === 'bot');
  }) || [];

  const entryFills = filteredFills.filter(f => f.layerNumber > 0);
  const exitFills = filteredFills.filter(f => f.layerNumber === 0);

  // Flash effect when layers increase
  useEffect(() => {
    if (actualLayersFilled > prevLayersRef.current) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 600);
      prevLayersRef.current = actualLayersFilled;
      return () => clearTimeout(timer);
    }
    prevLayersRef.current = actualLayersFilled;
  }, [actualLayersFilled]);

  // Calculate all necessary values
  const unrealizedPnlPercent = parseFloat(position.unrealizedPnl);
  const totalCost = parseFloat(position.totalCost);
  const rawLeverage = Number((position as any).leverage) || Number(strategy?.leverage);
  const leverage = Number.isFinite(rawLeverage) && rawLeverage > 0 ? rawLeverage : 1;
  const notionalValue = totalCost * leverage;
  const unrealizedPnlDollar = (unrealizedPnlPercent / 100) * notionalValue;
  const avgEntry = parseFloat(position.avgEntryPrice);

  const currentPrice = position.side === 'long'
    ? avgEntry * (1 + unrealizedPnlPercent / 100)
    : avgEntry * (1 - unrealizedPnlPercent / 100);

  // Sanitize strategy values
  const rawSL = Number(strategy?.stopLossPercent);
  const sanitizedSL = Number.isFinite(rawSL) && rawSL > 0 ? rawSL : 2;
  const rawTP = Number(strategy?.profitTargetPercent);
  const sanitizedTP = Number.isFinite(rawTP) && rawTP > 0 ? rawTP : 1;

  // Calculate SL and TP prices - use actual protective orders when available (includes adaptive calculations)
  // Otherwise fall back to fixed strategy percentages
  const calculateRoundedPrice = (rawPrice: number) => {
    let tickSize: number;
    let decimals: number;

    if (rawPrice >= 1000) {
      tickSize = 0.1;
      decimals = 1;
    } else if (rawPrice >= 100) {
      tickSize = 0.01;
      decimals = 2;
    } else if (rawPrice >= 10) {
      tickSize = 0.001;
      decimals = 3;
    } else if (rawPrice >= 1) {
      tickSize = 0.0001;
      decimals = 4;
    } else {
      tickSize = 0.00001;
      decimals = 5;
    }

    const rounded = Math.floor(rawPrice / tickSize) * tickSize;
    return parseFloat(rounded.toFixed(decimals));
  };

  // Calculate fallback prices from fixed percentages
  const fallbackStopLossPrice = position.side === 'long'
    ? avgEntry * (1 - sanitizedSL / 100)
    : avgEntry * (1 + sanitizedSL / 100);

  const fallbackTakeProfitPrice = position.side === 'long'
    ? avgEntry * (1 + sanitizedTP / 100)
    : avgEntry * (1 - sanitizedTP / 100);

  // Use actual protective order prices if available (these include adaptive ATR calculations)
  const stopLossPrice = actualSlPrice || calculateRoundedPrice(fallbackStopLossPrice);
  const takeProfitPrice = actualTpPrice || calculateRoundedPrice(fallbackTakeProfitPrice);

  // Calculate percentages from the actual prices (this will be correct for both adaptive and fixed)
  const actualTpPercent = takeProfitPrice
    ? (position.side === 'long'
        ? ((takeProfitPrice - avgEntry) / avgEntry) * 100
        : ((avgEntry - takeProfitPrice) / avgEntry) * 100)
    : sanitizedTP;

  const actualSlPercent = stopLossPrice
    ? (position.side === 'long'
        ? ((avgEntry - stopLossPrice) / avgEntry) * 100
        : ((stopLossPrice - avgEntry) / avgEntry) * 100)
    : sanitizedSL;

  const isLong = position.side === 'long';

  // Calculate potential loss/profit
  const fullSlLoss = notionalValue * (actualSlPercent / 100);
  const fullTpProfit = notionalValue * (actualTpPercent / 100);

  // Calculate vertical bar position with SUBTLE TP weighting for better visibility
  const totalRange = actualTpPercent + actualSlPercent;
  const clampedPnl = Math.max(-actualSlPercent, Math.min(actualTpPercent, unrealizedPnlPercent));

  // Bar height allocation - HEAVILY weighted toward TP for maximum visibility (6x)
  // This makes TP zone dominate the visual space for easy profit tracking
  const totalBarHeight = 120; // pixels
  const tpWeight = 6.0; // Give TP 6x visual space for maximum visibility
  const weightedTpPercent = actualTpPercent * tpWeight;
  const weightedTotalRange = actualSlPercent + weightedTpPercent;
  const slZoneHeight = (actualSlPercent / weightedTotalRange) * totalBarHeight;
  const tpZoneHeight = (weightedTpPercent / weightedTotalRange) * totalBarHeight;

  // Position on the bar (0 = bottom, 100 = top) - apply same weighting to indicator
  let barPosition: number;
  if (isLong) {
    // Long: bottom = SL, middle = Entry, top = TP
    // Apply weighting when in TP zone (positive P&L)
    const visualPnl = clampedPnl >= 0 ? clampedPnl * tpWeight : clampedPnl;
    barPosition = weightedTotalRange > 0 ? ((visualPnl + actualSlPercent) / weightedTotalRange) * 100 : 50;
  } else {
    // Short: bottom = TP, middle = Entry, top = SL
    // For shorts, positive P&L = winning = toward bottom (TP zone)
    // Apply weighting when in TP zone (positive P&L for shorts too)
    const visualPnl = clampedPnl >= 0 ? clampedPnl * tpWeight : clampedPnl;
    barPosition = weightedTotalRange > 0 ? ((weightedTpPercent - visualPnl) / weightedTotalRange) * 100 : 50;
  }

  // Clamp bar position to ensure indicator is always visible (2% margin from edges)
  barPosition = Math.max(2, Math.min(98, barPosition));

  // Determine border animation based on P&L
  const getBorderClass = () => {
    if (unrealizedPnlPercent > 0) {
      return 'animate-profit-pulse border-2 border-[rgb(190,242,100)]';
    } else if (unrealizedPnlPercent < 0) {
      return 'border-2 border-[rgb(251,146,60)]/50';
    }
    return 'border';
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div
        className={`transition-all duration-300 ${isFlashing ? 'animate-layer-flash' : ''}`}
        data-testid={`position-${position.symbol}`}
      >
        {/* P&L Display - Outside the card */}
        <div className={`text-center mb-0.5 text-sm font-mono font-bold ${getPnlColor(unrealizedPnlDollar)}`}>
          {unrealizedPnlDollar >= 0 ? '+' : ''}${Math.abs(unrealizedPnlDollar).toFixed(2)}
        </div>

        {/* Ultra-Compact Vertical Layout */}
        <div className={`flex flex-col items-center gap-1 p-1 rounded bg-card hover:shadow-md transition-shadow w-[70px] ${getBorderClass()}`}>
          {/* Vertical Price Bar with proportional zones */}
          <div className="flex flex-col items-center gap-0.5 w-full">
            {/* Top label (TP for long, SL for short) */}
            <div className="text-xs font-mono text-center leading-tight w-full">
              <div className={`font-bold flex items-center justify-center gap-0.5 ${isLong ? 'text-lime-600 dark:text-lime-400' : 'text-red-600 dark:text-red-500'}`}>
                <span>{isLong ? 'TP' : 'SL'} {isLong ? `+${actualTpPercent.toFixed(1)}%` : `-${actualSlPercent.toFixed(1)}%`}</span>
                {isLong && strategy?.adaptiveTpEnabled && actualTpPercent >= parseFloat(String(strategy?.maxTpPercent || 5)) && (
                  <span className="text-[10px] opacity-60" title="Hitting max TP ceiling">⬆</span>
                )}
                {!isLong && strategy?.adaptiveSlEnabled && actualSlPercent >= parseFloat(String(strategy?.maxSlPercent || 5)) && (
                  <span className="text-[10px] opacity-60" title="Hitting max SL ceiling">⬆</span>
                )}
              </div>
              <div className={`text-[11px] ${isLong ? 'text-lime-600 dark:text-lime-400' : 'text-red-600 dark:text-red-500'}`}>
                {isLong ? `+$${fullTpProfit.toFixed(0)}` : `-$${fullSlLoss.toFixed(0)}`}
              </div>
            </div>

            {/* Vertical bar with proportional zones */}
            <div
              className="relative w-4 bg-muted overflow-hidden"
              style={{
                height: `${totalBarHeight}px`,
                borderRadius: '3px'
              }}
            >
              {/* Color zones with proportional heights */}
              {isLong ? (
                <>
                  {/* Long: bottom zone = SL (red), top zone = TP (green) */}
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-red-600/20"
                    style={{ height: `${slZoneHeight}px` }}
                  />
                  <div
                    className="absolute top-0 left-0 right-0 bg-lime-600/20"
                    style={{ height: `${tpZoneHeight}px` }}
                  />
                </>
              ) : (
                <>
                  {/* Short: bottom zone = TP (green), top zone = SL (red) */}
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-lime-600/20"
                    style={{ height: `${tpZoneHeight}px` }}
                  />
                  <div
                    className="absolute top-0 left-0 right-0 bg-red-600/20"
                    style={{ height: `${slZoneHeight}px` }}
                  />
                </>
              )}

              {/* Entry line (at the boundary between zones) */}
              <div
                className="absolute left-0 right-0 h-[2px] bg-foreground/50"
                style={{
                  bottom: isLong ? `${slZoneHeight}px` : `${tpZoneHeight}px`
                }}
              />

              {/* Current price indicator */}
              <div
                className="absolute left-0 right-0 h-[3px] transition-all duration-300"
                style={{
                  bottom: `${barPosition}%`,
                  backgroundColor: unrealizedPnlDollar >= 0 ? 'rgb(190, 242, 100)' : 'rgb(220, 38, 38)'
                }}
              >
                {/* Arrowhead pointing right */}
                <div
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full"
                  style={{
                    width: 0,
                    height: 0,
                    borderTop: '4px solid transparent',
                    borderBottom: '4px solid transparent',
                    borderLeft: `6px solid ${unrealizedPnlDollar >= 0 ? 'rgb(190, 242, 100)' : 'rgb(220, 38, 38)'}`,
                  }}
                />
              </div>
            </div>

            {/* Bottom label (SL for long, TP for short) */}
            <div className="text-xs font-mono text-center leading-tight w-full">
              <div className={`text-[11px] ${isLong ? 'text-red-600 dark:text-red-500' : 'text-lime-600 dark:text-lime-400'}`}>
                {isLong ? `-$${fullSlLoss.toFixed(0)}` : `+$${fullTpProfit.toFixed(0)}`}
              </div>
              <div className={`font-bold flex items-center justify-center gap-0.5 ${isLong ? 'text-red-600 dark:text-red-500' : 'text-lime-600 dark:text-lime-400'}`}>
                <span>{isLong ? 'SL' : 'TP'} {isLong ? `-${actualSlPercent.toFixed(1)}%` : `+${actualTpPercent.toFixed(1)}%`}</span>
                {isLong && strategy?.adaptiveSlEnabled && actualSlPercent >= parseFloat(String(strategy?.maxSlPercent || 5)) && (
                  <span className="text-[10px] opacity-60" title="Hitting max SL ceiling">⬆</span>
                )}
                {!isLong && strategy?.adaptiveTpEnabled && actualTpPercent >= parseFloat(String(strategy?.maxTpPercent || 5)) && (
                  <span className="text-[10px] opacity-60" title="Hitting max TP ceiling">⬆</span>
                )}
              </div>
            </div>

            {/* Symbol and size below the bar */}
            <div className="text-center mt-0.5 w-full">
              <div className="flex items-center justify-center gap-0.5 flex-wrap">
                <span className={`font-bold text-[13px] ${
                  isHedge
                    ? 'text-yellow-500 dark:text-yellow-400'
                    : isLong
                      ? 'text-lime-600 dark:text-lime-400'
                      : 'text-red-600 dark:text-red-500'
                }`}>
                  {position.symbol.replace('USDT', '')}
                </span>
                {isHedge && (
                  <Badge variant="secondary" className="text-[11px] h-3 px-0.5 leading-none">H</Badge>
                )}
                {liquidityStatus && (
                  <div
                    className={`w-1 h-1 rounded-full ${liquidityStatus.color}`}
                    title={liquidityStatus.tooltip}
                  />
                )}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground">
                ${notionalValue.toFixed(0)}
              </div>
            </div>
          </div>

          {/* Action buttons below the bar */}
          <div className="flex flex-col items-center gap-0.5 w-full border-t pt-1">
            {/* Action buttons */}
            <div className="flex flex-col gap-0.5 w-full">
              <button
                className="rounded flex items-center justify-center px-1 py-0.5 border border-destructive bg-transparent text-destructive text-[11px] font-semibold transition-all hover:bg-destructive hover:text-destructive-foreground active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed w-full"
                data-testid={`button-close-position-${position.symbol}`}
                onClick={onClose}
                disabled={isClosing}
              >
                Close
              </button>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-5 w-full px-0.5 text-[11px]" data-testid="button-toggle-layers">
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </div>

        {/* Expandable Details */}
        <CollapsibleContent>
          <div className="mt-1 p-2 rounded-lg border bg-muted/30 w-[250px]">
            {/* Position Details */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-sm mb-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Qty:</span>
                <span className="font-mono">{parseFloat(position.totalQuantity).toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Leverage:</span>
                <span className="font-mono">{leverage}×</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Entry:</span>
                <span className="font-mono">{formatCurrency(avgEntry)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current:</span>
                <span className="font-mono">{formatCurrency(currentPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">TP:</span>
                <span className="font-mono text-lime-600 dark:text-lime-400">{formatCurrency(takeProfitPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">SL:</span>
                <span className="font-mono text-red-600 dark:text-red-500">{formatCurrency(stopLossPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Layers:</span>
                <span className="font-mono">{actualLayersFilled}/{position.maxLayers}</span>
              </div>
            </div>

            {/* Layer Details */}
            {fills && fills.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-1.5 pt-1.5 border-t">
                  <p className="text-sm font-medium text-muted-foreground">Layer Details</p>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">Filter:</label>
                    <select
                      value={fillSourceFilter}
                      onChange={(e) => setFillSourceFilter(e.target.value as 'all' | 'bot' | 'manual' | 'sync')}
                      className="text-xs bg-background border border-input rounded px-1 py-0.5 cursor-pointer"
                    >
                      <option value="all">All Fills</option>
                      <option value="bot">Bot Only</option>
                      <option value="manual">Manual Only</option>
                      <option value="sync">Synced Only</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  {entryFills.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground/70 mb-1">Entry Layers ({entryFills.length})</p>
                      <div className="space-y-0.5">
                        {entryFills.sort((a, b) => a.layerNumber - b.layerNumber).map((fill) => (
                          <div key={fill.id} className="text-xs py-1 px-1.5 rounded bg-muted/30">
                            <div className="flex items-center gap-1 mb-0.5">
                              <Badge variant="outline" className="text-[11px] h-5 px-1">L{fill.layerNumber}</Badge>
                              <FillSourceBadge source={fill.source} />
                              <span className="font-mono">
                                {parseFloat(fill.quantity).toFixed(2)} @ ${parseFloat(fill.price).toFixed(4)}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground/70 flex justify-between">
                              <span>{formatPST(fill.filledAt, 'MMM d, h:mm a')}</span>
                              <span>Fee: ${parseFloat(fill.fee || '0').toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {exitFills.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground/70 mb-1">Exit</p>
                      <div className="space-y-0.5">
                        {exitFills.map((fill) => (
                          <div key={fill.id} className="text-xs py-1 px-1.5 rounded bg-muted/30">
                            <div className="flex items-center gap-1 mb-0.5">
                              <Badge variant="outline" className="text-[11px] h-5 px-1">Exit</Badge>
                              <FillSourceBadge source={fill.source} />
                              <span className="font-mono">
                                {parseFloat(fill.quantity).toFixed(2)} @ ${parseFloat(fill.price).toFixed(4)}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground/70 flex justify-between">
                              <span>{formatPST(fill.filledAt, 'MMM d, h:mm a')}</span>
                              <span>Fee: ${parseFloat(fill.fee || '0').toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {!fills && (
              <p className="text-sm text-muted-foreground text-center pt-1.5 border-t">Loading layer details...</p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// Memoize component to prevent unnecessary re-renders when parent updates
export const StrategyStatus = memo(function StrategyStatus() {
  const { toast } = useToast();
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const [positionToClose, setPositionToClose] = useState<Position | null>(null);

  // Use centralized hook for all strategy-related data (reduces API calls by 10-20x)
  const {
    activeStrategy,
    liveAccount, // ✅ Extract account data for balance calculations
    livePositions: livePositionsData,
    livePositionsLoading: isLoading,
    livePositionsError: error,
    closedPositions,
    realizedPnlEvents,
    realizedPnlCount,
    realizedPnlLoading,
    strategyChanges,
    assetPerformance,
    chartData, // Chart data with consolidated positions (same as performance chart)
  } = useStrategyData();

  // Get all unique symbols from open positions
  const openSymbols = useMemo(() => {
    if (!livePositionsData) return [];
    return [...new Set(livePositionsData
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .map(p => p.symbol))];
  }, [livePositionsData]);

  // Fetch liquidity status for all open symbols
  const accountBalance = parseFloat(liveAccount?.totalWalletBalance || '0');
  const strategyLeverage = activeStrategy?.leverage || 5;
  const { liquidityStatusMap } = useLiquidityStatus(openSymbols, accountBalance, strategyLeverage);

  // Fetch fills for each live position to get layer counts
  const livePositionIds = livePositionsData
    ?.filter(p => parseFloat(p.positionAmt) !== 0)
    .map(p => `live-${p.symbol}-${parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT'}`) || [];

  // Create a map of position fills
  const livePositionFills = useQuery({
    queryKey: ['/api/live/position-fills', livePositionIds],
    queryFn: async () => {
      if (!livePositionIds.length) return {};
      
      const fillsMap: Record<string, any[]> = {};
      
      // Fetch fills for all positions in parallel
      const results = await Promise.all(
        livePositionIds.map(async (positionId) => {
          try {
            const response = await fetch(`/api/positions/${positionId}/fills`);
            if (response.ok) {
              const fills = await response.json();
              return { positionId, fills };
            }
          } catch (error) {
            console.error(`Failed to fetch fills for ${positionId}:`, error);
          }
          return { positionId, fills: [] };
        })
      );
      
      results.forEach(({ positionId, fills }) => {
        fillsMap[positionId] = fills;
      });
      
      return fillsMap;
    },
    enabled: livePositionIds.length > 0,
    refetchInterval: 120000, // 2min fallback, WebSocket provides real-time
    retry: 2,
  });

  // Fetch actual TP/SL orders from exchange
  const { data: protectiveOrders } = useQuery({
    queryKey: ['/api/live/protective-orders'],
    enabled: livePositionIds.length > 0,
    refetchInterval: 10000, // Refresh every 10 seconds to show adaptive TP changes
    retry: 2,
  });

  // Transform live positions to match Position interface for display
  const livePositionsSummary: PositionSummary | undefined = livePositionsData ? {
    positions: livePositionsData
      .filter(p => parseFloat(p.positionAmt) !== 0) // Filter out zero positions
      .map(p => {
        const notional = Math.abs(parseFloat(p.positionAmt) * parseFloat(p.entryPrice));
        const leverage = parseInt(p.leverage) || activeStrategy?.leverage || 1;
        // CRITICAL: totalCost must store MARGIN (notional / leverage), not notional!
        const margin = notional / leverage;
        
        const positionId = `live-${p.symbol}-${parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT'}`;
        const fills = livePositionFills.data?.[positionId] || [];

        // Calculate layers from fills - count unique ENTRY layer numbers (exclude layer 0 = exits)
        const entryFills = fills.filter((f: any) => f.layerNumber > 0);
        const uniqueLayers = new Set(entryFills.map((f: any) => f.layerNumber));
        const layersFilled = uniqueLayers.size || 1; // Default to 1 if no fills data

        // Get earliest fill time for position open time
        const earliestFill = fills.length > 0
          ? fills.reduce((earliest: any, current: any) =>
              new Date(current.filledAt) < new Date(earliest.filledAt) ? current : earliest
            )
          : null;
        const openedAt = earliestFill ? earliestFill.filledAt : new Date().toISOString();

        return {
          id: positionId,
          symbol: p.symbol,
          side: parseFloat(p.positionAmt) > 0 ? 'long' as const : 'short' as const,
          avgEntryPrice: p.entryPrice,
          totalQuantity: Math.abs(parseFloat(p.positionAmt)).toString(),
          totalCost: margin.toString(), // Store margin, not notional!
          unrealizedPnl: p.unRealizedProfit && parseFloat(p.entryPrice) > 0 
            ? ((parseFloat(p.unRealizedProfit) / notional) * 100).toString()
            : '0',
          realizedPnl: '0', // Live positions from exchange don't have realized P&L
          leverage, // Include leverage for liquidation donut calculation
          layersFilled,
          maxLayers: activeStrategy?.maxLayers,
          lastLayerPrice: p.entryPrice, // Use entry price as last layer price
          isOpen: true,
          openedAt: openedAt,
          updatedAt: new Date(),
          closedAt: null,
          sessionId: activeStrategy?.id || '',
          liquidationPrice: p.liquidationPrice, // Real liquidation price from exchange
        };
      }),
    sessionId: activeStrategy?.id || '',
    totalExposure: livePositionsData.reduce((sum, p) => 
      sum + Math.abs(parseFloat(p.positionAmt) * parseFloat(p.markPrice || p.entryPrice || 0)), 0
    ),
    currentBalance: parseFloat(liveAccount?.totalWalletBalance || '0'), // ✅ Use exchange's actual wallet balance
    startingBalance: 0,
    totalPnl: 0,
    realizedPnl: 0,
    winRate: 0,
    totalTrades: 0,
    activePositions: livePositionsData.filter(p => parseFloat(p.positionAmt) !== 0).length,
    unrealizedPnl: parseFloat(liveAccount?.totalUnrealizedProfit || '0'), // ✅ Use exchange's actual unrealized P&L
  } : undefined;

  // Use live positions summary (live-only mode)
  const displaySummary = livePositionsSummary;


  // Detect hedge positions in closed trades - check for overlapping time periods with opposite sides
  // Returns a Map of positionId -> boolean indicating if that specific position was hedged
  const closedHedgePositions = useMemo(() => {
    if (!closedPositions) return new Map<string, boolean>();
    
    const hedgedMap = new Map<string, boolean>();
    
    // For each position, check if there's another position with opposite side that overlapped in time
    closedPositions.forEach(pos1 => {
      let isHedged = false;
      
      closedPositions.forEach(pos2 => {
        if (pos1.id === pos2.id) return; // Skip same position
        if (pos1.symbol !== pos2.symbol) return; // Skip different symbols
        if (pos1.side === pos2.side) return; // Skip same side
        
        // Check if time periods overlapped
        const pos1Start = new Date(pos1.openedAt).getTime();
        const pos1End = pos1.closedAt ? new Date(pos1.closedAt).getTime() : Date.now();
        const pos2Start = new Date(pos2.openedAt).getTime();
        const pos2End = pos2.closedAt ? new Date(pos2.closedAt).getTime() : Date.now();
        
        // Check for overlap: start1 <= end2 && start2 <= end1
        if (pos1Start <= pos2End && pos2Start <= pos1End) {
          isHedged = true;
        }
      });
      
      hedgedMap.set(pos1.id, isHedged);
    });
    
    return hedgedMap;
  }, [closedPositions]);

  // Merge and sort closed positions with strategy changes by timestamp
  const tradeHistory = useMemo(() => {
    const items: Array<{ type: 'trade' | 'change'; timestamp: Date; data: any }> = [];
    
    if (closedPositions) {
      closedPositions.forEach(position => {
        items.push({
          type: 'trade',
          timestamp: position.closedAt ? new Date(position.closedAt) : new Date(position.openedAt),
          data: position
        });
      });
    }
    
    if (strategyChanges) {
      strategyChanges.forEach(change => {
        items.push({
          type: 'change',
          timestamp: new Date(change.changedAt),
          data: change
        });
      });
    }
    
    // Sort by timestamp, newest first
    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [closedPositions, strategyChanges]);

  // Detect hedge positions - when there are both long and short positions for the same symbol
  const hedgeSymbols = useMemo(() => {
    if (!displaySummary?.positions) return new Set<string>();
    
    const symbolSides = new Map<string, Set<'long' | 'short'>>();
    
    // Group positions by symbol and track their sides
    displaySummary.positions.forEach(pos => {
      if (!symbolSides.has(pos.symbol)) {
        symbolSides.set(pos.symbol, new Set());
      }
      symbolSides.get(pos.symbol)!.add(pos.side);
    });
    
    // Find symbols that have both long and short positions
    const hedged = new Set<string>();
    symbolSides.forEach((sides, symbol) => {
      if (sides.has('long') && sides.has('short')) {
        hedged.add(symbol);
      }
    });
    
    return hedged;
  }, [displaySummary?.positions]);

  // Track previous positions for sound notifications
  const prevPositionsRef = useRef<Map<string, { layersFilled: number; isOpen: boolean }>>(new Map());
  const prevClosedCountRef = useRef<number>(0);

  // Sound notifications for trading events
  useEffect(() => {
    if (!displaySummary?.positions) return;

    const currentPositionsMap = new Map<string, { layersFilled: number; isOpen: boolean }>();
    
    // Build map of current positions
    displaySummary.positions.forEach(pos => {
      currentPositionsMap.set(pos.id, {
        layersFilled: pos.layersFilled,
        isOpen: pos.isOpen
      });
    });

    // Check for new positions (new trades)
    currentPositionsMap.forEach((current, positionId) => {
      const prev = prevPositionsRef.current.get(positionId);
      
      if (!prev) {
        // New position detected
        soundNotifications.newTrade();
      } else if (current.layersFilled > prev.layersFilled) {
        // Layer added to existing position
        soundNotifications.layerAdded();
      }
    });

    // Check for closed positions (TP or SL hit)
    // Use closedPositions count instead of tracking individual closes to avoid false positives
    if (closedPositions && closedPositions.length > prevClosedCountRef.current) {
      // A position was closed - check the most recent one
      const recentlyClosed = closedPositions[0]; // Already sorted newest first
      if (recentlyClosed) {
        const pnlPercent = parseFloat(recentlyClosed.unrealizedPnl);
        if (pnlPercent > 0) {
          soundNotifications.takeProfitHit();
        } else if (pnlPercent < 0) {
          soundNotifications.stopLossHit();
        }
      }
    }

    // Update refs
    prevPositionsRef.current = currentPositionsMap;
    if (closedPositions) {
      prevClosedCountRef.current = closedPositions.length;
    }
  }, [displaySummary?.positions, closedPositions]);

  // Close position mutation - must be defined before any early returns
  const closePositionMutation = useMutation({
    mutationFn: async (positionId: string) => {
      const response = await apiRequest('POST', `/api/positions/${positionId}/close`);
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Position Closed",
        description: `Closed ${data.position.symbol} position with ${data.pnlPercent >= 0 ? '+' : ''}${data.pnlPercent.toFixed(2)}% P&L ($${data.pnlDollar >= 0 ? '+' : ''}${Math.abs(data.pnlDollar).toFixed(2)})`,
      });
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/strategies', activeStrategy?.id, 'positions', 'summary'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to close position. Please try again.",
        variant: "destructive",
      });
    }
  });


  if (isLoading) {
    return (
      <Card data-testid="strategy-status-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
          <Skeleton className="h-32" />
        </CardContent>
      </Card>
    );
  }

  // Handle 404 as "strategy not active" rather than error
  // Check multiple ways the error status might be stored
  const getErrorStatus = (err: any) => {
    // Direct status properties
    if (err?.status) return err.status;
    if (err?.response?.status) return err.response.status;
    if (err?.statusCode) return err.statusCode;
    
    // Parse status from error message like "404: {json}"
    if (err?.message && typeof err.message === 'string') {
      const statusMatch = err.message.match(/^(\d{3}):/);
      if (statusMatch) {
        return parseInt(statusMatch[1], 10);
      }
    }
    
    return null;
  };
  
  const errorStatus = error ? getErrorStatus(error) : null;
  const hasError = error && errorStatus !== 404 && errorStatus !== 429;
  const hasNoSession = error && errorStatus === 404;
  const isRateLimited = error && errorStatus === 429;

  if (isRateLimited) {
    // Rate limited - show a friendly message instead of an error
    return (
      <Card data-testid="strategy-status-rate-limited">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Position data will load in a moment...</p>
        </CardContent>
      </Card>
    );
  }

  if (hasError) {
    return (
      <Card data-testid="strategy-status-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">Failed to load position data. Please try again.</p>
        </CardContent>
      </Card>
    );
  }

  if (hasNoSession) {
    return (
      <Card data-testid="strategy-status-no-session">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Strategy Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Strategy is not active. Enable your strategy to begin trading and tracking P&L.</p>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const getPnlColor = (pnl: number) => {
    if (pnl > 0) return "text-lime-600 dark:text-lime-400";
    if (pnl < 0) return "text-red-700 dark:text-red-500";
    return "text-muted-foreground";
  };

  const totalReturnPercent = displaySummary ? ((displaySummary.totalPnl || 0) / (displaySummary.startingBalance || 1)) * 100 : 0;
  
  // Calculate current balance including unrealized P&L
  const currentBalanceWithUnrealized = displaySummary 
    ? displaySummary.currentBalance + (displaySummary.unrealizedPnl || 0)
    : 0;
  
  // Calculate available margin (current balance minus margin in use)
  const leverage = activeStrategy?.leverage || 1;
  const marginInUse = displaySummary ? (displaySummary.totalExposure / leverage) : 0;
  const availableMargin = displaySummary ? (displaySummary.currentBalance - marginInUse) : 0;

  return (
    <div className="space-y-6">
    <Card data-testid="strategy-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Transactions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="active" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="active" data-testid="tab-active-positions">
              Active Positions
              {displaySummary?.positions && displaySummary.positions.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {displaySummary.positions.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed" data-testid="tab-completed-positions">
              Completed Trades
              {chartData && chartData.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {chartData.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-3 md:mt-4">
            {displaySummary?.positions && displaySummary.positions.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-1.5">
                {displaySummary.positions
                  .sort((a, b) => {
                    // Sort by notional value (largest first)
                    const aNotional = parseFloat(a.totalQuantity) * parseFloat(a.avgEntryPrice);
                    const bNotional = parseFloat(b.totalQuantity) * parseFloat(b.avgEntryPrice);
                    return bNotional - aNotional;
                  })
                  .map(position => {
                    const orderKey = `${position.symbol}-${position.side.toUpperCase()}`;
                    const orders = protectiveOrders ? (protectiveOrders as any)[orderKey] : undefined;

                    // Check if this position is part of a hedge
                    const isHedge = hedgeSymbols.has(position.symbol);

                    return (
                      <PositionCard
                        key={position.id}
                        position={position}
                        strategy={activeStrategy}
                        onClose={() => {
                          setPositionToClose(position);
                          setIsCloseConfirmOpen(true);
                        }}
                        isClosing={closePositionMutation.isPending}
                        formatCurrency={formatCurrency}
                        formatPercentage={formatPercentage}
                        getPnlColor={getPnlColor}
                        isHedge={isHedge}
                        actualTpPrice={orders?.tpPrice}
                        actualSlPrice={orders?.slPrice}
                        liquidityStatus={liquidityStatusMap.get(position.symbol)}
                      />
                    );
                  })}
              </div>
            ) : (
              <div className="text-center py-8">
                <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No active positions</p>
                <p className="text-sm text-muted-foreground">Positions will appear here when your strategy triggers trades</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed" className="mt-3 md:mt-4">
            {chartData && chartData.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar">
                {chartData.slice().reverse().map((trade: any) => {
                  // Try to find matching database position for layer details
                  const matchedPosition = closedPositions?.find(p => {
                    if (!p.closedAt || p.symbol !== trade.symbol) return false;
                    const positionDate = new Date(p.closedAt);
                    const tradeDate = new Date(trade.timestamp);
                    const timeDiff = Math.abs(tradeDate.getTime() - positionDate.getTime());
                    // Match if within 5 minutes (wider window for multi-layer positions)
                    return timeDiff < 300000;
                  });

                  return (
                    <ExpandableCompletedTrade
                      key={`${trade.symbol}-${trade.timestamp}`}
                      trade={trade}
                      position={matchedPosition}
                      formatCurrency={formatCurrency}
                      formatPercentage={formatPercentage}
                      getPnlColor={getPnlColor}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No completed trades</p>
                <p className="text-sm text-muted-foreground">Closed positions will appear here</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>

    {/* Close Position Confirmation Dialog */}
    <Dialog open={isCloseConfirmOpen} onOpenChange={setIsCloseConfirmOpen}>
      <DialogContent data-testid="dialog-close-position-confirm">
        <DialogHeader>
          <DialogTitle>Close Position</DialogTitle>
          <DialogDescription>
            Are you sure you want to close this position?
            {positionToClose && (
              <div className="mt-4 p-3 rounded-lg bg-muted/50 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{positionToClose.symbol}</span>
                  <Badge className={positionToClose.side === 'long' ? 'bg-lime-500/15 text-lime-300 border-lime-400/30' : 'bg-red-600/15 text-red-400 border-red-500/30'}>
                    {positionToClose.side.toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="text-foreground">{parseFloat(positionToClose.totalQuantity).toFixed(4)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Avg Entry</span>
                  <span className="text-foreground">{formatCurrency(parseFloat(positionToClose.avgEntryPrice))}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Unrealized P&L</span>
                  <span className={getPnlColor(parseFloat(positionToClose.unrealizedPnl))}>
                    {parseFloat(positionToClose.unrealizedPnl) >= 0 ? '+' : ''}{parseFloat(positionToClose.unrealizedPnl).toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setIsCloseConfirmOpen(false);
              setPositionToClose(null);
            }}
            data-testid="button-cancel-close-position"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (positionToClose) {
                closePositionMutation.mutate(positionToClose.id);
                setIsCloseConfirmOpen(false);
                setPositionToClose(null);
              }
            }}
            disabled={closePositionMutation.isPending}
            data-testid="button-confirm-close-position"
          >
            {closePositionMutation.isPending ? "Closing..." : "Close Position"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
});