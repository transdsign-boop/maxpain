import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface WebSocketEvent {
  type: string;
  data: any;
  timestamp: number;
}

interface UseWebSocketDataOptions {
  enabled?: boolean;
  onEvent?: (event: WebSocketEvent) => void;
}

export function useWebSocketData(options: UseWebSocketDataOptions = {}) {
  const { enabled = true, onEvent } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000;

  const connect = useCallback(() => {
    if (!enabled || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log('🔌 Attempting WebSocket connection...');
      console.log('   URL:', wsUrl);
      console.log('   Protocol:', protocol);
      console.log('   Host:', window.location.host);
      console.log('   User Agent:', navigator.userAgent);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ Connected to trading data WebSocket');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const wsEvent: WebSocketEvent = JSON.parse(event.data);
          setLastEvent(wsEvent);
          
          // Call custom event handler if provided
          if (onEvent) {
            onEvent(wsEvent);
          }

          // Update cache directly from WebSocket events (NO HTTP polling)
          switch (wsEvent.type) {
            case 'live_snapshot':
              // Populate cache with live snapshot data from orchestrator
              const snapshot = wsEvent.data?.snapshot;
              if (snapshot?.account) {
                queryClient.setQueryData(['/api/live/account'], snapshot.account);
              }
              if (snapshot?.positions) {
                queryClient.setQueryData(['/api/live/positions'], snapshot.positions);
              }
              // Cache portfolio risk metrics for UI risk meter
              if (snapshot?.positionsSummary) {
                queryClient.setQueryData(['/api/live/positions-summary'], snapshot.positionsSummary);
              }
              break;
            
            case 'position_opened':
            case 'position_closed':
              // Invalidate closed positions if a position closed
              if (wsEvent.type === 'position_closed') {
                queryClient.invalidateQueries({ queryKey: ['/api/strategies'], predicate: (query) => 
                  query.queryKey[2] === 'positions' && query.queryKey[3] === 'closed'
                });
              }
              break;
            
            case 'position_updated':
              // Populate cache with position update from WebSocket
              if (wsEvent.data) {
                queryClient.setQueryData(['/api/live/positions'], wsEvent.data);
              }
              break;
            
            case 'fill_added':
              // Invalidate position fills
              queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
              queryClient.invalidateQueries({ queryKey: ['/api/live/position-fills'] });
              break;
            
            case 'account_updated':
              // Populate cache with account update
              if (wsEvent.data) {
                queryClient.setQueryData(['/api/live/account'], wsEvent.data);
              }
              break;
            
            case 'performance_updated':
              // Invalidate performance metrics
              queryClient.invalidateQueries({ queryKey: ['/api/performance/overview'] });
              queryClient.invalidateQueries({ queryKey: ['/api/performance/chart'] });
              break;
            
            case 'asset_performance_updated':
              // Invalidate asset performance
              queryClient.invalidateQueries({ queryKey: ['/api/analytics/asset-performance'] });
              break;
            
            case 'strategy_updated':
              // Invalidate strategy data
              queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
              break;
            
            case 'order_update':
              // Invalidate orders and related data
              queryClient.invalidateQueries({ queryKey: ['/api/live/open-orders'] });
              queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
              break;
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected from trading data WebSocket');
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(
            baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current),
            30000 // Max 30 seconds
          );
          reconnectAttemptsRef.current++;
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);

          // Warn user if multiple reconnection attempts
          if (reconnectAttemptsRef.current >= 3) {
            console.warn('⚠️ WebSocket connection failing repeatedly. If you have multiple browser tabs or devices open, please close all but one to avoid rate limiting.');
          }

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.error('❌ WebSocket failed after maximum reconnection attempts. Please close any other open tabs/devices and refresh this page.');
        }
      };

      ws.onerror = (error) => {
        console.error('Trading data WebSocket error:', error);
        console.error('WebSocket URL:', wsUrl);
        console.error('WebSocket readyState:', ws.readyState);
        console.error('Protocol:', window.location.protocol);
        console.error('Host:', window.location.host);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [enabled, onEvent, queryClient]);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, enabled]);

  return {
    isConnected,
    lastEvent,
  };
}
