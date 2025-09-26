import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter, RefreshCw } from "lucide-react";

interface FilterControlsProps {
  timeRange: string;
  sideFilter: "all" | "long" | "short";
  minValue: string;
  onTimeRangeChange: (value: string) => void;
  onSideFilterChange: (value: "all" | "long" | "short") => void;
  onMinValueChange: (value: string) => void;
  onRefresh: () => void;
  isConnected: boolean;
}

export default function FilterControls({
  timeRange,
  sideFilter,
  minValue,
  onTimeRangeChange,
  onSideFilterChange,
  onMinValueChange,
  onRefresh,
  isConnected
}: FilterControlsProps) {
  const timeRangeOptions = [
    { value: "1m", label: "1 Minute" },
    { value: "5m", label: "5 Minutes" },
    { value: "15m", label: "15 Minutes" },
    { value: "1h", label: "1 Hour" },
    { value: "4h", label: "4 Hours" },
    { value: "1d", label: "24 Hours" }
  ];

  const minValueOptions = [
    { value: "0", label: "All Values" },
    { value: "1000", label: "$1K+" },
    { value: "5000", label: "$5K+" },
    { value: "10000", label: "$10K+" },
    { value: "50000", label: "$50K+" },
    { value: "100000", label: "$100K+" }
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <Filter className="h-5 w-5" />
          Filters
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={!isConnected}
          data-testid="button-refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Time Range
            </label>
            <Select value={timeRange} onValueChange={onTimeRangeChange}>
              <SelectTrigger data-testid="select-time-range">
                <SelectValue placeholder="Select time range" />
              </SelectTrigger>
              <SelectContent>
                {timeRangeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Side Filter
            </label>
            <div className="flex gap-2">
              <Button
                variant={sideFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => onSideFilterChange("all")}
                data-testid="button-filter-all"
              >
                All
              </Button>
              <Button
                variant={sideFilter === "long" ? "default" : "outline"}
                size="sm"
                onClick={() => onSideFilterChange("long")}
                className={sideFilter === "long" ? "bg-chart-1 hover:bg-chart-1/90" : ""}
                data-testid="button-filter-long"
              >
                Long
              </Button>
              <Button
                variant={sideFilter === "short" ? "default" : "outline"}
                size="sm"
                onClick={() => onSideFilterChange("short")}
                className={sideFilter === "short" ? "bg-chart-2 hover:bg-chart-2/90" : ""}
                data-testid="button-filter-short"
              >
                Short
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Minimum Value
            </label>
            <Select value={minValue} onValueChange={onMinValueChange}>
              <SelectTrigger data-testid="select-min-value">
                <SelectValue placeholder="Select minimum value" />
              </SelectTrigger>
              <SelectContent>
                {minValueOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {sideFilter && sideFilter !== "all" && (
            <Badge variant="secondary" data-testid="badge-active-side-filter">
              Side: {sideFilter.toUpperCase()}
            </Badge>
          )}
          {minValue && minValue !== "0" && (
            <Badge variant="secondary" data-testid="badge-active-value-filter">
              Min Value: ${parseInt(minValue).toLocaleString()}
            </Badge>
          )}
          {timeRange && (
            <Badge variant="secondary" data-testid="badge-active-time-filter">
              Range: {timeRangeOptions.find(opt => opt.value === timeRange)?.label}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}