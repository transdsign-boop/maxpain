import WebSocket from 'ws';

export type WebSocketEventType =
  | 'position_opened'
  | 'position_closed'
  | 'position_updated'
  | 'fill_added'
  | 'account_updated'
  | 'performance_updated'
  | 'asset_performance_updated'
  | 'strategy_updated'
  | 'live_snapshot'
  | 'order_update'
  | 'trade_block'
  | 'vwap_update';

export interface WebSocketEvent {
  type: WebSocketEventType;
  data?: any;
  snapshot?: any;
  timestamp: number;
}

export class WebSocketBroadcaster {
  private clients: Set<WebSocket> | null = null;

  setClients(clients: Set<WebSocket>): void {
    this.clients = clients;
  }

  broadcast(event: WebSocketEvent): void {
    if (!this.clients) {
      return;
    }

    const message = JSON.stringify(event);
    
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Convenience methods for specific event types
  broadcastPositionOpened(position: any): void {
    this.broadcast({
      type: 'position_opened',
      data: position,
      timestamp: Date.now(),
    });
  }

  broadcastPositionClosed(position: any): void {
    this.broadcast({
      type: 'position_closed',
      data: position,
      timestamp: Date.now(),
    });
  }

  broadcastPositionUpdated(position: any): void {
    this.broadcast({
      type: 'position_updated',
      data: position,
      timestamp: Date.now(),
    });
  }

  broadcastFillAdded(fill: any): void {
    this.broadcast({
      type: 'fill_added',
      data: fill,
      timestamp: Date.now(),
    });
  }

  broadcastAccountUpdated(account: any): void {
    this.broadcast({
      type: 'account_updated',
      data: account,
      timestamp: Date.now(),
    });
  }

  broadcastPerformanceUpdated(performance: any): void {
    this.broadcast({
      type: 'performance_updated',
      data: performance,
      timestamp: Date.now(),
    });
  }

  broadcastAssetPerformanceUpdated(assetPerformance: any[]): void {
    this.broadcast({
      type: 'asset_performance_updated',
      data: assetPerformance,
      timestamp: Date.now(),
    });
  }

  broadcastStrategyUpdated(strategy: any): void {
    this.broadcast({
      type: 'strategy_updated',
      data: strategy,
      timestamp: Date.now(),
    });
  }

  broadcastTradeBlock(blockInfo: { blocked: boolean; reason: string; type: string }): void {
    this.broadcast({
      type: 'trade_block',
      data: blockInfo,
      timestamp: Date.now(),
    });
  }
}

// Create a singleton instance
export const wsBroadcaster = new WebSocketBroadcaster();
