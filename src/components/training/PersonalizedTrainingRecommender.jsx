import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Target, AlertTriangle, Sparkles } from "lucide-react";

export default function PersonalizedTrainingRecommender({ skillGaps, onStartTraining, isGenerating }) {
  if (skillGaps.length === 0) {
    return (
      <Card className="border-green-200">
        <CardContent className="p-8 text-center">
          <Target className="w-12 h-12 mx-auto mb-3 text-green-500" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No Skill Gaps Detected</h3>
          <p className="text-slate-600">
            Great work! Our AI analysis hasn't identified any significant skill gaps. Keep up the excellent performance!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-navy-200 bg-gradient-to-r from-navy-50 to-gold-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-navy-900">
          <Brain className="w-5 h-5" />
          AI-Recommended Training
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-navy-800 mb-4">
          Based on your recent performance data, we've identified {skillGaps.length} skill area{skillGaps.length > 1 ? 's' : ''} where targeted training could help you improve.
        </p>
        
        <div className="space-y-3">
          {skillGaps.slice(0, 3).map((gap, idx) => (
            <div key={idx} className="bg-white rounded-lg p-4 border border-navy-200 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-semibold text-slate-900">{gap.skill}</h4>
                    <Badge 
                      variant="destructive" 
                      className={
                        gap.gap_severity === 'high' ? 'bg-red-600' :
                        gap.gap_severity === 'medium' ? 'bg-orange-600' :
                        'bg-yellow-600'
                      }
                    >
                      {gap.gap_severity} priority
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-600 mb-3">{gap.recommendation}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Sparkles className="w-3 h-3" />
                    <span>AI will generate personalized interactive training</span>
                  </div>
                </div>
                <Button
                  onClick={() => onStartTraining(gap.skill)}
                  disabled={isGenerating}
                  size="sm"
                  className="bg-navy-600 hover:bg-navy-700 flex-shrink-0"
                >
                  Start Training
                </Button>
              </div>
            </div>
          ))}
        </div>

        {skillGaps.length > 3 && (
          <div className="bg-amber-50 rounded-lg p-3 border border-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              {skillGaps.length - 3} more skill gap{skillGaps.length - 3 > 1 ? 's' : ''} identified. Complete these first for maximum impact.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}