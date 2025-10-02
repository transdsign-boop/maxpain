import { useMutation, useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";

export default function LiveModeToggle() {
  // Fetch active strategy
  const { data: strategies } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
    refetchInterval: 5000,
  });

  const activeStrategy = strategies?.find(s => s.isActive);
  const isLiveMode = activeStrategy?.tradingMode === 'live';
  const isStrategyRunning = activeStrategy?.isRunning;

  // Toggle trading mode mutation
  const toggleModeMutation = useMutation({
    mutationFn: async (newMode: 'live' | 'paper') => {
      if (!activeStrategy) throw new Error('No active strategy');
      
      const updateData: any = {
        tradingMode: newMode,
      };

      // Set live session timestamp when switching to live mode
      if (newMode === 'live') {
        updateData.liveSessionStartedAt = new Date();
      } else {
        updateData.liveSessionStartedAt = null;
      }

      const response = await apiRequest('PUT', `/api/strategies/${activeStrategy.id}`, updateData);
      return await response.json();
    },
    onSuccess: (strategy) => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      toast({
        title: strategy.tradingMode === 'live' ? "Live Trading Enabled" : "Paper Trading Enabled",
        description: strategy.tradingMode === 'live' 
          ? "Real trades will now be executed on Aster DEX" 
          : "All trades are now simulated",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to toggle trading mode. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleToggle = (checked: boolean) => {
    if (isStrategyRunning) return;
    toggleModeMutation.mutate(checked ? 'live' : 'paper');
  };

  if (!activeStrategy) return null;

  return (
    <div className="flex items-center gap-3" data-testid="live-mode-toggle">
      <div className="flex items-center gap-2">
        <Switch
          data-testid="switch-live-mode"
          checked={isLiveMode}
          onCheckedChange={handleToggle}
          disabled={isStrategyRunning || toggleModeMutation.isPending}
        />
        <Label 
          htmlFor="live-mode-switch" 
          className="text-sm font-medium cursor-pointer"
          data-testid="label-live-mode"
        >
          {isLiveMode ? "Live" : "Paper"}
        </Label>
      </div>
      {isLiveMode && (
        <Badge variant="destructive" className="font-mono" data-testid="badge-live-mode">
          LIVE
        </Badge>
      )}
    </div>
  );
}
