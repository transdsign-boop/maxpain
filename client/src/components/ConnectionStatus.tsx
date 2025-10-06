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
  const [asterApiConnected, setAsterApiConnected] = useState(true);
  const [bybitApiConnected, setBybitApiConnected] = useState(true);
  const [latestError, setLatestError] = useState<ApiError | null>(null);
  const [cascadeStatus, setCascadeStatus] = useState<CascadeStatus>({
    autoBlock: false,
    autoEnabled: true,
    reversal_quality: 0,
    rq_threshold_adjusted: 1,
    rq_bucket: 'poor',
    volatility_regime: 'low'
  });

  // Check Aster API connection health
  useEffect(() => {
    const checkAsterApiHealth = async () => {
      try {
        const response = await fetch('/api/test-connection?exchange=aster', { method: 'GET' });
        if (!response.ok) {
          setAsterApiConnected(false);
          setLatestError({
            message: `Aster API Error: ${response.status} ${response.statusText}`,
            timestamp: new Date()
          });
        } else {
          const data = await response.json();
          if (data.success) {
            setAsterApiConnected(true);
          } else {
            setAsterApiConnected(false);
          }
        }
      } catch (error: any) {
        setAsterApiConnected(false);
        setLatestError({
          message: `Aster Network Error: ${error.message || 'Failed to connect to Aster API'}`,
          timestamp: new Date()
        });
      }
    };

    checkAsterApiHealth();
    const interval = setInterval(checkAsterApiHealth, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  // Check Bybit API connection health
  useEffect(() => {
    const checkBybitApiHealth = async () => {
      try {
        const response = await fetch('/api/test-connection?exchange=bybit', { method: 'GET' });
        if (!response.ok) {
          setBybitApiConnected(false);
          setLatestError({
            message: `Bybit API Error: ${response.status} ${response.statusText}`,
            timestamp: new Date()
          });
        } else {
          const data = await response.json();
          if (data.success) {
            setBybitApiConnected(true);
          } else {
            setBybitApiConnected(false);
          }
        }
      } catch (error: any) {
        setBybitApiConnected(false);
        setLatestError({
          message: `Bybit Network Error: ${error.message || 'Failed to connect to Bybit API'}`,
          timestamp: new Date()
        });
      }
    };

    checkBybitApiHealth();
    const interval = setInterval(checkBybitApiHealth, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

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
        {/* Aster WebSocket Connection */}
        <div 
          className="flex items-center gap-1.5"
          title={isConnected ? "Aster WebSocket: Connected" : "Aster WebSocket: Disconnected"}
        >
          <div className="relative">
            <div 
              className={`w-2.5 h-2.5 rounded-full ${
                isConnected 
                  ? 'bg-lime-500' 
                  : 'bg-red-600'
              }`}
              data-testid="dot-aster-websocket-status"
            />
            {isConnected && (
              <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-lime-500 animate-ping opacity-75" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">Aster WS</span>
        </div>

        {/* Aster API Connection */}
        <div 
          className="flex items-center gap-1.5"
          title={asterApiConnected ? "Aster API: Connected" : "Aster API: Disconnected"}
        >
          <div className="relative">
            <div 
              className={`w-2.5 h-2.5 rounded-full ${
                asterApiConnected 
                  ? 'bg-lime-500' 
                  : 'bg-red-600'
              }`}
              data-testid="dot-aster-api-status"
            />
            {asterApiConnected && (
              <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-lime-500 animate-ping opacity-75" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">Aster</span>
        </div>

        {/* Bybit API Connection */}
        <div 
          className="flex items-center gap-1.5"
          title={bybitApiConnected ? "Bybit Testnet API: Connected" : "Bybit Testnet API: Disconnected"}
        >
          <div className="relative">
            <div 
              className={`w-2.5 h-2.5 rounded-full ${
                bybitApiConnected 
                  ? 'bg-lime-500' 
                  : 'bg-red-600'
              }`}
              data-testid="dot-bybit-api-status"
            />
            {bybitApiConnected && (
              <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-lime-500 animate-ping opacity-75" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">Bybit</span>
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