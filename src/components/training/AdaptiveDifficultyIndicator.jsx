import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  Brain
} from "lucide-react";

export default function AdaptiveDifficultyIndicator({ performanceData }) {
  if (!performanceData) return null;

  const { 
    accuracy_rate, 
    suggested_difficulty, 
    recommendation,
    motivation_message,
    improvement_areas 
  } = performanceData;

  const getRecommendationIcon = () => {
    if (recommendation === 'increase_difficulty') return <TrendingUp className="w-5 h-5 text-green-600" />;
    if (recommendation === 'decrease_difficulty') return <TrendingDown className="w-5 h-5 text-orange-600" />;
    return <Target className="w-5 h-5 text-blue-600" />;
  };

  const getRecommendationColor = () => {
    if (recommendation === 'increase_difficulty') return 'bg-green-50 border-green-200';
    if (recommendation === 'decrease_difficulty') return 'bg-orange-50 border-orange-200';
    return 'bg-blue-50 border-blue-200';
  };

  return (
    <Card className={`border-2 ${getRecommendationColor()}`}>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-white rounded-full">
            {getRecommendationIcon()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-bold text-slate-900">Adaptive Learning Active</h4>
              <Badge className="bg-navy-500">
                <Brain className="w-3 h-3 mr-1" />
                AI-Powered
              </Badge>
            </div>
            
            <p className="text-sm text-slate-700 mb-3">{motivation_message}</p>

            <div className="grid md:grid-cols-2 gap-4 mb-3">
              <div>
                <p className="text-xs text-slate-600 mb-1">Current Accuracy</p>
                <div className="flex items-center gap-2">
                  <Progress value={accuracy_rate} className="flex-1 h-2" />
                  <span className="text-sm font-bold">{accuracy_rate?.toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-600 mb-1">Recommended Level</p>
                <Badge className="text-sm capitalize">{suggested_difficulty}</Badge>
              </div>
            </div>

            {improvement_areas && improvement_areas.length > 0 && (
              <Alert className="bg-white border-slate-200">
                <Zap className="w-4 h-4" />
                <AlertDescription>
                  <p className="text-xs font-semibold mb-1">Focus Areas:</p>
                  <ul className="text-xs space-y-1">
                    {improvement_areas.slice(0, 3).map((area, idx) => (
                      <li key={idx}>• {area}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}