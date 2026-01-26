import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, BookOpen } from "lucide-react";
import EducationMaterialCard from "./EducationMaterialCard";

export default function PatientEducationPanel({ patientDiagnosis }) {
  const [showAll, setShowAll] = useState(false);

  const { data: suggestedMaterials = [], isLoading } = useQuery({
    queryKey: ['suggestedEducation', patientDiagnosis],
    queryFn: async () => {
      if (!patientDiagnosis) return [];
      const response = await base44.functions.invoke('suggestEducationMaterials', {
        patientDiagnosis,
        limit: 3
      });
      return response.suggestions || [];
    },
    enabled: !!patientDiagnosis
  });

  if (!patientDiagnosis || suggestedMaterials.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-l-4 border-l-green-500 bg-gradient-to-r from-green-50 to-green-100">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="w-5 h-5 text-green-600" />
            Educational Resources
          </CardTitle>
          <p className="text-xs text-slate-600 mt-1">
            Materials related to {patientDiagnosis}
          </p>
        </CardHeader>

        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-green-600 mr-2" />
              <span className="text-sm text-slate-600">Loading materials...</span>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {suggestedMaterials.slice(0, 3).map((material) => (
                  <div
                    key={material.id}
                    className="p-3 bg-white rounded-lg border border-green-200 hover:border-green-400 transition-colors"
                  >
                    <p className="font-medium text-sm text-slate-900">{material.title}</p>
                    <p className="text-xs text-slate-600 mt-1">{material.description}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(material.content_url, '_blank')}
                      className="mt-2 w-full text-xs bg-green-50 border-green-200 hover:bg-green-100"
                    >
                      Read More
                    </Button>
                  </div>
                ))}
              </div>

              {suggestedMaterials.length > 3 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAll(true)}
                  className="w-full text-xs"
                >
                  View All {suggestedMaterials.length} Materials
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* View All Dialog */}
      {showAll && (
        <Dialog open={showAll} onOpenChange={setShowAll}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Educational Materials for {patientDiagnosis}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 mt-4">
              {suggestedMaterials.map((material) => (
                <EducationMaterialCard
                  key={material.id}
                  material={material}
                  onOpen={() => window.open(material.content_url, '_blank')}
                />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}