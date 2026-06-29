import { useLocation, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import OASISValidationPanel from "@/components/oasis/OASISValidationPanel";
import AuditRiskPredictor from "@/components/oasis/AuditRiskPredictor";
import AIAuditRiskPredictor from "@/components/oasis/AIAuditRiskPredictor";
import AdvancedComplianceAnalyzer from "@/components/oasis/AdvancedComplianceAnalyzer";

export default function OASISComplianceReview() {
  const location = useLocation();
  const { analysisResults, pdgmData, patientId } = location.state || {};

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
      {/* Advanced AI Compliance Analyzer */}
      <AdvancedComplianceAnalyzer
        analysisResults={analysisResults}
        pdgmData={pdgmData}
        patientId={patientId}
      />

      {/* Validation Panel */}
      <OASISValidationPanel
        analysisResults={analysisResults}
        pdgmData={pdgmData}
      />

      {/* Compliance Concerns */}
      {analysisResults.compliance_concerns && analysisResults.compliance_concerns.length > 0 && (
        <Card className="border-2 border-red-200">
          <CardHeader className="bg-gradient-to-r from-red-50 to-gold-50">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Compliance Concerns ({analysisResults.compliance_concerns.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {analysisResults.compliance_concerns.map((concern, idx) => (
                <Card key={idx} className={`border-l-4 ${
                  concern.severity === 'critical' ? 'border-l-red-600' :
                  concern.severity === 'high' ? 'border-l-orange-500' :
                  'border-l-yellow-500'
                }`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <Badge className={`${
                        concern.severity === 'critical' ? 'bg-red-600' :
                        concern.severity === 'high' ? 'bg-orange-500' :
                        'bg-yellow-500'
                      } text-white`}>
                        {concern.severity}
                      </Badge>
                    </div>
                    <p className="font-semibold text-slate-900 mb-1">{concern.area}</p>
                    <p className="text-sm text-slate-700 mb-2">{concern.issue}</p>
                    <div className="bg-blue-50 p-2 rounded text-sm text-blue-900">
                      <strong>Recommendation:</strong> {concern.recommendation}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accuracy Issues */}
      {analysisResults.accuracy_issues && analysisResults.accuracy_issues.length > 0 && (
        <Card className="border-2 border-orange-200">
          <CardHeader className="bg-gradient-to-r from-orange-50 to-yellow-50">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              Accuracy Issues ({analysisResults.accuracy_issues.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {analysisResults.accuracy_issues.map((issue, idx) => (
                <Card key={idx} className={`border-l-4 ${
                  issue.severity === 'critical' ? 'border-l-red-600' :
                  issue.severity === 'high' ? 'border-l-orange-500' :
                  'border-l-yellow-500'
                }`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{issue.item}</Badge>
                        <Badge className={`${
                          issue.severity === 'critical' ? 'bg-red-600' :
                          issue.severity === 'high' ? 'bg-orange-500' :
                          'bg-yellow-500'
                        } text-white`}>
                          {issue.severity}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-slate-700 mb-2">{issue.issue}</p>
                    <div className="bg-green-50 p-2 rounded text-sm text-green-900">
                      <strong>Recommendation:</strong> {issue.recommendation}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Risk Predictors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AuditRiskPredictor analysisResults={analysisResults} />
        {patientId && (
          <AIAuditRiskPredictor 
            currentOASISData={analysisResults}
            patientId={patientId}
          />
        )}
      </div>
    </div>
  );
}