import * as React from "react";
import { cn } from "@/lib/utils";

export function Progress({
  className,
  indicatorClassName,
  value,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  Readonly<{
    indicatorClassName?: string;
    value: number;
  }>) {
  const clamped = Math.min(Math.max(value, 0), 100);

  return (
    <div
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      role="progressbar"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(clamped)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full bg-primary", indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
