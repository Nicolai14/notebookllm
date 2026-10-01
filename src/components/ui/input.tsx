import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground",
      "placeholder:text-muted-foreground",
      "transition-[border-color,box-shadow] duration-150 [transition-timing-function:var(--ease-out-strong)]",
      "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25",
      "disabled:pointer-events-none disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";
