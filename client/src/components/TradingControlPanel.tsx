import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Play, Square, Settings, TrendingUp, DollarSign, Layers, Target, Trash2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Types
interface Strategy {
  id: string;
  name: string;
  sessionId: string;
  selectedAssets: string[];
  percentileThreshold: number;
  maxLayers: number;
  positionSizePercent: string;
  profitTargetPercent: string;
  marginMode: "cross" | "isolated";
  orderDelayMs: number;
  slippageTolerancePercent: string;
  orderType: "market" | "limit";
  maxRetryDurationMs: number;
  marginAmount: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Form validation schema
const strategyFormSchema = z.object({
  name: z.string().min(1, "Strategy name is required").max(50, "Name too long"),
  selectedAssets: z.array(z.string()).min(1, "Select at least one asset"),
  percentileThreshold: z.number().min(1).max(100),
  maxLayers: z.number().min(1).max(10),
  positionSizePercent: z.string().min(1, "Position size is required"),
  profitTargetPercent: z.string().min(0.1).max(20),
  marginMode: z.enum(["cross", "isolated"]),
  orderDelayMs: z.number().min(100).max(30000),
  slippageTolerancePercent: z.string().min(0.1).max(5),
  orderType: z.enum(["market", "limit"]),
  maxRetryDurationMs: z.number().min(5000).max(300000),
  marginAmount: z.string().min(1, "Margin amount is required"),
});

type StrategyFormData = z.infer<typeof strategyFormSchema>;

interface TradingControlPanelProps {
  sessionId: string;
}

export default function TradingControlPanel({ sessionId }: TradingControlPanelProps) {
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

  // Fetch current strategies for this session
  const { data: strategies, isLoading: strategiesLoading } = useQuery<Strategy[]>({
    queryKey: [`/api/strategies/${sessionId}`],
  });

  // Form setup with default values
  const form = useForm<StrategyFormData>({
    resolver: zodResolver(strategyFormSchema),
    defaultValues: {
      name: "Liquidation Counter-Trade",
      selectedAssets: ["ASTERUSDT"],
      percentileThreshold: 50,
      maxLayers: 5,
      positionSizePercent: "5.0",
      profitTargetPercent: "1.0",
      marginMode: "cross",
      orderDelayMs: 1000,
      slippageTolerancePercent: "0.5",
      orderType: "limit",
      maxRetryDurationMs: 30000,
      marginAmount: "1000.0",
    }
  });

  // Create strategy mutation
  const createStrategyMutation = useMutation({
    mutationFn: async (data: StrategyFormData) => {
      const response = await apiRequest('POST', '/api/strategies', {
        ...data,
        sessionId,
        isActive: false,
      });
      return await response.json() as Strategy;
    },
    onSuccess: (strategy) => {
      toast({
        title: "Strategy Created",
        description: `Strategy "${strategy.name}" has been created successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/strategies/${sessionId}`] });
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
      queryClient.invalidateQueries({ queryKey: [`/api/strategies/${sessionId}`] });
      setActiveStrategy(strategy);
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
        description: "Paper trading strategy is now active and monitoring liquidations.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/strategies/${sessionId}`] });
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
        description: "Paper trading strategy has been stopped.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/strategies/${sessionId}`] });
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
      queryClient.invalidateQueries({ queryKey: [`/api/strategies/${sessionId}`] });
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

  const onSubmit = (data: StrategyFormData) => {
    if (activeStrategy) {
      updateStrategyMutation.mutate(data);
    } else {
      createStrategyMutation.mutate(data);
    }
  };

  const handleStartStrategy = () => {
    if (activeStrategy) {
      startStrategyMutation.mutate(activeStrategy.id);
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

  // Load first strategy if available
  useEffect(() => {
    if (strategies && strategies.length > 0 && !activeStrategy) {
      const strategy = strategies[0];
      setActiveStrategy(strategy);
      setIsStrategyRunning(strategy.isActive);
      
      // Update form with strategy data
      form.reset({
        name: strategy.name,
        selectedAssets: strategy.selectedAssets,
        percentileThreshold: strategy.percentileThreshold,
        maxLayers: strategy.maxLayers,
        positionSizePercent: strategy.positionSizePercent,
        profitTargetPercent: strategy.profitTargetPercent,
        marginMode: strategy.marginMode,
        orderDelayMs: strategy.orderDelayMs,
        slippageTolerancePercent: strategy.slippageTolerancePercent,
        orderType: strategy.orderType,
        maxRetryDurationMs: strategy.maxRetryDurationMs,
        marginAmount: strategy.marginAmount,
      });
    }
  }, [strategies, activeStrategy, form]);

  if (assetsLoading || strategiesLoading) {
    return (
      <Card data-testid="trading-control-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Trading Strategy Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-4 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="trading-control-panel" className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Paper Trading Strategy
          </div>
          <div className="flex items-center gap-2">
            {isStrategyRunning && (
              <Badge variant="default" className="bg-green-600">
                <div className="w-2 h-2 bg-white rounded-full mr-1 animate-pulse" />
                Active
              </Badge>
            )}
            {activeStrategy && !isStrategyRunning && (
              <Badge variant="secondary">Stopped</Badge>
            )}
          </div>
        </CardTitle>
        <CardDescription>
          Configure your liquidation counter-trading strategy with position averaging
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
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
                      disabled={isStrategyRunning}
                    />
                  </FormControl>
                  <FormMessage />
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
                          disabled={isStrategyRunning}
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
                    Trigger trades when liquidation volume exceeds this percentile within a fixed 60-second monitoring window
                  </FormDescription>
                  <FormControl>
                    <Slider
                      data-testid="slider-percentile-threshold"
                      min={1}
                      max={100}
                      step={1}
                      value={[field.value]}
                      onValueChange={(value) => field.onChange(value[0])}
                      disabled={isStrategyRunning}
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
                          disabled={isStrategyRunning}
                        >
                          <SelectTrigger data-testid="select-max-layers">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                              <SelectItem key={num} value={num.toString()}>
                                {num} layer{num !== 1 ? 's' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                          disabled={isStrategyRunning}
                        >
                          <SelectTrigger data-testid="select-margin-mode">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cross">Cross Margin</SelectItem>
                            <SelectItem value="isolated">Isolated Margin</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription className="text-xs">
                        Cross: Uses full account as collateral. Isolated: Only allocated margin at risk
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Smart Order Placement */}
            <div className="space-y-4">
              <Label className="text-base font-medium flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Smart Order Placement
              </Label>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="orderDelayMs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel data-testid="label-order-delay">Order Delay (ms)</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-order-delay"
                          type="number"
                          step="100"
                          min="100"
                          max="30000"
                          placeholder="1000"
                          {...field}
                          disabled={isStrategyRunning}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 1000)}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Delay before placing orders
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxRetryDurationMs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel data-testid="label-max-retry-duration">Max Retry Duration (ms)</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-max-retry-duration"
                          type="number"
                          step="1000"
                          min="5000"
                          max="300000"
                          placeholder="30000"
                          {...field}
                          disabled={isStrategyRunning}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 30000)}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        How long to chase price before giving up
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
                      <FormLabel data-testid="label-slippage-tolerance">Slippage Tolerance %</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-slippage-tolerance"
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="5"
                          placeholder="0.5"
                          {...field}
                          disabled={isStrategyRunning}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Max acceptable slippage
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                          disabled={isStrategyRunning}
                        >
                          <SelectTrigger data-testid="select-order-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="limit">Limit Orders</SelectItem>
                            <SelectItem value="market">Market Orders</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription className="text-xs">
                        Order execution type
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
                <DollarSign className="h-4 w-4" />
                Risk Management
              </Label>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="positionSizePercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel data-testid="label-position-size">Position Size (%)</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-position-size"
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="50"
                          placeholder="5.0"
                          {...field}
                          disabled={isStrategyRunning}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Percentage of portfolio per position
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="marginAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel data-testid="label-margin-amount">Margin Amount ($)</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-margin-amount"
                          type="number"
                          step="100"
                          min="100"
                          max="100000"
                          placeholder="1000.0"
                          {...field}
                          disabled={isStrategyRunning}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Available margin for leverage
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="profitTargetPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel data-testid="label-profit-target">
                        <div className="flex items-center gap-1">
                          <Target className="h-4 w-4" />
                          Profit Target %
                        </div>
                      </FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-profit-target"
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="20"
                          placeholder="1.0"
                          {...field}
                          disabled={isStrategyRunning}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Exit when position is profitable
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              {!activeStrategy && (
                <Button
                  data-testid="button-create-strategy"
                  type="submit"
                  disabled={createStrategyMutation.isPending}
                  className="flex-1"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  {createStrategyMutation.isPending ? "Creating..." : "Create Strategy"}
                </Button>
              )}

              {activeStrategy && !isStrategyRunning && (
                <Button
                  data-testid="button-start-strategy"
                  onClick={handleStartStrategy}
                  disabled={startStrategyMutation.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {startStrategyMutation.isPending ? "Starting..." : "Start Trading"}
                </Button>
              )}

              {activeStrategy && isStrategyRunning && (
                <Button
                  data-testid="button-stop-strategy"
                  onClick={handleStopStrategy}
                  disabled={stopStrategyMutation.isPending}
                  variant="destructive"
                  className="flex-1"
                >
                  <Square className="mr-2 h-4 w-4" />
                  {stopStrategyMutation.isPending ? "Stopping..." : "Stop Trading"}
                </Button>
              )}

              {activeStrategy && !isStrategyRunning && (
                <Button
                  data-testid="button-delete-strategy"
                  onClick={handleDeleteStrategy}
                  disabled={deleteStrategyMutation.isPending}
                  variant="outline"
                  className="flex-1"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {deleteStrategyMutation.isPending ? "Deleting..." : "Delete Strategy"}
                </Button>
              )}

              {activeStrategy && (
                <Button
                  data-testid="button-update-strategy"
                  type="submit"
                  variant="outline"
                  disabled={updateStrategyMutation.isPending || isStrategyRunning}
                  className="flex-1"
                >
                  <TrendingUp className="mr-2 h-4 w-4" />
                  {updateStrategyMutation.isPending ? "Updating..." : "Update Strategy"}
                </Button>
              )}
            </div>

            {/* Strategy Info */}
            {activeStrategy && (
              <div className="text-xs text-muted-foreground space-y-1 p-3 bg-muted/50 rounded-md">
                <div>Strategy: {activeStrategy.name}</div>
                <div>Assets: {activeStrategy.selectedAssets?.join(", ")}</div>
                <div>Created: {new Date(activeStrategy.createdAt).toLocaleDateString()}</div>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}