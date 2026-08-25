import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "px-4 py-2",
        sm: "min-h-9 px-3 py-1.5 text-xs",
        icon: "size-10 p-0",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:border-primary/90 hover:bg-primary/90",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground hover:border-destructive/90 hover:bg-destructive/90",
        outline:
          "border-border bg-secondary text-foreground hover:border-primary/60 hover:text-primary",
        secondary:
          "border-border bg-card text-foreground hover:border-primary/50 hover:bg-secondary",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
      },
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ className, size, variant }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
