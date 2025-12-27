import React from "react";
import PatientDataExporter from "../components/export/PatientDataExporter";

export default function ExportPatientData() {
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Export Patient Data</h1>
        <p className="text-gray-600">
          Export patient demographics, visit history, and compliance audit summaries
        </p>
      </div>
      
      <PatientDataExporter />
    </div>
  );
}