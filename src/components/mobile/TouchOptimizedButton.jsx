import { Button } from "@/components/ui/button";

/**
 * Touch-optimized button with larger tap targets for mobile
 */
export default function TouchOptimizedButton({ 
  children, 
  className = "",
  ...props 
}) {
  return (
    <Button
      className={`min-h-[44px] touch-manipulation ${className}`}
      {...props}
    >
      {children}
    </Button>
  );
}