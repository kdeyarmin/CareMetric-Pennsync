import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  ClipboardList, 
  Calendar, 
  AlertTriangle, 
  FileText, 
  Pill,
  Activity,
  TrendingUp,
  CheckCircle2,
  Clock,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';

export default function PreVisitPreparation({ patientId, visitId }) {
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.get(patientId),
    enabled: !!patientId
  });

  const { data: recentVisits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: async () => {
      const visits = await base44.entities.Visit.filter({ patient_id: patientId });
      return visits.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date)).slice(0, 5);
    },
    enabled: !!patientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId, status: 'active' }),
    enabled: !!patientId
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['patientAlerts', patientId],
    queryFn: () => base44.entities.PatientAlert.filter({ patient_id: patientId, status: 'active' }),
    enabled: !!patientId
  });

  const generateAISummary = async () => {
    setGeneratingSummary(true);
    try {
      const prompt = `Generate a concise pre-visit preparation summary for this patient:

Patient: ${patient.first_name} ${patient.last_name}
Age: ${patient.date_of_birth ? Math.floor((Date.now() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown'}
Primary Diagnosis: ${patient.primary_diagnosis || 'None'}
Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
Allergies: ${patient.allergies || 'None'}

Recent Visit Notes:
${recentVisits.map(v => `${v.visit_date}: ${v.nurse_notes?.substring(0, 200) || 'No notes'}`).join('\n')}

Active Care Plans: ${carePlans.length}
Active Alerts: ${alerts.length}

Provide:
1. Key Clinical Summary (2-3 sentences)
2. Important Points to Review (3-5 bullet points)
3. Potential Questions to Ask (3-4 questions)
4. Red Flags to Watch For (if any)`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            clinical_summary: { type: 'string' },
            key_points: { type: 'array', items: { type: 'string' } },
            suggested_questions: { type: 'array', items: { type: 'string' } },
            red_flags: { type: 'array', items: { type: 'string' } }
          }
        }
      });

      setAiSummary(response);
    } catch (error) {
      console.error('Error generating summary:', error);
    } finally {
      setGeneratingSummary(false);
    }
  };

  if (!patient) return null;

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Pre-Visit Preparation</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {patient.first_name} {patient.last_name} • {patient.date_of_birth ? `${Math.floor((Date.now() - new Date(patient.date_of_birth)) / 31557600000)} years old` : 'Age unknown'}
          </p>
        </div>
        <Button onClick={generateAISummary} disabled={generatingSummary}>
          {generatingSummary ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Activity className="w-4 h-4 mr-2" />
              AI Summary
            </>
          )}
        </Button>
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950">
          <CardHeader className="pb-3">
            <CardTitle className="text-red-700 dark:text-red-300 text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Critical Alerts ({criticalAlerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalAlerts.map((alert, idx) => (
              <div key={idx} className="p-3 bg-white dark:bg-red-900 rounded-lg">
                <p className="font-semibold text-sm">{alert.title}</p>
                <p className="text-sm text-gray-700 dark:text-gray-300">{alert.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* AI Summary */}
      {aiSummary && (
        <Card className="bg-blue-50 dark:bg-blue-950">
          <CardHeader>
            <CardTitle className="text-lg">AI Clinical Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-semibold mb-1">Overview:</p>
              <p className="text-sm">{aiSummary.clinical_summary}</p>
            </div>

            {aiSummary.key_points?.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Key Points to Review:</p>
                <ul className="space-y-1">
                  {aiSummary.key_points.map((point, idx) => (
                    <li key={idx} className="text-sm flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {aiSummary.suggested_questions?.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Questions to Ask:</p>
                <ul className="space-y-1">
                  {aiSummary.suggested_questions.map((q, idx) => (
                    <li key={idx} className="text-sm">• {q}</li>
                  ))}
                </ul>
              </div>
            )}

            {aiSummary.red_flags?.length > 0 && (
              <div className="bg-red-100 dark:bg-red-900 p-3 rounded-lg">
                <p className="text-sm font-semibold mb-2 text-red-800 dark:text-red-200">Red Flags:</p>
                <ul className="space-y-1">
                  {aiSummary.red_flags.map((flag, idx) => (
                    <li key={idx} className="text-sm text-red-700 dark:text-red-300">⚠️ {flag}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Quick Facts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="w-5 h-5" />
              Quick Facts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Primary Diagnosis</p>
              <p className="font-semibold">{patient.primary_diagnosis || 'Not recorded'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Allergies</p>
              <p className="font-semibold text-red-600 dark:text-red-400">{patient.allergies || 'None documented'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Insurance</p>
              <p className="font-semibold">{patient.insurance_primary?.provider || 'Not on file'}</p>
            </div>
          </CardContent>
        </Card>

        {/* Current Medications */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Pill className="w-5 h-5" />
              Current Medications ({patient.current_medications?.length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {patient.current_medications?.length > 0 ? (
              <div className="space-y-2">
                {patient.current_medications.slice(0, 5).map((med, idx) => (
                  <div key={idx} className="text-sm">
                    <p className="font-semibold">{med.name}</p>
                    <p className="text-gray-600 dark:text-gray-400 text-xs">
                      {med.dosage} - {med.frequency}
                    </p>
                  </div>
                ))}
                {patient.current_medications.length > 5 && (
                  <p className="text-xs text-gray-500">+ {patient.current_medications.length - 5} more</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No medications on file</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Visits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Recent Visits
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentVisits.length > 0 ? (
              <div className="space-y-3">
                {recentVisits.slice(0, 3).map((visit, idx) => (
                  <div key={idx} className="pb-2 border-b last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold">{visit.visit_type}</p>
                      <p className="text-xs text-gray-500">{format(new Date(visit.visit_date), 'MMM d, yyyy')}</p>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                      {visit.nurse_notes?.substring(0, 100) || 'No notes'}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No previous visits</p>
            )}
          </CardContent>
        </Card>

        {/* Active Care Plans */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Active Care Plans ({carePlans.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {carePlans.length > 0 ? (
              <div className="space-y-2">
                {carePlans.map((plan, idx) => (
                  <div key={idx} className="text-sm">
                    <p className="font-semibold">{plan.problem}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{plan.goal}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                        <div 
                          className="bg-green-600 h-1.5 rounded-full" 
                          style={{ width: `${plan.progress_percentage || 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{plan.progress_percentage || 0}%</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No active care plans</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}