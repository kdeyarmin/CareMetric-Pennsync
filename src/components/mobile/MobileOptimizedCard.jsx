import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Mobile-optimized card component with responsive padding and text
 */
export default function MobileOptimizedCard({ 
  title, 
  icon: Icon, 
  children, 
  className = "",
  headerClassName = "",
  contentClassName = ""
}) {
  return (
    <Card className={className}>
      {title && (
        <CardHeader className={`p-4 sm:p-6 ${headerClassName}`}>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            {Icon && <Icon className="w-4 h-4 sm:w-5 sm:h-5" />}
            {title}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className={`p-4 sm:p-6 ${contentClassName}`}>
        {children}
      </CardContent>
    </Card>
  );
}