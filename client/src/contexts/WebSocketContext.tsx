import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface WebSocketEvent {
  type: string;
  data: any;
  timestamp: number;
}

interface CascadeStatus {
  symbol: string;
  score: number;
  LQ: number;
  RET: number;
  OI: number;
  light: 'green' | 'yellow' | 'orange' | 'red';
  autoBlock: boolean;
  autoEnabled: boolean;
  medianLiq: number;
  dOI_1m: number;
  dOI_3m: number;
  reversal_quality: number;
  rq_bucket: 'poor' | 'ok' | 'good' | 'excellent';
  volatility_regime: 'low' | 'medium' | 'high';
  rq_threshold_adjusted: number;
}

interface AggregateStatus {
  score: number;
  light: 'green' | 'yellow' | 'orange' | 'red';
  autoBlock: boolean;
  totalAssets: number;
  activeAssets: number;
  avgRQ: number;
  avgRET: number;
  avgOI: number;
}

type EventListener = (event: WebSocketEvent) => void;

interface WebSocketContextValue {
  isConnected: boolean;
  cascadeStatuses: CascadeStatus[];
  aggregateStatus: AggregateStatus | null;
  liquidations: any[];
  addEventListener: (listener: EventListener) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const eventListenersRef = useRef<Set<EventListener>>(new Set());
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [cascadeStatuses, setCascadeStatuses] = useState<CascadeStatus[]>([]);
  const [aggregateStatus, setAggregateStatus] = useState<AggregateStatus | null>(null);
  const [liquidations, setLiquidations] = useState<any[]>([]);

  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000;

  const addEventListener = useCallback((listener: EventListener) => {
    eventListenersRef.current.add(listener);
    return () => {
      eventListenersRef.current.delete(listener);
    };
  }, []);

  const handleWebSocketMessage = useCallback((event: WebSocketEvent) => {
    // Notify all custom event listeners
    eventListenersRef.current.forEach(listener => listener(event));
    // Update TanStack Query cache for various event types
    switch (event.type) {
      case 'live_snapshot':
        const snapshot = event.data?.snapshot;
        if (snapshot?.account) {
          queryClient.setQueryData(['/api/live/account'], snapshot.account);
        }
        if (snapshot?.positions) {
          queryClient.setQueryData(['/api/live/positions'], snapshot.positions);
        }
        break;
      
      case 'position_opened':
      case 'position_closed':
        if (event.type === 'position_closed') {
          queryClient.invalidateQueries({ 
            queryKey: ['/api/strategies'], 
            predicate: (query) => 
              query.queryKey[2] === 'positions' && query.queryKey[3] === 'closed'
          });
        }
        break;
      
      case 'position_updated':
        if (event.data) {
          queryClient.setQueryData(['/api/live/positions'], event.data);
        }
        break;
      
      case 'fill_added':
        queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
        queryClient.invalidateQueries({ queryKey: ['/api/live/position-fills'] });
        break;
      
      case 'account_updated':
        if (event.data) {
          queryClient.setQueryData(['/api/live/account'], event.data);
        }
        break;
      
      case 'performance_updated':
        queryClient.invalidateQueries({ queryKey: ['/api/performance/overview'] });
        queryClient.invalidateQueries({ queryKey: ['/api/performance/chart'] });
        break;
      
      case 'asset_performance_updated':
        queryClient.invalidateQueries({ queryKey: ['/api/analytics/asset-performance'] });
        break;
      
      case 'strategy_updated':
        queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
        break;
      
      case 'order_update':
        queryClient.invalidateQueries({ queryKey: ['/api/live/open-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
        break;

      case 'cascade_status':
        if (event.data.symbols && event.data.aggregate) {
          setCascadeStatuses(event.data.symbols);
          setAggregateStatus(event.data.aggregate);
        } else if (Array.isArray(event.data)) {
          setCascadeStatuses(event.data);
        }
        break;

      case 'liquidation':
        setLiquidations(prev => [event.data, ...prev].slice(0, 100));
        break;
    }
  }, [queryClient]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to WebSocket');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const wsEvent: WebSocketEvent = JSON.parse(event.data);
          handleWebSocketMessage(wsEvent);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from WebSocket');
        setIsConnected(false);
        wsRef.current = null;

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(
            baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectAttemptsRef.current++;
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [handleWebSocketMessage]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return (
    <WebSocketContext.Provider value={{ isConnected, cascadeStatuses, aggregateStatus, liquidations, addEventListener }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketStatus() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketStatus must be used within WebSocketProvider');
  }
  return { isConnected: context.isConnected };
}

export function useCascadeStatus() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useCascadeStatus must be used within WebSocketProvider');
  }
  return { 
    cascadeStatuses: context.cascadeStatuses, 
    aggregateStatus: context.aggregateStatus 
  };
}

export function useLiquidations() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useLiquidations must be used within WebSocketProvider');
  }
  return context.liquidations;
}

export function useWebSocketEvent(callback: EventListener) {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketEvent must be used within WebSocketProvider');
  }
  
  useEffect(() => {
    return context.addEventListener(callback);
  }, [callback, context]);
}
