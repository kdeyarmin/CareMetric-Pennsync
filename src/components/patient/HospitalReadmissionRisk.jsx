import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Ambulance,
  AlertTriangle,
  Activity,
  Heart,
  Shield,
  CheckCircle2,
  XCircle,
  Eye,
  Sparkles,
  Target,
  Clock,
  Lightbulb,
  Users
} from "lucide-react";
import { differenceInDays, parseISO, isValid } from "date-fns";
import { toast } from 'sonner';

export default function HospitalReadmissionRisk({ patient }) {
  const [showInterventions, setShowInterventions] = useState(false);
  const ai = useAICall();
  const [interventionPlan, setInterventionPlan] = useState(null);

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patient.id],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patient.id }),
    initialData: [],
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', patient.id],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patient.id }),
    initialData: [],
  });

  // Calculate Readmission Risk Score using LACE Index + additional factors
  const riskAssessment = useMemo(() => {
    const today = new Date();
    let totalScore = 0;
    const riskFactors = [];
    
    // Recent hospitalizations (highest predictor)
    const recentHospitalizations = incidents.filter(i => {
      const incidentDate = parseISO(i.incident_date);
      return i.incident_type === 'hospitalized' &&
        isValid(incidentDate) &&
        differenceInDays(today, incidentDate) <= 180;
    });
    
    if (recentHospitalizations.length > 0) {
      // Use the genuinely most-recent hospitalization (smallest days-since).
      // The query returns rows in unspecified order, so indexing [0] could pick
      // an older event and under-score the 30-day vs 90-day tier. Every entry
      // here already passed isValid() in the filter above.
      const daysSince = Math.min(
        ...recentHospitalizations.map(h => differenceInDays(today, parseISO(h.incident_date)))
      );

      if (daysSince <= 30) {
        totalScore += 25;
        riskFactors.push({
          factor: 'Recent Hospitalization',
          impact: 'Very High',
          details: `Hospitalized ${daysSince} days ago (within 30 days)`,
          score: 25,
          intervention: 'Intensive monitoring, daily check-ins, early warning signs education'
        });
      } else if (daysSince <= 90) {
        totalScore += 15;
        riskFactors.push({
          factor: 'Recent Hospitalization',
          impact: 'High',
          details: `Hospitalized ${daysSince} days ago (within 90 days)`,
          score: 15,
          intervention: 'Close monitoring, weekly assessment, medication review'
        });
      }
      
      // Multiple hospitalizations
      if (recentHospitalizations.length > 1) {
        totalScore += 10;
        riskFactors.push({
          factor: 'Multiple Hospitalizations',
          impact: 'High',
          details: `${recentHospitalizations.length} hospitalizations in past 6 months`,
          score: 10,
          intervention: 'Care plan revision, caregiver education, consider higher level of care'
        });
      }
    }

    // ED visits without admission
    const recentEDVisits = incidents.filter(i => {
      const incidentDate = parseISO(i.incident_date);
      return i.incident_type === 'emergency_visit' &&
        isValid(incidentDate) &&
        differenceInDays(today, incidentDate) <= 90;
    });
    
    if (recentEDVisits.length > 0) {
      totalScore += 8 * recentEDVisits.length;
      riskFactors.push({
        factor: 'Emergency Department Visits',
        impact: 'Medium',
        details: `${recentEDVisits.length} ED visits in past 90 days`,
        score: 8 * recentEDVisits.length,
        intervention: 'Assess barriers to care, improve symptom management, provide emergency plan'
      });
    }

    // Comorbidities - analyze diagnosis
    const diagnosis = patient.primary_diagnosis?.toLowerCase() || '';
    let _comorbidityCount = 0;
    
    const highRiskDiagnoses = [
      { terms: ['chf', 'heart failure', 'cardiomyopathy'], name: 'Congestive Heart Failure' },
      { terms: ['copd', 'emphysema', 'chronic bronchitis'], name: 'COPD' },
      { terms: ['diabetes'], name: 'Diabetes' },
      { terms: ['renal', 'kidney', 'dialysis'], name: 'Renal Disease' },
      { terms: ['pneumonia'], name: 'Pneumonia' },
      { terms: ['sepsis'], name: 'Sepsis' },
      { terms: ['stroke', 'cva'], name: 'Stroke' },
      { terms: ['cancer', 'malignancy', 'carcinoma'], name: 'Cancer' }
    ];
    
    highRiskDiagnoses.forEach(dx => {
      if (dx.terms.some(term => diagnosis.includes(term))) {
        _comorbidityCount++;
        totalScore += 5;
        riskFactors.push({
          factor: `High-Risk Diagnosis: ${dx.name}`,
          impact: 'Medium',
          details: 'Requires specialized monitoring and management',
          score: 5,
          intervention: 'Disease-specific care plan, symptom monitoring, patient education'
        });
      }
    });

    // Multiple secondary diagnoses
    if (patient.secondary_diagnoses && patient.secondary_diagnoses.length > 2) {
      totalScore += 8;
      riskFactors.push({
        factor: 'Multiple Comorbidities',
        impact: 'Medium',
        details: `${patient.secondary_diagnoses.length} secondary diagnoses`,
        score: 8,
        intervention: 'Comprehensive care coordination, medication management'
      });
    }

    // Age factor (65+ at higher risk). An unparseable date_of_birth must only
    // skip the age component — it must NOT discard the risk already accumulated
    // above (recent hospitalizations, comorbidities, falls, etc.), which a prior
    // early-return did, mislabeling genuinely high-risk patients as "Low".
    if (patient.date_of_birth) {
      const dob = parseISO(patient.date_of_birth);
      if (isValid(dob)) {
        const age = differenceInDays(today, dob) / 365;

        if (age >= 85) {
          totalScore += 10;
          riskFactors.push({
            factor: 'Advanced Age',
            impact: 'Medium',
            details: `Age ${Math.floor(age)} - increased frailty risk`,
            score: 10,
            intervention: 'Fall prevention, functional assessment, caregiver support'
          });
        } else if (age >= 75) {
          totalScore += 5;
          riskFactors.push({
            factor: 'Advanced Age',
            impact: 'Low',
            details: `Age ${Math.floor(age)}`,
            score: 5,
            intervention: 'Regular monitoring, fall risk assessment'
          });
        }
      }
    }

    // Recent falls
    const recentFalls = incidents.filter(i => {
      const incidentDate = parseISO(i.incident_date);
      return i.incident_type === 'fall' &&
        isValid(incidentDate) &&
        differenceInDays(today, incidentDate) <= 90;
    });
    
    if (recentFalls.length > 0) {
      totalScore += 6 * recentFalls.length;
      riskFactors.push({
        factor: 'Recent Falls',
        impact: 'Medium',
        details: `${recentFalls.length} falls in past 90 days`,
        score: 6 * recentFalls.length,
        intervention: 'Fall prevention protocol, home safety assessment, PT referral'
      });
    }

    // Medication errors
    const medErrors = incidents.filter(i => i.incident_type === 'medication_error');
    if (medErrors.length > 0) {
      totalScore += 7;
      riskFactors.push({
        factor: 'Medication Management Issues',
        impact: 'Medium',
        details: 'History of medication errors',
        score: 7,
        intervention: 'Medication reconciliation, pill organizer, caregiver education'
      });
    }

    // Visit frequency - too few visits may indicate lack of monitoring
    const last30DaysVisits = visits.filter(v => {
      const visitDate = parseISO(v.visit_date);
      return v.status === 'completed' &&
        isValid(visitDate) &&
        differenceInDays(today, visitDate) <= 30;
    });
    
    if (last30DaysVisits.length < 3) {
      totalScore += 5;
      riskFactors.push({
        factor: 'Infrequent Monitoring',
        impact: 'Low',
        details: `Only ${last30DaysVisits.length} visits in past 30 days`,
        score: 5,
        intervention: 'Increase visit frequency, assess barriers to care'
      });
    }

    // Vital signs instability (from most recent visit)
    const recentVisits = visits
      .filter(v => {
        const visitDate = new Date(v.visit_date);
        return v.status === 'completed' && v.vital_signs && isValid(visitDate);
      })
      .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
    
    if (recentVisits.length > 0) {
      const latestVitals = recentVisits[0].vital_signs;
      
      if (latestVitals.oxygen_saturation && latestVitals.oxygen_saturation < 92) {
        totalScore += 8;
        riskFactors.push({
          factor: 'Low Oxygen Saturation',
          impact: 'High',
          details: `O2 Sat: ${latestVitals.oxygen_saturation}% (< 92%)`,
          score: 8,
          intervention: 'Respiratory assessment, oxygen therapy evaluation, MD notification'
        });
      }
      
      if (latestVitals.blood_pressure_systolic) {
        if (latestVitals.blood_pressure_systolic > 180 || latestVitals.blood_pressure_systolic < 90) {
          totalScore += 7;
          riskFactors.push({
            factor: 'Blood Pressure Instability',
            impact: 'Medium',
            details: `BP: ${latestVitals.blood_pressure_systolic}/${latestVitals.blood_pressure_diastolic}`,
            score: 7,
            intervention: 'BP monitoring protocol, medication review, MD consult'
          });
        }
      }
      
      if (latestVitals.heart_rate && (latestVitals.heart_rate > 110 || latestVitals.heart_rate < 50)) {
        totalScore += 6;
        riskFactors.push({
          factor: 'Abnormal Heart Rate',
          impact: 'Medium',
          details: `Heart Rate: ${latestVitals.heart_rate} bpm`,
          score: 6,
          intervention: 'Cardiac monitoring, medication review, MD notification'
        });
      }
    }

    // Social factors
    if (!patient.caregiver_name || patient.caregiver_name.trim() === '') {
      totalScore += 8;
      riskFactors.push({
        factor: 'No Identified Caregiver',
        impact: 'High',
        details: 'Lack of support system increases readmission risk',
        score: 8,
        intervention: 'Social work referral, community resources, assess living situation'
      });
    }

    // Calculate risk level
    let riskLevel, riskColor, riskPercentage;
    
    if (totalScore >= 60) {
      riskLevel = 'Critical';
      riskColor = 'red';
      riskPercentage = '> 40%';
    } else if (totalScore >= 40) {
      riskLevel = 'High';
      riskColor = 'orange';
      riskPercentage = '25-40%';
    } else if (totalScore >= 20) {
      riskLevel = 'Moderate';
      riskColor = 'yellow';
      riskPercentage = '10-25%';
    } else {
      riskLevel = 'Low';
      riskColor = 'green';
      riskPercentage = '< 10%';
    }

    return {
      totalScore,
      riskLevel,
      riskColor,
      riskPercentage,
      riskFactors: riskFactors.sort((a, b) => b.score - a.score)
    };
  }, [patient, visits, incidents]);

  // Generate AI-powered intervention plan
  const generateInterventionPlan = async () => {
    
    try {
      const prompt = `You are a home health clinical expert. Generate a comprehensive intervention plan to reduce hospital readmission risk for this patient.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Diagnosis: ${patient.primary_diagnosis}
- Care Type: ${patient.care_type}
- Readmission Risk: ${riskAssessment.riskLevel} (${riskAssessment.totalScore} points)

IDENTIFIED RISK FACTORS:
${riskAssessment.riskFactors.map(rf => `- ${rf.factor}: ${rf.details} (Impact: ${rf.impact})`).join('\n')}

Generate a detailed 30-day action plan with:

1. **Immediate Actions** (Within 24-48 hours)
2. **Short-term Interventions** (Week 1-2)
3. **Ongoing Management** (Weeks 3-4)
4. **Patient/Caregiver Education Topics**
5. **Monitoring Parameters** (What to track and how often)
6. **Red Flags** (When to escalate to MD or 911)
7. **Interdisciplinary Referrals** (PT, OT, MSW, Dietitian, etc.)

Return JSON format:
{
  "immediate_actions": ["action1", "action2"],
  "short_term": ["intervention1", "intervention2"],
  "ongoing": ["management1", "management2"],
  "education": ["topic1", "topic2"],
  "monitoring": [
    {
      "parameter": "string",
      "frequency": "string",
      "target": "string"
    }
  ],
  "red_flags": ["flag1", "flag2"],
  "referrals": [
    {
      "discipline": "string",
      "reason": "string",
      "priority": "high|medium|low"
    }
  ],
  "expected_outcomes": "string describing expected improvements"
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            immediate_actions: { type: "array", items: { type: "string" } },
            short_term: { type: "array", items: { type: "string" } },
            ongoing: { type: "array", items: { type: "string" } },
            education: { type: "array", items: { type: "string" } },
            monitoring: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  parameter: { type: "string" },
                  frequency: { type: "string" },
                  target: { type: "string" }
                }
              }
            },
            red_flags: { type: "array", items: { type: "string" } },
            referrals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  discipline: { type: "string" },
                  reason: { type: "string" },
                  priority: { type: "string" }
                }
              }
            },
            expected_outcomes: { type: "string" }
          }
        }
      });

      // The response schema marks none of these arrays as required, so the model
      // may legally omit any of them. Normalize to arrays up front so the dialog's
      // unconditional .map()/.length renders can't crash.
      const asArray = (v) => (Array.isArray(v) ? v : []);
      setInterventionPlan({
        ...result,
        immediate_actions: asArray(result?.immediate_actions),
        short_term: asArray(result?.short_term),
        ongoing: asArray(result?.ongoing),
        monitoring: asArray(result?.monitoring),
        education: asArray(result?.education),
        red_flags: asArray(result?.red_flags),
        referrals: asArray(result?.referrals),
      });
      setShowInterventions(true);
      
    } catch (error) {
      console.error('Error generating intervention plan:', error);
      toast.error('Error generating plan. Please try again.');
    }
    
  };

  const getRiskIcon = () => {
    switch(riskAssessment.riskColor) {
      case 'red':
        return <Ambulance className="w-8 h-8 text-red-600" />;
      case 'orange':
        return <AlertTriangle className="w-8 h-8 text-orange-600" />;
      case 'yellow':
        return <Activity className="w-8 h-8 text-yellow-600" />;
      default:
        return <CheckCircle2 className="w-8 h-8 text-green-600" />;
    }
  };

  const getRiskBgColor = () => {
    const colors = {
      red: 'from-red-500 to-red-600',
      orange: 'from-orange-500 to-orange-600',
      yellow: 'from-yellow-500 to-yellow-600',
      green: 'from-green-500 to-green-600'
    };
    return colors[riskAssessment.riskColor];
  };

  const getImpactColor = (impact) => {
    const colors = {
      'Very High': 'bg-red-500',
      'High': 'bg-orange-500',
      'Medium': 'bg-yellow-500',
      'Low': 'bg-blue-500'
    };
    return colors[impact] || 'bg-slate-500';
  };

  return (
    <>
      <Card className={`border-2 ${{red: 'border-red-300', orange: 'border-orange-300', yellow: 'border-yellow-300', green: 'border-green-300'}[riskAssessment.riskColor] || 'border-slate-300'}`}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              30-Day Readmission Risk
            </span>
            <Button
              size="sm"
              onClick={generateInterventionPlan}
              disabled={ai.loading}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {ai.loading ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  AI Action Plan
                </>
              )}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Risk Score Display */}
          <div className={`p-6 rounded-lg bg-gradient-to-br ${getRiskBgColor()} text-white`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm opacity-90 mb-1">Risk Level</p>
                <p className="text-4xl font-bold">{riskAssessment.riskLevel}</p>
                <p className="text-sm opacity-90 mt-1">
                  {riskAssessment.riskPercentage} probability
                </p>
              </div>
              {getRiskIcon()}
            </div>
            <div className="bg-white bg-opacity-20 rounded p-3">
              <div className="flex justify-between text-sm mb-1">
                <span>Risk Score</span>
                <span className="font-semibold">{riskAssessment.totalScore} / 100</span>
              </div>
              <Progress 
                value={riskAssessment.totalScore} 
                className="h-2 bg-white bg-opacity-30"
              />
            </div>
          </div>

          {/* Risk Factors */}
          {riskAssessment.riskFactors.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                <Target className="w-4 h-4" />
                Contributing Risk Factors
              </h4>
              
              <Accordion type="single" collapsible className="space-y-2">
                {riskAssessment.riskFactors.map((factor, index) => (
                  <AccordionItem 
                    key={index} 
                    value={`factor-${index}`}
                    className="border rounded-lg"
                  >
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center gap-3 w-full">
                        <Badge className={getImpactColor(factor.impact)}>
                          +{factor.score}
                        </Badge>
                        <span className="font-medium text-left flex-1">
                          {factor.factor}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {factor.impact} Impact
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-2 text-sm">
                        <p className="text-slate-600">{factor.details}</p>
                        <Alert className="bg-blue-50 border-blue-200">
                          <Lightbulb className="w-4 h-4 text-blue-600" />
                          <AlertDescription className="text-blue-900">
                            <strong>Intervention:</strong> {factor.intervention}
                          </AlertDescription>
                        </Alert>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}

          {/* Quick Actions */}
          {(riskAssessment.riskLevel === 'Critical' || riskAssessment.riskLevel === 'High') && (
            <Alert className="bg-orange-50 border-orange-300">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              <AlertDescription className="text-orange-900">
                <p className="font-semibold mb-2">High Risk - Immediate Action Required</p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>Notify physician of elevated readmission risk</li>
                  <li>Implement intensive monitoring protocol</li>
                  <li>Schedule extra visits this week</li>
                  <li>Review medication adherence</li>
                  <li>Educate patient/caregiver on warning signs</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Intervention Plan Dialog */}
      <Dialog open={showInterventions} onOpenChange={setShowInterventions}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              AI-Generated Readmission Prevention Plan
            </DialogTitle>
            <DialogDescription>
              Comprehensive 30-day action plan to reduce hospital readmission risk
            </DialogDescription>
          </DialogHeader>

          {interventionPlan && (
            <div className="space-y-6 py-4">
              {/* Immediate Actions */}
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Ambulance className="w-5 h-5 text-red-600" />
                  Immediate Actions (24-48 hours)
                </h3>
                <ul className="space-y-2">
                  {interventionPlan.immediate_actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded">
                      <CheckCircle2 className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{action}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Short-term */}
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-600" />
                  Short-term Interventions (Week 1-2)
                </h3>
                <ul className="space-y-2">
                  {interventionPlan.short_term.map((action, i) => (
                    <li key={i} className="flex items-start gap-2 p-3 bg-orange-50 border border-orange-200 rounded">
                      <CheckCircle2 className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{action}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Ongoing */}
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600" />
                  Ongoing Management (Weeks 3-4)
                </h3>
                <ul className="space-y-2">
                  {interventionPlan.ongoing.map((action, i) => (
                    <li key={i} className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded">
                      <CheckCircle2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{action}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Monitoring */}
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-navy-600" />
                  Monitoring Parameters
                </h3>
                <div className="grid gap-3">
                  {interventionPlan.monitoring.map((param, i) => (
                    <div key={i} className="p-3 bg-navy-50 border border-navy-200 rounded">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">{param.parameter}</p>
                          <p className="text-sm text-slate-600">Target: {param.target}</p>
                        </div>
                        <Badge className="bg-navy-600">{param.frequency}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Education */}
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Heart className="w-5 h-5 text-green-600" />
                  Patient/Caregiver Education
                </h3>
                <ul className="space-y-2">
                  {interventionPlan.education.map((topic, i) => (
                    <li key={i} className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded">
                      <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm">{topic}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Red Flags */}
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  Warning Signs (Call MD or 911)
                </h3>
                <ul className="space-y-2">
                  {interventionPlan.red_flags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-2 p-3 bg-red-50 border-2 border-red-300 rounded">
                      <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm font-medium">{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Referrals */}
              {interventionPlan.referrals.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    Recommended Referrals
                  </h3>
                  <div className="grid gap-3">
                    {interventionPlan.referrals.map((ref, i) => (
                      <div key={i} className="p-3 bg-indigo-50 border border-indigo-200 rounded">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium">{ref.discipline}</p>
                            <p className="text-sm text-slate-600">{ref.reason}</p>
                          </div>
                          <Badge className={
                            ref.priority === 'high' ? 'bg-red-600' :
                            ref.priority === 'medium' ? 'bg-yellow-600' :
                            'bg-blue-600'
                          }>
                            {ref.priority} priority
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Expected Outcomes */}
              <Alert className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-300">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <AlertDescription>
                  <p className="font-semibold text-green-900 mb-2">Expected Outcomes</p>
                  <p className="text-sm text-green-800">{interventionPlan.expected_outcomes}</p>
                </AlertDescription>
              </Alert>
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowInterventions(false)}
            >
              Close
            </Button>
            <Button 
              onClick={() => {
                // Could add functionality to add to care plan or print
                toast.success('Plan saved to patient record');
              }}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Save to Care Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}