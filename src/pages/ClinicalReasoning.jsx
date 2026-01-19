import React from 'react';
import EvidenceBasedClinicalReasoning from '../components/clinical/EvidenceBasedClinicalReasoning';

export default function ClinicalReasoningPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">AI Clinical Reasoning Agent</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Generate evidence-based differential diagnoses, treatment recommendations, and clinical insights from high-impact medical journals
        </p>
      </div>

      <EvidenceBasedClinicalReasoning />
    </div>
  );
}