import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Stethoscope, AlertTriangle, CheckCircle2, Activity, Bell } from 'lucide-react';
import { toast } from 'sonner';

export default function DifferentialDiagnosisAssistant({ patientId, onDiagnosisSelect }) {
  const [formData, setFormData] = useState({
    chief_complaint: '',
    symptoms: '',
    vital_signs: '',
    patient_history: '',
    current_medications: '',
    physical_exam_findings: ''
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState(null);

  const generateDifferential = async () => {
    if (!formData.chief_complaint && !formData.symptoms) {
      toast.error('Please enter chief complaint or symptoms');
      return;
    }

    setAnalyzing(true);
    try {
      const response = await base44.functions.invoke('generateDifferentialDiagnosis', {
        ...formData,
        patient_id: patientId
      });

      if (response.data?.success) {
        setResults(response.data.differential_diagnosis);
        toast.success('Differential diagnosis generated');
      } else {
        toast.error('Failed to generate differential diagnosis');
      }
    } catch (error) {
      console.error('Error generating differential:', error);
      toast.error('Error generating differential diagnosis');
    } finally {
      setAnalyzing(false);
    }
  };

  const getProbabilityColor = (prob) => {
    switch (prob) {
      case 'Very High': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
      case 'High': return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
      case 'Moderate': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  };

  const getUrgencyColor = (urgency) => {
    switch (urgency) {
      case 'Emergency': return 'destructive';
      case 'Urgent': return 'default';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5" />
            AI Differential Diagnosis Assistant
          </CardTitle>
          <CardDescription>
            Get evidence-based differential diagnosis suggestions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-sm font-medium mb-2 block">Chief Complaint *</label>
              <Input
                value={formData.chief_complaint}
                onChange={(e) => setFormData({ ...formData, chief_complaint: e.target.value })}
                placeholder="e.g., Shortness of breath"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium mb-2 block">Presenting Symptoms *</label>
              <Textarea
                value={formData.symptoms}
                onChange={(e) => setFormData({ ...formData, symptoms: e.target.value })}
                placeholder="Describe symptoms, onset, duration, severity..."
                className="min-h-24"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Vital Signs</label>
              <Textarea
                value={formData.vital_signs}
                onChange={(e) => setFormData({ ...formData, vital_signs: e.target.value })}
                placeholder="BP, HR, RR, Temp, O2 Sat..."
                className="min-h-20"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Physical Exam Findings</label>
              <Textarea
                value={formData.physical_exam_findings}
                onChange={(e) => setFormData({ ...formData, physical_exam_findings: e.target.value })}
                placeholder="Relevant physical exam findings..."
                className="min-h-20"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Patient History</label>
              <Textarea
                value={formData.patient_history}
                onChange={(e) => setFormData({ ...formData, patient_history: e.target.value })}
                placeholder="Relevant medical history..."
                className="min-h-20"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Current Medications</label>
              <Textarea
                value={formData.current_medications}
                onChange={(e) => setFormData({ ...formData, current_medications: e.target.value })}
                placeholder="List current medications..."
                className="min-h-20"
              />
            </div>
          </div>

          <Button 
            onClick={generateDifferential} 
            disabled={analyzing || (!formData.chief_complaint && !formData.symptoms)}
            className="w-full"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Clinical Presentation...
              </>
            ) : (
              <>
                <Stethoscope className="w-4 h-4 mr-2" />
                Generate Differential Diagnosis
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {results && (
        <div className="space-y-4">
          {/* Urgency Alert */}
          {results.urgency_level && (
            <Alert variant={results.urgency_level === 'Emergency' ? 'destructive' : 'default'}>
              <Bell className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span className="font-semibold">Urgency Level: {results.urgency_level}</span>
                {results.physician_notification_recommended && (
                  <Badge variant="destructive">Physician Notification Recommended</Badge>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Cannot Miss Diagnoses */}
          {results.cannot_miss_diagnoses?.length > 0 && (
            <Card className="border-red-500">
              <CardHeader className="bg-red-50 dark:bg-red-950">
                <CardTitle className="text-lg flex items-center gap-2 text-red-900 dark:text-red-100">
                  <AlertTriangle className="w-5 h-5" />
                  Critical "Cannot Miss" Diagnoses
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {results.cannot_miss_diagnoses.map((diag, idx) => (
                  <div key={idx} className="border-l-4 border-red-500 pl-4 space-y-2">
                    <h4 className="font-bold text-red-900 dark:text-red-100">{diag.diagnosis}</h4>
                    <div>
                      <p className="text-sm font-semibold mb-1">Red Flags:</p>
                      <ul className="text-sm space-y-1">
                        {diag.red_flags?.map((flag, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <AlertTriangle className="w-3 h-3 mt-0.5 text-red-600 flex-shrink-0" />
                            <span>{flag}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <p className="text-sm"><span className="font-semibold">Immediate Actions:</span> {diag.immediate_actions}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Most Likely Diagnoses */}
          {results.most_likely_diagnoses?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Most Likely Diagnoses</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {results.most_likely_diagnoses.map((diag, idx) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="font-bold">{diag.diagnosis}</h4>
                          <Badge className={getProbabilityColor(diag.probability)}>
                            {diag.probability} Probability
                          </Badge>
                          {diag.icd10_code && (
                            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                              {diag.icd10_code}
                            </code>
                          )}
                        </div>
                        {onDiagnosisSelect && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onDiagnosisSelect(diag)}
                          >
                            Add to Patient Chart
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    <div className="text-sm space-y-2">
                      <div>
                        <p className="font-semibold mb-1">Supporting Factors:</p>
                        <ul className="space-y-0.5">
                          {diag.supporting_factors?.map((factor, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <CheckCircle2 className="w-3 h-3 mt-0.5 text-green-600 flex-shrink-0" />
                              <span>{factor}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      
                      {diag.key_features?.length > 0 && (
                        <div>
                          <p className="font-semibold mb-1">Key Features to Look For:</p>
                          <ul className="space-y-0.5">
                            {diag.key_features.map((feature, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <Activity className="w-3 h-3 mt-0.5 text-blue-600 flex-shrink-0" />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {diag.clinical_reasoning && (
                        <p><span className="font-semibold">Clinical Reasoning:</span> {diag.clinical_reasoning}</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Other Possible Diagnoses */}
          {results.other_possible_diagnoses?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Other Possible Diagnoses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {results.other_possible_diagnoses.map((diag, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-2 hover:bg-gray-50 dark:hover:bg-gray-900 rounded">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{diag.diagnosis}</span>
                          {diag.icd10_code && (
                            <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                              {diag.icd10_code}
                            </code>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{diag.rationale}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recommended Workup */}
          {results.recommended_workup?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recommended Diagnostic Workup</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {results.recommended_workup.map((test, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{test.test}</span>
                          <Badge variant={test.priority === 'Urgent' ? 'destructive' : 'default'}>
                            {test.priority}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{test.rationale}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Monitoring Plan */}
          {results.monitoring_plan && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Monitoring & Follow-up Plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {results.monitoring_plan.vital_signs_to_monitor?.length > 0 && (
                  <div>
                    <p className="font-semibold text-sm mb-2">Vital Signs to Monitor:</p>
                    <div className="flex flex-wrap gap-2">
                      {results.monitoring_plan.vital_signs_to_monitor.map((vs, idx) => (
                        <Badge key={idx} variant="outline">{vs}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                {results.monitoring_plan.frequency && (
                  <p className="text-sm">
                    <span className="font-semibold">Monitoring Frequency:</span> {results.monitoring_plan.frequency}
                  </p>
                )}
                
                {results.monitoring_plan.escalation_criteria?.length > 0 && (
                  <div>
                    <p className="font-semibold text-sm mb-2">Escalation Criteria:</p>
                    <ul className="space-y-1">
                      {results.monitoring_plan.escalation_criteria.map((criteria, idx) => (
                        <li key={idx} className="text-sm flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                          <span>{criteria}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Clinical Impression */}
          {results.clinical_impression && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Clinical Impression</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{results.clinical_impression}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}