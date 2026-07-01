import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function PerformanceMetricsCard({
  title,
  value,
  change,
  icon: Icon,
  color = "blue",
  // For "lower is better" metrics (e.g. average documentation time) a decrease
  // is the improvement. Set this so the arrow encodes good(up)/bad(down) rather
  // than raw numeric direction — otherwise a team that got 12% SLOWER is shown
  // with an up-arrow that reads as an improvement.
  invertTrend = false,
}) {
  const colorMap = {
    blue: "from-blue-500 to-blue-600",
    green: "from-green-500 to-green-600",
    purple: "from-navy-500 to-navy-600",
    indigo: "from-indigo-500 to-indigo-600",
    orange: "from-orange-500 to-orange-600"
  };

  const hasChange = change !== undefined && change !== null;
  const numChange = parseFloat(change);
  const isPositive = numChange > 0;
  const isNegative = numChange < 0;
  const isImprovement = hasChange && (invertTrend ? isNegative : isPositive);
  const isRegression = hasChange && (invertTrend ? isPositive : isNegative);

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
            <div className="flex items-center gap-1 mt-2" title={invertTrend ? "Lower is better" : undefined}>
              {isImprovement ? (
                <TrendingUp className="w-3 h-3" />
              ) : isRegression ? (
                <TrendingDown className="w-3 h-3" />
              ) : null}
              <span className="text-xs opacity-90">
                {isPositive ? '+' : ''}{change}% vs prev period{invertTrend ? ' (lower is better)' : ''}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}