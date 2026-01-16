import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, AlertTriangle, CheckCircle2, Lightbulb, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { toast } from 'sonner';

export default function ClinicalInsightsPanel({ insights, isLoading = false }) {
  const [expandedSections, setExpandedSections] = useState({
    drug_interactions: true,
    care_gaps: true,
    vital_signs: false,
    best_practices: false,
    safety: false,
    education: false
  });

  if (!insights && !isLoading) {
    return null;
  }

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'significant': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getSeverityIcon = (severity) => {
    if (severity === 'critical') return <AlertCircle className="w-4 h-4" />;
    if (severity === 'significant' || severity === 'high') return <AlertTriangle className="w-4 h-4" />;
    return <Lightbulb className="w-4 h-4" />;
  };

  if (isLoading) {
    return (
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-blue-600" />
            Clinical Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-12 bg-blue-100 rounded"></div>
            <div className="h-12 bg-blue-100 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!insights || Object.keys(insights).length === 0) {
    return null;
  }

  return (
    <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-blue-600" />
          Clinical Insights & Evidence-Based Guidance
        </CardTitle>
        <CardDescription>
          Proactive recommendations based on patient diagnoses, medications, and clinical presentation
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {insights.overall_clinical_summary && (
          <Alert className="border-blue-300 bg-blue-100 text-blue-900">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="font-medium">
              {insights.overall_clinical_summary}
            </AlertDescription>
          </Alert>
        )}

        {/* Drug Interactions */}
        {insights.drug_interactions && insights.drug_interactions.length > 0 && (
          <div className="border rounded-lg">
            <button
              onClick={() => toggleSection('drug_interactions')}
              className="w-full flex items-center justify-between p-4 hover:bg-red-50 transition"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <span className="font-semibold text-red-900">Drug Interactions</span>
                <Badge variant="destructive">{insights.drug_interactions.length}</Badge>
              </div>
              {expandedSections.drug_interactions ? <ChevronUp /> : <ChevronDown />}
            </button>

            {expandedSections.drug_interactions && (
              <div className="px-4 pb-4 space-y-3 border-t bg-red-50">
                {insights.drug_interactions.map((interaction, idx) => (
                  <div key={idx} className={`p-3 rounded border-l-4 border-red-600 bg-white`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-red-900">
                          {interaction.medications_involved.join(' + ')}
                        </p>
                        <p className="text-xs text-red-700">{interaction.interaction_type}</p>
                      </div>
                      <Badge className={getSeverityColor(interaction.severity)}>
                        {interaction.severity.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{interaction.clinical_concern}</p>
                    <p className="text-sm font-medium text-gray-900 mb-1">Action: {interaction.recommended_action}</p>
                    {interaction.guideline_reference && (
                      <p className="text-xs text-gray-600 italic">
                        📚 {interaction.guideline_reference}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Care Gaps */}
        {insights.care_gaps && insights.care_gaps.length > 0 && (
          <div className="border rounded-lg">
            <button
              onClick={() => toggleSection('care_gaps')}
              className="w-full flex items-center justify-between p-4 hover:bg-orange-50 transition"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                <span className="font-semibold text-orange-900">Care Gaps</span>
                <Badge className="bg-orange-200 text-orange-900">{insights.care_gaps.length}</Badge>
              </div>
              {expandedSections.care_gaps ? <ChevronUp /> : <ChevronDown />}
            </button>

            {expandedSections.care_gaps && (
              <div className="px-4 pb-4 space-y-3 border-t bg-orange-50">
                {insights.care_gaps.map((gap, idx) => (
                  <div key={idx} className="p-3 rounded border-l-4 border-orange-500 bg-white">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-semibold text-sm text-orange-900">{gap.gap}</p>
                      <Badge className={getSeverityColor(gap.priority)}>
                        {gap.priority.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 mb-2">
                      <span className="font-medium">Related to:</span> {gap.related_diagnosis}
                    </p>
                    <p className="text-sm text-gray-700 mb-2">{gap.clinical_rationale}</p>
                    <p className="text-sm text-gray-900 mb-1">
                      <span className="font-medium">Standard of Care:</span> {gap.standard_of_care}
                    </p>
                    {gap.suggested_documentation && (
                      <p className="text-sm text-blue-700 bg-blue-50 p-2 rounded mt-2">
                        💡 <span className="font-medium">Suggest documenting:</span> {gap.suggested_documentation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Vital Signs Alerts */}
        {insights.vital_sign_alerts && insights.vital_sign_alerts.length > 0 && (
          <div className="border rounded-lg">
            <button
              onClick={() => toggleSection('vital_signs')}
              className="w-full flex items-center justify-between p-4 hover:bg-yellow-50 transition"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                <span className="font-semibold text-yellow-900">Vital Sign Concerns</span>
                <Badge className="bg-yellow-200 text-yellow-900">{insights.vital_sign_alerts.length}</Badge>
              </div>
              {expandedSections.vital_signs ? <ChevronUp /> : <ChevronDown />}
            </button>

            {expandedSections.vital_signs && (
              <div className="px-4 pb-4 space-y-3 border-t bg-yellow-50">
                {insights.vital_sign_alerts.map((alert, idx) => (
                  <div key={idx} className="p-3 rounded border-l-4 border-yellow-500 bg-white">
                    <p className="font-semibold text-sm text-gray-900">
                      {alert.vital_sign}: {alert.value}
                    </p>
                    <p className="text-xs text-gray-600 mb-2">Related: {alert.related_diagnosis}</p>
                    <p className="text-sm text-gray-700 mb-2">{alert.clinical_concern}</p>
                    {alert.monitoring_recommendation && (
                      <p className="text-sm text-blue-700 bg-blue-50 p-2 rounded">
                        📊 {alert.monitoring_recommendation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Evidence-Based Practices */}
        {insights.evidence_based_practices && insights.evidence_based_practices.length > 0 && (
          <div className="border rounded-lg">
            <button
              onClick={() => toggleSection('best_practices')}
              className="w-full flex items-center justify-between p-4 hover:bg-green-50 transition"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-green-900">Evidence-Based Practices</span>
                <Badge className="bg-green-200 text-green-900">{insights.evidence_based_practices.length}</Badge>
              </div>
              {expandedSections.best_practices ? <ChevronUp /> : <ChevronDown />}
            </button>

            {expandedSections.best_practices && (
              <div className="px-4 pb-4 space-y-3 border-t bg-green-50">
                {insights.evidence_based_practices.map((practice, idx) => (
                  <div key={idx} className="p-3 rounded border-l-4 border-green-500 bg-white">
                    <p className="font-semibold text-sm text-gray-900">{practice.diagnosis}</p>
                    <p className="text-sm text-gray-700 mt-2">{practice.recommended_practice}</p>
                    <div className="mt-2 space-y-1">
                      {practice.icd10_codes && practice.icd10_codes.length > 0 && (
                        <p className="text-xs text-gray-600">
                          <span className="font-medium">ICD-10 Codes:</span> {practice.icd10_codes.join(', ')}
                        </p>
                      )}
                      <p className="text-xs text-blue-700 font-medium">
                        📚 {practice.guideline_source}
                      </p>
                      {practice.alignment_with_current_plan && (
                        <p className="text-sm text-green-700 bg-green-100 p-2 rounded mt-2">
                          {practice.alignment_with_current_plan}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Safety Alerts */}
        {insights.safety_alerts && insights.safety_alerts.length > 0 && (
          <div className="border rounded-lg">
            <button
              onClick={() => toggleSection('safety')}
              className="w-full flex items-center justify-between p-4 hover:bg-red-50 transition"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <span className="font-semibold text-red-900">Safety Alerts</span>
                <Badge variant="destructive">{insights.safety_alerts.length}</Badge>
              </div>
              {expandedSections.safety ? <ChevronUp /> : <ChevronDown />}
            </button>

            {expandedSections.safety && (
              <div className="px-4 pb-4 space-y-3 border-t bg-red-50">
                {insights.safety_alerts.map((alert, idx) => (
                  <div key={idx} className="p-3 rounded border-l-4 border-red-600 bg-white">
                    <p className="font-semibold text-sm text-red-900">{alert.alert_type}</p>
                    <p className="text-sm text-gray-700 mt-2">
                      <span className="font-medium">Risk:</span> {alert.risk_factor}
                    </p>
                    <p className="text-sm text-red-700 mt-1">
                      <span className="font-medium">Potential Harm:</span> {alert.potential_harm}
                    </p>
                    {alert.preventive_measures && alert.preventive_measures.length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm font-medium text-gray-900 mb-1">Preventive Measures:</p>
                        <ul className="list-disc list-inside space-y-1">
                          {alert.preventive_measures.map((measure, midx) => (
                            <li key={midx} className="text-sm text-gray-700">{measure}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Patient Education Priorities */}
        {insights.education_priorities && insights.education_priorities.length > 0 && (
          <div className="border rounded-lg">
            <button
              onClick={() => toggleSection('education')}
              className="w-full flex items-center justify-between p-4 hover:bg-purple-50 transition"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-purple-600" />
                <span className="font-semibold text-purple-900">Patient Education Priorities</span>
                <Badge className="bg-purple-200 text-purple-900">{insights.education_priorities.length}</Badge>
              </div>
              {expandedSections.education ? <ChevronUp /> : <ChevronDown />}
            </button>

            {expandedSections.education && (
              <div className="px-4 pb-4 space-y-3 border-t bg-purple-50">
                {insights.education_priorities.map((edu, idx) => (
                  <div key={idx} className="p-3 rounded border-l-4 border-purple-500 bg-white">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-semibold text-sm text-purple-900">{edu.topic}</p>
                      <Badge className={getSeverityColor(edu.urgency)}>
                        {edu.urgency.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{edu.rationale}</p>
                    {edu.key_teaching_points && edu.key_teaching_points.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-gray-900 mb-1">Key Teaching Points:</p>
                        <ul className="list-disc list-inside space-y-1">
                          {edu.key_teaching_points.map((point, pidx) => (
                            <li key={pidx} className="text-sm text-gray-700">{point}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}