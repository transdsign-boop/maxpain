import { useState, useEffect } from "react";
import { AlertCircle } from "lucide-react";

interface ConnectionStatusProps {
  isConnected: boolean;
}

interface ApiError {
  message: string;
  timestamp: Date;
}

interface CascadeStatus {
  autoBlock: boolean;
  autoEnabled: boolean;
  reversal_quality: number;
  rq_threshold_adjusted: number;
  rq_bucket: 'poor' | 'ok' | 'good' | 'excellent';
  volatility_regime: 'low' | 'medium' | 'high';
}

export default function ConnectionStatus({ isConnected }: ConnectionStatusProps) {
  const [apiConnected, setApiConnected] = useState(true);
  const [latestError, setLatestError] = useState<ApiError | null>(null);
  const [cascadeStatus, setCascadeStatus] = useState<CascadeStatus>({
    autoBlock: false,
    autoEnabled: true,
    reversal_quality: 0,
    rq_threshold_adjusted: 1,
    rq_bucket: 'poor',
    volatility_regime: 'low'
  });

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
          setCascadeStatus(message.data);
        }
      } catch (error) {
        console.error('Error parsing cascade status:', error);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Determine if trades are allowed based on cascade and reversal quality
  const tradesAllowed = !cascadeStatus.autoEnabled || 
    (!cascadeStatus.autoBlock && cascadeStatus.reversal_quality >= cascadeStatus.rq_threshold_adjusted);
  
  const getTradeStatusTitle = () => {
    if (!cascadeStatus.autoEnabled) {
      return "Trade Entry: Auto-gating disabled (all entries allowed)";
    }
    if (cascadeStatus.autoBlock) {
      return `Trade Entry: Blocked by cascade risk (high risk)`;
    }
    if (cascadeStatus.reversal_quality < cascadeStatus.rq_threshold_adjusted) {
      return `Trade Entry: Blocked by weak reversal quality (RQ: ${cascadeStatus.reversal_quality}/${cascadeStatus.rq_threshold_adjusted}, ${cascadeStatus.rq_bucket})`;
    }
    return `Trade Entry: Allowed (RQ: ${cascadeStatus.reversal_quality}/${cascadeStatus.rq_threshold_adjusted}, ${cascadeStatus.rq_bucket})`;
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
        <div 
          className="flex items-center gap-1.5"
          title={getTradeStatusTitle()}
        >
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