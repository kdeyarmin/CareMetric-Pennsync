import * as React from "react";
import { cn } from "@/lib/utils";

const EnhancedCard = React.forwardRef(({ className, variant = "default", interactive = false, ...props }, ref) => {
  const variants = {
    default: "modern-card",
    elevated: "modern-card-elevated",
    ai: "ai-card"
  };
  
  return (
    <div
      ref={ref}
      className={cn(
        variants[variant],
        interactive && "modern-card-interactive",
        className
      )}
      {...props}
    />
  );
});
EnhancedCard.displayName = "EnhancedCard";

const EnhancedCardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
EnhancedCardHeader.displayName = "EnhancedCardHeader";

const EnhancedCardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
EnhancedCardTitle.displayName = "EnhancedCardTitle";

const EnhancedCardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
EnhancedCardContent.displayName = "EnhancedCardContent";

export { EnhancedCard, EnhancedCardHeader, EnhancedCardTitle, EnhancedCardContent };