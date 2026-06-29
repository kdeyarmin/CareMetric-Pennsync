import { useLocation, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import OASISDocumentationQualityScorer from "@/components/oasis/OASISDocumentationQualityScorer";
import AIDocumentReviewer from "@/components/oasis/AIDocumentReviewer";
import AIDocumentationGenerator from "@/components/oasis/AIDocumentationGenerator";
import AIDocumentationAssistant from "@/components/oasis/AIDocumentationAssistant";
import InlineDocumentationAssistant from "@/components/oasis/InlineDocumentationAssistant";

export default function OASISDocumentationReview() {
  const location = useLocation();
  const { analysisResults, pdgmData, navigationData } = location.state || {};

  if (!analysisResults) {
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