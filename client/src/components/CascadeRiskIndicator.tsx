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
      await apiRequest('POST', '/api/cascade/auto', { autoEnabled: checked });
      
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

  const getPulsatingBarColor = () => {
    switch (status.light) {
      case 'green': return 'bg-green-500 shadow-green-500/50';
      case 'yellow': return 'bg-yellow-500 shadow-yellow-500/50';
      case 'orange': return 'bg-orange-500 shadow-orange-500/50';
      case 'red': return 'bg-red-500 shadow-red-500/50';
      default: return 'bg-gray-500 shadow-gray-500/50';
    }
  };

  return (
    <Card data-testid="card-cascade-risk" className="overflow-hidden">
      <style>{`
        @keyframes pulse-glow {
          0%, 100% {
            opacity: 1;
            box-shadow: 0 0 20px currentColor;
          }
          50% {
            opacity: 0.6;
            box-shadow: 0 0 40px currentColor;
          }
        }
        .pulsating-bar {
          animation: pulse-glow 3s ease-in-out infinite;
        }
      `}</style>
      <CardContent className="p-2 md:p-3">
        <div className="flex gap-1.5 md:gap-2">
          {/* Pulsating Bar - Full Height with top spacing */}
          <div 
            className={`w-1.5 md:w-2 rounded-full flex-shrink-0 mt-6 ${getPulsatingBarColor()} pulsating-bar transition-colors duration-300`}
            data-testid="indicator-light"
            style={{ color: status.light === 'green' ? '#22c55e' : status.light === 'yellow' ? '#eab308' : status.light === 'orange' ? '#f97316' : '#ef4444' }}
          />

          {/* Content Area */}
          <div className="flex-1 space-y-2">
            {/* Row 1: Metrics & Numbers */}
            <div className="flex items-center gap-1.5 md:gap-2 overflow-x-auto">
              {/* Risk Status */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <TrendingDown className="h-4 md:h-4 w-4 md:w-4" />
                <span className="text-sm md:text-sm font-semibold whitespace-nowrap">
                  {status.score >= 6 ? 'Extreme' : status.score >= 4 ? 'High' : status.score >= 2 ? 'Elevated' : 'Normal'}
                </span>
              </div>

              {/* Metrics - Lime colored */}
              <Badge variant="outline" className="flex-shrink-0 font-mono text-xs md:text-xs px-2 md:px-2 h-7 bg-[rgb(190,242,100)]/10 text-[rgb(190,242,100)] border-[rgb(190,242,100)]/20">
                {status.score}
              </Badge>

              <Badge variant="secondary" className="flex-shrink-0 font-mono text-xs md:text-xs px-2 md:px-2 h-7 bg-[rgb(190,242,100)]/10 text-[rgb(190,242,100)] border-[rgb(190,242,100)]/20" data-testid="tile-lq">
                LQ {status.LQ.toFixed(1)}
              </Badge>
              
              <Badge variant="secondary" className="flex-shrink-0 font-mono text-xs md:text-xs px-2 md:px-2 h-7 bg-[rgb(190,242,100)]/10 text-[rgb(190,242,100)] border-[rgb(190,242,100)]/20" data-testid="tile-ret">
                RT {status.RET.toFixed(1)}
              </Badge>
              
              <Badge variant="secondary" className="flex-shrink-0 font-mono text-xs md:text-xs px-2 md:px-2 h-7 bg-[rgb(190,242,100)]/10 text-[rgb(190,242,100)] border-[rgb(190,242,100)]/20" data-testid="tile-oi">
                OI {status.OI.toFixed(1)}%
              </Badge>
            </div>

            {/* Row 2: Cascade Detector Label, Status & Toggle */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Cascade Detector</span>
              <div className="flex items-center gap-2">
                {getStatusBadge()}
                <Switch
                  id="auto-detect"
                  checked={status.autoEnabled}
                  onCheckedChange={handleAutoToggle}
                  data-testid="switch-auto-detect"
                  className="scale-75 md:scale-100"
                />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
