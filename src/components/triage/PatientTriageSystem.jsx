import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  Activity,
  Brain,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  User,
  Stethoscope,
  Ambulance,
  Calendar
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, differenceInDays, parseISO } from "date-fns";
import { toast } from 'sonner';

export default function PatientTriageSystem() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [triageResults, setTriageResults] = useState([]);
  const [lastAnalyzed, setLastAnalyzed] = useState(null);

  const { data: patients } = useQuery({
    queryKey: ['triagePatients'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
    initialData: [],
  });

  const { data: allVisits } = useQuery({
    queryKey: ['triageVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 500),
    initialData: [],
  });

  const { data: incidents } = useQuery({
    queryKey: ['triageIncidents'],
    queryFn: () => base44.entities.Incident.list('-incident_date', 100),
    initialData: [],
  });

  const { data: carePlans } = useQuery({
    queryKey: ['triageCarePlans'],
    queryFn: () => base44.entities.CarePlan.filter({ status: 'active' }),
    initialData: [],
  });

  const runTriageAnalysis = async () => {
    if (!patients || patients.length === 0) {
      toast.error('No patients available for triage analysis.');
      return;
    }
    
    setIsAnalyzing(true);
    const results = [];

    for (const patient of patients) {
      try {
        const patientVisits = allVisits.filter(v => v.patient_id === patient.id);
        const patientIncidents = incidents.filter(i => i.patient_id === patient.id);
        const patientCarePlans = carePlans.filter(cp => cp.patient_id === patient.id);
        
        const recentVisits = patientVisits.slice(0, 5);
        const lastVisit = recentVisits[0];
        
        // Calculate days since last visit
        const daysSinceLastVisit = lastVisit 
          ? differenceInDays(new Date(), parseISO(lastVisit.visit_date))
          : 999;

        // Analyze vital sign trends
        const vitalTrends = analyzeVitalTrends(recentVisits);
        
        // Calculate risk factors
        const riskFactors = calculateRiskFactors(patient, patientVisits, patientIncidents, vitalTrends);
        
        // Generate AI analysis for complex cases
        let aiAnalysis = null;
        if (riskFactors.score >= 50 || patientIncidents.length > 0) {
          aiAnalysis = await generateAITriageAnalysis(
            patient, 
            recentVisits, 
            patientIncidents, 
            vitalTrends,
            patientCarePlans
          );
        }

        // Determine urgency level
        const urgencyLevel = determineUrgencyLevel(riskFactors.score, aiAnalysis);
        
        // Suggest visit type
        const suggestedVisitType = suggestVisitType(urgencyLevel, patient, riskFactors);

        results.push({
          patient,
          riskScore: riskFactors.score,
          riskFactors: riskFactors.factors,
          urgencyLevel,
          suggestedVisitType,
          vitalTrends,
          daysSinceLastVisit,
          recentIncidents: patientIncidents.slice(0, 3),
          lastVisit,
          aiAnalysis,
          carePlanCount: patientCarePlans.length
        });
      } catch (error) {
        console.error(`Error analyzing patient ${patient.id}:`, error);
      }
    }

    // Sort by risk score (highest first)
    results.sort((a, b) => b.riskScore - a.riskScore);
    
    setTriageResults(results);
    setLastAnalyzed(new Date());
    setIsAnalyzing(false);
  };

  const analyzeVitalTrends = (visits) => {
    const trends = {
      blood_pressure: { trend: 'stable', values: [], concern: false },
      heart_rate: { trend: 'stable', values: [], concern: false },
      oxygen_saturation: { trend: 'stable', values: [], concern: false },
      temperature: { trend: 'stable', values: [], concern: false },
      pain_level: { trend: 'stable', values: [], concern: false }
    };

    visits.forEach(visit => {
      if (visit.vital_signs) {
        if (visit.vital_signs.blood_pressure_systolic) {
          trends.blood_pressure.values.push(visit.vital_signs.blood_pressure_systolic);
        }
        if (visit.vital_signs.heart_rate) {
          trends.heart_rate.values.push(visit.vital_signs.heart_rate);
        }
        if (visit.vital_signs.oxygen_saturation) {
          trends.oxygen_saturation.values.push(visit.vital_signs.oxygen_saturation);
        }
        if (visit.vital_signs.temperature) {
          trends.temperature.values.push(visit.vital_signs.temperature);
        }
        if (visit.vital_signs.pain_level !== undefined) {
          trends.pain_level.values.push(visit.vital_signs.pain_level);
        }
      }
    });

    // Analyze each vital sign trend
    Object.keys(trends).forEach(key => {
      const values = trends[key].values;
      if (values.length >= 2) {
        const recent = values[0];
        const previous = values[values.length - 1];
        const diff = recent - previous;
        
        if (diff > 0) {
          trends[key].trend = 'increasing';
        } else if (diff < 0) {
          trends[key].trend = 'decreasing';
        }

        // Check for concerning values
        if (key === 'blood_pressure' && (recent > 160 || recent < 90)) {
          trends[key].concern = true;
        }
        if (key === 'heart_rate' && (recent > 100 || recent < 50)) {
          trends[key].concern = true;
        }
        if (key === 'oxygen_saturation' && recent < 92) {
          trends[key].concern = true;
        }
        if (key === 'temperature' && (recent > 100.4 || recent < 96)) {
          trends[key].concern = true;
        }
        if (key === 'pain_level' && recent >= 7) {
          trends[key].concern = true;
        }
      }
    });

    return trends;
  };

  const calculateRiskFactors = (patient, visits, incidents, vitalTrends) => {
    const factors = [];
    let score = 0;

    // High-risk diagnoses
    const highRiskDiagnoses = ['chf', 'heart failure', 'copd', 'diabetes', 'cancer', 'stroke', 'sepsis'];
    const diagnosis = (patient.primary_diagnosis || '').toLowerCase();
    
    if (highRiskDiagnoses.some(d => diagnosis.includes(d))) {
      factors.push({ type: 'diagnosis', description: `High-risk diagnosis: ${patient.primary_diagnosis}`, severity: 'high' });
      score += 25;
    }

    // Hospice patients
    if (patient.care_type === 'hospice') {
      factors.push({ type: 'care_type', description: 'Hospice patient - requires comfort-focused care', severity: 'medium' });
      score += 15;
    }

    // Recent hospitalizations
    const recentHospitalizations = incidents.filter(i => 
      i.incident_type === 'hospitalized' && 
      differenceInDays(new Date(), parseISO(i.incident_date)) <= 30
    );
    if (recentHospitalizations.length > 0) {
      factors.push({ type: 'hospitalization', description: `Recent hospitalization within 30 days (${recentHospitalizations.length})`, severity: 'high' });
      score += 30;
    }

    // Recent falls
    const recentFalls = incidents.filter(i => 
      i.incident_type === 'fall' && 
      differenceInDays(new Date(), parseISO(i.incident_date)) <= 14
    );
    if (recentFalls.length > 0) {
      factors.push({ type: 'fall', description: `Recent fall(s) within 14 days (${recentFalls.length})`, severity: 'high' });
      score += 20;
    }

    // Vital sign concerns
    Object.entries(vitalTrends).forEach(([key, data]) => {
      if (data.concern) {
        const vitalName = key.replace(/_/g, ' ');
        factors.push({ type: 'vitals', description: `Concerning ${vitalName} trend`, severity: 'medium' });
        score += 15;
      }
    });

    // No recent visits
    const lastVisit = visits[0];
    if (lastVisit) {
      const daysSince = differenceInDays(new Date(), parseISO(lastVisit.visit_date));
      if (daysSince > 14) {
        factors.push({ type: 'visit_gap', description: `No visit in ${daysSince} days`, severity: daysSince > 30 ? 'high' : 'medium' });
        score += daysSince > 30 ? 20 : 10;
      }
    } else {
      factors.push({ type: 'new_patient', description: 'New patient - requires initial assessment', severity: 'medium' });
      score += 15;
    }

    // Multiple secondary diagnoses
    if (patient.secondary_diagnoses && patient.secondary_diagnoses.length >= 3) {
      factors.push({ type: 'comorbidities', description: `Multiple comorbidities (${patient.secondary_diagnoses.length})`, severity: 'medium' });
      score += 10;
    }

    // Cap score at 100
    score = Math.min(score, 100);

    return { score, factors };
  };

  const generateAITriageAnalysis = async (patient, visits, incidents, vitalTrends, carePlans) => {
    try {
      const lastVisitNotes = visits[0]?.nurse_notes?.substring(0, 500) || 'No recent notes';
      
      const prompt = `You are a clinical triage specialist analyzing a home health/hospice patient for urgency and risk assessment.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patient.care_type === 'hospice' ? 'Hospice' : 'Home Health'}

RECENT VITAL SIGN TRENDS:
${Object.entries(vitalTrends).map(([key, data]) => 
  data.values.length > 0 
    ? `- ${key.replace(/_/g, ' ')}: ${data.trend} (latest: ${data.values[0]})${data.concern ? ' ⚠️ CONCERNING' : ''}`
    : ''
).filter(Boolean).join('\n')}

RECENT INCIDENTS (last 30 days):
${incidents.length > 0 
  ? incidents.slice(0, 3).map(i => `- ${i.incident_type}: ${i.incident_date}`).join('\n')
  : 'No recent incidents'}

ACTIVE CARE PLANS: ${carePlans.length}

LAST VISIT NOTES EXCERPT:
${lastVisitNotes}

Provide a brief triage assessment in JSON format:
{
  "urgency_rationale": "Brief explanation of why this patient needs attention at the suggested priority level",
  "key_concerns": ["List of 2-3 main clinical concerns"],
  "recommended_actions": ["List of 2-3 specific recommended actions"],
  "visit_timing": "Recommended timing for next visit (e.g., 'Within 24 hours', 'Within 3 days', 'Routine scheduling')",
  "escalation_needed": true/false,
  "escalation_reason": "If escalation needed, brief reason why"
}`;

      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            urgency_rationale: { type: "string" },
            key_concerns: { type: "array", items: { type: "string" } },
            recommended_actions: { type: "array", items: { type: "string" } },
            visit_timing: { type: "string" },
            escalation_needed: { type: "boolean" },
            escalation_reason: { type: "string" }
          }
        }
      });

      return result;
    } catch (error) {
      console.error('AI triage analysis failed:', error);
      return null;
    }
  };

  const determineUrgencyLevel = (riskScore, aiAnalysis) => {
    if (aiAnalysis?.escalation_needed) {
      return 'critical';
    }
    if (riskScore >= 70) {
      return 'critical';
    }
    if (riskScore >= 50) {
      return 'high';
    }
    if (riskScore >= 30) {
      return 'medium';
    }
    return 'low';
  };

  const suggestVisitType = (urgencyLevel, patient, riskFactors) => {
    if (urgencyLevel === 'critical') {
      return { type: 'prn', label: 'PRN/Emergency Visit', timing: 'Within 24 hours' };
    }
    if (urgencyLevel === 'high') {
      if (riskFactors.factors.some(f => f.type === 'hospitalization')) {
        return { type: 'admission', label: 'Post-Hospital Assessment', timing: 'Within 48 hours' };
      }
      return { type: 'skilled_nursing', label: 'Skilled Nursing Visit', timing: 'Within 48 hours' };
    }
    if (urgencyLevel === 'medium') {
      return { type: 'routine_visit', label: 'Routine Visit', timing: 'Within 5-7 days' };
    }
    return { type: 'routine_visit', label: 'Routine Visit', timing: 'Per care plan schedule' };
  };

  const _getUrgencyColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  const _getUrgencyIcon = (level) => {
    switch (level) {
      case 'critical': return <Ambulance className="w-4 h-4" />;
      case 'high': return <AlertTriangle className="w-4 h-4" />;
      case 'medium': return <AlertCircle className="w-4 h-4" />;
      case 'low': return <CheckCircle2 className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const _getTrendIcon = (trend) => {
    switch (trend) {
      case 'increasing': return <TrendingUp className="w-4 h-4 text-red-500" />;
      case 'decreasing': return <TrendingDown className="w-4 h-4 text-blue-500" />;
      default: return <Minus className="w-4 h-4 text-slate-400" />;
    }
  };

  const criticalCount = triageResults.filter(r => r.urgencyLevel === 'critical').length;
  const highCount = triageResults.filter(r => r.urgencyLevel === 'high').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-r from-red-50 to-orange-50 border-red-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <CardTitle className="text-xl">AI Patient Triage System</CardTitle>
                <p className="text-sm text-slate-600">Intelligent prioritization and risk assessment</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {lastAnalyzed && (
                <span className="text-sm text-slate-500">
                  Last analyzed: {format(lastAnalyzed, 'h:mm a')}
                </span>
              )}
              <Button
                onClick={runTriageAnalysis}
                disabled={isAnalyzing || patients.length === 0}
                className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing {patients.length} patients...
                  </>
                ) : (
                  <>
                    <Activity className="w-4 h-4 mr-2" />
                    Run Triage Analysis
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Summary Stats */}
      {triageResults.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-4 text-center">
              <Ambulance className="w-8 h-8 text-red-600 mx-auto mb-2" />
              <p className="text-3xl font-bold text-red-700">{criticalCount}</p>
              <p className="text-sm text-red-600">Critical Priority</p>
            </CardContent>
          </Card>
          <Card className="bg-orange-50 border-orange-200">
            <CardContent className="p-4 text-center">
              <AlertTriangle className="w-8 h-8 text-orange-600 mx-auto mb-2" />
              <p className="text-3xl font-bold text-orange-700">{highCount}</p>
              <p className="text-sm text-orange-600">High Priority</p>
            </CardContent>
          </Card>
          <Card className="bg-yellow-50 border-yellow-200">
            <CardContent className="p-4 text-center">
              <AlertCircle className="w-8 h-8 text-yellow-600 mx-auto mb-2" />
              <p className="text-3xl font-bold text-yellow-700">
                {triageResults.filter(r => r.urgencyLevel === 'medium').length}
              </p>
              <p className="text-sm text-yellow-600">Medium Priority</p>
            </CardContent>
          </Card>
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-4 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-3xl font-bold text-green-700">
                {triageResults.filter(r => r.urgencyLevel === 'low').length}
              </p>
              <p className="text-sm text-green-600">Low Priority</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Critical Alerts */}
      {criticalCount > 0 && (
        <Alert className="bg-red-100 border-red-300">
          <Ambulance className="w-5 h-5 text-red-600" />
          <AlertDescription className="text-red-900">
            <strong>⚠️ IMMEDIATE ATTENTION REQUIRED:</strong> {criticalCount} patient(s) flagged as critical priority. 
            These patients require urgent assessment within 24 hours.
          </AlertDescription>
        </Alert>
      )}

      {/* Triage Results */}
      {triageResults.length > 0 ? (
        <div className="space-y-4">
          {triageResults.map((result, index) => (
            <TriageResultCard key={result.patient.id} result={result} rank={index + 1} />
          ))}
        </div>
      ) : (
        <Card className="border-2 border-dashed">
          <CardContent className="p-12 text-center">
            <Brain className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">Ready to Analyze</h3>
            <p className="text-slate-500 mb-4">
              Click "Run Triage Analysis" to assess {patients.length} active patients
            </p>
            <Button onClick={runTriageAnalysis} disabled={isAnalyzing || patients.length === 0}>
              <Activity className="w-4 h-4 mr-2" />
              Start Analysis
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TriageResultCard({ result, rank }) {
  const [expanded, setExpanded] = useState(result.urgencyLevel === 'critical' || result.urgencyLevel === 'high');

  const getUrgencyColor = (level) => {
    switch (level) {
      case 'critical': return 'border-l-red-500 bg-red-50';
      case 'high': return 'border-l-orange-500 bg-orange-50';
      case 'medium': return 'border-l-yellow-500 bg-yellow-50';
      case 'low': return 'border-l-green-500 bg-white';
      default: return 'border-l-slate-500 bg-white';
    }
  };

  const getBadgeColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  return (
    <Card className={`border-l-4 ${getUrgencyColor(result.urgencyLevel)} hover:shadow-lg transition-all`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4 flex-1">
            {/* Rank */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow ${
              result.urgencyLevel === 'critical' ? 'bg-red-500' :
              result.urgencyLevel === 'high' ? 'bg-orange-500' :
              result.urgencyLevel === 'medium' ? 'bg-yellow-500 text-black' : 'bg-green-500'
            }`}>
              #{rank}
            </div>

            {/* Patient Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-bold text-slate-900">
                  {result.patient.first_name} {result.patient.last_name}
                </h3>
                <Badge className={getBadgeColor(result.urgencyLevel)}>
                  {result.urgencyLevel.toUpperCase()}
                </Badge>
                <Badge variant="outline" className="capitalize">
                  {result.patient.care_type?.replace('_', ' ')}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600 mb-3">
                <span className="flex items-center gap-1">
                  <Stethoscope className="w-4 h-4" />
                  {result.patient.primary_diagnosis || 'No diagnosis'}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Last visit: {result.daysSinceLastVisit < 999 ? `${result.daysSinceLastVisit} days ago` : 'Never'}
                </span>
              </div>

              {/* Risk Score Bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-700">Risk Score</span>
                  <span className={`text-sm font-bold ${
                    result.riskScore >= 70 ? 'text-red-600' :
                    result.riskScore >= 50 ? 'text-orange-600' :
                    result.riskScore >= 30 ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {result.riskScore}/100
                  </span>
                </div>
                <Progress 
                  value={result.riskScore} 
                  className={`h-2 ${
                    result.riskScore >= 70 ? '[&>div]:bg-red-500' :
                    result.riskScore >= 50 ? '[&>div]:bg-orange-500' :
                    result.riskScore >= 30 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-green-500'
                  }`}
                />
              </div>

              {/* Suggested Action */}
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                  <Clock className="w-3 h-3 mr-1" />
                  {result.suggestedVisitType.label}
                </Badge>
                <span className="text-sm text-slate-600">
                  {result.suggestedVisitType.timing}
                </span>
              </div>

              {/* Risk Factors Summary */}
              <div className="flex flex-wrap gap-2 mb-3">
                {result.riskFactors.slice(0, 3).map((factor, idx) => (
                  <Badge 
                    key={idx} 
                    variant="outline" 
                    className={`text-xs ${
                      factor.severity === 'high' ? 'border-red-300 text-red-700 bg-red-50' :
                      'border-yellow-300 text-yellow-700 bg-yellow-50'
                    }`}
                  >
                    {factor.description}
                  </Badge>
                ))}
                {result.riskFactors.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{result.riskFactors.length - 3} more
                  </Badge>
                )}
              </div>

              {/* Expanded Details */}
              {expanded && (
                <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
                  {/* AI Analysis */}
                  {result.aiAnalysis && (
                    <div className="bg-white rounded-lg p-4 border border-slate-200">
                      <h4 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <Brain className="w-4 h-4 text-navy-600" />
                        AI Triage Assessment
                      </h4>
                      <p className="text-sm text-slate-700 mb-3">{result.aiAnalysis.urgency_rationale}</p>
                      
                      {result.aiAnalysis.key_concerns?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Key Concerns</p>
                          <ul className="list-disc ml-5 text-sm text-slate-700">
                            {result.aiAnalysis.key_concerns.map((concern, idx) => (
                              <li key={idx}>{concern}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {result.aiAnalysis.recommended_actions?.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Recommended Actions</p>
                          <ul className="list-disc ml-5 text-sm text-slate-700">
                            {result.aiAnalysis.recommended_actions.map((action, idx) => (
                              <li key={idx}>{action}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {result.aiAnalysis.escalation_needed && (
                        <Alert className="bg-red-50 border-red-200 mt-3">
                          <AlertTriangle className="w-4 h-4 text-red-600" />
                          <AlertDescription className="text-red-900 text-sm">
                            <strong>Escalation Recommended:</strong> {result.aiAnalysis.escalation_reason}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}

                  {/* Vital Signs Trends */}
                  <div className="bg-white rounded-lg p-4 border border-slate-200">
                    <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-600" />
                      Vital Sign Trends
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      {Object.entries(result.vitalTrends).map(([key, data]) => (
                        <div 
                          key={key} 
                          className={`p-2 rounded-lg border ${
                            data.concern ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-500 capitalize">
                              {key.replace(/_/g, ' ')}
                            </span>
                            {data.values.length >= 2 && (
                              data.trend === 'increasing' ? 
                                <TrendingUp className={`w-3 h-3 ${data.concern ? 'text-red-500' : 'text-orange-500'}`} /> :
                              data.trend === 'decreasing' ?
                                <TrendingDown className={`w-3 h-3 ${data.concern ? 'text-red-500' : 'text-blue-500'}`} /> :
                                <Minus className="w-3 h-3 text-slate-400" />
                            )}
                          </div>
                          <p className={`text-sm font-semibold ${data.concern ? 'text-red-700' : 'text-slate-900'}`}>
                            {data.values[0] || 'N/A'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent Incidents */}
                  {result.recentIncidents.length > 0 && (
                    <div className="bg-white rounded-lg p-4 border border-slate-200">
                      <h4 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-600" />
                        Recent Incidents
                      </h4>
                      <div className="space-y-2">
                        {result.recentIncidents.map((incident, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <Badge variant="outline" className="capitalize">
                              {(incident.incident_type || '').replace(/_/g, ' ')}
                            </Badge>
                            <span className="text-slate-600">
                              {format(parseISO(incident.incident_date), 'MMM d, yyyy')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 ml-4">
            <Link to={`${createPageUrl("PatientDetails")}?patientId=${result.patient.id}`}>
              <Button size="sm" className="w-full">
                <User className="w-4 h-4 mr-1" />
                View
              </Button>
            </Link>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronRight className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
              {expanded ? 'Less' : 'More'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}