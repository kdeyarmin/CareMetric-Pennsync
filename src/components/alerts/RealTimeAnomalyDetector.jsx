import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  AlertTriangle, 
  TrendingUp,
  TrendingDown,
  Activity,
  CheckCircle2,
  Bell,
  Eye,
  EyeOff,
  Loader2
} from 'lucide-react';

export default function RealTimeAnomalyDetector({ patientId, careSetting, providerType }) {
  const [anomalies, setAnomalies] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [dismissedAnomalies, setDismissedAnomalies] = useState(new Set());

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.get(patientId),
    enabled: !!patientId
  });

  const { data: recentVisits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 20),
    enabled: !!patientId
  });

  const detectAnomalies = async () => {
    if (!patient || recentVisits.length < 2) return;

    setScanning(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical anomaly detection AI for ${providerType} in ${careSetting} setting.

PATIENT: ${patient.first_name} ${patient.last_name}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis}

RECENT VISIT DATA (${recentVisits.length} visits):
${recentVisits.slice(0, 10).map((v, i) => `
Visit ${i + 1} - ${v.visit_date}:
- Type: ${v.visit_type}
- Vitals: ${JSON.stringify(v.vital_signs || {})}
- Notes: ${v.nurse_notes?.substring(0, 300) || 'None'}
`).join('\n')}

BASELINE VITALS: ${JSON.stringify(patient.baseline_vitals || {})}
FUNCTIONAL STATUS: ${JSON.stringify(patient.functional_status || {})}

CARE SETTING: ${careSetting}
PROVIDER: ${providerType}

Analyze the data for anomalies specific to ${careSetting} and ${providerType} practice:

1. Vital sign trends (sudden changes, concerning patterns)
2. Documentation gaps or inconsistencies
3. Functional decline indicators
4. Medication-related concerns
5. Care plan deviation
6. ${careSetting}-specific red flags

For each anomaly, provide:
- Type (vital_sign, functional, documentation, medication, care_plan)
- Severity (critical, high, medium, low)
- Description (what's abnormal)
- Trend (increasing, decreasing, stable, fluctuating)
- Clinical_significance (why it matters for ${providerType})
- Recommended_action (specific to ${providerType} scope)
- Confidence (0-100)`,
        response_json_schema: {
          type: 'object',
          properties: {
            anomalies: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  severity: { type: 'string' },
                  description: { type: 'string' },
                  trend: { type: 'string' },
                  clinical_significance: { type: 'string' },
                  recommended_action: { type: 'string' },
                  confidence: { type: 'number' },
                  data_points: { type: 'array', items: { type: 'string' } }
                }
              }
            },
            overall_status: { type: 'string' },
            summary: { type: 'string' }
          }
        }
      });

      setAnomalies(response.anomalies || []);

      // Auto-create critical alerts
      const criticalAnomalies = (response.anomalies || []).filter(a => a.severity === 'critical');
      for (const anomaly of criticalAnomalies) {
        try {
          await base44.entities.PatientAlert.create({
            patient_id: patientId,
            alert_type: anomaly.type === 'vital_sign' ? 'vital_deterioration' : 'symptom_escalation',
            severity: 'critical',
            title: anomaly.description,
            message: anomaly.clinical_significance,
            recommended_actions: [anomaly.recommended_action],
            risk_score: anomaly.confidence,
            data_sources: { detected_by: 'AI Anomaly Detector', trend: anomaly.trend },
            status: 'active'
          });
        } catch (error) {
          console.error('Error creating alert:', error);
        }
      }

      if (criticalAnomalies.length > 0) {
        alert(`🚨 ${criticalAnomalies.length} critical anomalies detected and alerts created!`);
      }
    } catch (error) {
      console.error('Anomaly detection error:', error);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (autoScan && patientId && recentVisits.length >= 2) {
      detectAnomalies();
    }
  }, [patientId, recentVisits.length]);

  const activeAnomalies = anomalies.filter(a => !dismissedAnomalies.has(a.description));

  const getTrendIcon = (trend) => {
    if (trend === 'increasing') return <TrendingUp className="w-4 h-4 text-red-500" />;
    if (trend === 'decreasing') return <TrendingDown className="w-4 h-4 text-blue-500" />;
    return <Activity className="w-4 h-4 text-gray-500" />;
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  if (!patient) return null;

  return (
    <Card className="border-orange-300 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-orange-600" />
            Real-Time Anomaly Detection
            {activeAnomalies.length > 0 && (
              <Badge className="bg-red-600 text-white">{activeAnomalies.length}</Badge>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAutoScan(!autoScan)}
              className="text-xs"
            >
              {autoScan ? <Eye className="w-4 h-4 mr-1" /> : <EyeOff className="w-4 h-4 mr-1" />}
              Auto-Scan {autoScan ? 'On' : 'Off'}
            </Button>
            <Button 
              onClick={detectAnomalies} 
              disabled={scanning}
              size="sm"
              variant="outline"
            >
              {scanning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Scan Now'
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {scanning ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-orange-600" />
            <p className="text-sm text-gray-600">Analyzing patient data for anomalies...</p>
          </div>
        ) : activeAnomalies.length === 0 ? (
          <Alert className="bg-green-50 border-green-300">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              No significant anomalies detected. Patient data appears stable and within expected parameters.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {activeAnomalies.map((anomaly, i) => (
              <Card key={i} className={`${getSeverityColor(anomaly.severity)} border-2`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 flex-1">
                      {getTrendIcon(anomaly.trend)}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={
                            anomaly.severity === 'critical' ? 'bg-red-600 text-white' :
                            anomaly.severity === 'high' ? 'bg-orange-600 text-white' :
                            'bg-yellow-600 text-white'
                          }>
                            {anomaly.severity}
                          </Badge>
                          <p className="text-sm font-semibold">{anomaly.description}</p>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize">{anomaly.type.replace('_', ' ')}</Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDismissedAnomalies(prev => new Set([...prev, anomaly.description]))}
                      className="flex-shrink-0"
                    >
                      Dismiss
                    </Button>
                  </div>
                  
                  <div className="space-y-2 mt-3">
                    <div className="bg-white/50 dark:bg-slate-800/50 p-2 rounded">
                      <p className="text-xs font-semibold mb-1">Clinical Significance:</p>
                      <p className="text-xs">{anomaly.clinical_significance}</p>
                    </div>
                    
                    <div className="bg-blue-50 dark:bg-blue-900 p-2 rounded">
                      <p className="text-xs font-semibold mb-1 text-blue-800 dark:text-blue-300">
                        Recommended Action for {providerType}:
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-400">{anomaly.recommended_action}</p>
                    </div>

                    {anomaly.data_points && anomaly.data_points.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500">Supporting Data:</span>
                        {anomaly.data_points.slice(0, 3).map((dp, j) => (
                          <Badge key={j} variant="outline" className="text-xs">{dp}</Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-500">Confidence: {anomaly.confidence}%</p>
                      <Progress value={anomaly.confidence} className="w-24 h-2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}