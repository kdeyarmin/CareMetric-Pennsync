import { useState, useMemo } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, TrendingUp, Users, Brain, Loader2 } from "lucide-react";
import { differenceInDays } from "date-fns";
import { computeAge } from "@/components/oasis/oasisAnalytics";
import { toast } from 'sonner';

export default function PredictiveReadmissionModel({ patients, visits, incidents }) {
  const ai = useAICall();
  const [predictions, setPredictions] = useState(null);

  // Calculate risk factors for each patient
  const riskAnalysis = useMemo(() => {
    return patients.filter(p => p.status === "active").map(patient => {
      const _patientVisits = visits.filter(v => v.patient_id === patient.id);
      const patientIncidents = incidents.filter(i => i.patient_id === patient.id);
      
      let riskScore = 0;
      const riskFactors = [];

      // Recent hospitalization
      const recentHospitalization = patientIncidents.find(i => 
        i.incident_type === "hospitalized" && 
        differenceInDays(new Date(), new Date(i.incident_date)) <= 30
      );
      if (recentHospitalization) {
        riskScore += 35;
        riskFactors.push("Recent hospitalization");
      }

      // Multiple recent falls
      const recentFalls = patientIncidents.filter(i =>
        i.incident_type === "fall" &&
        differenceInDays(new Date(), new Date(i.incident_date)) <= 60
      ).length;
      if (recentFalls >= 2) {
        riskScore += 25;
        riskFactors.push(`${recentFalls} falls in 60 days`);
      }

      // Multiple diagnoses
      if (patient.secondary_diagnoses && patient.secondary_diagnoses.length >= 3) {
        riskScore += 15;
        riskFactors.push("Multiple comorbidities");
      }

      // Age factor. Month/day-aware so the 75+ threshold doesn't flip on/off for
      // months around a patient's birthday (a bare year subtraction over- or
      // under-counts by a year depending on whether their birthday has passed).
      if (patient.date_of_birth) {
        const age = computeAge(patient.date_of_birth);
        if (age >= 75) {
          riskScore += 10;
          riskFactors.push("Age 75+");
        }
      }

      // Medication count
      if (patient.current_medications && patient.current_medications.length >= 10) {
        riskScore += 10;
        riskFactors.push("Polypharmacy (10+ meds)");
      }

      // Cognitive impairment
      if (patient.functional_status?.cognitive_status === "severe_impairment") {
        riskScore += 15;
        riskFactors.push("Severe cognitive impairment");
      }

      // Living alone
      if (patient.social_history?.living_situation === "alone") {
        riskScore += 10;
        riskFactors.push("Lives alone");
      }

      // Past hospitalizations
      const pastHospitalizations = patient.past_hospitalizations?.length || 0;
      if (pastHospitalizations >= 2) {
        riskScore += 10;
        riskFactors.push(`${pastHospitalizations} prior hospitalizations`);
      }

      return {
        patient,
        riskScore: Math.min(riskScore, 100),
        riskLevel: riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low",
        riskFactors,
        estimatedDays: Math.max(7, Math.round(100 - riskScore))
      };
    }).sort((a, b) => b.riskScore - a.riskScore);
  }, [patients, visits, incidents]);

  // Generate AI-powered predictions
  const generateAIPredictions = async () => {
    
    try {
      const highRiskPatients = riskAnalysis.filter(r => r.riskLevel === "high").slice(0, 5);
      
      const prompt = `Analyze these high-risk patients for hospital readmission and provide specific intervention recommendations:

${highRiskPatients.map((r, idx) => `
Patient ${idx + 1}:
- Primary Diagnosis: ${r.patient.primary_diagnosis}
- Risk Score: ${r.riskScore}/100
- Risk Factors: ${r.riskFactors.join(", ")}
- Age: ${r.patient.date_of_birth && !Number.isNaN(computeAge(r.patient.date_of_birth)) ? computeAge(r.patient.date_of_birth) : "Unknown"}
- Living Situation: ${r.patient.social_history?.living_situation || "Unknown"}
`).join("\n")}

For each patient, provide:
1. Predicted readmission probability (0-100%)
2. Primary contributing factor
3. Specific clinical intervention
4. Recommended follow-up schedule`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            patients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  patient_number: { type: "number" },
                  readmission_probability: { type: "number" },
                  primary_factor: { type: "string" },
                  intervention: { type: "string" },
                  follow_up: { type: "string" }
                }
              }
            }
          }
        }
      });

      setPredictions(result.patients);
    } catch (error) {
      console.error("AI prediction error:", error);
      toast.error("Failed to generate AI predictions");
    }
    
  };

  const getRiskColor = (level) => {
    switch (level) {
      case "high": return "bg-red-500";
      case "medium": return "bg-yellow-500";
      default: return "bg-green-500";
    }
  };

  const highRiskCount = riskAnalysis.filter(r => r.riskLevel === "high").length;
  const mediumRiskCount = riskAnalysis.filter(r => r.riskLevel === "medium").length;
  const lowRiskCount = riskAnalysis.filter(r => r.riskLevel === "low").length;

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-600 font-medium">High Risk</p>
                <p className="text-3xl font-bold text-red-700 mt-1">{highRiskCount}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-yellow-600 font-medium">Medium Risk</p>
                <p className="text-3xl font-bold text-yellow-700 mt-1">{mediumRiskCount}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-600 font-medium">Low Risk</p>
                <p className="text-3xl font-bold text-green-700 mt-1">{lowRiskCount}</p>
              </div>
              <Users className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Analysis */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-navy-600" />
              AI-Powered Readmission Analysis
            </CardTitle>
            <Button 
              onClick={generateAIPredictions}
              disabled={ai.loading || highRiskCount === 0}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Generate AI Predictions
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        {predictions && (
          <CardContent>
            <div className="space-y-4">
              {predictions.map((pred, idx) => {
                const patient = riskAnalysis[pred.patient_number - 1];
                // patient_number is AI-supplied and may be out of range — skip
                // rather than crash the whole prediction list.
                if (!patient?.patient) return null;
                return (
                  <Alert key={idx} className={pred.readmission_probability >= 70 ? "border-red-300 bg-red-50" : "border-yellow-300 bg-yellow-50"}>
                    <AlertDescription>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold">
                            {patient.patient.first_name} {patient.patient.last_name}
                          </h4>
                          <Badge className={pred.readmission_probability >= 70 ? "bg-red-500" : "bg-yellow-500"}>
                            {pred.readmission_probability}% Probability
                          </Badge>
                        </div>
                        <div className="grid md:grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="font-medium text-slate-700">Primary Factor:</p>
                            <p className="text-slate-600">{pred.primary_factor}</p>
                          </div>
                          <div>
                            <p className="font-medium text-slate-700">Follow-up Schedule:</p>
                            <p className="text-slate-600">{pred.follow_up}</p>
                          </div>
                        </div>
                        <div>
                          <p className="font-medium text-slate-700">Recommended Intervention:</p>
                          <p className="text-slate-600">{pred.intervention}</p>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Risk Analysis Table */}
      <Card>
        <CardHeader>
          <CardTitle>Patient Risk Stratification</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Risk Level</TableHead>
                  <TableHead>Risk Score</TableHead>
                  <TableHead>Risk Factors</TableHead>
                  <TableHead>Est. Days to Event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riskAnalysis.slice(0, 20).map((analysis, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">
                      {analysis.patient.first_name} {analysis.patient.last_name}
                    </TableCell>
                    <TableCell>
                      <Badge className={getRiskColor(analysis.riskLevel)}>
                        {analysis.riskLevel.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={analysis.riskScore} className="w-20" />
                        <span className="text-sm font-medium">{analysis.riskScore}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {analysis.riskFactors.slice(0, 3).map((factor, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {factor}
                          </Badge>
                        ))}
                        {analysis.riskFactors.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{analysis.riskFactors.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{analysis.estimatedDays} days</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}