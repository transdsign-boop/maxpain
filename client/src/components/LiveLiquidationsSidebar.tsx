import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import LiquidationRow from "./LiquidationRow";
import { ChevronLeft, ChevronRight, Activity, Zap } from "lucide-react";

interface Liquidation {
  id: string;
  symbol: string;
  side: "long" | "short";
  size: string;
  price: string;
  value: string;
  timestamp: Date;
}

interface LiveLiquidationsSidebarProps {
  liquidations: Liquidation[];
  isConnected: boolean;
  selectedAssets: string[];
}

export default function LiveLiquidationsSidebar({ 
  liquidations, 
  isConnected,
  selectedAssets 
}: LiveLiquidationsSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Filter to show recent liquidations from selected assets (last 20)
  const recentLiquidations = liquidations
    .filter(liq => selectedAssets.length === 0 || selectedAssets.includes(liq.symbol))
    .slice(0, 20);

  // Quick stats for the sidebar
  const totalValue = recentLiquidations.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
  const longCount = recentLiquidations.filter(liq => liq.side === "long").length;
  const shortCount = recentLiquidations.filter(liq => liq.side === "short").length;

  const formatValue = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  };

  return (
    <div 
      className={`fixed right-0 top-0 h-full bg-background border-l transition-all duration-300 z-50 ${
        isCollapsed ? 'w-12' : 'w-80'
      }`}
      data-testid="sidebar-live-liquidations"
    >
      {/* Collapse/Expand Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -left-10 top-4 bg-background border shadow-md hover-elevate"
        data-testid="button-toggle-sidebar"
      >
        {isCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>

      {/* Sidebar Content */}
      <div className={`h-full flex flex-col ${isCollapsed ? 'hidden' : 'block'}`}>
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm" data-testid="text-sidebar-title">
              Live Liquidations
            </h3>
            <Badge 
              variant={isConnected ? "default" : "destructive"} 
              className="text-xs"
              data-testid="badge-connection-status"
            >
              {isConnected ? "LIVE" : "OFFLINE"}
            </Badge>
          </div>
          
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-center">
              <div className="text-muted-foreground">Total</div>
              <div className="font-medium" data-testid="text-total-value">
                {formatValue(totalValue)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Longs</div>
              <div className="font-medium text-destructive" data-testid="text-long-count">
                {longCount}
              </div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Shorts</div>
              <div className="font-medium text-green-600" data-testid="text-short-count">
                {shortCount}
              </div>
            </div>
          </div>
        </div>

        {/* Liquidations List */}
        <div className="flex-1 overflow-hidden">
          {recentLiquidations.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm" data-testid="text-no-liquidations">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {selectedAssets.length === 0 ? "Select assets to monitor" : "No recent liquidations"}
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {recentLiquidations.map((liquidation, index) => (
                  <div
                    key={liquidation.id}
                    className={`p-2 rounded-md border bg-card hover-elevate transition-colors ${
                      index === 0 ? 'ring-2 ring-primary/20 bg-primary/5' : ''
                    }`}
                    data-testid={`card-liquidation-${liquidation.id}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm" data-testid={`text-symbol-${liquidation.id}`}>
                          {liquidation.symbol}
                        </span>
                        <Badge 
                          variant={liquidation.side === 'long' ? 'destructive' : 'default'} 
                          className="text-xs px-1 py-0"
                        >
                          {liquidation.side}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(liquidation.timestamp).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <span className="text-muted-foreground">Size: </span>
                        <span className="font-medium">{parseFloat(liquidation.size).toFixed(4)}</span>
                      </div>
                      <div className="font-semibold">
                        {formatValue(parseFloat(liquidation.value))}
                      </div>
                    </div>
                    
                    <div className="text-xs text-muted-foreground mt-1">
                      @ ${parseFloat(liquidation.price).toFixed(4)}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Footer Info */}
        <div className="p-3 border-t bg-muted/30">
          <div className="text-xs text-muted-foreground text-center">
            Showing last {recentLiquidations.length} liquidations
            {selectedAssets.length > 0 && (
              <div className="mt-1">
                Tracking: {selectedAssets.slice(0, 2).join(", ")}
                {selectedAssets.length > 2 && ` +${selectedAssets.length - 2} more`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Collapsed State Icon */}
      {isCollapsed && (
        <div className="flex flex-col items-center pt-4 space-y-2">
          <Zap className="h-5 w-5 text-primary" />
          <div className="writing-mode-vertical text-xs text-muted-foreground transform rotate-90 origin-center">
            Live
          </div>
          {recentLiquidations.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {recentLiquidations.length}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}