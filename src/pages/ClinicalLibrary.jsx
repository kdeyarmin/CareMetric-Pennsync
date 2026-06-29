import ClinicalLibraryManager from "../components/clinical/ClinicalLibraryManager";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { BookOpen } from "lucide-react";

export default function ClinicalLibrary() {
  return (
    <PageContainer>
      <PageHeader
        icon={BookOpen}
        eyebrow="Resources"
        title="Clinical Library"
        description="Create and manage quick phrases that expand into full Medicare-compliant documentation. Perfect for common assessments, education, and interventions."
        favoritePage="ClinicalLibrary"
      />

      <ClinicalLibraryManager />

      <div className="mt-6 sm:mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 sm:p-6">
          <h3 className="font-semibold text-blue-900 mb-2 sm:mb-3 text-sm sm:text-base">Generic Templates</h3>
          <p className="text-xs sm:text-sm text-blue-800 mb-3 sm:mb-4">
            Use for standard documentation that applies to all patients.
          </p>
          <div className="space-y-2 text-xs sm:text-sm">
            <div className="bg-white rounded p-2 sm:p-3">
              <code className="text-blue-600 font-mono text-xs sm:text-sm">diabetic education</code>
              <p className="text-slate-600 mt-1 text-[10px] sm:text-xs">
                Expands to full diabetic education documentation
              </p>
            </div>
            <div className="bg-white rounded p-2 sm:p-3">
              <code className="text-blue-600 font-mono text-xs sm:text-sm">fall risk assessment</code>
              <p className="text-slate-600 mt-1 text-[10px] sm:text-xs">
                Generates complete fall risk evaluation
              </p>
            </div>
          </div>
        </div>

        <div className="bg-navy-50 border border-navy-200 rounded-lg p-4 sm:p-6">
          <h3 className="font-semibold text-navy-900 mb-2 sm:mb-3 text-sm sm:text-base">Patient-Specific Templates</h3>
          <p className="text-xs sm:text-sm text-navy-800 mb-3 sm:mb-4">
            Automatically pulls patient data to personalize documentation.
          </p>
          <div className="space-y-2 text-xs sm:text-sm">
            <div className="bg-white rounded p-2 sm:p-3">
              <code className="text-navy-600 font-mono text-xs sm:text-sm">wound care provided</code>
              <p className="text-slate-600 mt-1 text-[10px] sm:text-xs">
                Uses patient's wound data to generate specific care notes
              </p>
            </div>
            <div className="bg-white rounded p-2 sm:p-3">
              <code className="text-navy-600 font-mono text-xs sm:text-sm">medication review</code>
              <p className="text-slate-600 mt-1 text-[10px] sm:text-xs">
                Includes patient's current medications in documentation
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}