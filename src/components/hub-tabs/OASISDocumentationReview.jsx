import { useLocation } from "react-router";
import OASISNoAnalysisCard from "@/components/oasis/OASISNoAnalysisCard";
import OASISDocumentationQualityScorer from "@/components/oasis/OASISDocumentationQualityScorer";
import AIDocumentReviewer from "@/components/oasis/AIDocumentReviewer";
import AIDocumentationGenerator from "@/components/oasis/AIDocumentationGenerator";
import AIDocumentationAssistant from "@/components/oasis/AIDocumentationAssistant";
import InlineDocumentationAssistant from "@/components/oasis/InlineDocumentationAssistant";

const OASIS_DOCUMENTATION_REVIEW_ENABLED = false;

function EnabledOASISDocumentationReview() {
  const location = useLocation();
  const { analysisResults, pdgmData, navigationData } = location.state || {};

  if (!analysisResults) {
    return <OASISNoAnalysisCard />;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Documentation Quality Score */}
      <OASISDocumentationQualityScorer
        analysisResults={analysisResults}
        pdgmData={pdgmData}
      />

      {/* AI Document Reviewer */}
      {/* Takes `oasisData` (see OASISAnalyzer.jsx); passing analysisResults/pdgmData
          left oasisData undefined, so the component hit its `return null` guard and
          the AI review never appeared on this tab. */}
      <AIDocumentReviewer
        oasisData={pdgmData}
      />

      {/* AI Documentation Generator */}
      <AIDocumentationGenerator
        analysisResults={analysisResults}
        pdgmData={pdgmData}
        navigationData={navigationData}
      />

      {/* AI Documentation Assistant */}
      <AIDocumentationAssistant
        analysisResults={analysisResults}
        patientData={pdgmData}
      />

      {/* Inline Documentation Assistant */}
      <InlineDocumentationAssistant
        analysisResults={analysisResults}
        pdgmData={pdgmData}
      />
    </div>
  );
}

export default function OASISDocumentationReview() {
  if (!OASIS_DOCUMENTATION_REVIEW_ENABLED) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <p className="font-semibold text-amber-900">OASIS Documentation AI Review Paused</p>
        <p className="mt-2 text-sm text-amber-800">
          Automated OASIS scoring and documentation guidance are unavailable pending verified CMS
          content, tenant-scoped authorization, and clinician review.
        </p>
      </div>
    );
  }
  return <EnabledOASISDocumentationReview />;
}
