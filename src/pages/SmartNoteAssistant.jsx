import React, { useState } from "react";
import ClinicalNoteAnalyzer from "@/components/smartNote/ClinicalNoteAnalyzer";
import DifferentialDiagnosisSuggester from "@/components/smartNote/DifferentialDiagnosisSuggester";
import MedicationCrossChecker from "@/components/smartNote/MedicationCrossChecker";
import AdverseEventPredictor from "@/components/smartNote/AdverseEventPredictor";
import FollowUpTasksSuggester from "@/components/smartNote/FollowUpTasksSuggester";

export default function SmartNoteAssistant() {
  const [extractedData, setExtractedData] = useState(null);
  const [analysisResults, setAnalysisResults] = useState("");

  const handleDataExtracted = (data) => {
    setExtractedData(data);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Smart Note Assistant</h1>
        <p className="text-gray-600">AI-powered clinical decision support workflow</p>
      </div>

      <ClinicalNoteAnalyzer onDataExtracted={handleDataExtracted} />

      {extractedData && (
        <div className="grid gap-6">
          <DifferentialDiagnosisSuggester 
            symptoms={extractedData.symptoms?.join(", ") || ""}
            patientHistory={extractedData.patient_history}
          />

          <MedicationCrossChecker 
            medications={extractedData.medications?.join("\n") || ""}
            diagnoses={extractedData.diagnoses?.join(", ") || ""}
          />

          <AdverseEventPredictor 
            patientData={`Vitals: ${JSON.stringify(extractedData.vitals)}\nDiagnoses: ${extractedData.diagnoses?.join(", ")}\nMedications: ${extractedData.medications?.join(", ")}`}
          />

          <FollowUpTasksSuggester 
            analysisResults={analysisResults}
            extractedData={extractedData}
          />
        </div>
      )}
    </div>
  );
}