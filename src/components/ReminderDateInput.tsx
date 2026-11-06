import { useState } from "react";
import { Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ReminderDateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false);
  const empty = !value && !focused;
  return (
    <div className="relative h-9 min-w-0">
      <Input type="datetime-local" aria-label="Establecer fecha y hora" value={value}
        onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className={cn("min-w-0", empty && "text-transparent [&::-webkit-datetime-edit]:opacity-0 [&::-webkit-calendar-picker-indicator]:opacity-0")} />
      {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-between gap-2 px-3 text-sm text-muted-foreground">
        Establecer fecha y hora <Calendar className="h-4 w-4 shrink-0" />
      </span>}
    </div>
  );
}