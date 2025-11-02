import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Square, TrendingUp, DollarSign, Layers, Target, Trash2, Key, CheckCircle2, XCircle, Loader2, Download, Upload, Lightbulb, AlertCircle, Activity, ChevronDown, Shield } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLiquidityStatus } from "@/hooks/use-liquidity-status";

// Types
interface Strategy {
  id: string;
  name: string;
  userId: string;
  selectedAssets: string[];
  percentileThreshold: number;
  liquidationLookbackHours: number;
  maxLayers: number;
  profitTargetPercent: string;
  stopLossPercent: string;
  marginMode: "cross" | "isolated";
  leverage: number;
  orderDelayMs: number;
  dcaLayerDelayMs: number;
  slippageTolerancePercent: string;
  orderType: "market" | "limit";
  maxRetryDurationMs: number;
  priceChaseMode: boolean;
  marginAmount: string;
  hedgeMode: boolean;
  isActive: boolean;
  maxOpenPositions: number;
  maxPortfolioRiskPercent: string;
  createdAt: string;
  updatedAt: string;
  adaptiveTpEnabled?: boolean;
  adaptiveSlEnabled?: boolean;
  vwapFilterEnabled?: boolean;
  vwapTimeframeMinutes?: number;
  vwapBufferPercentage?: string;
  vwapEnableBuffer?: boolean;
  adaptiveSizingEnabled?: boolean;
  maxSizeMultiplier?: string;
  scaleAllLayers?: boolean;
}

// Form validation schema
const strategyFormSchema = z.object({
  name: z.string().min(1, "Strategy name is required").max(50, "Name too long"),
  selectedAssets: z.array(z.string()).min(1, "Select at least one asset"),
  percentileThreshold: z.number().min(1).max(100),
  liquidationLookbackHours: z.number().min(1).max(24),
  maxLayers: z.number().min(1).max(100),
  profitTargetPercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 20;
  }, "Profit target must be between 0.1% and 20%"),
  stopLossPercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 50;
  }, "Stop loss must be between 0.1% and 50%"),
  marginMode: z.enum(["cross", "isolated"]),
  leverage: z.number().min(1).max(125),
  orderDelayMs: z.number().min(100).max(30000),
  dcaLayerDelayMs: z.number().min(0).max(300000),
  slippageTolerancePercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 5;
  }, "Slippage tolerance must be between 0.1% and 5%"),
  orderType: z.enum(["market", "limit"]),
  maxRetryDurationMs: z.number().min(5000).max(300000),
  priceChaseMode: z.boolean(),
  marginAmount: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 1 && num <= 100;
  }, "Account usage must be between 1% and 100%"),
  hedgeMode: z.boolean(),
  maxOpenPositions: z.number().min(0).max(20),
  maxPortfolioRiskPercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 1 && num <= 100;
  }, "Max portfolio risk must be between 1% and 100%"),
});

type StrategyFormData = z.infer<typeof strategyFormSchema>;

// DCA Settings Types
interface DCASettings {
  dcaStartStepPercent: string;
  dcaSpacingConvexity: string;
  dcaSizeGrowth: string;
  dcaMaxRiskPercent: string;
  dcaVolatilityRef: string;
  dcaExitCushionMultiplier: string;
  retHighThreshold: string;
  retMediumThreshold: string;
  adaptiveTpEnabled: boolean;
  tpAtrMultiplier: string;
  minTpPercent: string;
  maxTpPercent: string;
  adaptiveSlEnabled: boolean;
  slAtrMultiplier: string;
  minSlPercent: string;
  maxSlPercent: string;
}

// VWAP Settings Types
interface VWAPSettings {
  vwapFilterEnabled: boolean;
  vwapTimeframeMinutes: number;
  vwapBufferPercentage: number;
  vwapEnableBuffer: boolean;
}

// Adaptive Position Sizing Settings Types
interface AdaptiveSizingSettings {
  adaptiveSizingEnabled: boolean;
  maxSizeMultiplier: number;
}

// DCA Preview Response Type
interface DCAPreviewResponse {
  effectiveGrowthFactor: number;
  configuredGrowthFactor: number;
  growthFactorAdjusted: boolean;
  currentBalance: string;
}

// DCA Size Growth Field with real-time effective growth factor display
function DcaSizeGrowthField({ strategyId, formValues, handleInputChange }: {
  strategyId: string | undefined;
  formValues: Partial<DCASettings>;
  handleInputChange: (field: keyof DCASettings, value: string | boolean) => void;
}) {
  const { data: previewData } = useQuery<DCAPreviewResponse>({
    queryKey: [`/api/strategies/${strategyId}/dca/preview`],
    enabled: !!strategyId,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const configured = parseFloat(formValues.dcaSizeGrowth || '1.8');
  const effective = previewData?.effectiveGrowthFactor;
  const isAdjusted = previewData?.growthFactorAdjusted;
  
  return (
    <div className="space-y-2">
      <Label htmlFor="dcaSizeGrowth" data-testid="label-dca-size-growth">
        Size Growth Ratio
      </Label>
      <Input
        id="dcaSizeGrowth"
        data-testid="input-dca-size-growth"
        type="number"
        step="0.1"
        min="1.0"
        max="3.0"
        value={formValues.dcaSizeGrowth || ''}
        onChange={(e) => handleInputChange('dcaSizeGrowth', e.target.value)}
        placeholder="1.8"
      />
      <div className="text-xs text-muted-foreground">
        <strong>How much each layer's size multiplies.</strong> 1.0 = all layers same size. 1.8 = each layer is 1.8× bigger (e.g., $10, $18, $32...). Higher ratios mean deeper layers bring your average entry price down faster, but use capital more aggressively.
      </div>
      
      {/* Real-time effective growth factor display */}
      {effective !== undefined && (
        <div className={`mt-2 p-2 rounded-md border ${
          isAdjusted 
            ? 'bg-orange-500/10 dark:bg-orange-500/20 border-orange-500/30' 
            : 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30'
        }`}>
          <div className={`text-xs ${
            isAdjusted 
              ? 'text-orange-700 dark:text-orange-300' 
              : 'text-green-700 dark:text-green-300'
          }`}>
            {isAdjusted ? (
              <>
                <strong>⚠️ Currently Effective: {effective.toFixed(2)}x</strong> (reduced from {configured.toFixed(2)}x configured)
                <div className="mt-1 opacity-90">
                  On your current balance (${parseFloat(previewData.currentBalance).toFixed(2)}), Layer 1 needs scaling to meet $5 minimum. Growth factor is automatically reduced to maintain your {formValues.dcaMaxRiskPercent}% risk cap.
                </div>
              </>
            ) : (
              <>
                <strong>✅ Using configured value: {configured.toFixed(2)}x</strong>
                <div className="mt-1 opacity-90">
                  Current balance: ${parseFloat(previewData?.currentBalance || '0').toFixed(2)}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {!effective && (
        <div className="mt-2 p-2 rounded-md bg-blue-500/10 dark:bg-blue-500/20 border border-blue-500/30">
          <div className="text-xs text-blue-700 dark:text-blue-300">
            <strong>💡 Dynamic Adjustment:</strong> On small accounts, the system may reduce this growth factor automatically to maintain your risk cap when Layer 1 is scaled up to meet the exchange's $5 minimum order size. As your account grows, it returns to your configured value.
          </div>
        </div>
      )}
    </div>
  );
}

// Exchange Limits Response Type
interface ExchangeLimitsResponse {
  limits: Array<{
    symbol: string;
    minNotional: string;
    pricePrecision: number;
    quantityPrecision: number;
  }>;
}

// DCA Settings Component
function ExchangeLimitsSection() {
  const [isOpen, setIsOpen] = useState(false);
  
  const { data: limitsData, isLoading } = useQuery<ExchangeLimitsResponse>({
    queryKey: ['/api/exchange-limits'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (!limitsData) {
    return null;
  }

  const limits = limitsData.limits || [];
  const hasLimits = limits.length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between p-2 h-auto"
          data-testid="button-toggle-exchange-limits"
        >
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <span className="text-base font-medium">Exchange Limits</span>
          </div>
          <div className="flex items-center gap-2">
            {hasLimits && (
              <Badge variant="outline" className="text-xs">
                {limits.filter((l: any) => l.available).length}/{limits.length} Available
              </Badge>
            )}
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="space-y-2">
        {isLoading && (
          <div className="text-sm text-muted-foreground p-2">Loading exchange limits...</div>
        )}
        
        {!isLoading && !hasLimits && (
          <div className="text-sm text-muted-foreground p-2">
            No cascade monitoring symbols configured
          </div>
        )}
        
        {!isLoading && hasLimits && (
          <div className="space-y-1 p-2 bg-muted/30 rounded-md">
            <div className="text-xs font-medium text-muted-foreground mb-2">Monitored Assets</div>
            <div className="grid gap-1">
              {limits.map((limit: any) => (
                <div
                  key={limit.symbol}
                  className="flex items-center justify-between text-xs p-2 bg-background rounded border"
                  data-testid={`exchange-limit-${limit.symbol}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{limit.symbol}</span>
                    {!limit.available && (
                      <Badge variant="destructive" className="text-[10px] h-4 px-1">
                        ⚠️ Missing
                      </Badge>
                    )}
                  </div>
                  {limit.available && (
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">Min:</span>
                        <span className="font-mono">${limit.minNotional}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">Price:</span>
                        <span className="font-mono">{limit.pricePrecision}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">Qty:</span>
                        <span className="font-mono">{limit.quantityPrecision}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground mt-2 p-1">
              Min = Minimum notional value (USD), Price = Price precision (decimals), Qty = Quantity precision (decimals)
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function DCASettingsSection({ strategyId, isStrategyRunning, saveTrigger }: { strategyId: string; isStrategyRunning: boolean; saveTrigger?: number }) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(true);
  
  // Fetch DCA settings
  const { data: dcaSettings, isLoading } = useQuery<DCASettings>({
    queryKey: [`/api/strategies/${strategyId}/dca`],
    enabled: !!strategyId,
  });

  // Update DCA settings mutation
  const updateDCAMutation = useMutation({
    mutationFn: async (data: Partial<DCASettings>) => {
      const response = await apiRequest('PUT', `/api/strategies/${strategyId}/dca`, data);
      return await response.json();
    },
    onSuccess: (data) => {
      // Immediately update form state with the response data
      setFormValues(data);
      toast({
        title: "DCA Settings Updated",
        description: "Your DCA parameters have been saved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/strategies/${strategyId}/dca`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update DCA settings. Please try again.",
        variant: "destructive",
      });
    }
  });

  const [formValues, setFormValues] = useState<Partial<DCASettings>>({});

  // Initialize form when DCA settings load
  useEffect(() => {
    if (dcaSettings) {
      setFormValues(dcaSettings);
    }
  }, [dcaSettings]);

  const handleInputChange = (field: keyof DCASettings, value: string | boolean) => {
    setFormValues(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    updateDCAMutation.mutate(formValues);
  };

  // Save when saveTrigger changes (triggered from parent)
  useEffect(() => {
    if (saveTrigger && Object.keys(formValues).length > 0) {
      updateDCAMutation.mutate(formValues);
    }
  }, [saveTrigger]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-4 bg-muted animate-pulse rounded" />
        <div className="h-4 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="space-y-4">
        <CollapsibleTrigger className="w-full" data-testid="button-toggle-dca">
          <div className="flex items-center justify-between cursor-pointer hover-elevate p-3 rounded-md">
            <Label className="text-base font-medium flex items-center gap-2 cursor-pointer">
              <Activity className="h-4 w-4" />
              DCA Settings (Advanced)
              <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </Label>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
              Configure Dollar Cost Averaging parameters for position sizing and spacing
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dcaStartStepPercent" data-testid="label-dca-start-step">
                  Start Step (%)
                </Label>
                <Input
                  id="dcaStartStepPercent"
                  data-testid="input-dca-start-step"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5.0"
                  value={formValues.dcaStartStepPercent || ''}
                  onChange={(e) => handleInputChange('dcaStartStepPercent', e.target.value)}
                  placeholder="0.4"
                />
                <div className="text-xs text-muted-foreground">
                  <strong>How far the price must move against you before adding the first additional layer.</strong> For example, 0.4% means if you enter at $100, the first layer triggers at $99.60 (long) or $100.40 (short). Lower = more frequent adds, higher = fewer adds but deeper drawdowns.
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dcaSpacingConvexity" data-testid="label-dca-spacing-convexity">
                  Spacing Convexity
                </Label>
                <Input
                  id="dcaSpacingConvexity"
                  data-testid="input-dca-spacing-convexity"
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="2.0"
                  value={formValues.dcaSpacingConvexity || ''}
                  onChange={(e) => handleInputChange('dcaSpacingConvexity', e.target.value)}
                  placeholder="1.2"
                />
                <div className="text-xs text-muted-foreground">
                  <strong>Controls how distance between layers increases.</strong> 1.0 = equal spacing (0.4%, 0.4%, 0.4%...). 1.2 = expanding spacing (0.4%, 0.48%, 0.58%...). Higher values mean deeper layers are spaced further apart, protecting against extreme moves.
                </div>
              </div>

              <DcaSizeGrowthField 
                strategyId={strategyId}
                formValues={formValues}
                handleInputChange={handleInputChange}
              />

              <div className="space-y-2">
                <Label htmlFor="dcaMaxRiskPercent" data-testid="label-dca-max-risk">
                  Max Risk (%)
                </Label>
                <Input
                  id="dcaMaxRiskPercent"
                  data-testid="input-dca-max-risk"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10.0"
                  value={formValues.dcaMaxRiskPercent || ''}
                  onChange={(e) => handleInputChange('dcaMaxRiskPercent', e.target.value)}
                  placeholder="1.0"
                />
                <div className="text-xs text-muted-foreground">
                  <strong>Maximum percentage of your account to risk on this entire position (all layers combined).</strong> For example, 1.0% on a $10,000 account = $100 total risk. The system calculates position sizes to stay within this limit even if all layers trigger.
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dcaVolatilityRef" data-testid="label-dca-volatility-ref">
                  Volatility Reference (%)
                </Label>
                <Input
                  id="dcaVolatilityRef"
                  data-testid="input-dca-volatility-ref"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10.0"
                  value={formValues.dcaVolatilityRef || ''}
                  onChange={(e) => handleInputChange('dcaVolatilityRef', e.target.value)}
                  placeholder="1.0"
                />
                <div className="text-xs text-muted-foreground">
                  <strong>Baseline volatility level used to scale layer spacing dynamically.</strong> When actual ATR (market volatility) is higher than this reference, layers space out more. When lower, they compress. Think of this as your "normal" volatility expectation - the system adapts spacing based on current market conditions vs. this baseline.
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dcaExitCushionMultiplier" data-testid="label-dca-exit-cushion">
                  Exit Cushion Multiplier
                </Label>
                <Input
                  id="dcaExitCushionMultiplier"
                  data-testid="input-dca-exit-cushion"
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="2.0"
                  value={formValues.dcaExitCushionMultiplier || ''}
                  onChange={(e) => handleInputChange('dcaExitCushionMultiplier', e.target.value)}
                  placeholder="0.6"
                />
                <div className="text-xs text-muted-foreground">
                  <strong>Determines take profit distance relative to your total DCA spacing.</strong> 0.6 = TP is 60% of the total distance you're willing to DCA. Lower values (0.3-0.5) = tighter profits, faster exits. Higher values (0.7-1.0) = let winners run more but risk giving back gains.
                </div>
              </div>
            </div>

            {/* Adaptive Take Profit Section */}
            <Separator className="my-4" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Adaptive Take Profit (Auto Envelope)
                </Label>
                <Switch
                  id="adaptiveTpEnabled"
                  data-testid="switch-adaptive-tp"
                  checked={formValues.adaptiveTpEnabled || false}
                  onCheckedChange={(checked) => handleInputChange('adaptiveTpEnabled', checked)}
                />
              </div>
              
              {formValues.adaptiveTpEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/30 rounded-md">
                  <div className="space-y-2">
                    <Label htmlFor="tpAtrMultiplier" data-testid="label-tp-atr-multiplier">
                      ATR Multiplier
                    </Label>
                    <Input
                      id="tpAtrMultiplier"
                      data-testid="input-tp-atr-multiplier"
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="5.0"
                      value={formValues.tpAtrMultiplier || ''}
                      onChange={(e) => handleInputChange('tpAtrMultiplier', e.target.value)}
                      placeholder="1.5"
                    />
                    <div className="text-xs text-muted-foreground">
                      TP = ATR × this multiplier. Higher = wider targets in volatile markets.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="minTpPercent" data-testid="label-min-tp">
                      Min TP %
                    </Label>
                    <Input
                      id="minTpPercent"
                      data-testid="input-min-tp"
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="10.0"
                      value={formValues.minTpPercent || ''}
                      onChange={(e) => handleInputChange('minTpPercent', e.target.value)}
                      placeholder="0.5"
                    />
                    <div className="text-xs text-muted-foreground">
                      Minimum TP floor (safety net for low volatility).
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxTpPercent" data-testid="label-max-tp">
                      Max TP %
                    </Label>
                    <Input
                      id="maxTpPercent"
                      data-testid="input-max-tp"
                      type="number"
                      step="0.1"
                      min="1.0"
                      max="20.0"
                      value={formValues.maxTpPercent || ''}
                      onChange={(e) => handleInputChange('maxTpPercent', e.target.value)}
                      placeholder="5.0"
                    />
                    <div className="text-xs text-muted-foreground">
                      Maximum TP ceiling (prevents overly wide targets).
                    </div>
                  </div>

                  <div className="col-span-full text-sm bg-primary/10 border border-primary/20 p-3 rounded-md">
                    <strong>🎯 Auto Envelope Mode:</strong> System automatically sets TP based on current volatility (ATR). 
                    Formula: <code className="bg-background/50 px-1 py-0.5 rounded">TP = clamp(ATR × Multiplier, Min%, Max%)</code>
                    <br />
                    <span className="text-muted-foreground text-xs mt-1 block">Calm markets = tighter TP (closer to Min). Volatile markets = wider TP (closer to Max).</span>
                  </div>
                </div>
              )}
            </div>

            {/* Adaptive Stop Loss Section */}
            <Separator className="my-4" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Adaptive Stop Loss (Auto Envelope)
                </Label>
                <Switch
                  id="adaptiveSlEnabled"
                  data-testid="switch-adaptive-sl"
                  checked={formValues.adaptiveSlEnabled || false}
                  onCheckedChange={(checked) => handleInputChange('adaptiveSlEnabled', checked)}
                />
              </div>
              
              {formValues.adaptiveSlEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/30 rounded-md">
                  <div className="space-y-2">
                    <Label htmlFor="slAtrMultiplier" data-testid="label-sl-atr-multiplier">
                      ATR Multiplier
                    </Label>
                    <Input
                      id="slAtrMultiplier"
                      data-testid="input-sl-atr-multiplier"
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="5.0"
                      value={formValues.slAtrMultiplier || ''}
                      onChange={(e) => handleInputChange('slAtrMultiplier', e.target.value)}
                      placeholder="2.0"
                    />
                    <div className="text-xs text-muted-foreground">
                      SL = ATR × this multiplier. Higher = wider stops in volatile markets.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="minSlPercent" data-testid="label-min-sl">
                      Min SL %
                    </Label>
                    <Input
                      id="minSlPercent"
                      data-testid="input-min-sl"
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="100"
                      value={formValues.minSlPercent || ''}
                      onChange={(e) => handleInputChange('minSlPercent', e.target.value)}
                      placeholder="1.0"
                    />
                    <div className="text-xs text-muted-foreground">
                      Minimum SL floor (safety net for low volatility).
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxSlPercent" data-testid="label-max-sl">
                      Max SL %
                    </Label>
                    <Input
                      id="maxSlPercent"
                      data-testid="input-max-sl"
                      type="number"
                      step="0.1"
                      min="1.0"
                      max="100"
                      value={formValues.maxSlPercent || ''}
                      onChange={(e) => handleInputChange('maxSlPercent', e.target.value)}
                      placeholder="5.0"
                    />
                    <div className="text-xs text-muted-foreground">
                      Maximum SL ceiling (prevents overly wide stops).
                    </div>
                  </div>

                  <div className="col-span-full text-sm bg-destructive/10 border border-destructive/20 p-3 rounded-md">
                    <strong>🛡️ Auto Envelope Mode:</strong> System automatically sets SL based on current volatility (ATR). 
                    Formula: <code className="bg-background/50 px-1 py-0.5 rounded">SL = clamp(ATR × Multiplier, Min%, Max%)</code>
                    <br />
                    <span className="text-muted-foreground text-xs mt-1 block">Calm markets = tighter SL (closer to Min). Volatile markets = wider SL (closer to Max).</span>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="retHighThreshold" data-testid="label-ret-high-threshold">
                  RET High Threshold
                </Label>
                <Input
                  id="retHighThreshold"
                  data-testid="input-ret-high-threshold"
                  type="number"
                  step="1"
                  min="10"
                  max="100"
                  value={formValues.retHighThreshold || ''}
                  onChange={(e) => handleInputChange('retHighThreshold', e.target.value)}
                  placeholder="35"
                />
                <div className="text-xs text-muted-foreground">
                  <strong>Minimum realized volatility (RET) required to enter trades when Reversal Quality is "good" (RQ≥3).</strong> RET measures actual price movement strength. Higher threshold = only trade on strong, volatile moves. Lower = trade more frequently on gentler moves. Default 35 means you need significant price action + good reversal signals.
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="retMediumThreshold" data-testid="label-ret-medium-threshold">
                  RET Medium Threshold
                </Label>
                <Input
                  id="retMediumThreshold"
                  data-testid="input-ret-medium-threshold"
                  type="number"
                  step="1"
                  min="5"
                  max="100"
                  value={formValues.retMediumThreshold || ''}
                  onChange={(e) => handleInputChange('retMediumThreshold', e.target.value)}
                  placeholder="25"
                />
                <div className="text-xs text-muted-foreground">
                  <strong>Minimum realized volatility (RET) required to enter trades when Reversal Quality is "ok" (RQ≥2).</strong> This is your secondary entry filter for moderate-quality setups. Should be lower than High Threshold. Lower values = more trades with less conviction. Higher = fewer, more selective entries even on ok signals.
                </div>
              </div>
            </div>

            <Button
              data-testid="button-update-dca"
              type="button"
              onClick={handleSubmit}
              disabled={updateDCAMutation.isPending}
              className="w-full"
            >
              {updateDCAMutation.isPending ? "Updating..." : "Update DCA Settings"}
            </Button>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function VWAPSettingsSection({ strategyId, isStrategyRunning }: { strategyId: string; isStrategyRunning: boolean }) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch current strategy to get VWAP settings
  const { data: strategy } = useQuery<Strategy>({
    queryKey: [`/api/strategies`],
    select: (data: any) => {
      const strategies = Array.isArray(data) ? data : [data];
      return strategies.find((s: Strategy) => s.id === strategyId);
    },
    enabled: !!strategyId,
  });

  // Update VWAP settings mutation
  const updateVWAPMutation = useMutation({
    mutationFn: async (data: Partial<VWAPSettings>) => {
      const response = await apiRequest('PATCH', `/api/strategies/${strategyId}/vwap/config`, data);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "VWAP Settings Updated",
        description: "Your VWAP direction filter has been configured successfully.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/strategies`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update VWAP settings. Please try again.",
        variant: "destructive",
      });
    }
  });

  const [formValues, setFormValues] = useState<Partial<VWAPSettings>>({
    vwapFilterEnabled: false,
    vwapTimeframeMinutes: 240,
    vwapBufferPercentage: 0.0005,
    vwapEnableBuffer: true,
  });

  // Initialize form when strategy loads
  useEffect(() => {
    if (strategy) {
      setFormValues({
        vwapFilterEnabled: strategy.vwapFilterEnabled ?? false,
        vwapTimeframeMinutes: strategy.vwapTimeframeMinutes ?? 240,
        vwapBufferPercentage: strategy.vwapBufferPercentage ? parseFloat(strategy.vwapBufferPercentage) : 0.0005,
        vwapEnableBuffer: strategy.vwapEnableBuffer ?? true,
      });
    }
  }, [strategy]);

  const handleInputChange = (field: keyof VWAPSettings, value: string | boolean | number) => {
    setFormValues(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    updateVWAPMutation.mutate(formValues);
  };

  const handlePresetClick = (preset: 'tight' | 'normal' | 'wide') => {
    const presets = {
      tight: { bufferPercentage: 0.0001, timeframeMinutes: 60 },   // 0.01%, 1h
      normal: { bufferPercentage: 0.0005, timeframeMinutes: 240 }, // 0.05%, 4h
      wide: { bufferPercentage: 0.002, timeframeMinutes: 480 },    // 0.2%, 8h
    };

    setFormValues(prev => ({
      ...prev,
      vwapBufferPercentage: presets[preset].bufferPercentage,
      vwapTimeframeMinutes: presets[preset].timeframeMinutes,
    }));
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="space-y-4">
        <CollapsibleTrigger className="w-full" data-testid="button-toggle-vwap">
          <div className="flex items-center justify-between cursor-pointer hover-elevate p-3 rounded-md">
            <Label className="text-base font-medium flex items-center gap-2 cursor-pointer">
              <TrendingUp className="h-4 w-4" />
              VWAP Direction Filter
              <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </Label>
            {formValues.vwapFilterEnabled && (
              <Badge variant="default" className="text-xs">
                Enabled
              </Badge>
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
              Only trade when price aligns with VWAP direction: longs below VWAP, shorts above VWAP. Buffer zones prevent flip-flopping near VWAP.
            </div>

            {/* Enable/Disable Switch */}
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div className="space-y-0.5">
                <Label htmlFor="vwapFilterEnabled" className="text-base">
                  Enable VWAP Filter
                </Label>
                <p className="text-sm text-muted-foreground">
                  Filter trades based on price position relative to VWAP (can be toggled while running)
                </p>
              </div>
              <Switch
                id="vwapFilterEnabled"
                checked={formValues.vwapFilterEnabled ?? false}
                onCheckedChange={(checked) => {
                  handleInputChange('vwapFilterEnabled', checked);
                  // Auto-save when toggling enable/disable
                  updateVWAPMutation.mutate({ ...formValues, vwapFilterEnabled: checked });
                }}
              />
            </div>

            {/* Preset Buttons */}
            <div className="space-y-2">
              <Label>Quick Presets</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick('tight')}
                  className="text-xs"
                >
                  <Lightbulb className="h-3 w-3 mr-1" />
                  Tight
                  <span className="ml-1 text-muted-foreground">(1h, 0.01%)</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick('normal')}
                  className="text-xs"
                >
                  <Target className="h-3 w-3 mr-1" />
                  Normal
                  <span className="ml-1 text-muted-foreground">(4h, 0.05%)</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePresetClick('wide')}
                  className="text-xs"
                >
                  <Layers className="h-3 w-3 mr-1" />
                  Wide
                  <span className="ml-1 text-muted-foreground">(8h, 0.2%)</span>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Timeframe Selection */}
              <div className="space-y-2">
                <Label htmlFor="vwapTimeframeMinutes">
                  VWAP Timeframe
                </Label>
                <Select
                  value={formValues.vwapTimeframeMinutes?.toString() ?? '240'}
                  onValueChange={(value) => handleInputChange('vwapTimeframeMinutes', parseInt(value))}
                >
                  <SelectTrigger id="vwapTimeframeMinutes">
                    <SelectValue placeholder="Select timeframe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="60">1 Hour</SelectItem>
                    <SelectItem value="120">2 Hours</SelectItem>
                    <SelectItem value="180">3 Hours</SelectItem>
                    <SelectItem value="240">4 Hours</SelectItem>
                    <SelectItem value="360">6 Hours</SelectItem>
                    <SelectItem value="480">8 Hours</SelectItem>
                    <SelectItem value="1440">24 Hours</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  VWAP resets every {formValues.vwapTimeframeMinutes ? `${formValues.vwapTimeframeMinutes / 60}h` : '4h'}
                </p>
              </div>

              {/* Buffer Percentage */}
              <div className="space-y-2">
                <Label htmlFor="vwapBufferPercentage">
                  Buffer Size: {((formValues.vwapBufferPercentage ?? 0.0005) * 100).toFixed(2)}%
                </Label>
                <Slider
                  id="vwapBufferPercentage"
                  min={0.0001}
                  max={0.002}
                  step={0.0001}
                  value={[formValues.vwapBufferPercentage ?? 0.0005]}
                  onValueChange={(value) => handleInputChange('vwapBufferPercentage', value[0])}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Range: 0.01% (tight) to 0.2% (wide)
                </p>
              </div>
            </div>

            {/* Enable Buffer Zone Switch */}
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div className="space-y-0.5">
                <Label htmlFor="vwapEnableBuffer" className="text-sm">
                  Enable Buffer Zone
                </Label>
                <p className="text-xs text-muted-foreground">
                  Maintain previous direction when price is near VWAP (prevents whipsaw)
                </p>
              </div>
              <Switch
                id="vwapEnableBuffer"
                checked={formValues.vwapEnableBuffer ?? true}
                onCheckedChange={(checked) => handleInputChange('vwapEnableBuffer', checked)}
              />
            </div>

            {/* Info Box */}
            <div className="text-xs bg-blue-500/10 border border-blue-500/20 p-3 rounded-md space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium text-blue-500">How VWAP Direction Filter Works:</p>
                  <p className="text-muted-foreground">
                    • <strong>Price below VWAP</strong> → LONG_ONLY (blocks short trades)
                  </p>
                  <p className="text-muted-foreground">
                    • <strong>Price above VWAP</strong> → SHORT_ONLY (blocks long trades)
                  </p>
                  <p className="text-muted-foreground">
                    • <strong>Price in buffer zone</strong> → Maintains previous direction
                  </p>
                  <p className="text-muted-foreground mt-2">
                    Buffer zones prevent rapid direction changes when price hovers near VWAP, reducing false signals.
                  </p>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={updateVWAPMutation.isPending}
              className="w-full"
            >
              {updateVWAPMutation.isPending ? "Updating..." : "Update VWAP Configuration"}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Changes take effect immediately, even while the strategy is running
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function AdaptiveSizingSettingsSection({ strategyId, isStrategyRunning }: { strategyId: string; isStrategyRunning: boolean }) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch current strategy to get adaptive sizing settings
  const { data: strategy } = useQuery<Strategy>({
    queryKey: [`/api/strategies`],
    select: (data: any) => {
      const strategies = Array.isArray(data) ? data : [data];
      return strategies.find((s: Strategy) => s.id === strategyId);
    },
    enabled: !!strategyId,
  });

  // Update adaptive sizing settings mutation
  const updateAdaptiveSizingMutation = useMutation({
    mutationFn: async (data: Partial<AdaptiveSizingSettings>) => {
      const response = await apiRequest('PATCH', `/api/strategies/${strategyId}/adaptive-sizing/config`, data);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Adaptive Sizing Updated",
        description: "Your percentile-based position sizing has been configured successfully.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/strategies`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update adaptive sizing settings. Please try again.",
        variant: "destructive",
      });
    }
  });

  const [formValues, setFormValues] = useState<Partial<AdaptiveSizingSettings>>({
    adaptiveSizingEnabled: false,
    maxSizeMultiplier: 3.0,
  });

  // Initialize form when strategy loads
  useEffect(() => {
    if (strategy) {
      setFormValues({
        adaptiveSizingEnabled: strategy.adaptiveSizingEnabled ?? false,
        maxSizeMultiplier: strategy.maxSizeMultiplier ? parseFloat(strategy.maxSizeMultiplier) : 3.0,
      });
    }
  }, [strategy]);

  const handleInputChange = (field: keyof AdaptiveSizingSettings, value: number | boolean) => {
    setFormValues(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    updateAdaptiveSizingMutation.mutate(formValues);
  };

  // Calculate current percentile threshold from strategy
  const percentileThreshold = strategy?.percentileThreshold ?? 40;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="space-y-4">
        <CollapsibleTrigger className="w-full" data-testid="button-toggle-adaptive-sizing">
          <div className="flex items-center justify-between cursor-pointer hover-elevate p-3 rounded-md">
            <Label className="text-base font-medium flex items-center gap-2 cursor-pointer">
              <TrendingUp className="h-4 w-4" />
              Adaptive Position Sizing
              <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </Label>
            {formValues.adaptiveSizingEnabled && (
              <Badge variant="default" className="text-xs">
                Enabled ({formValues.maxSizeMultiplier?.toFixed(1)}x max)
              </Badge>
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-md">
              Scale Layer 1 position size based on liquidation percentile rank. Larger liquidations (higher percentiles) get larger positions through linear interpolation.
            </div>

            {/* Enable/Disable Switch */}
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div className="space-y-0.5">
                <Label htmlFor="adaptiveSizingEnabled" className="text-base">
                  Enable Adaptive Sizing
                </Label>
                <p className="text-sm text-muted-foreground">
                  Scale position size based on liquidation magnitude (can be toggled while running)
                </p>
              </div>
              <Switch
                id="adaptiveSizingEnabled"
                checked={formValues.adaptiveSizingEnabled ?? false}
                onCheckedChange={(checked) => {
                  handleInputChange('adaptiveSizingEnabled', checked);
                  // Auto-save when toggling enable/disable
                  updateAdaptiveSizingMutation.mutate({ ...formValues, adaptiveSizingEnabled: checked });
                }}
              />
            </div>

            {/* Max Size Multiplier Slider */}
            <div className="space-y-2">
              <Label htmlFor="maxSizeMultiplier">
                Max Size Multiplier: {formValues.maxSizeMultiplier?.toFixed(1)}x
              </Label>
              <Slider
                id="maxSizeMultiplier"
                min={1.0}
                max={10.0}
                step={0.1}
                value={[formValues.maxSizeMultiplier ?? 3.0]}
                onValueChange={(value) => handleInputChange('maxSizeMultiplier', value[0])}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Position size at 95th+ percentile. Range: 1.0x (no scaling) to 10.0x (maximum)
              </p>
            </div>

            {/* Scaling Visualization */}
            <div className="space-y-2 p-3 border rounded-md bg-muted/20">
              <Label className="text-sm font-medium">Scaling Formula</Label>
              <div className="text-xs space-y-1 font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">At {percentileThreshold}th percentile (threshold):</span>
                  <span className="font-semibold">1.0x (base size)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">At 95th percentile:</span>
                  <span className="font-semibold text-lime-500">{formValues.maxSizeMultiplier?.toFixed(1)}x</span>
                </div>
                <div className="mt-2 text-muted-foreground">
                  Linear interpolation between threshold and 95th percentile
                </div>
              </div>
            </div>

            {/* Example Calculation */}
            <div className="space-y-2 p-3 border rounded-md bg-blue-500/5">
              <Label className="text-sm font-medium text-blue-500">Example</Label>
              <div className="text-xs space-y-1">
                <p className="text-muted-foreground">
                  If Layer 1 base size = $100 and max multiplier = {formValues.maxSizeMultiplier?.toFixed(1)}x:
                </p>
                <div className="font-mono space-y-0.5 mt-2">
                  <div>• {percentileThreshold}th percentile → $100 (1.0x)</div>
                  <div>• {Math.round((percentileThreshold + 95) / 2)}th percentile → ${(100 * (1.0 + (formValues.maxSizeMultiplier! - 1.0) / 2)).toFixed(0)} ({(1.0 + (formValues.maxSizeMultiplier! - 1.0) / 2).toFixed(1)}x)</div>
                  <div className="text-lime-500">• 95th percentile → ${(100 * formValues.maxSizeMultiplier!).toFixed(0)} ({formValues.maxSizeMultiplier?.toFixed(1)}x)</div>
                </div>
              </div>
            </div>

            {/* Info Box */}
            <div className="text-xs bg-blue-500/10 border border-blue-500/20 p-3 rounded-md space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="font-medium text-blue-500">How Adaptive Position Sizing Works:</p>
                  <p className="text-muted-foreground">
                    • <strong>Percentile Calculation:</strong> Current liquidation is ranked against 10,000 recent liquidations for the symbol
                  </p>
                  <p className="text-muted-foreground">
                    • <strong>Scaling Logic:</strong> Size = Base × (1.0 + ((percentile - threshold) / (95 - threshold)) × (maxMultiplier - 1.0))
                  </p>
                  <p className="text-muted-foreground">
                    • <strong>Only Layer 1:</strong> Currently scales only the first DCA layer (subsequent layers use standard sizing)
                  </p>
                  <p className="text-muted-foreground mt-2">
                    This allows you to take larger positions on exceptional liquidation events while maintaining conservative sizing on smaller liquidations.
                  </p>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={updateAdaptiveSizingMutation.isPending}
              className="w-full"
            >
              {updateAdaptiveSizingMutation.isPending ? "Updating..." : "Update Adaptive Sizing Configuration"}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Changes take effect immediately, even while the strategy is running
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface TradingStrategyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TradingStrategyDialog({ open, onOpenChange }: TradingStrategyDialogProps) {
  const { toast } = useToast();
  const [activeStrategy, setActiveStrategy] = useState<Strategy | null>(null);
  const [isStrategyRunning, setIsStrategyRunning] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message: string; accountInfo?: any } | null>(null);
  const [assetSortMode, setAssetSortMode] = useState<"liquidations" | "liquidity" | "alphabetical">("liquidations");
  const [dcaSaveTrigger, setDcaSaveTrigger] = useState(0);

  // Fetch available symbols from Aster DEX
  const { data: symbols, isLoading: symbolsLoading } = useQuery({
    queryKey: ['/api/symbols'],
    select: (data: any) => {
      return data.symbols
        .filter((s: any) => s.status === 'TRADING')
        .map((s: any) => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset
        }))
        .sort((a: any, b: any) => a.symbol.localeCompare(b.symbol));
    }
  });

  // Fetch liquidation counts from database
  const { data: liquidationCounts, isLoading: countsLoading } = useQuery({
    queryKey: ['/api/analytics/assets'],
    select: (data: any[]) => {
      const countMap: Record<string, number> = {};
      data.forEach((asset: any) => {
        countMap[asset.symbol] = parseInt(asset.count);
      });
      return countMap;
    }
  });

  // Fetch asset performance data (wins/losses) - NO polling, WebSocket provides updates
  const { data: performanceData, isLoading: performanceLoading } = useQuery<any[]>({
    queryKey: ['/api/analytics/asset-performance'],
    staleTime: Infinity, // Never refetch - WebSocket provides updates
  });

  // Create a map for quick performance lookup
  const performanceMap = new Map(
    performanceData?.map(p => [p.symbol, p]) || []
  );

  // Merge symbols with liquidation counts (will be sorted after form is initialized)
  const mergedAssets = symbols?.map((symbol: any) => ({
    ...symbol,
    liquidationCount: liquidationCounts?.[symbol.symbol] || 0,
  }));

  const assetsLoading = symbolsLoading || countsLoading;

  // Fetch current strategies
  const { data: strategies, isLoading: strategiesLoading } = useQuery<Strategy[]>({
    queryKey: ['/api/strategies'],
  });

  // Fetch DCA settings for active strategy to get adaptive TP/SL flags
  const { data: dcaSettings } = useQuery<DCASettings>({
    queryKey: [`/api/strategies/${activeStrategy?.id}/dca`],
    enabled: !!activeStrategy?.id,
  });

  // Fetch exchange account balance - NO HTTP polling, populated by WebSocket only
  const { data: exchangeAccount, isLoading: accountLoading } = useQuery<any>({
    queryKey: ['/api/live/account'],
    queryFn: () => {
      throw new Error('This query should only be populated by WebSocket events');
    },
    staleTime: Infinity, // Never refetch - WebSocket provides updates
    gcTime: Infinity,
    retry: false,
  });

  // Form setup with default values
  const form = useForm<StrategyFormData>({
    resolver: zodResolver(strategyFormSchema),
    defaultValues: {
      name: "Liquidation Counter-Trade",
      selectedAssets: ["ASTERUSDT"],
      percentileThreshold: 50,
      liquidationLookbackHours: 1,
      maxLayers: 5,
      profitTargetPercent: "1.0",
      stopLossPercent: "2.0",
      marginMode: "cross",
      leverage: 1,
      orderDelayMs: 1000,
      dcaLayerDelayMs: 30000,
      slippageTolerancePercent: "0.5",
      orderType: "limit",
      maxRetryDurationMs: 30000,
      priceChaseMode: true,
      marginAmount: "10.0",
      hedgeMode: false,
      maxOpenPositions: 5,
      maxPortfolioRiskPercent: "15.0",
    }
  });

  // Calculate account balance based on form values and exchange account
  const marginPercent = parseFloat(form.watch("marginAmount") || "10");
  
  // Get account balance from exchange, fallback to 10000 for calculations
  const accountBalance = exchangeAccount?.totalWalletBalance 
    ? parseFloat(exchangeAccount.totalWalletBalance) 
    : 10000;
  
  // Calculate actual trading balance (account balance × margin usage %)
  const currentBalance = accountBalance * (marginPercent / 100);
  // Note: Trade size is now calculated by DCA system based on dcaMaxRiskPercent
  const tradeSize = currentBalance * 0.05; // Fallback for liquidity checks only

  // Fetch real liquidity data for symbols with account balance for recommendations
  const { data: liquidityData, isLoading: liquidityLoading } = useQuery({
    // Only use symbols in queryKey to prevent refetching on every form value change
    // Server-side caching handles the actual data freshness
    queryKey: ['/api/analytics/liquidity/batch', symbols?.map((s: any) => s.symbol).sort().join(',')],
    enabled: !!symbols && symbols.length > 0,
    queryFn: async () => {
      if (!symbols || symbols.length === 0) return [];
      
      const response = await apiRequest('POST', '/api/analytics/liquidity/batch', {
        symbols: symbols.map((s: any) => s.symbol),
        tradeSize: tradeSize,
        accountBalance: currentBalance
      });
      return await response.json();
    },
    staleTime: 60000, // Cache for 60 seconds (server also caches for 15s)
    refetchOnWindowFocus: false, // Prevent refetching when window gets focus
    refetchOnMount: false, // Prevent refetching on component mount if data exists
  });

  // Create liquidity lookup map
  const liquidityMap: Record<string, any> = {};
  liquidityData?.forEach((item: any) => {
    liquidityMap[item.symbol] = item;
  });

  // Merge liquidity data with assets
  const assetsWithLiquidity = mergedAssets?.map((asset: any) => ({
    ...asset,
    liquidity: liquidityMap[asset.symbol] || { totalLiquidity: 0, canHandleTradeSize: false, recommended: false },
  }));

  // Calculate recommendations based on selected assets
  const selectedSymbols = form.watch("selectedAssets") || [];
  const selectedAssetsWithLiquidity = assetsWithLiquidity?.filter((a: any) => selectedSymbols.includes(a.symbol)) || [];
  
  // Find the asset with lowest liquidity (the limiting factor)
  const limitingAsset = selectedAssetsWithLiquidity.length > 0 
    ? selectedAssetsWithLiquidity.reduce((min: any, asset: any) => 
        (asset.liquidity?.minSideLiquidity || 0) < (min.liquidity?.minSideLiquidity || Infinity) 
          ? asset 
          : min
      )
    : null;

  // Calculate recommended order size based on limiting asset
  const recommendedOrderSize = limitingAsset?.liquidity?.maxSafeOrderSize || 0;
  const recommendedPositionSizePercent = currentBalance > 0 
    ? Math.min(100, Math.floor((recommendedOrderSize / currentBalance) * 100))
    : 0;

  // Calculate recommended risk parameters based on account tier
  const accountTier = currentBalance < 1000 ? 'micro' : 
                     currentBalance < 10000 ? 'small' : 
                     currentBalance < 50000 ? 'mid' : 'large';
  
  const recommendedStopLoss = accountTier === 'micro' ? 1.0 : 
                             accountTier === 'small' ? 1.5 : 
                             accountTier === 'mid' ? 2.0 : 2.5;
  
  const recommendedTakeProfit = recommendedStopLoss * (limitingAsset?.liquidity?.liquidityRatio > 10 ? 2 : 1.5);
  
  const recommendedMaxLayers = limitingAsset && recommendedOrderSize > 0
    ? Math.min(
        accountTier === 'micro' ? 2 : accountTier === 'small' ? 3 : accountTier === 'mid' ? 5 : 7,
        Math.floor((limitingAsset.liquidity?.minSideLiquidity || 0) / (recommendedOrderSize * 1.5))
      )
    : 1;

  // Get list of recommended assets for this account size
  const recommendedAssets = assetsWithLiquidity?.filter((a: any) => a.liquidity?.recommended) || [];

  // Sort assets based on selected mode
  const availableAssets = assetsWithLiquidity?.slice().sort((a: any, b: any) => {
    if (assetSortMode === "alphabetical") {
      return a.symbol.localeCompare(b.symbol);
    } else if (assetSortMode === "liquidity") {
      // Sort by REAL liquidity - use minSideLiquidity (the limiting factor for trades)
      return (b.liquidity?.minSideLiquidity || 0) - (a.liquidity?.minSideLiquidity || 0);
    } else {
      // Default: sort by liquidation count
      return b.liquidationCount - a.liquidationCount;
    }
  });

  // Get liquidity status for all available symbols (colored indicators)
  const allSymbols = availableAssets?.map((a: any) => a.symbol) || [];
  const leverage = form.watch("leverage") || 5;
  const { liquidityStatusMap } = useLiquidityStatus(allSymbols, accountBalance, leverage);

  // Create strategy mutation
  const createStrategyMutation = useMutation({
    mutationFn: async (data: StrategyFormData) => {
      const response = await apiRequest('POST', '/api/strategies', {
        ...data,
        isActive: false,
      });
      return await response.json() as Strategy;
    },
    onSuccess: (strategy) => {
      toast({
        title: "Strategy Created",
        description: `Strategy "${strategy.name}" has been created successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      setActiveStrategy(strategy);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to create strategy. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Update strategy mutation
  const updateStrategyMutation = useMutation({
    mutationFn: async (data: StrategyFormData) => {
      if (!activeStrategy) throw new Error('No active strategy to update');
      
      console.log('Sending update request with data:', data);
      try {
        const response = await apiRequest('PUT', `/api/strategies/${activeStrategy.id}`, data);
        const result = await response.json() as Strategy;
        console.log('Update response:', result);
        return result;
      } catch (err) {
        console.error('Update failed with error:', err);
        console.error('Error type:', err?.constructor?.name);
        console.error('Error message:', err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    onSuccess: async (strategy) => {
      toast({
        title: "✓ Settings Saved",
        description: `All changes have been saved successfully.`,
        duration: 3000,
      });
      
      // Wait for query invalidation to complete before updating form
      await queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      setActiveStrategy(strategy);
      
      // Reset form with updated strategy data to refresh UI
      // Convert number fields to strings to match form field types
      form.reset({
        name: strategy.name,
        selectedAssets: strategy.selectedAssets,
        percentileThreshold: strategy.percentileThreshold,
        liquidationLookbackHours: strategy.liquidationLookbackHours,
        maxLayers: strategy.maxLayers,
        profitTargetPercent: String(strategy.profitTargetPercent),
        stopLossPercent: String(strategy.stopLossPercent),
        marginMode: strategy.marginMode,
        leverage: strategy.leverage,
        orderDelayMs: strategy.orderDelayMs,
        dcaLayerDelayMs: strategy.dcaLayerDelayMs,
        slippageTolerancePercent: String(strategy.slippageTolerancePercent),
        orderType: strategy.orderType,
        maxRetryDurationMs: strategy.maxRetryDurationMs,
        priceChaseMode: strategy.priceChaseMode,
        marginAmount: String(strategy.marginAmount),
        hedgeMode: strategy.hedgeMode,
        maxOpenPositions: strategy.maxOpenPositions || 5,
        maxPortfolioRiskPercent: String(strategy.maxPortfolioRiskPercent || "15.0"),
      });
    },
    onError: (error) => {
      console.error('Update strategy error (full):', error);
      console.error('Error keys:', Object.keys(error || {}));
      console.error('Error JSON:', JSON.stringify(error, null, 2));
      
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      toast({
        title: "Error",
        description: `Failed to update strategy: ${errorMessage}`,
        variant: "destructive",
      });
    }
  });

  // Start strategy mutation
  const startStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const response = await apiRequest('POST', `/api/strategies/${strategyId}/start`);
      return await response.json() as Strategy;
    },
    onSuccess: (updatedStrategy) => {
      setIsStrategyRunning(true);
      setActiveStrategy(updatedStrategy);
      toast({
        title: "Strategy Started",
        description: "Live trading strategy is now active and monitoring liquidations.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start strategy. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Pause strategy mutation
  const pauseStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const response = await apiRequest('POST', `/api/strategies/${strategyId}/pause`);
      return await response.json() as Strategy;
    },
    onSuccess: (updatedStrategy) => {
      setActiveStrategy(updatedStrategy);
      toast({
        title: "Strategy Paused",
        description: "Trading strategy has been paused. Resume anytime to continue.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to pause strategy. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Delete strategy mutation
  const deleteStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const response = await apiRequest('DELETE', `/api/strategies/${strategyId}`);
      return response.status === 204;
    },
    onSuccess: () => {
      toast({
        title: "Strategy Deleted",
        description: "Strategy has been deleted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      setActiveStrategy(null);
      setIsStrategyRunning(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete strategy. Please try again.",
        variant: "destructive",
      });
    }
  });


  // Test API connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/settings/test-connection', {});
      return await response.json();
    },
    onSuccess: (data) => {
      setApiTestResult(data);
      if (data.success) {
        toast({
          title: "Connection Successful",
          description: "Your Aster DEX API credentials are working correctly!",
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.error || "Failed to connect to Aster DEX API.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      setApiTestResult({
        success: false,
        message: error?.message || "Unknown error occurred"
      });
      toast({
        title: "Connection Test Failed",
        description: error?.message || "Failed to test API connection. Please try again.",
        variant: "destructive",
      });
    }
  });

  // Export settings handler
  const handleExportSettings = async () => {
    try {
      const response = await fetch('/api/settings/export');
      if (!response.ok) throw new Error('Export failed');
      
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Format: settings_YYYY-MM-DD_HH-MM-SS.json
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      a.download = `settings_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.json`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Settings Exported",
        description: "Your settings have been downloaded as a JSON file.",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export settings. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Import settings handler
  const handleImportSettings = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e: any) => {
      try {
        const file = e.target?.files?.[0];
        if (!file) return;
        
        const text = await file.text();
        const data = JSON.parse(text);
        
        const response = await apiRequest('POST', '/api/settings/import', data);
        if (!response.ok) throw new Error('Import failed');
        
        const result = await response.json();
        
        toast({
          title: "Settings Imported",
          description: result.message || "Your settings have been restored successfully.",
        });
        
        // Refresh all data
        queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
        queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
        
        // Reload the page to ensure all components refresh
        setTimeout(() => window.location.reload(), 1000);
      } catch (error) {
        toast({
          title: "Import Failed",
          description: "Failed to import settings. Please check the file format.",
          variant: "destructive",
        });
      }
    };
    input.click();
  };

  const onSubmit = (data: StrategyFormData) => {
    if (activeStrategy) {
      updateStrategyMutation.mutate(data);
    } else {
      createStrategyMutation.mutate(data);
    }
  };

  // Handler for "Save Settings" button - saves both main form AND DCA settings
  const handleSaveSettings = () => {
    // Save main strategy form
    form.handleSubmit(onSubmit)();
    
    // Trigger DCA settings save (includes adaptive TP/SL)
    if (activeStrategy) {
      setDcaSaveTrigger(prev => prev + 1);
    }
  };

  const handleDialogClose = (newOpen: boolean) => {
    if (!newOpen && form.formState.isDirty) {
      form.handleSubmit(onSubmit)();
    }
    onOpenChange(newOpen);
  };

  const handleStartStrategy = async () => {
    if (activeStrategy) {
      // First, save any form changes before starting
      const formValues = form.getValues();
      const hasChanges = JSON.stringify(formValues) !== JSON.stringify({
        name: activeStrategy.name,
        selectedAssets: activeStrategy.selectedAssets,
        percentileThreshold: activeStrategy.percentileThreshold,
        liquidationLookbackHours: activeStrategy.liquidationLookbackHours,
        maxLayers: activeStrategy.maxLayers,
        profitTargetPercent: activeStrategy.profitTargetPercent,
        stopLossPercent: activeStrategy.stopLossPercent,
        marginMode: activeStrategy.marginMode,
        leverage: activeStrategy.leverage,
        orderDelayMs: activeStrategy.orderDelayMs,
        slippageTolerancePercent: activeStrategy.slippageTolerancePercent,
        orderType: activeStrategy.orderType,
        maxRetryDurationMs: activeStrategy.maxRetryDurationMs,
        marginAmount: activeStrategy.marginAmount,
        hedgeMode: activeStrategy.hedgeMode,
      });

      if (hasChanges) {
        // Save changes first, then start after save completes
        try {
          await updateStrategyMutation.mutateAsync(formValues);
          startStrategyMutation.mutate(activeStrategy.id);
        } catch (error) {
          // Update failed, don't start trading
          return;
        }
      } else {
        // No changes, just start
        startStrategyMutation.mutate(activeStrategy.id);
      }
    }
  };

  const handlePauseStrategy = () => {
    if (activeStrategy) {
      pauseStrategyMutation.mutate(activeStrategy.id);
    }
  };

  const handleDeleteStrategy = () => {
    if (activeStrategy) {
      deleteStrategyMutation.mutate(activeStrategy.id);
    }
  };

  // Load and maintain active strategy
  useEffect(() => {
    if (strategies && strategies.length > 0) {
      let strategy: Strategy | null = null;
      
      // Try to find the current active strategy in the updated strategies list
      if (activeStrategy) {
        strategy = strategies.find(s => s.id === activeStrategy.id) || null;
      }
      
      // If no current strategy or it's not found, use the first available strategy
      if (!strategy) {
        strategy = strategies[0];
      }
      
      // Update state with the strategy (could be updated data for existing strategy)
      setActiveStrategy(strategy);
      setIsStrategyRunning(strategy.isActive);
      
      // Always update form with latest strategy data to ensure UI reflects current state
      form.reset({
        name: strategy.name,
        selectedAssets: strategy.selectedAssets,
        percentileThreshold: strategy.percentileThreshold,
        liquidationLookbackHours: strategy.liquidationLookbackHours,
        maxLayers: strategy.maxLayers,
        profitTargetPercent: strategy.profitTargetPercent,
        stopLossPercent: strategy.stopLossPercent,
        marginMode: strategy.marginMode,
        leverage: strategy.leverage,
        orderDelayMs: strategy.orderDelayMs,
        dcaLayerDelayMs: strategy.dcaLayerDelayMs,
        slippageTolerancePercent: strategy.slippageTolerancePercent,
        orderType: strategy.orderType,
        maxRetryDurationMs: strategy.maxRetryDurationMs,
        priceChaseMode: strategy.priceChaseMode,
        marginAmount: strategy.marginAmount,
        hedgeMode: strategy.hedgeMode,
        maxOpenPositions: strategy.maxOpenPositions || 5,
        maxPortfolioRiskPercent: String(strategy.maxPortfolioRiskPercent || "15.0"),
      });
    } else if (strategies && strategies.length === 0) {
      // No strategies available, clear active strategy
      setActiveStrategy(null);
      setIsStrategyRunning(false);
    }
  }, [strategies, form]); // Remove activeStrategy from dependencies to prevent stale state

  if (assetsLoading || strategiesLoading) {
    return (
      <Dialog open={open} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-4xl max-h-[90vh]" aria-describedby="loading-description">
          <DialogHeader>
            <DialogTitle>Global Settings</DialogTitle>
            <DialogDescription id="loading-description">Loading global settings...</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="h-4 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]" data-testid="dialog-trading-strategy" aria-describedby="strategy-dialog-description">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Global Settings</span>
            {isStrategyRunning && (
              <Badge variant="default" className="bg-lime-600">
                <div className="w-2 h-2 bg-white rounded-full mr-1 animate-pulse" />
                Active
              </Badge>
            )}
            {activeStrategy && !isStrategyRunning && (
              <Badge variant="secondary">Stopped</Badge>
            )}
          </DialogTitle>
          <DialogDescription id="strategy-dialog-description">
            Configure your trading parameters and position sizing
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-200px)] pr-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              {/* Hedge Mode Toggle */}
              <FormField
                control={form.control}
                name="hedgeMode"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel data-testid="label-hedge-mode">Hedge Mode</FormLabel>
                      <FormDescription>
                        Allow simultaneous long and short positions on the same asset when conditions are met
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        data-testid="switch-hedge-mode"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={false}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <Separator />

              {/* Asset Selection */}
              <FormField
                control={form.control}
                name="selectedAssets"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel data-testid="label-asset-selection">Assets to Monitor</FormLabel>
                      <Select 
                        value={assetSortMode} 
                        onValueChange={(value: any) => setAssetSortMode(value)}
                      >
                        <SelectTrigger className="w-[200px]" data-testid="select-asset-sort">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="liquidations">Most Active</SelectItem>
                          <SelectItem value="liquidity">Best Liquidity</SelectItem>
                          <SelectItem value="alphabetical">Alphabetical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <FormDescription>
                      {liquidityLoading ? (
                        <span>Loading real-time order book data...</span>
                      ) : assetSortMode === "liquidity" ? (
                        <span>Sorted by limiting side liquidity (min of bid/ask depth). Your trade size: ${(tradeSize).toFixed(0)}. ✓ = both sides can fill your order.</span>
                      ) : assetSortMode === "alphabetical" ? (
                        <span>Assets sorted alphabetically</span>
                      ) : (
                        <span>Sorted by liquidation activity (not real liquidity - switch to "Best Liquidity" for real order book depth)</span>
                      )}
                    </FormDescription>
                    <div className="space-y-2 mt-2">
                      {/* Render selected assets in grid format with details */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {availableAssets?.filter((asset: any) => field.value.includes(asset.symbol)).map((asset: any) => (
                          <div
                            key={asset.symbol}
                            className="border rounded-md p-2 space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-sm">{asset.symbol}</span>
                                  {liquidityStatusMap.get(asset.symbol) && (
                                    <div
                                      className={`w-2 h-2 ${liquidityStatusMap.get(asset.symbol)?.color}`}
                                      title={liquidityStatusMap.get(asset.symbol)?.tooltip}
                                    />
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground">({asset.liquidationCount})</span>
                              </div>
                              <Checkbox
                                data-testid={`checkbox-asset-${asset.symbol}`}
                                id={`asset-${asset.symbol}`}
                                checked={true}
                                disabled={false}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    field.onChange(field.value.filter(s => s !== asset.symbol));
                                  }
                                }}
                              />
                            </div>
                            {!performanceLoading && performanceMap.get(asset.symbol) && performanceMap.get(asset.symbol).wins + performanceMap.get(asset.symbol).losses > 0 && (
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge 
                                  variant="secondary" 
                                  className="text-[10px] px-1 py-0 h-4 bg-chart-2/10 text-chart-2 hover:bg-chart-2/20 border-chart-2/20"
                                  data-testid={`badge-wins-${asset.symbol}`}
                                >
                                  {performanceMap.get(asset.symbol).wins}W
                                </Badge>
                                <Badge 
                                  variant="secondary" 
                                  className="text-[10px] px-1 py-0 h-4 bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"
                                  data-testid={`badge-losses-${asset.symbol}`}
                                >
                                  {performanceMap.get(asset.symbol).losses}L
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {((performanceMap.get(asset.symbol).wins / (performanceMap.get(asset.symbol).wins + performanceMap.get(asset.symbol).losses)) * 100).toFixed(0)}%
                                </span>
                              </div>
                            )}
                            {!liquidityLoading && asset.liquidity && asset.liquidity.maxSafeOrderSize > 0 && (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1 flex-wrap">
                                  {asset.liquidity.riskLevel === 'safe' ? (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                                      ✓ Max: ${asset.liquidity.maxSafeOrderSize >= 1000 ? (asset.liquidity.maxSafeOrderSize / 1000).toFixed(1) + 'k' : asset.liquidity.maxSafeOrderSize.toFixed(0)}
                                    </Badge>
                                  ) : asset.liquidity.riskLevel === 'caution' ? (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                                      ⚠ Max: ${asset.liquidity.maxSafeOrderSize >= 1000 ? (asset.liquidity.maxSafeOrderSize / 1000).toFixed(1) + 'k' : asset.liquidity.maxSafeOrderSize.toFixed(0)}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
                                      ⛔ Max: ${asset.liquidity.maxSafeOrderSize >= 1000 ? (asset.liquidity.maxSafeOrderSize / 1000).toFixed(1) + 'k' : asset.liquidity.maxSafeOrderSize.toFixed(0)}
                                    </Badge>
                                  )}
                                  <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-muted/50">
                                    {asset.liquidity.participationRate.toFixed(1)}% {asset.liquidity.liquidityType.includes('volume') ? 'vol' : 'book'}
                                  </Badge>
                                </div>
                                {asset.liquidity.clipSize > 0 && (
                                  <div className="text-[10px] text-muted-foreground">
                                    Clip: ${asset.liquidity.clipSize >= 1000 ? (asset.liquidity.clipSize / 1000).toFixed(1) + 'k' : asset.liquidity.clipSize.toFixed(0)}/order
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      
                      {/* Render all unselected assets in a single collapsible group */}
                      {availableAssets?.filter((asset: any) => !field.value.includes(asset.symbol)).length > 0 && (
                        <Collapsible defaultOpen={false} className="border rounded-md">
                          <CollapsibleTrigger className="w-full" data-testid="button-toggle-unselected-assets">
                            <div className="flex items-center justify-between p-2 hover-elevate">
                              <div className="flex items-center gap-2">
                                <ChevronDown className="h-4 w-4 transition-transform" />
                                <span className="font-medium text-sm text-muted-foreground">
                                  Other Assets ({availableAssets?.filter((asset: any) => !field.value.includes(asset.symbol)).length})
                                </span>
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t mx-2">
                              {availableAssets?.filter((asset: any) => !field.value.includes(asset.symbol)).map((asset: any) => (
                                <div
                                  key={asset.symbol}
                                  className="flex items-center justify-between p-2 hover-elevate border-b last:border-b-0"
                                >
                                  <div className="flex items-center gap-2 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-medium text-sm">{asset.symbol}</span>
                                      {liquidityStatusMap.get(asset.symbol) && (
                                        <div
                                          className={`w-2 h-2 ${liquidityStatusMap.get(asset.symbol)?.color}`}
                                          title={liquidityStatusMap.get(asset.symbol)?.tooltip}
                                        />
                                      )}
                                    </div>
                                    <span className="text-xs text-muted-foreground">({asset.liquidationCount})</span>
                                  </div>
                                  <Checkbox
                                    data-testid={`checkbox-asset-${asset.symbol}`}
                                    id={`asset-${asset.symbol}`}
                                    checked={false}
                                    disabled={false}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        field.onChange([...field.value, asset.symbol]);
                                      }
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Minimum Order Size Requirements */}
              {selectedSymbols.length > 0 && (
                <div className="rounded-lg border p-4 space-y-3 bg-orange-500/5 border-orange-500/20" data-testid="min-order-reminder">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-2 flex-1">
                      <h3 className="font-semibold text-orange-900 dark:text-orange-100">⚠️ Exchange Minimum Order Size</h3>
                      <div className="text-sm text-orange-800 dark:text-orange-200 space-y-2">
                        <p>Aster DEX requires a <strong>minimum $5.00 notional value</strong> per order.</p>
                        <div className="bg-orange-200/50 dark:bg-orange-900/30 p-3 rounded space-y-1">
                          <p className="font-semibold">Formula: Notional = (Balance × Margin% × StartStep% × Leverage) / 10,000</p>
                          <p className="text-xs">
                            • Layer 1 sized by Start Step % (default 0.1%), NOT Max Risk %
                          </p>
                          <p className="text-xs">
                            • Example: $802 balance, 80% margin, 0.1% step, 10x leverage = $6.42 notional ✓
                          </p>
                          <p className="text-xs">
                            • <strong>Increase Start Step %</strong> in DCA Settings for larger Layer 1 positions
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              {/* Liquidation Threshold */}
              <FormField
                control={form.control}
                name="percentileThreshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel data-testid="label-percentile-threshold">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Percentile Threshold: {field.value}%
                      </div>
                    </FormLabel>
                    <FormDescription>
                      Trigger trades when liquidation volume exceeds this percentile
                    </FormDescription>
                    <FormControl>
                      <Slider
                        data-testid="slider-percentile-threshold"
                        min={1}
                        max={100}
                        step={1}
                        value={[field.value]}
                        onValueChange={(value) => field.onChange(value[0])}
                        disabled={false}
                        className="w-full"
                      />
                    </FormControl>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1%</span>
                      <span>100%</span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Liquidation Lookback Window */}
              <FormField
                control={form.control}
                name="liquidationLookbackHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel data-testid="label-liquidation-lookback">
                      Lookback Window: {field.value} hour{field.value !== 1 ? 's' : ''}
                    </FormLabel>
                    <FormDescription>
                      Compare liquidations against historical data from the past 1-24 hours
                    </FormDescription>
                    <FormControl>
                      <Select 
                        value={field.value.toString()} 
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        disabled={false}
                      >
                        <SelectTrigger data-testid="select-liquidation-lookback">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1 hour</SelectItem>
                          <SelectItem value="2">2 hours</SelectItem>
                          <SelectItem value="4">4 hours</SelectItem>
                          <SelectItem value="6">6 hours</SelectItem>
                          <SelectItem value="8">8 hours</SelectItem>
                          <SelectItem value="12">12 hours</SelectItem>
                          <SelectItem value="18">18 hours</SelectItem>
                          <SelectItem value="24">24 hours</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Position Averaging Settings */}
              <div className="space-y-4">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Position Averaging
                </Label>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="maxLayers"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-2">
                          <FormLabel data-testid="label-max-layers">Max Layers</FormLabel>
                          {limitingAsset && field.value > recommendedMaxLayers && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                              ⚠ High for liquidity
                            </Badge>
                          )}
                        </div>
                        <FormControl>
                          <Input
                            data-testid="input-max-layers"
                            type="number"
                            min="1"
                            max="100"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                            disabled={false}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Maximum positions to open for averaging (1-100)
                        </FormDescription>
                        {limitingAsset && recommendedMaxLayers > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-xs">
                            <Lightbulb className="h-3 w-3 text-primary" />
                            <span className="text-primary font-medium">
                              Suggested: {recommendedMaxLayers} based on {accountTier} account tier and current liquidity
                            </span>
                          </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
                  <strong>Note:</strong> Position sizing is now controlled by the DCA Settings (Advanced) section below. The <strong>Max Risk %</strong> parameter determines total position sizing across all layers.
                </div>
              </div>

              <Separator />

              {/* Risk Management */}
              <div className="space-y-4">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Risk Management (Fallback Values)
                </Label>

                {/* Adaptive Mode Active Indicator */}
                {(dcaSettings?.adaptiveTpEnabled || dcaSettings?.adaptiveSlEnabled) && (
                  <div className="bg-primary/10 border border-primary/20 p-3 rounded-md">
                    <div className="flex items-start gap-2">
                      <Activity className="h-4 w-4 text-primary mt-0.5" />
                      <div className="flex-1 text-sm">
                        <strong className="text-primary">
                          {dcaSettings.adaptiveTpEnabled && dcaSettings.adaptiveSlEnabled ? (
                            <>Adaptive Mode Active — TP & SL</>
                          ) : dcaSettings.adaptiveTpEnabled ? (
                            <>Adaptive Mode Active — TP Only</>
                          ) : (
                            <>Adaptive Mode Active — SL Only</>
                          )}
                        </strong>
                        <p className="text-muted-foreground mt-1">
                          {dcaSettings.adaptiveTpEnabled && dcaSettings.adaptiveSlEnabled ? (
                            <>TP and SL are automatically calculated using ATR (volatility). Values below are only used as fallbacks if adaptive calculation fails.</>
                          ) : dcaSettings.adaptiveTpEnabled ? (
                            <>Take Profit is automatically calculated using ATR. Stop Loss uses the fixed value below.</>
                          ) : (
                            <>Stop Loss is automatically calculated using ATR. Take Profit uses the fixed value below.</>
                          )}
                        </p>
                        {dcaSettings.adaptiveTpEnabled && dcaSettings.adaptiveSlEnabled && (
                          <p className="text-xs text-primary/80 mt-2">
                            Configure adaptive settings in DCA Settings (Advanced) section below.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="profitTargetPercent"
                    render={({ field }) => (
                      <FormItem className={dcaSettings?.adaptiveTpEnabled ? "opacity-60" : ""}>
                        <div className="flex items-center gap-2">
                          <FormLabel data-testid="label-profit-target">
                            Take Profit % {dcaSettings?.adaptiveTpEnabled && <span className="text-xs text-muted-foreground">(Fallback)</span>}
                          </FormLabel>
                          {limitingAsset && parseFloat(field.value) < recommendedTakeProfit * 0.8 && recommendedTakeProfit > 0 && !dcaSettings?.adaptiveTpEnabled && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                              ⚠ Too tight
                            </Badge>
                          )}
                        </div>
                        <FormControl>
                          <Input
                            data-testid="input-profit-target"
                            type="text"
                            placeholder="1.0"
                            {...field}
                            disabled={false}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          {dcaSettings?.adaptiveTpEnabled ? (
                            <>Fallback value used only if ATR-based calculation fails</>
                          ) : (
                            <>Close when profit reaches this % (0.1-20%)
                              {limitingAsset && recommendedTakeProfit > 0 && (
                                <span className="text-primary ml-1">(Recommended: {recommendedTakeProfit.toFixed(1)}%)</span>
                              )}
                            </>
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="stopLossPercent"
                    render={({ field }) => (
                      <FormItem className={dcaSettings?.adaptiveSlEnabled ? "opacity-60" : ""}>
                        <div className="flex items-center gap-2">
                          <FormLabel data-testid="label-stop-loss">
                            Stop Loss % {dcaSettings?.adaptiveSlEnabled && <span className="text-xs text-muted-foreground">(Fallback)</span>}
                          </FormLabel>
                          {limitingAsset && parseFloat(field.value) > recommendedStopLoss * 1.5 && recommendedStopLoss > 0 && !dcaSettings?.adaptiveSlEnabled && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                              ⚠ Too wide
                            </Badge>
                          )}
                        </div>
                        <FormControl>
                          <Input
                            data-testid="input-stop-loss"
                            type="text"
                            placeholder="2.0"
                            {...field}
                            disabled={false}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          {dcaSettings?.adaptiveSlEnabled ? (
                            <>Fallback value used only if ATR-based calculation fails</>
                          ) : (
                            <>Close when loss reaches this % (0.1-50%)
                              {limitingAsset && recommendedStopLoss > 0 && (
                                <span className="text-primary ml-1">(Recommended: {recommendedStopLoss.toFixed(1)}%)</span>
                              )}
                            </>
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Separator />

              {/* Portfolio Risk Limits */}
              <div className="space-y-4">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Portfolio Risk Limits
                </Label>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="maxOpenPositions"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-max-open-positions">Max Open Positions</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-max-open-positions"
                            type="number"
                            min="0"
                            max="20"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            disabled={false}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Maximum simultaneous positions (0 = unlimited)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="maxPortfolioRiskPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-max-portfolio-risk">Max Total Risk %</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-max-portfolio-risk"
                            type="text"
                            placeholder="15.0"
                            {...field}
                            disabled={false}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Maximum aggregate risk across all positions (1-100%)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
                  <strong>Protection:</strong> New positions will be blocked when either limit is reached. This prevents excessive risk exposure across your portfolio.
                </div>
              </div>

              <Separator />

              {/* Account Settings */}
              <div className="space-y-4">
                <Label className="text-base font-medium flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Account Settings
                </Label>
                
                <div className="space-y-2">
                  <FormLabel>
                    Exchange Account Balance
                    {accountLoading && <span className="text-xs text-muted-foreground ml-2">Loading...</span>}
                  </FormLabel>
                  <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border">
                    {accountLoading ? (
                      <div className="text-muted-foreground">Fetching from Aster DEX...</div>
                    ) : exchangeAccount?.totalWalletBalance ? (
                      <>
                        <div className="flex-1">
                          <div className="text-2xl font-semibold font-mono" data-testid="text-account-balance">
                            ${parseFloat(exchangeAccount.totalWalletBalance).toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            Tier: {accountBalance < 1000 ? 'Micro' : accountBalance < 10000 ? 'Small' : accountBalance < 50000 ? 'Mid' : 'Large'} Account
                          </div>
                        </div>
                        <div className="text-green-600 dark:text-green-400">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">
                        Unable to fetch balance. Please check API credentials.
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Automatically fetched from your Aster DEX account
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="marginMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-margin-mode">Margin Mode</FormLabel>
                        <FormControl>
                          <Select 
                            value={field.value} 
                            onValueChange={field.onChange}
                            disabled={false}
                          >
                            <SelectTrigger data-testid="select-margin-mode">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cross">Cross</SelectItem>
                              <SelectItem value="isolated">Isolated</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription className="text-xs">
                          Risk mode for positions
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="leverage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-leverage">Leverage: {field.value}x</FormLabel>
                        <FormControl>
                          <Slider
                            data-testid="slider-leverage"
                            min={1}
                            max={125}
                            step={1}
                            value={[field.value]}
                            onValueChange={(value) => field.onChange(value[0])}
                            disabled={false}
                          />
                        </FormControl>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>1x</span>
                          <span>125x</span>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="marginAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-margin-amount">Account Usage %</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-margin-amount"
                            type="text"
                            placeholder="10.0"
                            {...field}
                            disabled={false}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Max % of account to use (1-100%)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Separator />

              {/* Order Execution */}
              <div className="space-y-4">
                <Label className="text-base font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Order Execution
                </Label>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="orderType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-order-type">Order Type</FormLabel>
                        <FormControl>
                          <Select 
                            value={field.value} 
                            onValueChange={field.onChange}
                            disabled={false}
                          >
                            <SelectTrigger data-testid="select-order-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="market">Market</SelectItem>
                              <SelectItem value="limit">Limit</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription className="text-xs">
                          Market: Instant fill / Limit: Better price
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="slippageTolerancePercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-slippage">Slippage Tolerance %</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-slippage"
                            type="text"
                            placeholder="0.5"
                            {...field}
                            disabled={false}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Max price deviation allowed (0.1-5%)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="orderDelayMs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-order-delay">Order Delay: {field.value}ms</FormLabel>
                        <FormControl>
                          <Slider
                            data-testid="slider-order-delay"
                            min={100}
                            max={30000}
                            step={100}
                            value={[field.value]}
                            onValueChange={(value) => field.onChange(value[0])}
                            disabled={false}
                          />
                        </FormControl>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>100ms</span>
                          <span>30s</span>
                        </div>
                        <FormDescription className="text-xs">
                          Delay before placing any order
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dcaLayerDelayMs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-dca-layer-delay">DCA Layer Delay: {field.value / 1000}s</FormLabel>
                        <FormControl>
                          <Slider
                            data-testid="slider-dca-layer-delay"
                            min={0}
                            max={300000}
                            step={1000}
                            value={[field.value]}
                            onValueChange={(value) => field.onChange(value[0])}
                            disabled={false}
                          />
                        </FormControl>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>0s (No delay)</span>
                          <span>5min</span>
                        </div>
                        <FormDescription className="text-xs">
                          Minimum time between DCA layer fills on same symbol
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="maxRetryDurationMs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-max-retry">Max Retry: {field.value / 1000}s</FormLabel>
                        <FormControl>
                          <Slider
                            data-testid="slider-max-retry"
                            min={5000}
                            max={300000}
                            step={5000}
                            value={[field.value]}
                            onValueChange={(value) => field.onChange(value[0])}
                            disabled={false}
                          />
                        </FormControl>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>5s</span>
                          <span>300s</span>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priceChaseMode"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel data-testid="label-price-chase">Price Chase Mode</FormLabel>
                          <FormDescription>
                            Automatically update limit orders to chase market price during fast-moving liquidation events, ensuring DCA layers always get filled
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            data-testid="switch-price-chase"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Separator />

              {/* DCA Settings (Advanced) */}
              {activeStrategy && (
                <DCASettingsSection
                  strategyId={activeStrategy.id}
                  isStrategyRunning={isStrategyRunning}
                  saveTrigger={dcaSaveTrigger}
                />
              )}

              <Separator />

              {/* VWAP Direction Filter */}
              {activeStrategy && (
                <VWAPSettingsSection
                  strategyId={activeStrategy.id}
                  isStrategyRunning={isStrategyRunning}
                />
              )}

              <Separator />

              {/* Adaptive Position Sizing */}
              {activeStrategy && (
                <AdaptiveSizingSettingsSection
                  strategyId={activeStrategy.id}
                  isStrategyRunning={isStrategyRunning}
                />
              )}

              <Separator />

              {/* Exchange Limits */}
              <ExchangeLimitsSection />

              <Separator />

              {/* API Connection */}
              <div className="space-y-4">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  API Connection
                </Label>
                
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Test your Aster DEX API connection to ensure live trading will work correctly. Your API credentials are securely stored as environment variables.
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => testConnectionMutation.mutate()}
                      disabled={testConnectionMutation.isPending}
                      data-testid="button-test-api-connection"
                    >
                      {testConnectionMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Key className="h-4 w-4 mr-2" />
                      )}
                      Test Connection
                    </Button>
                    
                    {apiTestResult && (
                      <div className="flex items-center gap-2">
                        {apiTestResult.success ? (
                          <>
                            <CheckCircle2 className="h-5 w-5 text-lime-600 dark:text-lime-400" />
                            <span className="text-sm font-medium text-lime-600 dark:text-lime-400">
                              Connected
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-5 w-5 text-red-700 dark:text-red-500" />
                            <span className="text-sm font-medium text-red-700 dark:text-red-500">
                              Failed
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {apiTestResult && !apiTestResult.success && apiTestResult.message && (
                    <div className="text-sm text-red-700 dark:text-red-500 bg-red-100 dark:bg-red-950/30 p-3 rounded-md">
                      {apiTestResult.message}
                    </div>
                  )}
                  
                  {apiTestResult && apiTestResult.success && apiTestResult.accountInfo && (
                    <div className="text-sm space-y-1 bg-lime-100 dark:bg-lime-950/30 p-3 rounded-md">
                      <div className="font-medium text-lime-900 dark:text-lime-100">Account Status:</div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-lime-800 dark:text-lime-200">
                        <div>
                          <span className="font-medium">Trading:</span>{' '}
                          {apiTestResult.accountInfo.canTrade ? '✓' : '✗'}
                        </div>
                        <div>
                          <span className="font-medium">Deposit:</span>{' '}
                          {apiTestResult.accountInfo.canDeposit ? '✓' : '✗'}
                        </div>
                        <div>
                          <span className="font-medium">Withdraw:</span>{' '}
                          {apiTestResult.accountInfo.canWithdraw ? '✓' : '✗'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </form>
          </Form>
        </ScrollArea>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <div className="flex flex-1 gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportSettings}
              data-testid="button-export-settings"
            >
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleImportSettings}
              data-testid="button-import-settings"
            >
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleSaveSettings}
            disabled={createStrategyMutation.isPending || updateStrategyMutation.isPending}
            data-testid="button-save-strategy"
          >
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
