import React, { useState } from "react";
import DifferentialDiagnosisSuggester from "@/components/smartNote/DifferentialDiagnosisSuggester";
import MedicationCrossChecker from "@/components/smartNote/MedicationCrossChecker";
import AdverseEventPredictor from "@/components/smartNote/AdverseEventPredictor";

export default function SmartNoteAssistant() {
  const [symptoms, setSymptoms] = useState("");
  const [medications, setMedications] = useState("");
  const [diagnoses, setDiagnoses] = useState("");
  const [patientData, setPatientData] = useState("");

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Smart Note Assistant</h1>
        <p className="text-gray-600">AI-powered clinical decision support tools</p>
      </div>

      <div className="grid gap-6">
        <DifferentialDiagnosisSuggester 
          symptoms={symptoms}
          patientHistory={patientData}
        />

        <MedicationCrossChecker 
          medications={medications}
          diagnoses={diagnoses}
        />

        <AdverseEventPredictor 
          patientData={patientData}
        />
      </div>
    </div>
  );
}