import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-7 items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "border-primary/35 bg-primary/10 text-primary",
        secondary: "border-border bg-secondary text-muted-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        destructive: "border-destructive/45 bg-destructive/10 text-destructive",
        cyan: "border-fitness-cyan/35 bg-fitness-cyan/10 text-fitness-cyan",
        orange:
          "border-fitness-orange/35 bg-fitness-orange/10 text-fitness-orange",
        violet:
          "border-fitness-violet/35 bg-fitness-violet/10 text-fitness-violet",
      },
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ className, variant }))} {...props} />
  );
}
