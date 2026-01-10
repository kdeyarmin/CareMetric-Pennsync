import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, TrendingUp, AlertTriangle, Pill, Target, ChevronDown, ChevronUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { secureAICall } from "../utils/security";

export default function PreVisitAIBrief({ patient, recentVisits, carePlans, userEmail }) {
  const [brief, setBrief] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (patient) {
      generateBrief();
    }
  }, [patient?.id]);

  const generateBrief = async () => {
    setIsLoading(true);
    try {
      const result = await secureAICall(
        () => base44.integrations.Core.InvokeLLM({
          prompt: `Generate concise pre-visit brief for nurse.

PATIENT: ${patient.first_name} ${patient.last_name}
Dx: ${patient.primary_diagnosis}
Meds: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
Allergies: ${patient.allergies || 'None'}

LAST VISIT: ${recentVisits[0] ? `${recentVisits[0].visit_date}: ${recentVisits[0].nurse_notes?.substring(0, 200)}` : 'None'}

BASELINE VITALS: ${patient.baseline_vitals ? `BP ${patient.baseline_vitals.blood_pressure_systolic}/${patient.baseline_vitals.blood_pressure_diastolic}, HR ${patient.baseline_vitals.heart_rate}, O2 ${patient.baseline_vitals.oxygen_saturation}%` : 'Not recorded'}

ACTIVE CARE PLANS: ${carePlans.filter(cp => cp.status === 'active').map(cp => `${cp.problem}: ${cp.goal}`).join('; ') || 'None'}

Provide quick actionable brief:
{
  "key_highlights": ["2-3 critical points from last visit"],
  "vitals_to_watch": ["Specific vitals needing monitoring"],
  "care_plan_focus": ["Which goals to assess today"],
  "medication_checks": ["Meds requiring adherence/response check"],
  "clinical_alerts": ["Safety concerns or changes to monitor"]
}`,
          response_json_schema: {
            type: "object",
            properties: {
              key_highlights: { type: "array", items: { type: "string" } },
              vitals_to_watch: { type: "array", items: { type: "string" } },
              care_plan_focus: { type: "array", items: { type: "string" } },
              medication_checks: { type: "array", items: { type: "string" } },
              clinical_alerts: { type: "array", items: { type: "string" } }
            }
          }
        }),
        userEmail
      );
      setBrief(result);
    } catch (error) {
      setBrief(null);
    }
    setIsLoading(false);
  };

  if (!patient || isLoading) {
    return isLoading ? (
      <Card className="border-2 border-blue-300 bg-blue-50">
        <CardContent className="p-4 text-center text-sm text-blue-700">
          Preparing pre-visit brief...
        </CardContent>
      </Card>
    ) : null;
  }

  if (!brief) return null;

  return (
    <Card className="border-2 border-blue-400 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-lg">
      <CardHeader className="py-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            Pre-Visit AI Brief
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>
      {isExpanded && (
        <CardContent className="p-4 space-y-3">
          {brief.clinical_alerts?.length > 0 && (
            <Alert className="bg-red-50 border-red-300">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-xs">
                <strong className="text-red-800">Clinical Alerts:</strong>
                <ul className="mt-1 space-y-1">
                  {brief.clinical_alerts.map((alert, idx) => (
                    <li key={idx} className="text-red-700">• {alert}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {brief.key_highlights?.length > 0 && (
            <div className="space-y-1">
              <Badge className="bg-blue-600 text-white text-xs">Last Visit Highlights</Badge>
              <ul className="text-xs space-y-1">
                {brief.key_highlights.map((item, idx) => (
                  <li key={idx} className="text-gray-700">• {item}</li>
                ))}
              </ul>
            </div>
          )}

          {brief.vitals_to_watch?.length > 0 && (
            <div className="space-y-1">
              <Badge className="bg-green-600 text-white text-xs flex items-center gap-1 w-fit">
                <TrendingUp className="w-3 h-3" /> Vitals to Monitor
              </Badge>
              <ul className="text-xs space-y-1">
                {brief.vitals_to_watch.map((item, idx) => (
                  <li key={idx} className="text-gray-700">• {item}</li>
                ))}
              </ul>
            </div>
          )}

          {brief.care_plan_focus?.length > 0 && (
            <div className="space-y-1">
              <Badge className="bg-purple-600 text-white text-xs flex items-center gap-1 w-fit">
                <Target className="w-3 h-3" /> Care Plan Focus
              </Badge>
              <ul className="text-xs space-y-1">
                {brief.care_plan_focus.map((item, idx) => (
                  <li key={idx} className="text-gray-700">• {item}</li>
                ))}
              </ul>
            </div>
          )}

          {brief.medication_checks?.length > 0 && (
            <div className="space-y-1">
              <Badge className="bg-orange-600 text-white text-xs flex items-center gap-1 w-fit">
                <Pill className="w-3 h-3" /> Medication Checks
              </Badge>
              <ul className="text-xs space-y-1">
                {brief.medication_checks.map((item, idx) => (
                  <li key={idx} className="text-gray-700">• {item}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}