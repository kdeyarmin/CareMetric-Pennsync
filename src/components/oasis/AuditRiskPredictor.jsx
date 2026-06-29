import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  FileWarning,
  Scale
} from "lucide-react";

export default function AuditRiskPredictor({ analysisResults }) {
  if (!analysisResults) return null;

  // Calculate audit risk score based on multiple factors
  const calculateAuditRisk = () => {
    let riskScore = 0;
    const riskFactors = [];

    // Factor 1: Accuracy issues
    const accuracyIssues = analysisResults.accuracy_issues || [];
    const highSeverityAccuracy = accuracyIssues.filter(i => i.severity === 'high').length;
    const mediumSeverityAccuracy = accuracyIssues.filter(i => i.severity === 'medium').length;
    
    if (highSeverityAccuracy > 0) {
      riskScore += highSeverityAccuracy * 15;
      riskFactors.push({
        factor: 'High-severity accuracy issues',
        count: highSeverityAccuracy,
        impact: 'high',
        description: 'Critical documentation errors that auditors frequently flag'
      });
    }
    if (mediumSeverityAccuracy > 0) {
      riskScore += mediumSeverityAccuracy * 8;
      riskFactors.push({
        factor: 'Medium-severity accuracy issues',
        count: mediumSeverityAccuracy,
        impact: 'medium',
        description: 'Documentation inconsistencies that may trigger audit review'
      });
    }

    // Factor 2: Compliance concerns
    const complianceConcerns = analysisResults.compliance_concerns || [];
    const criticalCompliance = complianceConcerns.filter(c => c.severity === 'high').length;
    
    if (criticalCompliance > 0) {
      riskScore += criticalCompliance * 20;
      riskFactors.push({
        factor: 'Critical compliance violations',
        count: criticalCompliance,
        impact: 'critical',
        description: 'CMS regulatory violations that often result in claim denials'
      });
    }

    // Factor 3: Functional score patterns (unusually high scores are audit triggers)
    const pdgmData = analysisResults.pdgm_data;
    if (pdgmData?.functional_scores) {
      const scores = pdgmData.functional_scores;
      const highFunctionalCount = Object.values(scores).filter(s => {
        const maxForItem = s > 4 ? 6 : 3; // Approximate max values
        return s >= maxForItem * 0.8;
      }).length;
      
      if (highFunctionalCount >= 4) {
        riskScore += 12;
        riskFactors.push({
          factor: 'Multiple high functional impairment scores',
          count: highFunctionalCount,
          impact: 'medium',
          description: 'Pattern of high dependency scores may trigger medical review'
        });
      }
    }

    // Factor 4: Validation issues
    const validationIssues = analysisResults.validation_summary?.issues || [];
    const criticalValidation = validationIssues.filter(i => i.severity === 'critical').length;
    
    if (criticalValidation > 0) {
      riskScore += criticalValidation * 18;
      riskFactors.push({
        factor: 'Critical data validation failures',
        count: criticalValidation,
        impact: 'critical',
        description: 'Internal consistency errors that indicate documentation problems'
      });
    }

    // Factor 5: Missing documentation elements
    const extractedItems = analysisResults.extracted_items;
    if (extractedItems?.items_missing?.length > 5) {
      riskScore += 10;
      riskFactors.push({
        factor: 'Multiple missing OASIS items',
        count: extractedItems.items_missing.length,
        impact: 'medium',
        description: 'Incomplete documentation increases audit selection probability'
      });
    }

    // Factor 6: Low overall scores
    if (analysisResults.accuracy_score < 70) {
      riskScore += 15;
      riskFactors.push({
        factor: 'Low accuracy score',
        count: null,
        impact: 'high',
        description: `Accuracy score of ${analysisResults.accuracy_score}% is below acceptable threshold`
      });
    }

    if (analysisResults.compliance_score < 70) {
      riskScore += 18;
      riskFactors.push({
        factor: 'Low compliance score',
        count: null,
        impact: 'high',
        description: `Compliance score of ${analysisResults.compliance_score}% indicates regulatory risk`
      });
    }

    // Cap at 100
    riskScore = Math.min(100, riskScore);

    return { riskScore, riskFactors };
  };

  const { riskScore, riskFactors } = calculateAuditRisk();

  const getRiskLevel = (score) => {
    if (score >= 70) return { level: 'High', color: 'text-red-700', bg: 'bg-red-100', border: 'border-red-300' };
    if (score >= 40) return { level: 'Moderate', color: 'text-yellow-700', bg: 'bg-yellow-100', border: 'border-yellow-300' };
    if (score >= 20) return { level: 'Low', color: 'text-blue-700', bg: 'bg-blue-100', border: 'border-blue-300' };
    return { level: 'Minimal', color: 'text-green-700', bg: 'bg-green-100', border: 'border-green-300' };
  };

  const riskInfo = getRiskLevel(riskScore);

  const getImpactBadge = (impact) => {
    switch (impact) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <Card className="border-2 border-orange-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-orange-50 to-red-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-orange-600" />
          Audit Risk Prediction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Risk Score Gauge */}
        <div className={`p-4 rounded-lg border-2 ${riskInfo.bg} ${riskInfo.border}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {riskScore >= 70 ? (
                <XCircle className="w-6 h-6 text-red-600" />
              ) : riskScore >= 40 ? (
                <AlertTriangle className="w-6 h-6 text-yellow-600" />
              ) : (
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              )}
              <div>
                <p className="text-xs text-slate-600">Predicted Audit Risk</p>
                <p className={`text-2xl font-bold ${riskInfo.color}`}>
                  {riskInfo.level} Risk
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-3xl font-bold ${riskInfo.color}`}>{riskScore}%</p>
              <p className="text-xs text-slate-500">Risk Score</p>
            </div>
          </div>
          <Progress 
            value={riskScore} 
            className="h-3"
          />
        </div>

        {/* Risk Factors */}
        {riskFactors.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Contributing Risk Factors
            </p>
            <div className="space-y-2">
              {riskFactors.map((factor, idx) => (
                <div key={idx} className="p-3 bg-white rounded-lg border flex items-start gap-3">
                  <FileWarning className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    factor.impact === 'critical' || factor.impact === 'high' ? 'text-red-500' :
                    factor.impact === 'medium' ? 'text-yellow-500' : 'text-blue-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-800">{factor.factor}</span>
                      {factor.count !== null && (
                        <Badge variant="outline" className="text-xs">{factor.count}</Badge>
                      )}
                      <Badge className={`text-xs ${getImpactBadge(factor.impact)}`}>
                        {factor.impact}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{factor.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-green-50 rounded-lg border border-green-200 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-green-800">No significant audit risk factors detected</p>
            <p className="text-xs text-green-600 mt-1">Documentation appears to be well-prepared for audit review</p>
          </div>
        )}

        {/* Audit Preparation Tips */}
        <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
          <p className="text-xs font-semibold text-indigo-800 mb-2 flex items-center gap-1">
            <Scale className="w-3 h-3" />
            Audit Preparation Recommendations
          </p>
          <ul className="text-xs text-indigo-700 space-y-1">
            <li>• Ensure all functional scores have supporting narrative documentation</li>
            <li>• Verify primary diagnosis aligns with documented skilled need</li>
            <li>• Confirm homebound status is clearly substantiated</li>
            <li>• Check that all M-items have internal consistency</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}