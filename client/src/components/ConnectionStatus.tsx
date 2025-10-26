import { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTimeSecondsPST } from "@/lib/utils";

interface ConnectionStatusProps {
  isConnected: boolean;
  tradeBlockStatus?: {blocked: boolean; reason?: string} | null;
}

interface ApiError {
  message: string;
  timestamp: Date;
}

interface CascadeStatus {
  symbol: string;
  autoBlock: boolean;
  autoEnabled: boolean;
  reversal_quality: number;
  rq_threshold_adjusted: number;
  rq_bucket: 'poor' | 'ok' | 'good' | 'excellent';
  volatility_regime: 'low' | 'medium' | 'high';
}

interface AggregateStatus {
  avgReversalQuality: number;
  avgRqThreshold: number;
  avgVolatilityRET: number;
  avgScore: number;
  blockAll: boolean;
  autoEnabled: boolean;
  symbolCount: number;
  criticalSymbols: string[];
  volatilityRegime: 'low' | 'medium' | 'high';
  reason?: string;
}

interface TradeBlockInfo {
  blocked: boolean;
  reason: string;
  type: string;
  timestamp?: number;
}

export default function ConnectionStatus({ isConnected, tradeBlockStatus }: ConnectionStatusProps) {
  const [apiConnected, setApiConnected] = useState(true);
  const [latestError, setLatestError] = useState<ApiError | null>(null);
  const [cascadeStatuses, setCascadeStatuses] = useState<CascadeStatus[]>([]);
  const [aggregateStatus, setAggregateStatus] = useState<AggregateStatus | null>(null);
  const [tradeBlock, setTradeBlock] = useState<TradeBlockInfo | null>(null);

  // Check API connection health and capture errors
  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        const response = await fetch('/api/strategies', { method: 'HEAD' });
        if (!response.ok) {
          setApiConnected(false);
          setLatestError({
            message: `API Error: ${response.status} ${response.statusText}`,
            timestamp: new Date()
          });
        } else {
          setApiConnected(true);
          // Clear error if connection is restored
          if (!apiConnected) {
            setLatestError(null);
          }
        }
      } catch (error: any) {
        setApiConnected(false);
        setLatestError({
          message: `Network Error: ${error.message || 'Failed to connect to API'}`,
          timestamp: new Date()
        });
      }
    };

    checkApiHealth();
    const interval = setInterval(checkApiHealth, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [apiConnected]);

  // Listen for global API errors from other components
  useEffect(() => {
    const handleApiError = (event: CustomEvent) => {
      setApiConnected(false); // Turn API light red when errors occur
      setLatestError({
        message: event.detail.message || 'Unknown API error',
        timestamp: new Date()
      });
    };

    window.addEventListener('api-error' as any, handleApiError);
    return () => window.removeEventListener('api-error' as any, handleApiError);
  }, []);

  // Listen for cascade status updates via WebSocket
  useEffect(() => {
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    console.log('🔌 ConnectionStatus: Creating WebSocket connection to:', wsUrl);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('✅ ConnectionStatus: WebSocket connected');
    };

    ws.onclose = () => {
      console.log('❌ ConnectionStatus: WebSocket closed');
    };

    ws.onerror = (error) => {
      console.error('💥 ConnectionStatus: WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      console.log('📨 ConnectionStatus: Received message:', event.data);
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'cascade_status') {
          // New format: { symbols: [...], aggregate: {...} }
          if (message.data.symbols && message.data.aggregate) {
            setCascadeStatuses(message.data.symbols);
            setAggregateStatus(message.data.aggregate);
          } else {
            // Fallback for old format
            const statuses = Array.isArray(message.data) ? message.data : [message.data];
            setCascadeStatuses(statuses);
          }
        } else if (message.type === 'trade_block') {
          console.log('🔴 TRADE_BLOCK message received:', message.data);
          // Handle trade block events
          if (message.data.blocked) {
            // Set block - will remain until explicitly cleared
            setTradeBlock({
              ...message.data,
              timestamp: message.timestamp || Date.now()
            });
            console.log('🔴 Trade light should now be RED (blocked)');
          } else {
            // Clear block - explicit unblock signal
            setTradeBlock(null);
            console.log('🟢 Trade light should now be GREEN (unblocked)');
          }
        } else if (message.type === 'api_error' || message.type === 'api_warning') {
          console.log(`🔴 API ${message.type === 'api_error' ? 'ERROR' : 'WARNING'} received:`, message.data);
          // Turn API light red and show error message
          setApiConnected(false);
          setLatestError({
            message: message.data.message || `API ${message.type === 'api_error' ? 'Error' : 'Warning'}`,
            timestamp: new Date(message.timestamp)
          });

          // For warnings, auto-recover after 30 seconds
          if (message.type === 'api_warning') {
            setTimeout(() => {
              setApiConnected(true);
              setLatestError(null);
              console.log('✅ API warning cleared - light back to green');
            }, 30000);
          }
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Prioritize tradeBlockStatus prop from Dashboard (real-time pause status from main WebSocket)
  // Fall back to local tradeBlock state from ConnectionStatus WebSocket
  const effectiveTradeBlock = tradeBlockStatus || tradeBlock;
  
  // Use aggregate status from WebSocket (all-or-none blocking) OR trade block events
  const tradesAllowed = effectiveTradeBlock?.blocked ? false : (aggregateStatus ? !aggregateStatus.blockAll : false);
  const autoEnabled = aggregateStatus?.autoEnabled ?? true;
  
  // Determine block reason - prioritize real-time trade blocks over cascade status
  const blockReason = effectiveTradeBlock?.blocked ? effectiveTradeBlock.reason : (aggregateStatus?.blockAll ? aggregateStatus.reason : null);
  
  const getTradeStatusTitle = () => {
    if (!aggregateStatus) {
      return "Trade Entry: Waiting for cascade data...";
    }
    
    if (!autoEnabled) {
      return "Trade Entry: Auto-gating disabled (all entries allowed)";
    }
    
    if (aggregateStatus.blockAll) {
      return `Trade Entry: ALL TRADES BLOCKED - ${aggregateStatus.reason || 'Aggregate quality too low'}`;
    }
    
    return `Trade Entry: ALL TRADES ALLOWED - Aggregate quality sufficient`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3" data-testid="connection-status">
        {/* WebSocket Connection */}
        <div 
          className="flex items-center gap-1.5"
          title={isConnected ? "WebSocket: Connected" : "WebSocket: Disconnected"}
        >
          <div className="relative">
            <div 
              className={`w-2.5 h-2.5 rounded-full ${
                isConnected 
                  ? 'bg-lime-500' 
                  : 'bg-red-600'
              }`}
              data-testid="dot-websocket-status"
            />
            {isConnected && (
              <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-lime-500 animate-ping opacity-75" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">WS</span>
        </div>

        {/* API Connection */}
        <div 
          className="flex items-center gap-1.5"
          title={apiConnected ? "API: Connected" : "API: Disconnected"}
        >
          <div className="relative">
            <div 
              className={`w-2.5 h-2.5 rounded-full ${
                apiConnected 
                  ? 'bg-lime-500' 
                  : 'bg-red-600'
              }`}
              data-testid="dot-api-status"
            />
            {apiConnected && (
              <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-lime-500 animate-ping opacity-75" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">API</span>
        </div>

        {/* Trade Entry Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 cursor-help">
              <div className="relative">
                <div 
                  className={`w-2.5 h-2.5 rounded-full ${
                    tradesAllowed 
                      ? 'bg-lime-500' 
                      : 'bg-red-600'
                  }`}
                  data-testid="dot-trade-status"
                />
                {tradesAllowed && (
                  <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-lime-500 animate-ping opacity-75" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">TRADE</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-sm">
            <div className="space-y-1">
              <p className="font-medium">Trade Entry:</p>
              {!aggregateStatus && (
                <p className="text-xs text-muted-foreground">Waiting for cascade data...</p>
              )}
              {!autoEnabled && aggregateStatus && (
                <p className="text-xs text-muted-foreground">Auto-gating disabled - all entries allowed</p>
              )}
              {autoEnabled && aggregateStatus && !aggregateStatus.blockAll && (
                <div className="text-xs">
                  <p className="text-lime-600 dark:text-lime-400">✓ ALL TRADES ALLOWED</p>
                  <div className="mt-1 text-muted-foreground space-y-0.5">
                    <p>Aggregate RQ: {aggregateStatus.avgReversalQuality.toFixed(1)}/{aggregateStatus.avgRqThreshold.toFixed(1)}</p>
                    <p>Volatility: {aggregateStatus.volatilityRegime.toUpperCase()} (RET: {aggregateStatus.avgVolatilityRET.toFixed(1)})</p>
                    <p>Symbols monitored: {aggregateStatus.symbolCount}</p>
                  </div>
                </div>
              )}
              {!tradesAllowed && blockReason && (
                <div className="text-xs text-red-600 dark:text-red-400">
                  <p>✗ ALL TRADES BLOCKED</p>
                  <div className="mt-1 space-y-0.5">
                    <p>Reason: {blockReason}</p>
                    {tradeBlock?.type && (
                      <p className="text-muted-foreground">Type: {tradeBlock.type.replace(/_/g, ' ')}</p>
                    )}
                    {aggregateStatus && (
                      <>
                        <p className="text-muted-foreground">Aggregate RQ: {aggregateStatus.avgReversalQuality.toFixed(1)}/{aggregateStatus.avgRqThreshold.toFixed(1)}</p>
                        <p className="text-muted-foreground">Volatility: {aggregateStatus.volatilityRegime.toUpperCase()}</p>
                        {aggregateStatus.criticalSymbols && aggregateStatus.criticalSymbols.length > 0 && (
                          <p className="text-muted-foreground text-xs">⚠️ High activity: {aggregateStatus.criticalSymbols.join(', ')}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* API Error Display */}
      {latestError && (
        <div 
          className="flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/20 max-w-md"
          data-testid="api-error-display"
        >
          <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-red-900 dark:text-red-100 break-words">
              {latestError.message}
            </div>
            <div className="text-[10px] text-red-700 dark:text-red-300 mt-0.5">
              {formatTimeSecondsPST(latestError.timestamp)} PST
            </div>
          </div>
        </div>
      )}
    </div>
  );
}