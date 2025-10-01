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
import { Play, Square, TrendingUp, DollarSign, Layers, Target, Trash2, RotateCcw } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Types
interface Strategy {
  id: string;
  name: string;
  userId: string;
  selectedAssets: string[];
  percentileThreshold: number;
  liquidationLookbackHours: number;
  maxLayers: number;
  positionSizePercent: string;
  profitTargetPercent: string;
  stopLossPercent: string;
  marginMode: "cross" | "isolated";
  leverage: number;
  orderDelayMs: number;
  slippageTolerancePercent: string;
  orderType: "market" | "limit";
  maxRetryDurationMs: number;
  marginAmount: string;
  tradingMode: "paper" | "live";
  paperAccountSize: string;
  hedgeMode: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Form validation schema
const strategyFormSchema = z.object({
  name: z.string().min(1, "Strategy name is required").max(50, "Name too long"),
  selectedAssets: z.array(z.string()).min(1, "Select at least one asset"),
  percentileThreshold: z.number().min(1).max(100),
  liquidationLookbackHours: z.number().min(1).max(24),
  maxLayers: z.number().min(1).max(10),
  positionSizePercent: z.string().min(1, "Position size is required").refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 50;
  }, "Position size must be between 0.1% and 50%"),
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
  slippageTolerancePercent: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0.1 && num <= 5;
  }, "Slippage tolerance must be between 0.1% and 5%"),
  orderType: z.enum(["market", "limit"]),
  maxRetryDurationMs: z.number().min(5000).max(300000),
  marginAmount: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 1 && num <= 100;
  }, "Account usage must be between 1% and 100%"),
  tradingMode: z.enum(["paper", "live"]),
  paperAccountSize: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num >= 100 && num <= 1000000;
  }, "Paper account size must be between $100 and $1,000,000"),
  hedgeMode: z.boolean(),
});

type StrategyFormData = z.infer<typeof strategyFormSchema>;

interface TradingStrategyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TradingStrategyDialog({ open, onOpenChange }: TradingStrategyDialogProps) {
  const { toast } = useToast();
  const [activeStrategy, setActiveStrategy] = useState<Strategy | null>(null);
  const [isStrategyRunning, setIsStrategyRunning] = useState(false);

  // Fetch available assets for selection
  const { data: availableAssets, isLoading: assetsLoading } = useQuery({
    queryKey: ['/api/analytics/assets'],
    select: (data: any[]) => data.map(asset => ({
      symbol: asset.symbol,
      count: asset.count,
      latestTimestamp: asset.latestTimestamp
    }))
  });

  // Fetch current strategies
  const { data: strategies, isLoading: strategiesLoading } = useQuery<Strategy[]>({
    queryKey: ['/api/strategies'],
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
      positionSizePercent: "5.0",
      profitTargetPercent: "1.0",
      stopLossPercent: "2.0",
      marginMode: "cross",
      leverage: 1,
      orderDelayMs: 1000,
      slippageTolerancePercent: "0.5",
      orderType: "limit",
      maxRetryDurationMs: 30000,
      marginAmount: "10.0",
      tradingMode: "paper",
      paperAccountSize: "10000.0",
      hedgeMode: false,
    }
  });

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
      const response = await apiRequest('PUT', `/api/strategies/${activeStrategy.id}`, data);
      return await response.json() as Strategy;
    },
    onSuccess: (strategy) => {
      toast({
        title: "Strategy Updated",
        description: `Strategy "${strategy.name}" has been updated successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      setActiveStrategy(strategy);
      
      // Reset form with updated strategy data to refresh UI
      form.reset({
        name: strategy.name,
        selectedAssets: strategy.selectedAssets,
        percentileThreshold: strategy.percentileThreshold,
        liquidationLookbackHours: strategy.liquidationLookbackHours,
        maxLayers: strategy.maxLayers,
        positionSizePercent: strategy.positionSizePercent,
        profitTargetPercent: strategy.profitTargetPercent,
        stopLossPercent: strategy.stopLossPercent,
        marginMode: strategy.marginMode,
        leverage: strategy.leverage,
        orderDelayMs: strategy.orderDelayMs,
        slippageTolerancePercent: strategy.slippageTolerancePercent,
        orderType: strategy.orderType,
        maxRetryDurationMs: strategy.maxRetryDurationMs,
        marginAmount: strategy.marginAmount,
        tradingMode: strategy.tradingMode,
        paperAccountSize: strategy.paperAccountSize || "10000.0",
        hedgeMode: strategy.hedgeMode,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update strategy. Please try again.",
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
        description: `${updatedStrategy.tradingMode === 'live' ? 'Live' : 'Paper'} trading strategy is now active and monitoring liquidations.`,
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

  // Stop strategy mutation
  const stopStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const response = await apiRequest('POST', `/api/strategies/${strategyId}/stop`);
      return await response.json() as Strategy;
    },
    onSuccess: (updatedStrategy) => {
      setIsStrategyRunning(false);
      setActiveStrategy(updatedStrategy);
      toast({
        title: "Strategy Stopped",
        description: "Trading strategy has been stopped.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to stop strategy. Please try again.",
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

  // Clear paper trades mutation
  const clearPaperTradesMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const response = await apiRequest('DELETE', `/api/strategies/${strategyId}/clear-paper-trades`);
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Paper Trades Cleared",
        description: `Cleared ${data.cleared.positions} positions and ${data.cleared.fills} fills. Starting fresh!`,
      });
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/performance/overview'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to clear paper trades. Please try again.",
        variant: "destructive",
      });
    }
  });

  const onSubmit = (data: StrategyFormData) => {
    if (activeStrategy) {
      updateStrategyMutation.mutate(data);
    } else {
      createStrategyMutation.mutate(data);
    }
  };

  const handleStartStrategy = async () => {
    if (activeStrategy) {
      // First, save any form changes before starting
      const formValues = form.getValues();
      const hasChanges = JSON.stringify(formValues) !== JSON.stringify({
        name: activeStrategy.name,
        selectedAssets: activeStrategy.selectedAssets,
        percentileThreshold: activeStrategy.percentileThreshold,
        maxLayers: activeStrategy.maxLayers,
        positionSizePercent: activeStrategy.positionSizePercent,
        profitTargetPercent: activeStrategy.profitTargetPercent,
        stopLossPercent: activeStrategy.stopLossPercent,
        marginMode: activeStrategy.marginMode,
        leverage: activeStrategy.leverage,
        orderDelayMs: activeStrategy.orderDelayMs,
        slippageTolerancePercent: activeStrategy.slippageTolerancePercent,
        orderType: activeStrategy.orderType,
        maxRetryDurationMs: activeStrategy.maxRetryDurationMs,
        marginAmount: activeStrategy.marginAmount,
        tradingMode: activeStrategy.tradingMode,
        paperAccountSize: activeStrategy.paperAccountSize || "10000.0",
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

  const handleStopStrategy = () => {
    if (activeStrategy) {
      stopStrategyMutation.mutate(activeStrategy.id);
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
        positionSizePercent: strategy.positionSizePercent,
        profitTargetPercent: strategy.profitTargetPercent,
        stopLossPercent: strategy.stopLossPercent,
        marginMode: strategy.marginMode,
        leverage: strategy.leverage,
        orderDelayMs: strategy.orderDelayMs,
        slippageTolerancePercent: strategy.slippageTolerancePercent,
        orderType: strategy.orderType,
        maxRetryDurationMs: strategy.maxRetryDurationMs,
        marginAmount: strategy.marginAmount,
        tradingMode: strategy.tradingMode,
        paperAccountSize: strategy.paperAccountSize || "10000.0",
        hedgeMode: strategy.hedgeMode,
      });
    } else if (strategies && strategies.length === 0) {
      // No strategies available, clear active strategy
      setActiveStrategy(null);
      setIsStrategyRunning(false);
    }
  }, [strategies, form]); // Remove activeStrategy from dependencies to prevent stale state

  if (assetsLoading || strategiesLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh]" aria-describedby="loading-description">
          <DialogHeader>
            <DialogTitle>Trading Settings</DialogTitle>
            <DialogDescription id="loading-description">Loading trading settings...</DialogDescription>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]" data-testid="dialog-trading-strategy" aria-describedby="strategy-dialog-description">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Trading Settings</span>
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
              
              {/* Strategy Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel data-testid="label-strategy-name">Strategy Name</FormLabel>
                    <FormControl>
                      <Input 
                        data-testid="input-strategy-name"
                        placeholder="My Trading Strategy" 
                        {...field} 
                        disabled={false}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Separator />

              {/* Trading Mode Toggle */}
              <FormField
                control={form.control}
                name="tradingMode"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel data-testid="label-trading-mode">Live Trading Mode</FormLabel>
                      <FormDescription>
                        Enable live trading to execute real trades. When off, all trades are simulated.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        data-testid="switch-trading-mode"
                        checked={field.value === "live"}
                        onCheckedChange={(checked) => field.onChange(checked ? "live" : "paper")}
                        disabled={false}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Paper Account Size (only shown in paper mode) */}
              {form.watch("tradingMode") === "paper" && (
                <>
                  <FormField
                    control={form.control}
                    name="paperAccountSize"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-paper-account-size">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4" />
                            Paper Account Size
                          </div>
                        </FormLabel>
                        <FormDescription>
                          Starting balance for paper trading (simulated funds)
                        </FormDescription>
                        <FormControl>
                          <Input
                            data-testid="input-paper-account-size"
                            type="text"
                            placeholder="10000.0"
                            {...field}
                            disabled={false}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

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
                    <FormLabel data-testid="label-asset-selection">Assets to Monitor</FormLabel>
                    <FormDescription>
                      Select which assets to scan for liquidation opportunities
                    </FormDescription>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                      {availableAssets?.map((asset) => (
                        <div key={asset.symbol} className="flex items-center space-x-2">
                          <Checkbox
                            data-testid={`checkbox-asset-${asset.symbol}`}
                            id={`asset-${asset.symbol}`}
                            checked={field.value.includes(asset.symbol)}
                            disabled={false}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                field.onChange([...field.value, asset.symbol]);
                              } else {
                                field.onChange(field.value.filter(s => s !== asset.symbol));
                              }
                            }}
                          />
                          <label 
                            htmlFor={`asset-${asset.symbol}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                          >
                            {asset.symbol}
                            <span className="text-xs text-muted-foreground ml-1">
                              ({asset.count})
                            </span>
                          </label>
                        </div>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

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

              <Separator />

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
                        <FormLabel data-testid="label-max-layers">Max Layers</FormLabel>
                        <FormControl>
                          <Select 
                            value={field.value.toString()} 
                            onValueChange={(value) => field.onChange(parseInt(value))}
                            disabled={false}
                          >
                            <SelectTrigger data-testid="select-max-layers">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">1</SelectItem>
                              <SelectItem value="2">2</SelectItem>
                              <SelectItem value="3">3</SelectItem>
                              <SelectItem value="4">4</SelectItem>
                              <SelectItem value="5">5</SelectItem>
                              <SelectItem value="6">6</SelectItem>
                              <SelectItem value="7">7</SelectItem>
                              <SelectItem value="8">8</SelectItem>
                              <SelectItem value="9">9</SelectItem>
                              <SelectItem value="10">10</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription className="text-xs">
                          Maximum positions to open for averaging
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="positionSizePercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-position-size">Position Size %</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-position-size"
                            type="text"
                            placeholder="5.0"
                            {...field}
                            disabled={false}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          % of available margin per layer (0.1-50%)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Separator />

              {/* Risk Management */}
              <div className="space-y-4">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Risk Management
                </Label>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="profitTargetPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-profit-target">Take Profit %</FormLabel>
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
                          Close when profit reaches this % (0.1-20%)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="stopLossPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-stop-loss">Stop Loss %</FormLabel>
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
                          Close when loss reaches this % (0.1-50%)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Separator />

              {/* Account Settings */}
              <div className="space-y-4">
                <Label className="text-base font-medium flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Account Settings
                </Label>
                
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />

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
                </div>
              </div>

            </form>
          </Form>
        </ScrollArea>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <div className="flex flex-1 gap-2">
            {activeStrategy && activeStrategy.tradingMode === "paper" && !isStrategyRunning && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="button-clear-paper-trades"
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Clear Paper Trades
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear All Paper Trades?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete all positions and fill history, resetting your paper trading account. Your settings will remain unchanged.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => activeStrategy && clearPaperTradesMutation.mutate(activeStrategy.id)}>
                      Clear All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={form.handleSubmit(onSubmit)}
              disabled={createStrategyMutation.isPending || updateStrategyMutation.isPending}
              data-testid="button-save-strategy"
            >
              Save Settings
            </Button>
            {!isStrategyRunning ? (
              <Button
                type="button"
                onClick={handleStartStrategy}
                disabled={!activeStrategy || startStrategyMutation.isPending}
                className="bg-lime-600 hover:bg-lime-700"
                data-testid="button-start-strategy"
              >
                <Play className="h-4 w-4 mr-2" />
                Start Trading
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                onClick={handleStopStrategy}
                disabled={stopStrategyMutation.isPending}
                data-testid="button-stop-strategy"
              >
                <Square className="h-4 w-4 mr-2" />
                Stop Trading
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
