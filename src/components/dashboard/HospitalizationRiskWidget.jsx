import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { invokeLLM } from "@/lib/invokeLLM";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  AlertTriangle, Activity, 
  RefreshCw, ChevronRight, AlertCircle, CheckCircle2
} from "lucide-react";
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { toast } from 'sonner';
import { formatAge } from "@/lib/age";
import { sameAuthorizedTenantScope } from '@/lib/authorizedTenantScope';

export default function HospitalizationRiskWidget({ autoAnalyze = false }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [riskScores, setRiskScores] = useState(null);
  const [lastAnalyzed, setLastAnalyzed] = useState(null);
  // Guards against a second concurrent run (the analysis spans many LLM calls and
  // riskScores stays null throughout, so the effect's
  // !riskScores guard alone can't prevent re-entrant runs on query invalidation).
  const runningRef = useRef(null);
  const analysisSequenceRef = useRef(0);

  const patientQuery = useScopedPatients({ purpose: 'risk_analysis', status: 'active', sort: '-updated_date', limit: 100 });
  const visitQuery = useAuthorizedVisits({
    purpose: 'hospitalization_risk',
    status: 'completed',
    sort: '-visit_date',
    limit: 500,
  });
  const tenantScopesMismatch = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !sameAuthorizedTenantScope(patientQuery.tenantScope, visitQuery.tenantScope);
  const analysisSnapshot = useMemo(() => (
    patientQuery.isSuccess
      && visitQuery.isSuccess
      && !tenantScopesMismatch
      ? {
        patients: patientQuery.data,
        visits: visitQuery.data,
        patientTenantScope: patientQuery.tenantScope,
        visitTenantScope: visitQuery.tenantScope,
      }
      : null
  ), [
    patientQuery.data,
    patientQuery.isSuccess,
    patientQuery.tenantScope,
    tenantScopesMismatch,
    visitQuery.data,
    visitQuery.isSuccess,
    visitQuery.tenantScope,
  ]);
  const analysisSnapshotRef = useRef(analysisSnapshot);
  analysisSnapshotRef.current = analysisSnapshot;
  const patients = analysisSnapshot?.patients || [];

  // Risk results include patient names and Visit-derived clinical conclusions.
  // Hide and discard them as soon as either authority starts a fresh recheck or
  // settles denied; a late LLM response is rejected by the snapshot identity.
  useEffect(() => {
    if (analysisSnapshot) return;
    analysisSequenceRef.current += 1;
    runningRef.current = null;
    setAnalyzing(false);
    setRiskScores(null);
    setLastAnalyzed(null);
  }, [analysisSnapshot]);

  const analyzeHospitalizationRisk = useCallback(async () => {
    const authorizedSnapshot = analysisSnapshotRef.current;
    if (!authorizedSnapshot) {
      toast.error('Patient and visit access must be verified before risk analysis.');
      return;
    }
    if (runningRef.current !== null) return; // already analyzing — don't start a duplicate run
    const analysisSequence = ++analysisSequenceRef.current;
    runningRef.current = analysisSequence;
    const isCurrentRun = () => (
      analysisSnapshotRef.current === authorizedSnapshot
      && analysisSequenceRef.current === analysisSequence
    );
    setAnalyzing(true);
    try {
      const analysisPromises = authorizedSnapshot.patients.map(async (patient) => {
        // Get patient-specific data
        const patientVisits = authorizedSnapshot.visits
          .filter(v => v.patient_id === patient.id)
          .slice(0, 10);
        
        if (patientVisits.length === 0) {
          return {
            patient_id: patient.id,
            patient_name: `${patient.first_name} ${patient.last_name}`,
            risk_score: 0,
            risk_level: 'insufficient_data',
            factors: ['No recent visit data available']
          };
        }

        // Extract vital signs trends
        const vitalsTrends = patientVisits
          .filter(v => v.vital_signs)
          .map(v => ({
            date: v.visit_date,
            bp_systolic: v.vital_signs?.blood_pressure_systolic,
            bp_diastolic: v.vital_signs?.blood_pressure_diastolic,
            heart_rate: v.vital_signs?.heart_rate,
            temp: v.vital_signs?.temperature,
            o2_sat: v.vital_signs?.oxygen_saturation,
            weight: v.vital_signs?.weight
          }));

        // Compile recent clinical notes
        const clinicalNotes = patientVisits
          .filter(v => v.nurse_notes)
          .map(v => ({
            date: v.visit_date,
            note: v.nurse_notes?.substring(0, 500) // Limit for AI processing
          }));

        // Analyze with AI
        const analysis = await invokeLLM({
          model: "automatic",
          prompt: `You are a clinical risk assessment AI analyzing home health patient data to predict hospitalization risk.

PATIENT: ${patient.first_name} ${patient.last_name}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis || 'Unknown'}
SECONDARY DIAGNOSES: ${patient.secondary_diagnoses?.join(', ') || 'None'}
AGE: ${formatAge(patient.date_of_birth)}

RECENT VITALS TRENDS (Last ${vitalsTrends.length} visits):
${vitalsTrends.map(v => `Date: ${v.date} | BP: ${v.bp_systolic}/${v.bp_diastolic} | HR: ${v.heart_rate} | Temp: ${v.temp} | O2: ${v.o2_sat}% | Weight: ${v.weight}`).join('\n')}

RECENT CLINICAL NOTES:
${clinicalNotes.slice(0, 3).map(n => `${n.date}: ${n.note}`).join('\n\n')}

Analyze this data and calculate a hospitalization risk score (0-100):

ASSESS THESE CRITICAL FACTORS:
1. Vital Signs Stability: Trending worse? Abnormal patterns?
2. Symptom Progression: Worsening symptoms mentioned in notes?
3. Clinical Deterioration: Any concerning observations?
4. Disease-Specific Risks: Based on diagnoses
5. Functional Decline: Mobility, ADL changes mentioned?
6. Recent Hospitalizations: Pattern of readmissions?
7. Red Flags: Pain escalation, infection signs, mental status changes?

Return detailed risk assessment:`,
          response_json_schema: {
            type: "object",
            properties: {
              risk_score: { 
                type: "number",
                description: "0-100 risk score (0-30: Low, 31-60: Moderate, 61-85: High, 86-100: Critical)"
              },
              risk_level: { 
                type: "string",
                enum: ["low", "moderate", "high", "critical"]
              },
              risk_factors: {
                type: "array",
                items: { type: "string" },
                description: "Specific clinical findings contributing to risk"
              },
              vital_concerns: {
                type: "array",
                items: { type: "string" },
                description: "Abnormal or trending vital signs"
              },
              medication_concerns: {
                type: "array",
                items: { type: "string" },
                description: "High-risk meds or interactions"
              },
              clinical_red_flags: {
                type: "array",
                items: { type: "string" },
                description: "Urgent clinical findings from notes"
              },
              trending_direction: {
                type: "string",
                enum: ["improving", "stable", "declining", "rapidly_declining"]
              },
              immediate_actions: {
                type: "array",
                items: { type: "string" },
                description: "Recommended immediate interventions"
              },
              monitoring_recommendations: {
                type: "array",
                items: { type: "string" },
                description: "What to monitor closely"
              },
              estimated_days_until_crisis: {
                type: "number",
                description: "Estimated days before potential hospitalization if current trend continues"
              },
              confidence_level: {
                type: "number",
                description: "AI confidence in this assessment (0-100)"
              }
            }
          }
        });

        return {
          patient_id: patient.id,
          patient_name: `${patient.first_name} ${patient.last_name}`,
          primary_diagnosis: patient.primary_diagnosis,
          ...analysis
        };
      });

      const results = await Promise.all(analysisPromises);
      if (!isCurrentRun()) return;
      
      // Sort by risk score
      const sortedResults = results
        .filter(r => r.risk_level !== 'insufficient_data')
        .sort((a, b) => b.risk_score - a.risk_score);

      setRiskScores(sortedResults);
      setLastAnalyzed(new Date());

    } catch (error) {
      console.error('Risk analysis error:', error);
      if (isCurrentRun()) toast.error('Failed to analyze hospitalization risk');
    } finally {
      if (runningRef.current === analysisSequence) {
        setAnalyzing(false);
        runningRef.current = null;
      }
    }
  }, []);

  React.useEffect(() => {
    if (autoAnalyze && analysisSnapshot && patients.length > 0 && !riskScores) {
      analyzeHospitalizationRisk();
    }
  }, [analysisSnapshot, autoAnalyze, patients.length, riskScores, analyzeHospitalizationRisk]);

  const getRiskColor = (level) => {
    switch(level) {
      case 'critical': return 'bg-red-600';
      case 'high': return 'bg-orange-600';
      case 'moderate': return 'bg-yellow-600';
      case 'low': return 'bg-green-600';
      default: return 'bg-slate-600';
    }
  };

  const visibleRiskScores = analysisSnapshot ? riskScores : null;
  const highRiskCount = visibleRiskScores?.filter(r => r.risk_level === 'high' || r.risk_level === 'critical').length || 0;
  const criticalRiskCount = visibleRiskScores?.filter(r => r.risk_level === 'critical').length || 0;

  return (
    <Card className={`${criticalRiskCount > 0 ? 'border-red-300 bg-red-50' : highRiskCount > 0 ? 'border-orange-300 bg-orange-50' : ''}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${criticalRiskCount > 0 ? 'bg-red-600' : 'bg-gradient-to-br from-blue-600 to-indigo-600'}`}>
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-base sm:text-lg">Hospitalization Risk Monitor</div>
              <div className="text-xs font-normal text-slate-500">AI-powered predictive analysis</div>
            </div>
          </CardTitle>
          <Button
            onClick={analyzeHospitalizationRisk}
            disabled={analyzing || !analysisSnapshot || patients.length === 0}
            size="sm"
            variant="outline"
            className="min-h-[44px]"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${analyzing ? 'animate-spin' : ''}`} />
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Alert className="mb-4 border-slate-300 bg-slate-50">
          <AlertCircle className="h-4 w-4 text-slate-600" />
          <AlertDescription className="text-slate-800">
            Risk analysis is display-only. Persisting Patient alerts is unavailable until an authorized atomic alert broker is reviewed.
          </AlertDescription>
        </Alert>
        {!analysisSnapshot && (
          <Alert className="border-amber-300 bg-amber-50" role="status">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-950">
              {visitQuery.isError || patientQuery.isError || tenantScopesMismatch
                ? 'Hospitalization risk analysis is unavailable because matching Patient and Visit access could not be verified. Platform owners remain blocked until a reviewed agency selector is available.'
                : 'Reverifying matching Patient and Visit tenant access before hospitalization risk analysis…'}
            </AlertDescription>
          </Alert>
        )}

        {analysisSnapshot && !visibleRiskScores && !analyzing && (
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 mb-4">Click "Analyze" to assess hospitalization risk for all active patients</p>
            <p className="text-xs text-slate-500">AI analyzes vitals and clinical notes</p>
          </div>
        )}

        {analyzing && (
          <div className="text-center py-8">
            <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-3 animate-spin" />
            <p className="text-slate-600 font-medium">Analyzing {patients.length} patients...</p>
            <p className="text-xs text-slate-500 mt-2">Reviewing vitals and clinical patterns</p>
          </div>
        )}

        {visibleRiskScores && (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center p-3 bg-red-50 rounded-lg border border-red-200">
                <div className="text-2xl font-bold text-red-600">{criticalRiskCount}</div>
                <div className="text-xs text-red-700">Critical</div>
              </div>
              <div className="text-center p-3 bg-orange-50 rounded-lg border border-orange-200">
                <div className="text-2xl font-bold text-orange-600">
                  {visibleRiskScores.filter(r => r.risk_level === 'high').length}
                </div>
                <div className="text-xs text-orange-700">High</div>
              </div>
              <div className="text-center p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                <div className="text-2xl font-bold text-yellow-600">
                  {visibleRiskScores.filter(r => r.risk_level === 'moderate').length}
                </div>
                <div className="text-xs text-yellow-700">Moderate</div>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg border border-green-200">
                <div className="text-2xl font-bold text-green-600">
                  {visibleRiskScores.filter(r => r.risk_level === 'low').length}
                </div>
                <div className="text-xs text-green-700">Low</div>
              </div>
            </div>

            {/* Critical/High Risk Patients */}
            {highRiskCount > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`w-4 h-4 ${criticalRiskCount > 0 ? 'text-red-600' : 'text-orange-600'}`} />
                  <span className="font-semibold text-sm">High-Risk Patients Requiring Attention</span>
                </div>
                
                {visibleRiskScores
                  .filter(r => r.risk_level === 'critical' || r.risk_level === 'high')
                  .slice(0, 5)
                  .map((risk, idx) => (
                    <Link 
                      key={idx}
                      to={createPageUrl(`PatientDetails?id=${risk.patient_id}`)}
                      className="block"
                    >
                      <div className={`p-3 rounded-lg border hover:shadow-md transition-shadow cursor-pointer ${
                        risk.risk_level === 'critical' 
                          ? 'bg-red-50 border-red-300' 
                          : 'bg-orange-50 border-orange-300'
                      }`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-slate-900 truncate">{risk.patient_name}</p>
                              <Badge className={`${getRiskColor(risk.risk_level)} text-white text-xs`}>
                                {risk.risk_score}/100
                              </Badge>
                              {risk.trending_direction === 'rapidly_declining' && (
                                <Badge className="bg-red-700 text-white text-xs animate-pulse">
                                  Rapid Decline
                                </Badge>
                              )}
                            </div>
                            
                            {risk.primary_diagnosis && (
                              <p className="text-xs text-slate-600 mb-2">{risk.primary_diagnosis}</p>
                            )}

                            {/* Top Risk Factors */}
                            <div className="space-y-1">
                              {risk.risk_factors?.slice(0, 2).map((factor, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-xs">
                                  <AlertCircle className={`w-3 h-3 flex-shrink-0 mt-0.5 ${
                                    risk.risk_level === 'critical' ? 'text-red-600' : 'text-orange-600'
                                  }`} />
                                  <span className="text-slate-700">{factor}</span>
                                </div>
                              ))}
                            </div>

                            {/* Immediate Actions */}
                            {risk.immediate_actions && risk.immediate_actions.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-slate-200">
                                <p className="text-xs font-semibold text-slate-700 mb-1">Immediate Action:</p>
                                <p className="text-xs text-slate-600">{risk.immediate_actions[0]}</p>
                              </div>
                            )}

                            {/* Time Estimate */}
                            {risk.estimated_days_until_crisis && risk.estimated_days_until_crisis <= 7 && (
                              <div className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-700">
                                <AlertTriangle className="w-3 h-3" />
                                Est. {risk.estimated_days_until_crisis} days until potential crisis
                              </div>
                            )}
                          </div>
                          
                          <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0 mt-1" />
                        </div>
                      </div>
                    </Link>
                  ))}

                {visibleRiskScores.filter(r => r.risk_level === 'critical' || r.risk_level === 'high').length > 5 && (
                  <Button
                    asChild
                    variant="outline"
                    className="w-full text-sm"
                  >
                    <Link to={createPageUrl('PredictiveAnalytics')}>
                      View All {highRiskCount} High-Risk Patients
                      <ChevronRight className="w-4 h-4 ml-2" />
                    </Link>
                  </Button>
                )}
              </div>
            )}

            {/* All Low Risk */}
            {highRiskCount === 0 && visibleRiskScores.length > 0 && (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <p className="font-semibold mb-1">All Patients Stable</p>
                  <p className="text-sm">No high-risk hospitalization concerns detected. Continue routine monitoring.</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Last Analyzed */}
            {lastAnalyzed && (
              <div className="text-xs text-slate-500 text-center pt-2 border-t">
                Last analyzed: {lastAnalyzed.toLocaleTimeString()} • {visibleRiskScores.length} patients assessed
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
