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
import { Play, Square, TrendingUp, DollarSign, Layers, Target, Trash2, RotateCcw, Key, CheckCircle2, XCircle, Loader2, Download, Upload, Lightbulb, AlertCircle } from "lucide-react";
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
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message: string; accountInfo?: any } | null>(null);
  const [assetSortMode, setAssetSortMode] = useState<"liquidations" | "liquidity" | "alphabetical">("liquidations");

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

  // Fetch asset performance data (wins/losses)
  const { data: performanceData, isLoading: performanceLoading } = useQuery<any[]>({
    queryKey: ['/api/analytics/asset-performance'],
    refetchInterval: 30000,
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

  // Fetch exchange account balance
  const { data: exchangeAccount, isLoading: accountLoading } = useQuery<any>({
    queryKey: ['/api/live/account'],
    refetchInterval: 15000, // Refresh every 15 seconds
    staleTime: 5000, // Cache for 5 seconds
    retry: false, // Don't retry if API keys not configured
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
      hedgeMode: false,
    }
  });

  // Calculate trade size and account balance based on form values and exchange account
  const marginPercent = parseFloat(form.watch("marginAmount") || "10");
  const positionSizePercent = parseFloat(form.watch("positionSizePercent") || "5");
  
  // Get account balance from exchange, fallback to 10000 for calculations
  const accountBalance = exchangeAccount?.totalWalletBalance 
    ? parseFloat(exchangeAccount.totalWalletBalance) 
    : 10000;
  
  // Calculate actual trading balance (account balance × margin usage %)
  const currentBalance = accountBalance * (marginPercent / 100);
  const tradeSize = currentBalance * (positionSizePercent / 100);

  // Fetch real liquidity data for symbols with account balance for recommendations
  const { data: liquidityData, isLoading: liquidityLoading } = useQuery({
    queryKey: ['/api/analytics/liquidity/batch', symbols?.map((s: any) => s.symbol), tradeSize, currentBalance],
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
    staleTime: 30000, // Cache for 30 seconds
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
      a.download = `aster-dex-settings-${new Date().toISOString().split('T')[0]}.json`;
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
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                      {availableAssets?.map((asset: any) => (
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
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-1 flex-wrap"
                          >
                            <span>{asset.symbol}</span>
                            <span className="text-xs text-muted-foreground">
                              ({asset.liquidationCount})
                            </span>
                            {!performanceLoading && performanceMap.get(asset.symbol) && performanceMap.get(asset.symbol).wins + performanceMap.get(asset.symbol).losses > 0 && (
                              <>
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
                              </>
                            )}
                            {!liquidityLoading && asset.liquidity && asset.liquidity.canHandleTradeSize && (
                              <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 h-4 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                                ✓ ${(asset.liquidity.minSideLiquidity / 1000).toFixed(0)}k
                              </Badge>
                            )}
                            {!liquidityLoading && asset.liquidity && !asset.liquidity.canHandleTradeSize && asset.liquidity.minSideLiquidity > 0 && (
                              <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 h-4 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                                ⚠ ${(asset.liquidity.minSideLiquidity / 1000).toFixed(0)}k {asset.liquidity.limitingSide}
                              </Badge>
                            )}
                          </label>
                        </div>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Recommendations Section */}
              {!liquidityLoading && selectedSymbols.length > 0 && (
                <>
                  <div className="rounded-lg border p-4 space-y-3 bg-card" data-testid="recommendations-card">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-primary" />
                      <h3 className="font-medium">Recommendations Based on Your Selection</h3>
                    </div>
                    
                    {limitingAsset && (
                      <div className="space-y-2 text-sm">
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <div>
                            <span className="font-medium text-foreground">{limitingAsset.symbol}</span> has the lowest liquidity 
                            (${(limitingAsset.liquidity?.minSideLiquidity / 1000).toFixed(1)}k on {limitingAsset.liquidity?.limitingSide} side). 
                            All settings optimized for this asset.
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3 pt-2">
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Recommended Order Size</div>
                            <div className="text-lg font-semibold text-primary" data-testid="text-recommended-order-size">
                              ${recommendedOrderSize.toFixed(0)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              ({recommendedPositionSizePercent}% of balance)
                            </div>
                          </div>
                          
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Account Tier</div>
                            <div className="text-lg font-semibold capitalize" data-testid="text-account-tier">
                              {accountTier}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              ${currentBalance.toFixed(0)} balance
                            </div>
                          </div>
                          
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Stop Loss / Take Profit</div>
                            <div className="text-base font-medium" data-testid="text-recommended-sl-tp">
                              {recommendedStopLoss.toFixed(1)}% / {recommendedTakeProfit.toFixed(1)}%
                            </div>
                          </div>
                          
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">Max Layers</div>
                            <div className="text-base font-medium" data-testid="text-recommended-max-layers">
                              {recommendedMaxLayers}
                            </div>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full mt-2"
                          data-testid="button-apply-recommendations"
                          onClick={() => {
                            form.setValue("positionSizePercent", recommendedPositionSizePercent.toString());
                            form.setValue("stopLossPercent", recommendedStopLoss.toString());
                            form.setValue("profitTargetPercent", recommendedTakeProfit.toString());
                            form.setValue("maxLayers", recommendedMaxLayers);
                          }}
                        >
                          Apply Recommended Settings
                        </Button>
                      </div>
                    )}

                    {recommendedAssets.length > 0 && recommendedAssets.length < availableAssets.length && (
                      <div className="pt-2 border-t">
                        <div className="text-xs text-muted-foreground mb-2">
                          Recommended assets for ${currentBalance.toFixed(0)} account ({recommendedAssets.length} assets):
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {recommendedAssets.slice(0, 10).map((asset: any) => (
                            <Badge 
                              key={asset.symbol} 
                              variant="outline" 
                              className="text-[10px] bg-green-500/5 text-green-600 dark:text-green-400 border-green-500/20"
                            >
                              {asset.symbol}
                            </Badge>
                          ))}
                          {recommendedAssets.length > 10 && (
                            <Badge variant="outline" className="text-[10px]">
                              +{recommendedAssets.length - 10} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
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
                        <div className="flex items-center gap-2">
                          <FormLabel data-testid="label-max-layers">Max Layers</FormLabel>
                          {limitingAsset && field.value > recommendedMaxLayers && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                              ⚠ High for liquidity
                            </Badge>
                          )}
                        </div>
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
                          {limitingAsset && recommendedMaxLayers > 0 && (
                            <span className="text-primary ml-1">(Recommended: {recommendedMaxLayers})</span>
                          )}
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
                        <div className="flex items-center gap-2">
                          <FormLabel data-testid="label-position-size">Position Size %</FormLabel>
                          {limitingAsset && parseFloat(field.value) > recommendedPositionSizePercent && recommendedPositionSizePercent > 0 && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
                              ⚠ Exceeds safe size
                            </Badge>
                          )}
                        </div>
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
                          {limitingAsset && recommendedPositionSizePercent > 0 && (
                            <span className="text-primary ml-1">(Recommended: {recommendedPositionSizePercent}%)</span>
                          )}
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
                        <div className="flex items-center gap-2">
                          <FormLabel data-testid="label-profit-target">Take Profit %</FormLabel>
                          {limitingAsset && parseFloat(field.value) < recommendedTakeProfit * 0.8 && recommendedTakeProfit > 0 && (
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
                          Close when profit reaches this % (0.1-20%)
                          {limitingAsset && recommendedTakeProfit > 0 && (
                            <span className="text-primary ml-1">(Recommended: {recommendedTakeProfit.toFixed(1)}%)</span>
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
                      <FormItem>
                        <div className="flex items-center gap-2">
                          <FormLabel data-testid="label-stop-loss">Stop Loss %</FormLabel>
                          {limitingAsset && parseFloat(field.value) > recommendedStopLoss * 1.5 && recommendedStopLoss > 0 && (
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
                          Close when loss reaches this % (0.1-50%)
                          {limitingAsset && recommendedStopLoss > 0 && (
                            <span className="text-primary ml-1">(Recommended: {recommendedStopLoss.toFixed(1)}%)</span>
                          )}
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
                    Automatically fetched from your Aster DEX account for both paper and live trading
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
          <div className="flex flex-1 gap-2">
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
