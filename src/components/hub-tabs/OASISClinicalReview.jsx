import { useLocation, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Stethoscope } from "lucide-react";
import AIPathwayRecommender from "@/components/oasis/AIPathwayRecommender";
import ClinicalPathwayTrigger from "@/components/oasis/ClinicalPathwayTrigger";
import OASISTaskGenerator from "@/components/oasis/OASISTaskGenerator";
import WorkflowExecutionEngine from "@/components/oasis/WorkflowExecutionEngine";
import PredictiveOutcomesAnalyzer from "@/components/oasis/PredictiveOutcomesAnalyzer";

export default function OASISClinicalReview() {
  const location = useLocation();
  const { analysisResults, pdgmData, patientName, patientId } = location.state || {};

  if (!analysisResults || !pdgmData) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-slate-600">No analysis data available. Please analyze an OASIS document first.</p>
            <Link to={createPageUrl("OASISAnalyzer")}>
              <Button className="mt-4">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Analyzer
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Predictive Outcomes Analyzer */}
      <PredictiveOutcomesAnalyzer
        analysisResults={analysisResults}
        pdgmData={pdgmData}
        patientId={patientId}
      />

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
      />

      {/* Automated Workflow Engine */}
      <WorkflowExecutionEngine
        analysisResults={analysisResults}
        pdgmData={pdgmData}
        patientId={patientId}
        patientName={patientName}
        oasisUploadId={null}
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