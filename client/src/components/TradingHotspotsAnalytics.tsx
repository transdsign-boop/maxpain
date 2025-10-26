import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronUp, BarChart3, TrendingUp, Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TradingHotspotsProps {
  strategyId: string;
}

interface HotspotData {
  hourlyDistribution: Array<{ hour: number; count: number }>;
  dailyDistribution: Array<{ day: number; dayName: string; count: number }>;
  heatmapData: Array<{ day: number; hour: number; count: number; dayName: string }>;
  totalTrades: number;
  peakHour: { hour: number; count: number } | null;
  peakDay: { day: number; dayName: string; count: number } | null;
}

export default function TradingHotspotsAnalytics({ strategyId }: TradingHotspotsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: hotspotsData, isLoading } = useQuery<HotspotData>({
    queryKey: [`/api/trading-hotspots/${strategyId}`],
    enabled: !!strategyId,
    refetchInterval: 60000, // Refresh every minute
    retry: 1, // Only retry once if failed
  });

  if (isLoading || !hotspotsData) {
    return null;
  }

  if (hotspotsData.totalTrades === 0) {
    return null; // Don't show if no trades yet
  }

  const maxHourlyCount = Math.max(...hotspotsData.hourlyDistribution.map(h => h.count), 1);
  const maxDailyCount = Math.max(...hotspotsData.dailyDistribution.map(d => d.count), 1);
  const maxHeatmapCount = Math.max(...hotspotsData.heatmapData.map(h => h.count), 1);

  const formatHour = (hour: number) => {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}${period}`;
  };

  const getHeatmapColor = (count: number) => {
    if (count === 0) return 'bg-muted';
    const intensity = count / maxHeatmapCount;
    if (intensity > 0.75) return 'bg-lime-500';
    if (intensity > 0.5) return 'bg-lime-400';
    if (intensity > 0.25) return 'bg-lime-300';
    return 'bg-lime-200';
  };

  const getHeatmapValue = (day: number, hour: number) => {
    return hotspotsData.heatmapData.find(h => h.day === day && h.hour === hour)?.count || 0;
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Trading Activity Analysis</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
        <CardDescription className="text-xs">
          {hotspotsData.totalTrades} total trades •
          {hotspotsData.peakDay && ` Peak: ${hotspotsData.peakDay.dayName}`}
          {hotspotsData.peakHour && ` at ${formatHour(hotspotsData.peakHour.hour)}`}
        </CardDescription>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-6">
          {/* Peak Trading Times */}
          <div className="grid grid-cols-2 gap-4">
            {hotspotsData.peakHour && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <Clock className="h-4 w-4 text-lime-500 mt-0.5" />
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Peak Hour</div>
                  <div className="text-sm font-semibold">{formatHour(hotspotsData.peakHour.hour)}</div>
                  <div className="text-xs text-muted-foreground">{hotspotsData.peakHour.count} trades</div>
                </div>
              </div>
            )}
            {hotspotsData.peakDay && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <Calendar className="h-4 w-4 text-lime-500 mt-0.5" />
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Peak Day</div>
                  <div className="text-sm font-semibold">{hotspotsData.peakDay.dayName}</div>
                  <div className="text-xs text-muted-foreground">{hotspotsData.peakDay.count} trades</div>
                </div>
              </div>
            )}
          </div>

          {/* Daily Distribution Chart */}
          <div>
            <div className="text-xs font-medium mb-3 flex items-center gap-2">
              <Calendar className="h-3 w-3" />
              Daily Activity (Week)
            </div>
            <div className="space-y-2">
              {hotspotsData.dailyDistribution.map((d) => {
                const width = d.count > 0 ? Math.max(((d.count / maxDailyCount) * 100), 5) : 0;
                return (
                  <div key={d.day} className="flex items-center gap-3">
                    <div className="text-xs font-mono w-12 text-right text-muted-foreground">
                      {d.dayName.substring(0, 3)}
                    </div>
                    <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                      {width > 0 && (
                        <div
                          className="absolute left-0 top-0 h-full bg-lime-500 rounded-full transition-all"
                          style={{ width: `${width}%` }}
                        />
                      )}
                      <div className="absolute inset-0 flex items-center justify-start px-3">
                        <span className="text-xs font-semibold">{d.count}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Heatmap: Day x Hour */}
          <div>
            <div className="text-xs font-medium mb-3 flex items-center gap-2">
              <TrendingUp className="h-3 w-3" />
              Activity Heatmap (Day × Hour)
            </div>
            <div className="overflow-x-auto">
              <div className="inline-block min-w-full">
                <div className="flex gap-1">
                  {/* Day labels column */}
                  <div className="flex flex-col gap-1">
                    <div className="h-4" /> {/* Spacer for hour labels */}
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                      <div key={day} className="h-5 flex items-center justify-end pr-2">
                        <span className="text-[9px] text-muted-foreground font-mono">{day}</span>
                      </div>
                    ))}
                  </div>

                  {/* Heatmap grid */}
                  <div>
                    {/* Hour labels */}
                    <div className="flex gap-1 mb-1">
                      {Array.from({ length: 24 }, (_, hour) => (
                        <div key={hour} className="w-5 h-4">
                          {hour % 6 === 0 && (
                            <span className="text-[8px] text-muted-foreground font-mono">{hour}</span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Grid rows */}
                    {Array.from({ length: 7 }, (_, day) => (
                      <div key={day} className="flex gap-1 mb-1">
                        {Array.from({ length: 24 }, (_, hour) => {
                          const count = getHeatmapValue(day, hour);
                          return (
                            <div
                              key={`${day}-${hour}`}
                              className={`w-5 h-5 rounded ${getHeatmapColor(count)} transition-all hover:ring-2 hover:ring-lime-500`}
                              title={`${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]} ${formatHour(hour)}: ${count} trades`}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 text-[10px] text-muted-foreground">
              <span>Less</span>
              <div className="flex gap-1">
                <div className="w-3 h-3 rounded bg-muted" />
                <div className="w-3 h-3 rounded bg-lime-200" />
                <div className="w-3 h-3 rounded bg-lime-300" />
                <div className="w-3 h-3 rounded bg-lime-400" />
                <div className="w-3 h-3 rounded bg-lime-500" />
              </div>
              <span>More</span>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
