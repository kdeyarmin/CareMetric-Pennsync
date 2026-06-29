import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ProgressFeedback({ 
  stages = [],
  currentStage = 0,
  message = "Processing...",
  isComplete = false 
}) {
  const progress = isComplete ? 100 : ((currentStage + 1) / stages.length) * 100;

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardContent className="p-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            {isComplete ? (
              <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
            ) : (
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin flex-shrink-0" />
            )}
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900">
                {isComplete ? "Complete!" : message}
              </h3>
              {!isComplete && stages.length > 0 && (
                <p className="text-sm text-slate-600">
                  Step {currentStage + 1} of {stages.length}: {stages[currentStage]}
                </p>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <Progress value={progress} className="h-2" />

          {/* Stage List */}
          {stages.length > 0 && (
            <div className="space-y-2 mt-4">
              {stages.map((stage, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  {index < currentStage ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  ) : index === currentStage && !isComplete ? (
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
                  )}
                  <span className={
                    index < currentStage 
                      ? "text-green-700 font-medium" 
                      : index === currentStage
                      ? "text-blue-700 font-medium"
                      : "text-slate-500"
                  }>
                    {stage}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}