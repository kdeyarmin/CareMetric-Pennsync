import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stethoscope } from "lucide-react";
import OASISNoAnalysisCard from "@/components/oasis/OASISNoAnalysisCard";
import AIPathwayRecommender from "@/components/oasis/AIPathwayRecommender";
import ClinicalPathwayTrigger from "@/components/oasis/ClinicalPathwayTrigger";
import OASISTaskGenerator from "@/components/oasis/OASISTaskGenerator";
import WorkflowExecutionEngine from "@/components/oasis/WorkflowExecutionEngine";

// Released by the owner on 2026-10-08 ("turn everything on"). Pathways are read
// and tasks, alerts and automation runs are written only through the OASIS
// record broker, which confirms the clinician may open the chart first; the
// clinical summary below shows clinical grouping only, never payment.
const OASIS_CLINICAL_AI_ENABLED = true;

function EnabledOASISClinicalReview({ analysisHandoff }) {
  const { analysisResults, pdgmData, patientName, patientId, uploadId, analysisId } = analysisHandoff || {};

  if (!analysisResults || !pdgmData) {
    return <OASISNoAnalysisCard />;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* AI Pathway Recommender */}
      <AIPathwayRecommender
        pdgmData={pdgmData}
        analysisResults={analysisResults}
        patientId={patientId}
        onPathwaysActivated={() => {
        }}
      />

      {/* Clinical Pathway Trigger */}
      {patientId && (
        <ClinicalPathwayTrigger
          patientId={patientId}
          pdgmData={pdgmData}
        />
      )}

      {/* Task Generator */}
      <OASISTaskGenerator
        analysisResults={analysisResults}
        patientId={patientId}
        patientName={patientName}
        analysisId={analysisId}
      />

      {/* Automated Workflow Engine */}
      <WorkflowExecutionEngine
        analysisResults={analysisResults}
        patientId={patientId}
        oasisUploadId={uploadId || null}
        autoExecute={true}
      />

      {/* Clinical Data Summary */}
      <Card className="border-2 border-blue-200">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-navy-50">
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-blue-600" />
            Clinical Data Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">Primary Diagnosis</p>
              <p className="text-slate-900">{pdgmData?.primary_diagnosis || 'Not specified'}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">Clinical Group</p>
              <Badge className="bg-blue-100 text-blue-800">
                {pdgmData?.clinical_group || 'Not determined'}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">Functional Level</p>
              <Badge className="bg-navy-100 text-navy-800">
                {pdgmData?.functional_level || 'Not determined'}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">Admission Source</p>
              <p className="text-slate-900">{pdgmData?.admission_source || 'Not specified'}</p>
            </div>
          </div>

          {pdgmData?.comorbidities && pdgmData.comorbidities.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">Comorbidities</p>
              <div className="flex flex-wrap gap-2">
                {pdgmData.comorbidities.map((comorb, idx) => (
                  <Badge key={idx} variant="outline">{comorb}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function OASISClinicalReview({ analysisHandoff }) {
  if (!OASIS_CLINICAL_AI_ENABLED) {
    return (
      <Card className="border-2 border-amber-300">
        <CardHeader className="bg-amber-50">
          <CardTitle className="flex items-center gap-2 text-amber-950">
            <Stethoscope className="h-5 w-5" /> OASIS Clinical Review Off
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-5 text-sm text-slate-700">
          <p>Clinical pathways and OASIS automation are switched off for this deployment.</p>
        </CardContent>
      </Card>
    );
  }
  return <EnabledOASISClinicalReview analysisHandoff={analysisHandoff} />;
}
