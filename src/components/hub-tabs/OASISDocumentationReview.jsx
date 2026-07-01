import { useLocation } from "react-router-dom";
import OASISNoAnalysisCard from "@/components/oasis/OASISNoAnalysisCard";
import OASISDocumentationQualityScorer from "@/components/oasis/OASISDocumentationQualityScorer";
import AIDocumentReviewer from "@/components/oasis/AIDocumentReviewer";
import AIDocumentationGenerator from "@/components/oasis/AIDocumentationGenerator";
import AIDocumentationAssistant from "@/components/oasis/AIDocumentationAssistant";
import InlineDocumentationAssistant from "@/components/oasis/InlineDocumentationAssistant";

export default function OASISDocumentationReview() {
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
      <AIDocumentReviewer
        analysisResults={analysisResults}
        pdgmData={pdgmData}
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