import React from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import PatientOnboardingWizard from "../components/patient/PatientOnboardingWizard";

export default function PatientOnboarding() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen p-4 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            New Patient Onboarding
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Streamlined patient registration with AI-powered data extraction
          </p>
        </div>

        <PatientOnboardingWizard
          onComplete={(patient) => {
            navigate(createPageUrl('PatientDetails') + `?id=${patient.id}`);
          }}
        />
      </div>
    </div>
  );
}