import { useLocation, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, TrendingUp } from "lucide-react";
import PDGMRevenueComparison from "@/components/oasis/PDGMRevenueComparison";
import EnhancedPDGMCaseMixAnalyzer from "@/components/oasis/EnhancedPDGMCaseMixAnalyzer";
import AutomatedPDGMNavigator from "@/components/oasis/AutomatedPDGMNavigator";
import PDGMImpactAnalyzer from "@/components/oasis/PDGMImpactAnalyzer";

export default function OASISRevenueAnalysis() {
  const location = useLocation();
  const { analysisResults, pdgmData, _uploadId } = location.state || {};

  if (!analysisResults || !pdgmData) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-slate-600">No analysis data available. Please analyze an OASIS document first.</p>
            <Link to={`${createPageUrl("OASISCenter")}?tab=analyze`}>
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
      {/* Revenue Comparison */}
      <PDGMRevenueComparison 
        analysisResults={analysisResults}
        pdgmData={pdgmData}
      />

      {/* PDGM Navigator */}
      <AutomatedPDGMNavigator
        analysisResults={analysisResults}
        pdgmData={pdgmData}
      />

      {/* Case Mix Analyzer */}
      <EnhancedPDGMCaseMixAnalyzer
        analysisResults={analysisResults}
        pdgmData={pdgmData}
      />

      {/* Impact Analyzer */}
      <PDGMImpactAnalyzer
        analysisResults={analysisResults}
        pdgmData={pdgmData}
      />

      {/* Revenue Tips */}
      {analysisResults.revenue_tips && analysisResults.revenue_tips.length > 0 && (
        <Card className="border-2 border-green-200">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              Revenue Optimization Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {analysisResults.revenue_tips.map((tip, idx) => (
                <Card key={idx} className="border-l-4 border-l-green-500">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-green-100 text-green-800">{tip.category}</Badge>
                        <Badge variant="outline">{tip.potential_impact}</Badge>
                      </div>
                    </div>
                    <p className="font-medium text-slate-900 mb-2">{tip.opportunity}</p>
                    <p className="text-sm text-slate-700 mb-3">{tip.specific_action}</p>
                    {tip.supporting_documentation && (
                      <div className="bg-blue-50 p-2 rounded text-xs text-blue-900">
                        <strong>Documentation:</strong> {tip.supporting_documentation}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}