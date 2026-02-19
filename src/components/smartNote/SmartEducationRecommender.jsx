import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, BookOpen, Check } from "lucide-react";
import { toast } from "sonner";

export default function SmartEducationRecommender({
  diagnosis,
  visitType,
  onMaterialsGenerated
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [recommendations, setRecommendations] = useState(null);

  const generateRecommendations = async () => {
    setIsLoading(true);
    try {
      const result = await base44.functions.invoke('smartEducationRecommender', {
        diagnosis_codes: [diagnosis],
        care_plan_goals: [],
        reading_level: 'simple',
        max_materials: 3
      });

      if (result?.data?.success) {
        setRecommendations(result.data);
        onMaterialsGenerated?.(result.data.generated_materials);
        toast.success("Education recommendations generated");
      } else {
        toast.error("Failed to generate recommendations");
      }
    } catch (error) {
      toast.error(`Error: ${error.message}`);
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-purple-200/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <BookOpen className="w-4 h-4 text-purple-600" />
          Personalized Education Recommendations
        </CardTitle>
        <p className="text-xs text-slate-600 mt-2">
          AI-selected education materials based on diagnosis and care plan
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!recommendations ? (
          <Button
            onClick={generateRecommendations}
            disabled={isLoading || !diagnosis}
            className="w-full"
            size="sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Generate Recommendations"
            )}
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="bg-green-50 p-2 rounded border border-green-200 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <Check className="w-4 h-4 text-green-600" />
                <span className="font-semibold">{recommendations.generated_materials?.length || 0} materials ready</span>
              </div>
            </div>
            <Button
              onClick={generateRecommendations}
              variant="outline"
              size="sm"
              className="w-full text-xs"
            >
              Refresh Recommendations
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}