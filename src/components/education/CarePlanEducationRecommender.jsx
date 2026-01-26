import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ChevronRight, Loader2 } from "lucide-react";

export default function CarePlanEducationRecommender({ patientDiagnosis, onAssignMaterial }) {
  const { data: materials = [], isLoading } = useQuery({
    queryKey: ['carePlanEducation', patientDiagnosis],
    queryFn: async () => {
      if (!patientDiagnosis) return [];
      const response = await base44.functions.invoke('suggestEducationMaterials', {
        patientDiagnosis,
        limit: 4
      });
      return response?.suggestions || [];
    },
    enabled: !!patientDiagnosis
  });

  if (!patientDiagnosis || materials.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-green-500">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="w-5 h-5 text-green-600" />
          Patient Education for Care Plan
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-4 h-4 animate-spin text-green-600" />
            <span className="text-xs text-slate-600">Finding materials...</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {materials.map((material) => (
              <div
                key={material.id}
                className="p-2 bg-slate-50 rounded-lg border border-green-200 hover:bg-green-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-xs font-medium text-slate-900">{material.title}</p>
                    <div className="flex gap-1 mt-1">
                      <Badge className="text-xs bg-green-100 text-green-800">
                        {material.material_type}
                      </Badge>
                      {material.average_rating && (
                        <Badge variant="outline" className="text-xs">
                          ⭐ {material.average_rating.toFixed(1)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {onAssignMaterial && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-green-600 hover:bg-green-100"
                      onClick={() => onAssignMaterial(material)}
                      title="Add to care plan"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}