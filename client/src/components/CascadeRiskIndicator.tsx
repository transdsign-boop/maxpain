import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, TrendingDown, Activity } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CascadeStatus {
  score: number;
  LQ: number;
  RET: number;
  OI: number;
  light: 'green' | 'yellow' | 'orange' | 'red';
  autoBlock: boolean;
  autoEnabled: boolean;
  medianLiq: number;
}

export default function CascadeRiskIndicator() {
  const [status, setStatus] = useState<CascadeStatus>({
    score: 0,
    LQ: 0,
    RET: 0,
    OI: 0,
    light: 'green',
    autoBlock: false,
    autoEnabled: true,
    medianLiq: 0
  });
  const { toast } = useToast();

  useEffect(() => {
    const ws = new WebSocket(
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
    );

    ws.onopen = () => {
      console.log('Connected to cascade detector WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'cascade_status') {
          setStatus(message.data);
        }
      } catch (error) {
        console.error('Error parsing cascade status:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('Cascade WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Cascade detector WebSocket closed');
    };

    return () => {
      ws.close();
    };
  }, []);

  const handleAutoToggle = async (checked: boolean) => {
    try {
      await apiRequest('/api/cascade/auto', 'POST', { autoEnabled: checked });
      
      toast({
        title: checked ? "Auto-gating enabled" : "Auto-gating disabled",
        description: checked 
          ? "New entries will be blocked when cascade risk is high" 
          : "New entries allowed regardless of cascade risk",
      });
    } catch (error) {
      console.error('Error toggling auto mode:', error);
      toast({
        title: "Error",
        description: "Failed to update auto-gating mode",
        variant: "destructive",
      });
    }
  };

  const getLightColor = () => {
    switch (status.light) {
      case 'green': return 'bg-green-500';
      case 'yellow': return 'bg-yellow-500';
      case 'orange': return 'bg-orange-500';
      case 'red': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusBadge = () => {
    if (status.autoBlock) {
      return (
        <Badge variant="destructive" className="gap-1" data-testid="badge-auto-blocking">
          <AlertTriangle className="h-3 w-3" />
          Auto Blocking
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" data-testid="badge-entries-allowed">
        <Activity className="h-3 w-3" />
        Entries Allowed
      </Badge>
    );
  };

  return (
    <Card data-testid="card-cascade-risk">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            <span>Cascade Risk</span>
          </div>
          {getStatusBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div 
              className={`h-8 w-8 rounded-full ${getLightColor()} shadow-lg transition-colors duration-300`}
              data-testid="indicator-light"
            />
            <div className="text-sm">
              <div className="font-medium capitalize">{status.light} Risk</div>
              <div className="text-xs text-muted-foreground">Score: {status.score}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Label htmlFor="auto-detect" className="text-sm">Auto Detect</Label>
            <Switch
              id="auto-detect"
              checked={status.autoEnabled}
              onCheckedChange={handleAutoToggle}
              data-testid="switch-auto-detect"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-3 space-y-1" data-testid="tile-lq">
            <div className="text-xs text-muted-foreground">LQ × median</div>
            <div className="text-lg font-semibold font-mono">{status.LQ.toFixed(1)}</div>
          </div>
          
          <div className="rounded-lg border p-3 space-y-1" data-testid="tile-ret">
            <div className="text-xs text-muted-foreground">RET σ</div>
            <div className="text-lg font-semibold font-mono">{status.RET.toFixed(1)}</div>
          </div>
          
          <div className="rounded-lg border p-3 space-y-1" data-testid="tile-oi">
            <div className="text-xs text-muted-foreground">OI drop 5m</div>
            <div className="text-lg font-semibold font-mono">{status.OI.toFixed(1)}%</div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <div>• Green (0-1): Normal market conditions</div>
          <div>• Yellow (2-3): Elevated liquidation activity</div>
          <div>• Orange (4-5): High cascade risk</div>
          <div>• Red (6+): Extreme cascade risk - auto blocking active</div>
        </div>
      </CardContent>
    </Card>
  );
}
