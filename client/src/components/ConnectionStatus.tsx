import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff } from "lucide-react";
import { useState, useEffect } from "react";

interface ConnectionStatusProps {
  isConnected: boolean;
}

export default function ConnectionStatus({ isConnected }: ConnectionStatusProps) {
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    if (isConnected) {
      setLastUpdate(new Date());
    }
  }, [isConnected]);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {isConnected ? (
          <Wifi className="h-4 w-4 text-chart-1" />
        ) : (
          <WifiOff className="h-4 w-4 text-chart-2" />
        )}
        <Badge 
          variant={isConnected ? "default" : "destructive"}
          className="text-xs"
          data-testid="badge-connection-status"
        >
          {isConnected ? "Connected" : "Disconnected"}
        </Badge>
      </div>
      <span className="text-xs text-muted-foreground font-mono" data-testid="text-last-update">
        Last: {lastUpdate.toLocaleTimeString()}
      </span>
    </div>
  );
}