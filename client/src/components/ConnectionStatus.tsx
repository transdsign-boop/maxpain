import { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ConnectionStatusProps {
  isConnected: boolean;
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

export default function ConnectionStatus({ isConnected }: ConnectionStatusProps) {
  const [apiConnected, setApiConnected] = useState(true);
  const [latestError, setLatestError] = useState<ApiError | null>(null);
  const [cascadeStatuses, setCascadeStatuses] = useState<CascadeStatus[]>([]);
  const [aggregateStatus, setAggregateStatus] = useState<AggregateStatus | null>(null);

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
    const ws = new WebSocket(
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
    );

    ws.onmessage = (event) => {
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
        }
      } catch (error) {
        console.error('Error parsing cascade status:', error);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Use aggregate status from WebSocket (all-or-none blocking)
  const tradesAllowed = aggregateStatus ? !aggregateStatus.blockAll : false;
  const autoEnabled = aggregateStatus?.autoEnabled ?? true;
  
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
              {autoEnabled && aggregateStatus && aggregateStatus.blockAll && (
                <div className="text-xs text-red-600 dark:text-red-400">
                  <p>✗ ALL TRADES BLOCKED</p>
                  <div className="mt-1 space-y-0.5">
                    <p>Reason: {aggregateStatus.reason}</p>
                    <p className="text-muted-foreground">Aggregate RQ: {aggregateStatus.avgReversalQuality.toFixed(1)}/{aggregateStatus.avgRqThreshold.toFixed(1)}</p>
                    <p className="text-muted-foreground">Volatility: {aggregateStatus.volatilityRegime.toUpperCase()}</p>
                    {aggregateStatus.criticalSymbols.length > 0 && (
                      <p className="text-muted-foreground text-xs">⚠️ High activity detected: {aggregateStatus.criticalSymbols.join(', ')} (monitoring only)</p>
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
              {latestError.timestamp.toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}