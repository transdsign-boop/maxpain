import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpen, Plus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface TradeSession {
  id: string;
  name: string | null;
  mode: string;
  startingBalance: string;
  currentBalance: string;
  totalPnl: string;
  totalTrades: number;
  isActive: boolean;
  startedAt: string;
  endedAt: string | null;
}

export default function SessionManager() {
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [isLoadSessionOpen, setIsLoadSessionOpen] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const { toast } = useToast();

  const { data: sessions = [] } = useQuery<TradeSession[]>({
    queryKey: ['/api/sessions'],
  });

  const { data: strategies = [] } = useQuery<any[]>({
    queryKey: ['/api/strategies'],
  });
  const activeStrategy = strategies.find(s => s.isActive);

  const newSessionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/sessions/new', {
        mode: activeStrategy?.tradingMode || 'paper',
        name: sessionName || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sessions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/performance/overview'] });
      setIsNewSessionOpen(false);
      setSessionName('');
      toast({
        title: "New session started",
        description: "Trading session created successfully",
      });
      window.location.reload();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create session",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const loadSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await apiRequest('POST', `/api/sessions/${sessionId}/load`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sessions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      queryClient.invalidateQueries({ queryKey: ['/api/performance/overview'] });
      setIsLoadSessionOpen(false);
      toast({
        title: "Session loaded",
        description: "Previous session loaded successfully",
      });
      window.location.reload();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to load session",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const activeSession = sessions.find(s => s.isActive);
  const previousSessions = sessions.filter(s => !s.isActive).slice(0, 10);

  const formatSessionLabel = (session: TradeSession) => {
    const name = session.name || `Session ${format(new Date(session.startedAt), 'MMM d, h:mm a')}`;
    const dateRange = session.endedAt
      ? `${format(new Date(session.startedAt), 'MMM d, yyyy')} - ${format(new Date(session.endedAt), 'MMM d, yyyy')}`
      : `Started ${format(new Date(session.startedAt), 'MMM d, yyyy')}`;
    const pnl = parseFloat(session.totalPnl);
    const pnlColor = pnl >= 0 ? 'text-lime-500' : 'text-orange-500';
    const modeLabel = session.mode === 'live' ? '🔴 Live' : '📄 Paper';
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">{modeLabel}</span>
        </div>
        <span className="text-xs text-muted-foreground">{dateRange}</span>
        <span className={`text-xs font-mono ${pnlColor}`}>
          P&L: ${pnl.toFixed(2)} ({session.totalTrades} trades)
        </span>
      </div>
    );
  };

  return (
    <div className="flex items-center gap-2">
      {/* New Session */}
      <Dialog open={isNewSessionOpen} onOpenChange={setIsNewSessionOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            data-testid="button-new-session"
            disabled={!activeStrategy}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Session</span>
          </Button>
        </DialogTrigger>
        <DialogContent data-testid="dialog-new-session">
          <DialogHeader>
            <DialogTitle>Start New Session</DialogTitle>
            <DialogDescription>
              Create a fresh session with reset performance metrics. Your current session will be saved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Session Name (Optional)</Label>
              <Input
                id="name"
                data-testid="input-session-name"
                placeholder="e.g., December Strategy Test"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Session will use your current trading mode: {activeStrategy?.tradingMode === 'live' ? '🔴 Live' : '📄 Paper'}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsNewSessionOpen(false)}
              data-testid="button-cancel-new-session"
            >
              Cancel
            </Button>
            <Button
              onClick={() => newSessionMutation.mutate()}
              disabled={newSessionMutation.isPending}
              data-testid="button-confirm-new-session"
            >
              {newSessionMutation.isPending ? 'Creating...' : 'Start New Session'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Load Previous Session */}
      <Dialog open={isLoadSessionOpen} onOpenChange={setIsLoadSessionOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            data-testid="button-load-session"
          >
            <FolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Load Session</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl" data-testid="dialog-load-session">
          <DialogHeader>
            <DialogTitle>Load Session</DialogTitle>
            <DialogDescription>
              Select a previous session to review or continue. Your current session will be saved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-96 overflow-y-auto">
            {previousSessions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No previous sessions found
              </p>
            ) : (
              <div className="space-y-2">
                {previousSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => loadSessionMutation.mutate(session.id)}
                    disabled={loadSessionMutation.isPending}
                    className="w-full p-3 text-left border rounded-md hover-elevate active-elevate-2 transition-colors"
                    data-testid={`button-load-session-${session.id}`}
                  >
                    {formatSessionLabel(session)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
