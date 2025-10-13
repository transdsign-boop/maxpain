import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, TrendingDown, Activity } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  blockAll: boolean;
  autoEnabled: boolean;
  reason?: string;
  avgScore: number;
  symbolCount: number;
  criticalSymbols: string[];
}

export default function CascadeRiskIndicator() {
  const [statuses, setStatuses] = useState<CascadeStatus[]>([]);
  const [backendAggregate, setBackendAggregate] = useState<AggregateStatus | null>(null);
  const { toast } = useToast();

  // Aggregate metrics across all assets for overall market view
  const getAggregatedStatus = (): CascadeStatus => {
    if (statuses.length === 0) {
      return {
        symbol: 'ALL',
        score: 0,
        LQ: 0,
        RET: 0,
        OI: 0,
        light: 'green' as const,
        autoBlock: false,
        autoEnabled: true,
        medianLiq: 0,
        dOI_1m: 0,
        dOI_3m: 0,
        reversal_quality: 0,
        rq_bucket: 'poor' as const,
        volatility_regime: 'low' as const,
        rq_threshold_adjusted: 1
      };
    }

    // Calculate averages
    const avgScore = statuses.reduce((sum, s) => sum + s.score, 0) / statuses.length;
    const avgLQ = statuses.reduce((sum, s) => sum + s.LQ, 0) / statuses.length;
    const avgRET = statuses.reduce((sum, s) => sum + s.RET, 0) / statuses.length;
    const avgOI = statuses.reduce((sum, s) => sum + s.OI, 0) / statuses.length;
    const avgDOI1m = statuses.reduce((sum, s) => sum + s.dOI_1m, 0) / statuses.length;
    const avgDOI3m = statuses.reduce((sum, s) => sum + s.dOI_3m, 0) / statuses.length;
    const avgRQ = statuses.reduce((sum, s) => sum + s.reversal_quality, 0) / statuses.length;
    const avgMedianLiq = statuses.reduce((sum, s) => sum + s.medianLiq, 0) / statuses.length;

    // Calculate aggregated light based on average score (consistent with displayed score)
    const roundedScore = Math.round(avgScore);
    let aggregatedLight: 'green' | 'yellow' | 'orange' | 'red';
    if (roundedScore === 0) aggregatedLight = 'green';
    else if (roundedScore <= 2) aggregatedLight = 'yellow';
    else if (roundedScore <= 4) aggregatedLight = 'orange';
    else aggregatedLight = 'red';

    // Use backend's blockAll flag if available (ensures consistency with TRADE light)
    // Otherwise fall back to local calculation based on aggregated light
    const aggregatedAutoBlock = backendAggregate?.blockAll ?? 
      (statuses[0]?.autoEnabled && (aggregatedLight === 'orange' || aggregatedLight === 'red'));

    // Determine RQ bucket based on average (use range checks for floats)
    let rq_bucket: 'poor' | 'ok' | 'good' | 'excellent';
    if (avgRQ <= 1) rq_bucket = 'poor';
    else if (avgRQ <= 2) rq_bucket = 'ok';
    else if (avgRQ <= 3) rq_bucket = 'good';
    else rq_bucket = 'excellent';

    // Determine volatility regime based on average RET
    let volatility_regime: 'low' | 'medium' | 'high';
    let rq_threshold_adjusted: number;
    if (avgRET >= 35) {
      volatility_regime = 'high';
      rq_threshold_adjusted = 3;
    } else if (avgRET >= 25) {
      volatility_regime = 'medium';
      rq_threshold_adjusted = 2;
    } else {
      volatility_regime = 'low';
      rq_threshold_adjusted = 0;
    }

    return {
      symbol: 'ALL',
      score: Math.round(avgScore),
      LQ: avgLQ,
      RET: avgRET,
      OI: avgOI,
      light: aggregatedLight,
      autoBlock: aggregatedAutoBlock,
      autoEnabled: statuses[0]?.autoEnabled ?? true,
      medianLiq: avgMedianLiq,
      dOI_1m: avgDOI1m,
      dOI_3m: avgDOI3m,
      reversal_quality: Math.round(avgRQ),
      rq_bucket,
      volatility_regime,
      rq_threshold_adjusted
    };
  };

  const status = getAggregatedStatus();

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
          // New format: { symbols: [...], aggregate: {...} }
          if (message.data.symbols && Array.isArray(message.data.symbols)) {
            setStatuses(message.data.symbols);
            // Store backend's aggregate for consistent blocking logic
            if (message.data.aggregate) {
              setBackendAggregate(message.data.aggregate);
            }
          } else {
            // Fallback for old format
            const data = Array.isArray(message.data) ? message.data : [message.data];
            setStatuses(data);
          }
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
    if (status.autoEnabled) {
      return (
        <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" data-testid="badge-auto-gating-on">
          <Activity className="h-3 w-3" />
          Auto Gating On
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1 bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20" data-testid="badge-auto-gating-off">
        <Activity className="h-3 w-3" />
        Auto Gating Off
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

  const getReversalQualityBarColor = () => {
    switch (status.rq_bucket) {
      case 'poor': return 'bg-gray-500';
      case 'ok': return 'bg-yellow-500';
      case 'good': return 'bg-green-500';
      case 'excellent': return 'bg-green-500 border-2 border-green-400';
      default: return 'bg-gray-500';
    }
  };

  const getContextMessage = () => {
    if (status.autoBlock) {
      return "Auto blocking due to cascade risk";
    } else if (status.reversal_quality < status.rq_threshold_adjusted) {
      return `Context too weak (need ${status.rq_threshold_adjusted}+ for ${status.volatility_regime} volatility)`;
    } else {
      return `Context OK for ${status.volatility_regime} volatility (${status.reversal_quality}/${status.rq_threshold_adjusted})`;
    }
  };

  return (
    <Card data-testid="card-cascade-risk" className="overflow-hidden mt-4 md:mt-6">
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
        {/* Mobile Layout: Two rows */}
        <div className="flex gap-1.5 md:hidden">
          {/* Pulsating Bar - Full Height with top spacing */}
          <div 
            className={`w-1.5 rounded-full flex-shrink-0 mt-6 ${getPulsatingBarColor()} pulsating-bar transition-colors duration-300`}
            data-testid="indicator-light"
            style={{ color: status.light === 'green' ? '#22c55e' : status.light === 'yellow' ? '#eab308' : status.light === 'orange' ? '#f97316' : '#ef4444' }}
          />

          {/* Content Area */}
          <div className="flex-1 space-y-2">
            {/* Row 1: Metrics & Numbers */}
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {/* Risk Status */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <TrendingDown className="h-4 w-4" />
                <span className="text-sm font-semibold whitespace-nowrap">
                  {status.score >= 6 ? 'Extreme' : status.score >= 4 ? 'High' : status.score >= 2 ? 'Elevated' : 'Normal'}
                </span>
              </div>

              {/* Metrics - Lime colored */}
              <Badge variant="outline" className="flex-shrink-0 font-mono text-xs px-2 h-7 bg-[rgb(190,242,100)]/10 text-[rgb(190,242,100)] border-[rgb(190,242,100)]/20">
                {status.score}
              </Badge>

              <Badge variant="secondary" className="flex-shrink-0 font-mono text-xs px-2 h-7 bg-[rgb(190,242,100)]/10 text-[rgb(190,242,100)] border-[rgb(190,242,100)]/20" data-testid="tile-lq">
                LQ {status.LQ.toFixed(1)}
              </Badge>
              
              <Badge variant="secondary" className="flex-shrink-0 font-mono text-xs px-2 h-7 bg-[rgb(190,242,100)]/10 text-[rgb(190,242,100)] border-[rgb(190,242,100)]/20" data-testid="tile-ret">
                RT {status.RET.toFixed(1)}
              </Badge>
              
              <Badge variant="secondary" className="flex-shrink-0 font-mono text-xs px-2 h-7 bg-[rgb(190,242,100)]/10 text-[rgb(190,242,100)] border-[rgb(190,242,100)]/20" data-testid="tile-oi">
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
                  className="scale-75"
                />
              </div>
            </div>

            {/* Row 3: Reversal Quality */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Reversal Quality</span>
                <Badge variant="secondary" className="font-mono text-xs px-2 h-6" data-testid="badge-rq-score">
                  {status.reversal_quality} • {status.rq_bucket}
                </Badge>
              </div>
              
              {/* 4-Segment Bar */}
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((segment) => (
                  <div
                    key={segment}
                    className={`h-2 flex-1 rounded-sm ${
                      segment <= status.reversal_quality
                        ? getReversalQualityBarColor()
                        : 'bg-gray-300 dark:bg-gray-700'
                    }`}
                    data-testid={`rq-segment-${segment}`}
                  />
                ))}
              </div>

              {/* OI Deltas and Message */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  <Badge variant="secondary" className="font-mono text-xs px-1.5 h-6" data-testid="tile-doi-1m">
                    dOI 1m {status.dOI_1m.toFixed(1)}%
                  </Badge>
                  <Badge variant="secondary" className="font-mono text-xs px-1.5 h-6" data-testid="tile-doi-3m">
                    dOI 3m {status.dOI_3m.toFixed(1)}%
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground" data-testid="text-context-message">
                  {getContextMessage()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop Layout: Single row */}
        <div className="hidden md:flex items-center gap-4">
          {/* Pulsating Bar */}
          <div 
            className={`w-2 h-12 rounded-full flex-shrink-0 ${getPulsatingBarColor()} pulsating-bar transition-colors duration-300`}
            data-testid="indicator-light"
            style={{ color: status.light === 'green' ? '#22c55e' : status.light === 'yellow' ? '#eab308' : status.light === 'orange' ? '#f97316' : '#ef4444' }}
          />

          {/* Risk Status */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <TrendingDown className="h-5 w-5" />
            <span className="text-base font-semibold whitespace-nowrap">
              {status.score >= 6 ? 'Extreme' : status.score >= 4 ? 'High' : status.score >= 2 ? 'Elevated' : 'Normal'}
            </span>
          </div>

          {/* Metrics - Large numbers without boxes */}
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center">
              <span className="text-2xl font-bold font-mono text-[rgb(190,242,100)]">{status.score}</span>
              <span className="text-xs text-muted-foreground">Score</span>
            </div>

            <div className="flex flex-col items-center" data-testid="tile-lq">
              <span className="text-2xl font-bold font-mono text-[rgb(190,242,100)]">{status.LQ.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">LQ</span>
            </div>
            
            <div className="flex flex-col items-center" data-testid="tile-ret">
              <span className="text-2xl font-bold font-mono text-[rgb(190,242,100)]">{status.RET.toFixed(1)}</span>
              <span className="text-xs text-muted-foreground">RT</span>
            </div>
            
            <div className="flex flex-col items-center" data-testid="tile-oi">
              <span className="text-2xl font-bold font-mono text-[rgb(190,242,100)]">{status.OI.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground">OI</span>
            </div>
          </div>

          {/* Cascade Detector Label */}
          <span className="text-sm text-muted-foreground ml-4">Cascade Detector</span>

          {/* Status & Toggle */}
          <div className="flex items-center gap-2 ml-auto">
            {getStatusBadge()}
            <Switch
              id="auto-detect"
              checked={status.autoEnabled}
              onCheckedChange={handleAutoToggle}
              data-testid="switch-auto-detect"
            />
          </div>
        </div>

        {/* Reversal Quality Row - Desktop */}
        <div className="hidden md:flex items-center gap-4 mt-3 pt-3 border-t border-border">
          {/* Reversal Quality Label */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-sm font-medium whitespace-nowrap">Reversal Quality</span>
            <Badge variant="secondary" className="font-mono text-xs px-2" data-testid="badge-rq-score">
              {status.reversal_quality} • {status.rq_bucket}
            </Badge>
          </div>

          {/* 4-Segment Bar */}
          <div className="flex gap-1.5 w-32">
            {[1, 2, 3, 4].map((segment) => (
              <div
                key={segment}
                className={`h-3 flex-1 rounded-sm transition-colors ${
                  segment <= status.reversal_quality
                    ? getReversalQualityBarColor()
                    : 'bg-gray-300 dark:bg-gray-700'
                }`}
                data-testid={`rq-segment-${segment}`}
              />
            ))}
          </div>

          {/* OI Deltas */}
          <div className="flex gap-2">
            <div className="flex flex-col items-center" data-testid="tile-doi-1m">
              <span className="text-lg font-bold font-mono text-[rgb(190,242,100)]">{status.dOI_1m.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground">dOI 1m</span>
            </div>
            
            <div className="flex flex-col items-center" data-testid="tile-doi-3m">
              <span className="text-lg font-bold font-mono text-[rgb(190,242,100)]">{status.dOI_3m.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground">dOI 3m</span>
            </div>
          </div>

          {/* Context Message */}
          <span className="text-sm text-muted-foreground ml-auto" data-testid="text-context-message">
            {getContextMessage()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
