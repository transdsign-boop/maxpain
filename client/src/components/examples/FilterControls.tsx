import FilterControls from '../FilterControls';
import { useState } from 'react';

export default function FilterControlsExample() {
  const [timeRange, setTimeRange] = useState("1h");
  const [sideFilter, setSideFilter] = useState<"all" | "long" | "short">("all");
  const [minValue, setMinValue] = useState("0");

  const handleRefresh = () => {
    console.log('Refresh triggered');
  };

  return (
    <div className="p-4">
      <FilterControls
        timeRange={timeRange}
        sideFilter={sideFilter}
        minValue={minValue}
        onTimeRangeChange={setTimeRange}
        onSideFilterChange={setSideFilter}
        onMinValueChange={setMinValue}
        onRefresh={handleRefresh}
        isConnected={true}
      />
    </div>
  );
}