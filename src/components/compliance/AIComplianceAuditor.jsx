import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
  TrendingUp,
  BookOpen,
  Sparkles,
  XCircle
} from "lucide-react";

export default function AIComplianceAuditor() {
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResults, setAuditResults] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['activePatients'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
    initialData: [],
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', selectedPatientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId,
    initialData: [],
  });

  const { data: medicareRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  const runAIComplianceAudit = async () => {
    if (!selectedPatient || visits.length === 0) return;

    setIsAuditing(true);
    setAuditResults(null);

    try {
      // Prepare comprehensive patient data
      const recentVisits = visits.slice(-10);
      const patientContext = {
        demographics: {
          name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
          dob: selectedPatient.date_of_birth,
          diagnosis: selectedPatient.primary_diagnosis,
          secondary_diagnoses: selectedPatient.secondary_diagnoses,
          admission_date: selectedPatient.admission_date,
          care_type: selectedPatient.care_type
        },
        clinical: {
          allergies: selectedPatient.allergies,
          medications: selectedPatient.current_medications,
          baseline_vitals: selectedPatient.baseline_vitals,
          functional_status: selectedPatient.functional_status,
          advance_directives: selectedPatient.advance_directives
        },
        recent_visits: recentVisits.map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          notes: v.nurse_notes,
          vital_signs: v.vital_signs
        }))
      };

      // Call AI compliance audit function
      const response = await base44.functions.invoke('aiComplianceAudit', {
        patientContext,
        medicareRules: medicareRules.map(r => ({
          rule_name: r.rule_name,
          cop_reference: r.cop_reference,
          description: r.description,
          required_elements: r.required_elements,
          severity: r.severity
        }))
      });

      setAuditResults(response.data);

      // Save audit results to database
      if (response.data.issues && response.data.issues.length > 0) {
        await base44.entities.ComplianceAudit.create({
          visit_id: recentVisits[recentVisits.length - 1]?.id,
          nurse_email: currentUser?.email,
          patient_id: selectedPatientId,
          compliance_score: response.data.overall_score,
          status: response.data.overall_score >= 85 ? 'passed' : response.data.overall_score >= 70 ? 'flagged' : 'critical',
          issues: response.data.issues,
          compliant_elements: response.data.compliant_areas,
          audit_type: 'automated'
        });
        queryClient.invalidateQueries({ queryKey: ['myComplianceAudits'] });
      }

    } catch (error) {
      console.error('Audit failed:', error);
      alert('Failed to run compliance audit. Please try again.');
    }

    setIsAuditing(false);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600';
      case 'high': return 'bg-orange-600';
      case 'medium': return 'bg-yellow-600';
      case 'low': return 'bg-blue-600';
      default: return 'bg-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-purple-300 bg-gradient-to-r from-purple-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            AI-Driven Compliance Audit
          </CardTitle>
          <p className="text-sm text-gray-600">
            Analyze patient documentation against Medicare CoP regulations
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Select Patient</label>
              <Select value={selectedPatientId || ""} onValueChange={setSelectedPatientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a patient to audit..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} - {p.primary_diagnosis}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={runAIComplianceAudit}
              disabled={!selectedPatientId || isAuditing || visits.length === 0}
              className="bg-gradient-to-r from-purple-600 to-indigo-600"
            >
              {isAuditing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Auditing...
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  Run AI Audit
                </>
              )}
            </Button>
          </div>

          {selectedPatientId && visits.length === 0 && (
            <Alert>
              <AlertDescription>
                No visits found for this patient. Please document at least one visit first.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {auditResults && (
        <Card className="border-2 border-blue-300">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Audit Results for {selectedPatient?.first_name} {selectedPatient?.last_name}
              </CardTitle>
              <Badge className={`text-lg px-4 py-2 ${
                auditResults.overall_score >= 85 ? 'bg-green-600' :
                auditResults.overall_score >= 70 ? 'bg-yellow-600' : 'bg-red-600'
              }`}>
                Score: {auditResults.overall_score}%
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {/* Overall Assessment */}
            <div className={`p-4 rounded-lg border-2 ${
              auditResults.overall_score >= 85 ? 'bg-green-50 border-green-300' :
              auditResults.overall_score >= 70 ? 'bg-yellow-50 border-yellow-300' : 'bg-red-50 border-red-300'
            }`}>
              <div className="flex items-center gap-3 mb-3">
                {auditResults.overall_score >= 85 ? (
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                ) : (
                  <AlertTriangle className="w-8 h-8 text-orange-600" />
                )}
                <div>
                  <h3 className="font-bold text-lg">
                    {auditResults.overall_score >= 85 ? 'Compliant' :
                     auditResults.overall_score >= 70 ? 'Needs Improvement' : 'Critical Issues'}
                  </h3>
                  <p className="text-sm text-gray-700">
                    {auditResults.summary}
                  </p>
                </div>
              </div>
            </div>

            {/* Compliant Areas */}
            {auditResults.compliant_areas?.length > 0 && (
              <div className="bg-green-50 p-4 rounded-lg border-2 border-green-200">
                <h3 className="font-bold text-green-900 mb-3 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  Compliant Documentation ({auditResults.compliant_areas.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {auditResults.compliant_areas.map((area, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm text-green-800">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                      <span>{area}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compliance Issues */}
            {auditResults.issues?.length > 0 && (
              <div>
                <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  Compliance Issues Found ({auditResults.issues.length})
                </h3>
                <ScrollArea className="max-h-96">
                  <div className="space-y-3">
                    {auditResults.issues.map((issue, idx) => (
                      <Card key={idx} className={`border-l-4 ${
                        issue.severity === 'critical' ? 'border-l-red-600 bg-red-50' :
                        issue.severity === 'high' ? 'border-l-orange-600 bg-orange-50' :
                        issue.severity === 'medium' ? 'border-l-yellow-600 bg-yellow-50' :
                        'border-l-blue-600 bg-blue-50'
                      }`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge className={getSeverityColor(issue.severity)}>
                                  {issue.severity}
                                </Badge>
                                <span className="text-xs font-medium text-gray-600">
                                  {issue.cop_reference}
                                </span>
                              </div>
                              <h4 className="font-semibold text-gray-900">{issue.element}</h4>
                            </div>
                          </div>
                          
                          <p className="text-sm text-gray-700 mb-3">
                            <strong>Problem:</strong> {issue.problem}
                          </p>

                          {/* Corrective Actions */}
                          <div className="bg-white p-3 rounded border-2 border-blue-200">
                            <p className="text-xs font-semibold text-blue-900 mb-2 flex items-center gap-1">
                              <BookOpen className="w-3 h-3" />
                              CORRECTIVE ACTIONS:
                            </p>
                            <ul className="text-sm text-gray-700 space-y-1">
                              {issue.corrective_actions?.map((action, actionIdx) => (
                                <li key={actionIdx} className="flex items-start gap-2">
                                  <TrendingUp className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                                  <span>{action}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Medicare Guidance */}
                          {issue.medicare_guidance && (
                            <div className="mt-2 text-xs text-gray-600 bg-gray-50 p-2 rounded">
                              <strong>Medicare CoP Guidance:</strong> {issue.medicare_guidance}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Recommendations */}
            {auditResults.recommendations?.length > 0 && (
              <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                <h3 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  AI Recommendations
                </h3>
                <ul className="space-y-2">
                  {auditResults.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-blue-800">
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Training Suggestions */}
            {auditResults.training_needed?.length > 0 && (
              <div className="bg-purple-50 p-4 rounded-lg border-2 border-purple-200">
                <h3 className="font-bold text-purple-900 mb-3 flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  Recommended Training Topics
                </h3>
                <div className="flex flex-wrap gap-2">
                  {auditResults.training_needed.map((topic, idx) => (
                    <Badge key={idx} variant="outline" className="bg-white">
                      {topic}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}