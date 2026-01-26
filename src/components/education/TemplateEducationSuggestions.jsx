import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, BookOpen, Lightbulb, ExternalLink } from "lucide-react";

export default function TemplateEducationSuggestions({ templateId, patientDiagnosis }) {
  const { data: suggestions = {}, isLoading } = useQuery({
    queryKey: ['templateEducationMaterials', templateId, patientDiagnosis],
    queryFn: async () => {
      if (!templateId && !patientDiagnosis) return {};
      const response = await base44.functions.invoke('getTemplateEducationMaterials', {
        templateId,
        patientDiagnosis
      });
      return response || {};
    },
    enabled: !!(templateId || patientDiagnosis)
  });

  const { linkedMaterials = [], diagnosisMaterials = [], allMaterials = [] } = suggestions;

  if (!templateId && !patientDiagnosis) return null;
  if (allMaterials.length === 0) return null;

  return (
    <Card className="border-l-4 border-l-blue-500 bg-gradient-to-r from-blue-50 to-blue-100">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="w-5 h-5 text-blue-600" />
          Related Patient Materials
        </CardTitle>
        <p className="text-xs text-slate-600 mt-1">
          {templateId && linkedMaterials.length > 0 && `${linkedMaterials.length} materials linked to this template`}
          {patientDiagnosis && diagnosisMaterials.length > 0 && ` · ${diagnosisMaterials.length} for ${patientDiagnosis}`}
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-slate-600">Loading materials...</p>
        ) : (
          <>
            {/* Template-linked materials */}
            {linkedMaterials.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Template Materials
                </p>
                <div className="space-y-2">
                  {linkedMaterials.map((material) => (
                    <MaterialLink key={material.id} material={material} />
                  ))}
                </div>
              </div>
            )}

            {/* Diagnosis-based suggestions */}
            {diagnosisMaterials.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">
                  💡 For {patientDiagnosis}
                </p>
                <div className="space-y-2">
                  {diagnosisMaterials.map((material) => (
                    <MaterialLink key={material.id} material={material} suggested />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MaterialLink({ material, suggested }) {
  return (
    <div className="p-2.5 bg-white rounded border border-slate-200 hover:border-blue-400 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-900 truncate">{material.title}</p>
          <p className="text-xs text-slate-600 line-clamp-1 mt-0.5">{material.description}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <Badge className="text-xs bg-slate-100 text-slate-700">
              {material.material_type}
            </Badge>
            {material.duration_minutes && (
              <Badge variant="outline" className="text-xs">
                ⏱️ {material.duration_minutes}min
              </Badge>
            )}
            {suggested && (
              <Badge className="bg-blue-100 text-blue-700 text-xs">Suggested</Badge>
            )}
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-slate-500 hover:text-blue-600 flex-shrink-0"
          onClick={() => window.open(material.content_url, '_blank')}
          title="Open material"
        >
          <ExternalLink className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}