import { useState, useEffect } from "react";

interface ConnectionStatusProps {
  isConnected: boolean;
}

export default function ConnectionStatus({ isConnected }: ConnectionStatusProps) {
  const [apiConnected, setApiConnected] = useState(true);

  // Check API connection health
  useEffect(() => {
    const checkApiHealth = async () => {
      try {
        const response = await fetch('/api/strategies', { method: 'HEAD' });
        setApiConnected(response.ok);
      } catch {
        setApiConnected(false);
      }
    };

    checkApiHealth();
    const interval = setInterval(checkApiHealth, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2" data-testid="connection-status">
      {/* WebSocket Connection */}
      <div 
        className="relative"
        title={isConnected ? "WebSocket: Connected" : "WebSocket: Disconnected"}
      >
        <div 
          className={`w-2.5 h-2.5 rounded-full ${
            isConnected 
              ? 'bg-emerald-500' 
              : 'bg-red-500'
          }`}
          data-testid="dot-websocket-status"
        />
        {isConnected && (
          <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
        )}
      </div>

      {/* API Connection */}
      <div 
        className="relative"
        title={apiConnected ? "API: Connected" : "API: Disconnected"}
      >
        <div 
          className={`w-2.5 h-2.5 rounded-full ${
            apiConnected 
              ? 'bg-emerald-500' 
              : 'bg-red-500'
          }`}
          data-testid="dot-api-status"
        />
        {apiConnected && (
          <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
        )}
      </div>
    </div>
  );
}