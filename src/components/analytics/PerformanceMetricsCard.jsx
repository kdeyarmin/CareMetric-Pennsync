import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function PerformanceMetricsCard({ 
  title, 
  value, 
  change, 
  icon: Icon, 
  color = "blue" 
}) {
  const colorMap = {
    blue: "from-blue-500 to-blue-600",
    green: "from-green-500 to-green-600",
    purple: "from-navy-500 to-navy-600",
    indigo: "from-indigo-500 to-indigo-600",
    orange: "from-orange-500 to-orange-600"
  };

  const hasChange = change !== undefined && change !== null;
  const isPositive = parseFloat(change) > 0;
  const isNegative = parseFloat(change) < 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className={`p-4 bg-gradient-to-br ${colorMap[color]} text-white`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm opacity-90">{title}</p>
            <Icon className="w-5 h-5 opacity-75" />
          </div>
          <p className="text-2xl font-bold">{value}</p>
          {hasChange && (
            <div className="flex items-center gap-1 mt-2">
              {isPositive ? (
                <TrendingUp className="w-3 h-3" />
              ) : isNegative ? (
                <TrendingDown className="w-3 h-3" />
              ) : null}
              <span className="text-xs opacity-90">
                {isPositive ? '+' : ''}{change}% vs prev period
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}