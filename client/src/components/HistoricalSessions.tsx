import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { History, TrendingUp, TrendingDown, Activity, Calendar } from "lucide-react";
import { format } from "date-fns";

interface HistoricalSession {
  id: string;
  strategyId: string;
  tradingMode: "paper" | "live";
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  totalPnl: string;
  totalTrades: number;
  winRate: string;
  positionCount: number;
  fillCount: number;
  openPositions: number;
  closedPositions: number;
}

interface HistoricalSessionsProps {
  strategyId: string;
}

export function HistoricalSessions({ strategyId }: HistoricalSessionsProps) {
  const [open, setOpen] = useState(false);

  const { data: sessions, isLoading } = useQuery<HistoricalSession[]>({
    queryKey: [`/api/strategies/${strategyId}/sessions/history`],
    enabled: open && !!strategyId,
  });

  const archivedSessions = sessions?.filter(s => !s.isActive) || [];
  const activeSession = sessions?.find(s => s.isActive);

  const formatDuration = (start: string, end: string | null) => {
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const hours = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h`;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className="w-full"
          data-testid="button-view-history"
        >
          <History className="h-4 w-4 mr-1" />
          History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto" data-testid="dialog-historical-sessions" aria-describedby="dialog-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Trading History
          </DialogTitle>
          <DialogDescription id="dialog-description">
            All your trading sessions are permanently preserved. You can review past performance at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {isLoading && (
            <div className="space-y-2">
              <div className="h-24 bg-muted animate-pulse rounded" />
              <div className="h-24 bg-muted animate-pulse rounded" />
            </div>
          )}

          {!isLoading && activeSession && (
            <Card className="border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    <CardTitle className="text-base">Current Session</CardTitle>
                  </div>
                  <Badge variant="default" data-testid={`badge-session-active`}>
                    Active
                  </Badge>
                </div>
                <CardDescription>
                  Started {format(new Date(activeSession.startedAt), "PPp")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Mode</div>
                    <Badge variant={activeSession.tradingMode === "live" ? "destructive" : "secondary"}>
                      {activeSession.tradingMode}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Positions</div>
                    <div className="font-mono" data-testid="text-session-positions">
                      {activeSession.openPositions} open / {activeSession.closedPositions} closed
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total Trades</div>
                    <div className="font-mono" data-testid="text-session-trades">
                      {activeSession.totalTrades}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">P&L</div>
                    <div 
                      className={`font-mono ${parseFloat(activeSession.totalPnl) >= 0 ? 'text-lime-500' : 'text-orange-500'}`}
                      data-testid="text-session-pnl"
                    >
                      ${parseFloat(activeSession.totalPnl).toFixed(2)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!isLoading && archivedSessions.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Archived Sessions ({archivedSessions.length})
                </h3>
                <div className="space-y-2">
                  {archivedSessions.map((session, index) => (
                    <Card key={session.id} data-testid={`card-session-${index}`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-sm">
                              Session {archivedSessions.length - index}
                            </CardTitle>
                            <Badge variant={session.tradingMode === "live" ? "destructive" : "secondary"} className="text-xs">
                              {session.tradingMode}
                            </Badge>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {formatDuration(session.startedAt, session.endedAt)}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs">
                          {format(new Date(session.startedAt), "PP")} → {session.endedAt ? format(new Date(session.endedAt), "PP") : "Active"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                          <div>
                            <div className="text-muted-foreground">Positions</div>
                            <div className="font-mono">{session.positionCount}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Fills</div>
                            <div className="font-mono">{session.fillCount}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Trades</div>
                            <div className="font-mono">{session.totalTrades}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Win Rate</div>
                            <div className="font-mono">{parseFloat(session.winRate).toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">P&L</div>
                            <div className={`font-mono flex items-center gap-1 ${parseFloat(session.totalPnl) >= 0 ? 'text-lime-500' : 'text-orange-500'}`}>
                              {parseFloat(session.totalPnl) >= 0 ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : (
                                <TrendingDown className="h-3 w-3" />
                              )}
                              ${parseFloat(session.totalPnl).toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}

          {!isLoading && archivedSessions.length === 0 && !activeSession && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No trading sessions yet</p>
                <p className="text-sm">Start trading to create your first session</p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
