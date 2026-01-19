import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Pill,
  TrendingDown,
  Lightbulb,
  Clock,
  Shield,
  Loader2
} from "lucide-react";

export default function CDSSWidget({ 
  cdssData, 
  isLoading = false, 
  onRefresh = null 
}) {
  const [expandedSection, setExpandedSection] = useState(null);

  if (isLoading) {
    return (
      <Card className="border-indigo-200 dark:border-indigo-900">
        <CardContent className="py-8 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          <span className="text-slate-600 dark:text-slate-400">Analyzing clinical data...</span>
        </CardContent>
      </Card>
    );
  }

  if (!cdssData) {
    return null;
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "critical": return "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100 border-red-300";
      case "urgent": return "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100 border-orange-300";
      case "warning": return "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100 border-yellow-300";
      case "info": return "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100 border-blue-300";
      default: return "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100";
    }
  };

  const getRiskColor = (level) => {
    switch (level) {
      case "critical": return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950";
      case "high": return "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950";
      case "moderate": return "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950";
      case "low": return "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950";
      default: return "text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950";
    }
  };

  const getEvidenceLevel = (level) => {
    const config = {
      strong: { color: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200", label: "Strong Evidence" },
      moderate: { color: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200", label: "Moderate Evidence" },
      weak: { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200", label: "Weak Evidence" },
      insufficient: { color: "bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200", label: "Insufficient Evidence" }
    };
    return config[level] || config.insufficient;
  };

  return (
    <div className="space-y-6">
      {/* Critical Alerts Section */}
      {cdssData.clinical_alerts && cdssData.clinical_alerts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Clinical Alerts</h3>
          </div>
          {cdssData.clinical_alerts.map((alert, idx) => (
            <Alert key={idx} className={`border-2 ${getSeverityColor(alert.alert_type)}`}>
              <AlertDescription className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{alert.alert_title}</p>
                    <p className="text-sm mt-1">{alert.alert_description}</p>
                  </div>
                  <Badge className={`whitespace-nowrap ${
                    alert.alert_type === 'critical' ? 'bg-red-600' :
                    alert.alert_type === 'urgent' ? 'bg-orange-600' :
                    alert.alert_type === 'warning' ? 'bg-yellow-600' :
                    'bg-blue-600'
                  }`}>
                    {alert.alert_type.toUpperCase()}
                  </Badge>
                </div>
                <div className="pt-2 border-t border-current border-opacity-20 space-y-1">
                  <p className="text-sm font-medium">Required Action:</p>
                  <p className="text-sm">{alert.required_action}</p>
                  {alert.timeframe && (
                    <p className="text-xs font-medium flex items-center gap-1 mt-2">
                      <Clock className="w-3 h-3" /> {alert.timeframe}
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Tabs for detailed analysis */}
      <Tabs defaultValue="interactions" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="interactions">
            <Pill className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Interactions</span>
          </TabsTrigger>
          <TabsTrigger value="risks">
            <TrendingDown className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Risks</span>
          </TabsTrigger>
          <TabsTrigger value="treatment">
            <Lightbulb className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Treatment</span>
          </TabsTrigger>
          <TabsTrigger value="followup">
            <Clock className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Follow-up</span>
          </TabsTrigger>
        </TabsList>

        {/* Drug Interactions */}
        <TabsContent value="interactions" className="space-y-4">
          {cdssData.drug_interactions && cdssData.drug_interactions.length > 0 ? (
            cdssData.drug_interactions.map((interaction, idx) => (
              <Card key={idx} className={`border-l-4 ${
                interaction.interaction_type === 'contraindicated' ? 'border-l-red-600 bg-red-50 dark:bg-red-950' :
                interaction.interaction_type === 'major' ? 'border-l-orange-600 bg-orange-50 dark:bg-orange-950' :
                interaction.interaction_type === 'moderate' ? 'border-l-yellow-600 bg-yellow-50 dark:bg-yellow-950' :
                'border-l-blue-600 bg-blue-50 dark:bg-blue-950'
              }`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <CardTitle className="text-base">
                        {interaction.drugs_involved.join(" + ")}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {interaction.clinical_consequence}
                      </CardDescription>
                    </div>
                    <Badge className={`whitespace-nowrap ${
                      interaction.interaction_type === 'contraindicated' ? 'bg-red-600' :
                      interaction.interaction_type === 'major' ? 'bg-orange-600' :
                      interaction.interaction_type === 'moderate' ? 'bg-yellow-600' :
                      'bg-blue-600'
                    }`}>
                      {interaction.interaction_type.toUpperCase()}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Management Strategy:</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{interaction.management_strategy}</p>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-xs text-slate-600 dark:text-slate-400">Severity:</span>
                    <div className="w-32 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${
                          interaction.severity_score >= 8 ? 'bg-red-600' :
                          interaction.severity_score >= 6 ? 'bg-orange-600' :
                          interaction.severity_score >= 4 ? 'bg-yellow-600' :
                          'bg-green-600'
                        }`}
                        style={{ width: `${(interaction.severity_score / 10) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold">{interaction.severity_score}/10</span>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">No significant drug interactions detected</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Risk Assessments */}
        <TabsContent value="risks" className="space-y-4">
          {cdssData.risk_assessments && cdssData.risk_assessments.length > 0 ? (
            cdssData.risk_assessments.map((risk, idx) => (
              <Card key={idx} className={`border-l-4 ${
                risk.risk_level === 'critical' ? 'border-l-red-600' :
                risk.risk_level === 'high' ? 'border-l-orange-600' :
                risk.risk_level === 'moderate' ? 'border-l-yellow-600' :
                'border-l-green-600'
              }`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <CardTitle className="text-base">{risk.risk_type}</CardTitle>
                    </div>
                    <Badge className={`whitespace-nowrap ${
                      risk.risk_level === 'critical' ? 'bg-red-600' :
                      risk.risk_level === 'high' ? 'bg-orange-600' :
                      risk.risk_level === 'moderate' ? 'bg-yellow-600' :
                      'bg-green-600'
                    }`}>
                      {risk.risk_level.toUpperCase()}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        risk.risk_score >= 80 ? 'bg-red-600' :
                        risk.risk_score >= 60 ? 'bg-orange-600' :
                        risk.risk_score >= 40 ? 'bg-yellow-600' :
                        'bg-green-600'
                      }`}
                      style={{ width: `${risk.risk_score}%` }}
                    />
                  </div>
                  <p className="text-sm font-semibold">Risk Score: {risk.risk_score}/100</p>
                  
                  {risk.contributing_factors && risk.contributing_factors.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Contributing Factors:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {risk.contributing_factors.map((factor, i) => (
                          <li key={i} className="text-sm text-slate-600 dark:text-slate-400">{factor}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {risk.intervention_suggestions && risk.intervention_suggestions.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Interventions:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {risk.intervention_suggestions.map((intervention, i) => (
                          <li key={i} className="text-sm text-slate-600 dark:text-slate-400">{intervention}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {risk.monitoring_recommendations && risk.monitoring_recommendations.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Monitoring:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {risk.monitoring_recommendations.map((monitor, i) => (
                          <li key={i} className="text-sm text-slate-600 dark:text-slate-400">{monitor}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <Shield className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">No high-risk conditions identified</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Treatment Recommendations */}
        <TabsContent value="treatment" className="space-y-4">
          {cdssData.treatment_recommendations && cdssData.treatment_recommendations.length > 0 ? (
            cdssData.treatment_recommendations.map((rec, idx) => (
              <Card key={idx}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <CardTitle className="text-base">{rec.clinical_indication}</CardTitle>
                    <Badge className={getEvidenceLevel(rec.evidence_level).color}>
                      {getEvidenceLevel(rec.evidence_level).label}
                    </Badge>
                  </div>
                  <CardDescription>{rec.rationale}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recommended Approach:</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{rec.recommended_approach}</p>
                  </div>

                  {rec.alternatives && rec.alternatives.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Alternative Options:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {rec.alternatives.map((alt, i) => (
                          <li key={i} className="text-sm text-slate-600 dark:text-slate-400">{alt}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {rec.contraindications && rec.contraindications.length > 0 && (
                    <div className="pt-2 border-t border-red-200 dark:border-red-800">
                      <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-2">Contraindications:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {rec.contraindications.map((contra, i) => (
                          <li key={i} className="text-sm text-red-600 dark:text-red-400">{contra}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {rec.monitoring_parameters && rec.monitoring_parameters.length > 0 && (
                    <div className="pt-2 border-t">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Monitoring Parameters:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {rec.monitoring_parameters.map((param, i) => (
                          <li key={i} className="text-sm text-slate-600 dark:text-slate-400">{param}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <Lightbulb className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">No specific treatment recommendations at this time</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Follow-up & Compliance */}
        <TabsContent value="followup" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Follow-up Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cdssData.follow_up_recommendations && cdssData.follow_up_recommendations.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Recommended Follow-up:</p>
                  <ul className="list-disc list-inside space-y-2">
                    {cdssData.follow_up_recommendations.map((rec, i) => (
                      <li key={i} className="text-sm text-slate-600 dark:text-slate-400">{rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              {cdssData.compliance_notes && cdssData.compliance_notes.length > 0 && (
                <div className="pt-4 border-t">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Documentation & Compliance:</p>
                  <ul className="list-disc list-inside space-y-2">
                    {cdssData.compliance_notes.map((note, i) => (
                      <li key={i} className="text-sm text-slate-600 dark:text-slate-400">{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Refresh Button */}
      {onRefresh && (
        <div className="flex justify-center">
          <Button onClick={onRefresh} variant="outline" size="sm">
            Refresh Analysis
          </Button>
        </div>
      )}
    </div>
  );
}