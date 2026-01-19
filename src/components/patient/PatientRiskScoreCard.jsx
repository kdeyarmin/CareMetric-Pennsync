import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  TrendingUp,
  Activity,
  Shield,
  Users,
  Home,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Info,
  Sparkles
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export default function PatientRiskScoreCard({ patient, onRefresh }) {
  const [calculating, setCalculating] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [riskDetails, setRiskDetails] = useState(null);

  const riskAssessment = patient?.risk_assessment;
  const score = riskAssessment?.score || 0;
  const level = riskAssessment?.level || 'unknown';

  const calculateRiskScore = async () => {
    setCalculating(true);
    try {
      const { data } = await base44.functions.invoke('calculatePatientRiskScore', {
        patient_id: patient.id
      });

      setRiskDetails(data.risk_assessment);
      toast.success('Risk score calculated');
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Failed to calculate risk score');
      console.error(error);
    } finally {
      setCalculating(false);
    }
  };

  const getRiskColor = () => {
    if (score >= 76) return 'from-red-500 to-red-700';
    if (score >= 51) return 'from-orange-500 to-orange-700';
    if (score >= 26) return 'from-yellow-500 to-yellow-700';
    return 'from-green-500 to-green-700';
  };

  const getRiskBadgeColor = () => {
    switch (level) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getCategoryIcon = (category) => {
    const icons = {
      clinical_stability: Activity,
      functional_status: TrendingUp,
      safety_risk: AlertTriangle,
      readmission_risk: Home,
      social_factors: Users
    };
    return icons[category] || Shield;
  };

  return (
    <>
      <Card className="border-l-4 border-l-purple-500">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              AI Risk Score
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={calculateRiskScore}
              disabled={calculating}
              className="h-7"
            >
              {calculating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Risk Score Display */}
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge className={getRiskBadgeColor()}>
                  {level.toUpperCase()}
                </Badge>
                {riskAssessment?.confidence && (
                  <span className="text-xs text-gray-500">
                    {riskAssessment.confidence}% confidence
                  </span>
                )}
              </div>
              <div className="relative w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${getRiskColor()} transition-all duration-500`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>0</span>
                <span className="font-semibold text-gray-900">{score}/100</span>
                <span>100</span>
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          {riskAssessment?.category_scores && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-700">Risk Breakdown:</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(riskAssessment.category_scores).map(([category, categoryScore]) => {
                  const Icon = getCategoryIcon(category);
                  return (
                    <div key={category} className="flex items-center gap-2">
                      <Icon className="w-3 h-3 text-gray-400" />
                      <div className="flex-1">
                        <p className="text-xs text-gray-600 capitalize">
                          {category.replace(/_/g, ' ')}
                        </p>
                        <div className="w-full h-1.5 bg-gray-200 rounded-full">
                          <div
                            className={`h-full rounded-full ${
                              categoryScore >= 75 ? 'bg-red-500' :
                              categoryScore >= 50 ? 'bg-orange-500' :
                              categoryScore >= 25 ? 'bg-yellow-500' :
                              'bg-green-500'
                            }`}
                            style={{ width: `${categoryScore}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-medium text-gray-700 w-8 text-right">
                        {categoryScore}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Last Updated */}
          {riskAssessment?.last_calculated && (
            <p className="text-xs text-gray-400">
              Updated {formatDistanceToNow(new Date(riskAssessment.last_calculated), { addSuffix: true })}
            </p>
          )}

          {/* View Details Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (riskDetails) {
                setDetailsOpen(true);
              } else {
                calculateRiskScore().then(() => setDetailsOpen(true));
              }
            }}
            className="w-full"
          >
            <Info className="w-3 h-3 mr-1" />
            View Detailed Analysis
          </Button>
        </CardContent>
      </Card>

      {/* Detailed Risk Analysis Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {riskDetails && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  Comprehensive Risk Analysis
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* Overall Score */}
                <Card className="bg-purple-50 border-purple-200">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-purple-900">Overall Risk Score</h3>
                      <Badge className={getRiskBadgeColor()}>
                        {riskDetails.risk_level.toUpperCase()} - {riskDetails.overall_risk_score}/100
                      </Badge>
                    </div>
                    <p className="text-sm text-purple-800">
                      {riskDetails.clinical_reasoning}
                    </p>
                    {riskDetails.confidence_score && (
                      <p className="text-xs text-purple-600 mt-2">
                        AI Confidence: {riskDetails.confidence_score}%
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Risk Factors */}
                {riskDetails.risk_factors?.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Identified Risk Factors</h3>
                    <div className="space-y-2">
                      {riskDetails.risk_factors.map((factor, idx) => (
                        <Card key={idx} className={`border-l-4 ${
                          factor.severity === 'critical' ? 'border-l-red-500' :
                          factor.severity === 'high' ? 'border-l-orange-500' :
                          factor.severity === 'medium' ? 'border-l-yellow-500' :
                          'border-l-blue-500'
                        }`}>
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="text-xs">
                                    {factor.category}
                                  </Badge>
                                  <Badge className={
                                    factor.severity === 'critical' ? 'bg-red-100 text-red-800' :
                                    factor.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                                    factor.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-blue-100 text-blue-800'
                                  }>
                                    {factor.severity}
                                  </Badge>
                                </div>
                                <p className="text-sm text-gray-700">{factor.factor}</p>
                              </div>
                              <span className="text-sm font-semibold text-gray-900">
                                {factor.impact_score}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Priority Interventions */}
                {riskDetails.priority_interventions?.length > 0 && (
                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        Priority Interventions
                      </h3>
                      <ul className="space-y-2">
                        {riskDetails.priority_interventions.map((intervention, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-blue-800">
                            <CheckCircle2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                            <span>{intervention}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Early Warning Signs */}
                {riskDetails.early_warning_signs?.length > 0 && (
                  <Card className="bg-yellow-50 border-yellow-200">
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Early Warning Signs to Monitor
                      </h3>
                      <ul className="space-y-1">
                        {riskDetails.early_warning_signs.map((sign, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-yellow-800">
                            <span className="text-yellow-500 mt-0.5">•</span>
                            <span>{sign}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Monitoring Frequency */}
                {riskDetails.recommended_monitoring_frequency && (
                  <Card className="bg-green-50 border-green-200">
                    <CardContent className="p-4">
                      <h3 className="font-semibold text-green-900 mb-1">Recommended Monitoring</h3>
                      <p className="text-sm text-green-800">
                        {riskDetails.recommended_monitoring_frequency}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}