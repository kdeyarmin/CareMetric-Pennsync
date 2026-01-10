import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  FileText,
  MapPin,
  TrendingUp,
  Lock,
  Eye,
  Users,
  AlertCircle
} from "lucide-react";

export default function AdvancedRegulatoryCompliance({ complianceData, onApplyFix, onCreateTask }) {
  if (!complianceData) return null;

  const { hipaa_compliance, state_regulatory, summary } = complianceData;

  // Risk level colors
  const riskColors = {
    critical: "bg-red-100 text-red-800 border-red-200",
    high: "bg-orange-100 text-orange-800 border-orange-200",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
    low: "bg-green-100 text-green-800 border-green-200"
  };

  const riskIcons = {
    critical: <AlertTriangle className="w-4 h-4 text-red-600" />,
    high: <AlertCircle className="w-4 h-4 text-orange-600" />,
    medium: <AlertTriangle className="w-4 h-4 text-yellow-600" />,
    low: <CheckCircle2 className="w-4 h-4 text-green-600" />
  };

  return (
    <Card className="border-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Advanced Regulatory Compliance
          </CardTitle>
          <div className="flex gap-2">
            <Badge className={riskColors[hipaa_compliance?.overall_risk_level || 'low']}>
              HIPAA: {hipaa_compliance?.overall_risk_level?.toUpperCase() || 'LOW'}
            </Badge>
            <Badge className={state_regulatory?.risk_score > 70 ? riskColors.critical : state_regulatory?.risk_score > 50 ? riskColors.high : riskColors.low}>
              State Risk: {state_regulatory?.risk_score || 0}/100
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="hipaa" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="hipaa" className="gap-2">
              <Lock className="w-4 h-4" />
              HIPAA
            </TabsTrigger>
            <TabsTrigger value="state" className="gap-2">
              <MapPin className="w-4 h-4" />
              State Regulatory
            </TabsTrigger>
            <TabsTrigger value="proactive" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              Proactive Actions
            </TabsTrigger>
          </TabsList>

          {/* HIPAA Compliance Tab */}
          <TabsContent value="hipaa" className="space-y-4">
            {hipaa_compliance?.violations?.length > 0 ? (
              <div className="space-y-3">
                <Alert className="bg-blue-50 border-blue-200">
                  <Shield className="w-4 h-4 text-blue-600" />
                  <AlertDescription className="text-sm">
                    {hipaa_compliance.violations.length} HIPAA privacy and security concern(s) identified
                  </AlertDescription>
                </Alert>

                {hipaa_compliance.violations.map((violation, idx) => (
                  <Card key={idx} className={`border-l-4 ${
                    violation.risk_level === 'critical' ? 'border-l-red-500 bg-red-50' :
                    violation.risk_level === 'high' ? 'border-l-orange-500 bg-orange-50' :
                    violation.risk_level === 'medium' ? 'border-l-yellow-500 bg-yellow-50' :
                    'border-l-blue-500 bg-blue-50'
                  }`}>
                    <CardContent className="pt-4">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 flex-1">
                            {riskIcons[violation.risk_level]}
                            <div className="flex-1">
                              <p className="font-semibold text-sm">{violation.category}</p>
                              <p className="text-sm text-gray-700 mt-1">{violation.issue}</p>
                            </div>
                          </div>
                          <Badge className={riskColors[violation.risk_level]}>
                            {violation.risk_level}
                          </Badge>
                        </div>

                        <div className="bg-white rounded-lg p-3 mt-2">
                          <p className="text-xs font-semibold text-gray-600 mb-1">Remediation:</p>
                          <p className="text-sm text-gray-800">{violation.remediation}</p>
                          {violation.regulatory_reference && (
                            <p className="text-xs text-gray-500 mt-2">
                              Reference: {violation.regulatory_reference}
                            </p>
                          )}
                        </div>

                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onApplyFix && onApplyFix(violation.remediation)}
                            className="text-xs"
                          >
                            Apply Fix
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onCreateTask && onCreateTask({
                              title: `HIPAA: ${violation.category}`,
                              description: `${violation.issue}\n\nRemediation: ${violation.remediation}`,
                              priority: violation.risk_level === 'critical' ? 'critical' : violation.risk_level === 'high' ? 'high' : 'medium',
                              type: 'safety'
                            })}
                            className="text-xs"
                          >
                            Create Task
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-900">No HIPAA Violations Detected</p>
                <p className="text-xs text-gray-600 mt-1">Documentation meets privacy and security standards</p>
              </div>
            )}

            {hipaa_compliance?.compliant_areas?.length > 0 && (
              <Card className="bg-green-50 border-green-200">
                <CardContent className="pt-4">
                  <p className="text-sm font-semibold text-green-900 mb-2">✓ HIPAA Compliant Areas:</p>
                  <ul className="text-xs text-green-800 space-y-1">
                    {hipaa_compliance.compliant_areas.map((area, idx) => (
                      <li key={idx}>• {area}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* State Regulatory Tab */}
          <TabsContent value="state" className="space-y-4">
            {state_regulatory?.potential_violations?.length > 0 ? (
              <div className="space-y-3">
                <Alert className="bg-purple-50 border-purple-200">
                  <MapPin className="w-4 h-4 text-purple-600" />
                  <AlertDescription className="text-sm">
                    {state_regulatory.potential_violations.length} potential state regulatory issue(s) identified
                  </AlertDescription>
                </Alert>

                {state_regulatory.potential_violations.map((violation, idx) => (
                  <Card key={idx} className={`border-l-4 ${
                    violation.severity === 'critical' ? 'border-l-red-500 bg-red-50' :
                    violation.severity === 'high' ? 'border-l-orange-500 bg-orange-50' :
                    'border-l-yellow-500 bg-yellow-50'
                  }`}>
                    <CardContent className="pt-4">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 flex-1">
                            {riskIcons[violation.severity]}
                            <div className="flex-1">
                              <p className="font-semibold text-sm">{violation.requirement}</p>
                              <p className="text-xs text-gray-600 mt-1">
                                Affects: {Array.isArray(violation.states_affected) ? violation.states_affected.join(', ') : violation.states_affected || 'Multiple states'}
                              </p>
                              <p className="text-sm text-gray-700 mt-2">{violation.issue}</p>
                            </div>
                          </div>
                          <Badge className={riskColors[violation.severity]}>
                            {violation.severity}
                          </Badge>
                        </div>

                        <div className="bg-white rounded-lg p-3 mt-2">
                          <p className="text-xs font-semibold text-gray-600 mb-1">Remediation:</p>
                          <p className="text-sm text-gray-800">{violation.remediation}</p>
                        </div>

                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onApplyFix && onApplyFix(violation.remediation)}
                            className="text-xs"
                          >
                            Apply Fix
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onCreateTask && onCreateTask({
                              title: `State Compliance: ${violation.requirement}`,
                              description: `${violation.issue}\n\nRemediation: ${violation.remediation}\n\nAffects: ${violation.states_affected}`,
                              priority: violation.severity === 'critical' ? 'critical' : 'high',
                              type: 'document'
                            })}
                            className="text-xs"
                          >
                            Create Task
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-900">No State Regulatory Issues Detected</p>
                <p className="text-xs text-gray-600 mt-1">Documentation aligns with common state requirements</p>
              </div>
            )}

            {state_regulatory?.state_specific_alerts?.length > 0 && (
              <Card className="bg-purple-50 border-purple-200">
                <CardContent className="pt-4">
                  <p className="text-sm font-semibold text-purple-900 mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    State-Specific Alerts:
                  </p>
                  <div className="space-y-2">
                    {state_regulatory.state_specific_alerts.map((alert, idx) => (
                      <div key={idx} className="bg-white rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-gray-800 flex-1">{alert.alert}</p>
                          <Badge variant="outline" className="text-xs">
                            {alert.priority}
                          </Badge>
                        </div>
                        {alert.action_required && (
                          <p className="text-xs text-gray-600 mt-2">
                            Action: {alert.action_required}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Proactive Actions Tab */}
          <TabsContent value="proactive" className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-sm">
                AI-identified proactive measures to prevent future compliance risks
              </AlertDescription>
            </Alert>

            {hipaa_compliance?.proactive_recommendations?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lock className="w-4 h-4 text-blue-600" />
                    HIPAA Privacy & Security Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {hipaa_compliance.proactive_recommendations.map((rec, idx) => (
                    <div key={idx} className="border rounded-lg p-3 bg-gray-50">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">{rec.recommendation}</p>
                          {rec.impact && (
                            <p className="text-xs text-gray-600 mt-1">Impact: {rec.impact}</p>
                          )}
                        </div>
                        <Badge variant="outline" className={
                          rec.priority === 'high' ? 'border-red-300 text-red-700' :
                          rec.priority === 'medium' ? 'border-yellow-300 text-yellow-700' :
                          'border-blue-300 text-blue-700'
                        }>
                          {rec.priority}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 text-xs"
                        onClick={() => onCreateTask && onCreateTask({
                          title: `Proactive: ${rec.recommendation.substring(0, 50)}...`,
                          description: rec.recommendation,
                          priority: rec.priority === 'high' ? 'high' : 'medium',
                          type: 'safety'
                        })}
                      >
                        Create Proactive Task
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {state_regulatory?.best_practices?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-purple-600" />
                    State Regulatory Best Practices
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {state_regulatory.best_practices.map((practice, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700">{practice}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}