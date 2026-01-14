import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  AlertTriangle, 
  Activity, 
  Phone, 
  Shield,
  TrendingUp,
  Clock,
  CheckCircle2
} from "lucide-react";
import { toast } from "sonner";

export default function RealTimePatientRiskMonitor({ 
  visitId, 
  patientId, 
  isActive,
  transcript = '',
  vitals = {},
  callDuration = 0,
  onEscalate
}) {
  const [riskLevel, setRiskLevel] = useState('low');
  const [riskFactors, setRiskFactors] = useState([]);
  const [lastAnalysis, setLastAnalysis] = useState(null);
  const [escalationTriggered, setEscalationTriggered] = useState(false);

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }).then(p => p[0]),
    enabled: !!patientId
  });

  const { data: recentIncidents = [] } = useQuery({
    queryKey: ['recentIncidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ 
      patient_id: patientId 
    }, '-incident_date', 3),
    enabled: !!patientId
  });

  const analyzeRiskMutation = useMutation({
    mutationFn: async (analysisData) => {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical risk assessment AI monitoring a live telehealth visit. Analyze the following real-time data to identify potential patient risk factors that require immediate attention or escalation.

PATIENT CONTEXT:
- Name: ${patient?.first_name} ${patient?.last_name}
- Age: ${patient?.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
- Primary Diagnosis: ${patient?.primary_diagnosis}
- Baseline Vitals: ${JSON.stringify(patient?.baseline_vitals || {})}
- Recent Incidents: ${recentIncidents.map(i => `${i.incident_type} - ${i.severity}`).join(', ') || 'None'}

CURRENT VISIT DATA:
- Call Duration: ${Math.floor(callDuration / 60)} minutes
- Current Vitals: ${JSON.stringify(vitals)}
- Transcript Snippet: ${transcript.slice(-500)}

ANALYZE FOR URGENT RISK FACTORS:
1. **Vital Signs Abnormalities**: Significant deviations from baseline or normal ranges
2. **Distress Indicators**: Words/phrases indicating pain, confusion, shortness of breath, chest pain
3. **Emergency Symptoms**: Stroke signs (FAST), cardiac symptoms, severe pain, altered mental status
4. **Fall Risk**: Balance issues, dizziness mentioned
5. **Medication Concerns**: Side effects, non-compliance, confusion about medications
6. **Mental Health Crisis**: Suicidal ideation, severe depression/anxiety, agitation
7. **Escalation Needs**: Requires immediate 911 call or urgent in-person evaluation

Provide:
- Overall risk level (low, medium, high, critical)
- Specific risk factors detected with severity
- Whether immediate escalation is required
- Recommended actions`,
        response_json_schema: {
          type: "object",
          properties: {
            risk_level: { 
              type: "string", 
              enum: ["low", "medium", "high", "critical"] 
            },
            requires_immediate_escalation: { 
              type: "boolean" 
            },
            risk_factors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  description: { type: "string" },
                  severity: { 
                    type: "string", 
                    enum: ["low", "medium", "high", "critical"] 
                  },
                  confidence: { type: "number" }
                }
              }
            },
            recommended_actions: {
              type: "array",
              items: { type: "string" }
            },
            escalation_protocol: {
              type: "object",
              properties: {
                type: { 
                  type: "string",
                  enum: ["none", "notify_supervisor", "call_911", "urgent_visit", "monitor_closely"]
                },
                reason: { type: "string" },
                urgency: { type: "string" }
              }
            },
            summary: { type: "string" }
          }
        }
      });

      return response;
    },
    onSuccess: (analysis) => {
      setRiskLevel(analysis.risk_level);
      setRiskFactors(analysis.risk_factors || []);
      setLastAnalysis(analysis);

      // Auto-trigger escalation for critical situations
      if (analysis.requires_immediate_escalation && !escalationTriggered) {
        triggerEscalation(analysis);
      }

      // Show alerts for high-risk situations
      if (analysis.risk_level === 'critical' || analysis.risk_level === 'high') {
        toast.error(`${analysis.risk_level.toUpperCase()} risk detected: ${analysis.summary}`, {
          duration: 10000
        });
      }
    }
  });

  // Analyze risk periodically during active call
  useEffect(() => {
    if (!isActive || !patient) return;

    // Initial analysis
    analyzeRiskMutation.mutate({ transcript, vitals, callDuration });

    // Re-analyze every 60 seconds or when significant changes occur
    const interval = setInterval(() => {
      analyzeRiskMutation.mutate({ transcript, vitals, callDuration });
    }, 60000);

    return () => clearInterval(interval);
  }, [isActive, patient, transcript, vitals]);

  // Trigger when vitals change significantly
  useEffect(() => {
    if (isActive && vitals && Object.keys(vitals).length > 0) {
      analyzeRiskMutation.mutate({ transcript, vitals, callDuration });
    }
  }, [vitals]);

  const triggerEscalation = async (analysis) => {
    setEscalationTriggered(true);

    // Create incident report
    await base44.entities.Incident.create({
      patient_id: patientId,
      visit_id: visitId,
      incident_type: 'emergency_visit',
      incident_name: 'Telehealth Risk Alert - Immediate Escalation',
      incident_date: new Date().toISOString().split('T')[0],
      incident_time: new Date().toLocaleTimeString(),
      severity: 'high',
      details: {
        risk_level: analysis.risk_level,
        risk_factors: analysis.risk_factors,
        escalation_protocol: analysis.escalation_protocol,
        analysis_summary: analysis.summary
      },
      report: `AUTOMATED RISK ALERT during telehealth visit:\n\n${analysis.summary}\n\nRisk Factors:\n${analysis.risk_factors.map(f => `- ${f.category}: ${f.description}`).join('\n')}\n\nRecommended Actions:\n${analysis.recommended_actions?.map((a, i) => `${i+1}. ${a}`).join('\n')}`,
      physician_notified: false,
      office_notified: false,
      status: 'reported'
    });

    // Create urgent task
    await base44.entities.Task.create({
      patient_id: patientId,
      title: `URGENT: ${analysis.escalation_protocol?.type || 'Risk Alert'} - ${patient?.first_name} ${patient?.last_name}`,
      description: analysis.escalation_protocol?.reason || analysis.summary,
      type: 'safety',
      priority: 'critical',
      status: 'pending',
      source: 'ai_generated',
      due_timeframe: 'today'
    });

    if (onEscalate) {
      onEscalate(analysis);
    }

    toast.error('ESCALATION PROTOCOL ACTIVATED - Incident report created', {
      duration: 15000
    });
  };

  const getRiskColor = (level) => {
    const colors = {
      low: "bg-green-100 text-green-800 border-green-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      high: "bg-orange-100 text-orange-800 border-orange-300",
      critical: "bg-red-100 text-red-800 border-red-300"
    };
    return colors[level] || colors.low;
  };

  if (!isActive) return null;

  return (
    <Card className={`border-2 ${getRiskColor(riskLevel)}`}>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4" />
          AI Risk Monitor
          <Badge className={getRiskColor(riskLevel)} variant="outline">
            {riskLevel.toUpperCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2 space-y-3">
        {analyzeRiskMutation.isPending && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Activity className="w-4 h-4 animate-pulse" />
            <span>Analyzing patient status...</span>
          </div>
        )}

        {lastAnalysis && (
          <>
            <p className="text-sm text-gray-700">{lastAnalysis.summary}</p>

            {riskFactors.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-gray-900">Active Risk Factors:</h4>
                {riskFactors.map((factor, idx) => (
                  <Alert key={idx} className={`py-2 ${getRiskColor(factor.severity)}`}>
                    <AlertDescription className="text-xs">
                      <strong>{factor.category}:</strong> {factor.description}
                      <Badge variant="outline" className="ml-2 text-xs">
                        {Math.round(factor.confidence * 100)}% confidence
                      </Badge>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {lastAnalysis.escalation_protocol?.type !== 'none' && (
              <Alert className="border-red-300 bg-red-50">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-xs text-red-900">
                  <strong>Escalation Protocol:</strong> {lastAnalysis.escalation_protocol?.type}
                  <br />
                  {lastAnalysis.escalation_protocol?.reason}
                </AlertDescription>
              </Alert>
            )}

            {lastAnalysis.recommended_actions && lastAnalysis.recommended_actions.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-900 mb-1">Recommended Actions:</h4>
                <ul className="text-xs space-y-1">
                  {lastAnalysis.recommended_actions.map((action, idx) => (
                    <li key={idx} className="flex items-start gap-1">
                      <CheckCircle2 className="w-3 h-3 mt-0.5 text-blue-600" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(riskLevel === 'critical' || riskLevel === 'high') && !escalationTriggered && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => triggerEscalation(lastAnalysis)}
                className="w-full"
              >
                <Phone className="w-4 h-4 mr-2" />
                Trigger Escalation Protocol
              </Button>
            )}

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock className="w-3 h-3" />
              Last analyzed: {new Date().toLocaleTimeString()}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}