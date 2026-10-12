import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "group peer relative inline-flex h-7 w-[60px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className,
    )}
    {...props}
    ref={ref}
  >
    {/* Visible action label — describes what clicking will do */}
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-wider select-none transition-colors"
    >
      <span className="group-data-[state=checked]:hidden pl-6 text-muted-foreground">
        Off
      </span>
      <span className="group-data-[state=unchecked]:hidden pr-6 text-primary-foreground">
        On
      </span>
    </span>
    {/* Screen-reader-only state announcement: complements role="switch" + aria-checked */}
    <span className="sr-only">
      <span className="group-data-[state=checked]:hidden">Currently off. Activate to turn on.</span>
      <span className="group-data-[state=unchecked]:hidden">
        Currently on. Activate to turn off.
      </span>
    </span>
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none z-10 block h-6 w-6 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-[32px] data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
