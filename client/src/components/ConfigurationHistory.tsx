import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, RotateCcw, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

interface StrategySnapshot {
  id: string;
  strategyId: string;
  userId: string;
  snapshotData: any;
  description: string | null;
  createdAt: string;
}

interface ConfigurationHistoryProps {
  strategyId: string;
}

export function ConfigurationHistory({ strategyId }: ConfigurationHistoryProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data: snapshots, isLoading } = useQuery<StrategySnapshot[]>({
    queryKey: [`/api/strategies/${strategyId}/snapshots`],
    enabled: open && !!strategyId,
  });

  const restoreMutation = useMutation({
    mutationFn: async (snapshotId: string) => {
      const response = await apiRequest('POST', `/api/strategies/snapshots/${snapshotId}/restore`);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Configuration Restored",
        description: "Strategy configuration has been restored from snapshot.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      setOpen(false);
    },
    onError: () => {
      toast({
        title: "Restore Failed",
        description: "Failed to restore configuration. Please try again.",
        variant: "destructive",
      });
    },
  });

  const formatSnapshotData = (data: any) => {
    const assets = data.selectedAssets?.slice(0, 3).join(", ") || "N/A";
    const moreAssets = data.selectedAssets?.length > 3 ? ` +${data.selectedAssets.length - 3}` : "";
    
    return {
      assets: assets + moreAssets,
      mode: data.tradingMode || "paper",
      leverage: data.leverage || 1,
      maxLayers: data.maxLayers || 5,
      profitTarget: data.profitTargetPercent || "1.0",
      stopLoss: data.stopLossPercent || "2.0",
    };
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          data-testid="button-view-config-history"
        >
          <Clock className="h-4 w-4 mr-1" />
          Config History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" data-testid="dialog-config-history" aria-describedby="dialog-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Configuration History
          </DialogTitle>
          <DialogDescription id="dialog-description">
            View and restore previous strategy configurations. Each snapshot is saved automatically before you update settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {isLoading && (
            <div className="space-y-2">
              <div className="h-24 bg-muted animate-pulse rounded" />
              <div className="h-24 bg-muted animate-pulse rounded" />
            </div>
          )}

          {!isLoading && snapshots && snapshots.length > 0 && (
            <div className="space-y-2">
              {snapshots.map((snapshot, index) => {
                const config = formatSnapshotData(snapshot.snapshotData);
                const isRecent = index === 0;
                
                return (
                  <Card key={snapshot.id} className={isRecent ? "border-primary/30" : ""} data-testid={`card-snapshot-${index}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-sm flex items-center gap-2">
                            Snapshot {snapshots.length - index}
                            {isRecent && (
                              <Badge variant="secondary" className="text-xs">
                                Most Recent
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {format(new Date(snapshot.createdAt), "PPp")}
                          </CardDescription>
                          {snapshot.description && (
                            <p className="text-xs text-muted-foreground mt-1 italic">
                              {snapshot.description}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restoreMutation.mutate(snapshot.id)}
                          disabled={restoreMutation.isPending}
                          data-testid={`button-restore-${index}`}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Restore
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-muted-foreground">Assets</div>
                          <div className="font-mono text-xs truncate" title={config.assets}>
                            {config.assets}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Mode</div>
                          <Badge 
                            variant={config.mode === "live" ? "destructive" : "secondary"}
                            className="text-xs"
                          >
                            {config.mode}
                          </Badge>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Leverage</div>
                          <div className="font-mono">{config.leverage}x</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Max Layers</div>
                          <div className="font-mono">{config.maxLayers}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Profit Target</div>
                          <div className="font-mono text-lime-500">{config.profitTarget}%</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Stop Loss</div>
                          <div className="font-mono text-orange-500">{config.stopLoss}%</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {!isLoading && (!snapshots || snapshots.length === 0) && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No configuration history yet</p>
                <p className="text-sm">Snapshots will be created automatically when you update settings</p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
