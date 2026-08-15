import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIME_RANGE_OPTIONS } from "@/lib/time-range";
import type { TimeRange } from "../../api/queries/time-range";

export default function TimeRangePicker({
  value,
  onChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select value={value} onValueChange={(next) => onChange(next as TimeRange)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIME_RANGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === "custom" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label className="sr-only" htmlFor="range-start">Start date</label>
          <Input
            id="range-start"
            type="datetime-local"
            value={startDate}
            onChange={(event) => onStartDateChange(event.target.value)}
            className="w-[205px]"
            aria-label="Start date and time"
          />
          <span aria-hidden="true">to</span>
          <label className="sr-only" htmlFor="range-end">End date</label>
          <Input
            id="range-end"
            type="datetime-local"
            value={endDate}
            onChange={(event) => onEndDateChange(event.target.value)}
            className="w-[205px]"
            aria-label="End date and time"
          />
        </div>
      )}
    </div>
  );
}
