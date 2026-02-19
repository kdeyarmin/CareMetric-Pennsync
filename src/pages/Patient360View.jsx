import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  User, 
  Heart, 
  Pill, 
  FileText, 
  Calendar,
  AlertTriangle,
  TrendingUp,
  Activity,
  Clock,
  Phone,
  Mail,
  Home,
  Loader2
} from 'lucide-react';

export default function Patient360View() {
  const { patientId } = useParams();
  const [activeTab, setActiveTab] = useState('overview');

  const { data: patient, isLoading: loadingPatient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.get(patientId)
  });

  const { data: visits } = useQuery({
    queryKey: ['patient-visits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId })
  });

  const { data: documents } = useQuery({
    queryKey: ['patient-documents', patientId],
    queryFn: () => base44.entities.PatientDocument.filter({ patient_id: patientId })
  });

  const { data: alerts } = useQuery({
    queryKey: ['patient-alerts', patientId],
    queryFn: () => base44.entities.PatientAlert.filter({ patient_id: patientId, status: 'active' })
  });

  const { data: carePlans } = useQuery({
    queryKey: ['patient-careplans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId })
  });

  const { data: outcomes } = useQuery({
    queryKey: ['patient-outcomes', patientId],
    queryFn: () => base44.entities.PatientOutcomeMetric.filter({ patient_id: patientId })
  });

  const { data: riskAnalysis } = useQuery({
    queryKey: ['patient-risk', patientId],
    queryFn: async () => {
      const analyses = await base44.entities.RiskAnalysis.filter({ patient_id: patientId });
      return analyses.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];
    }
  });

  if (loadingPatient) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="p-6">
        <p className="text-slate-600">Patient not found</p>
      </div>
    );
  }

  const activeAlerts = alerts?.filter(a => a.status === 'active') || [];
  const recentVisits = visits?.slice(0, 5) || [];
  const activeCarePlan = carePlans?.find(cp => cp.status === 'active');

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{patient.full_name}</h1>
            <p className="text-sm text-slate-600 mt-1">Patient ID: {patient.id?.slice(0, 8)}</p>
          </div>
          <Badge className={patient.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}>
            {patient.status}
          </Badge>
        </div>

        {/* Active Alerts Banner */}
        {activeAlerts.length > 0 && (
          <Card className="border-2 border-red-300 bg-red-50">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-red-900 mb-2">Active Alerts ({activeAlerts.length})</h3>
                  <div className="space-y-1">
                    {activeAlerts.slice(0, 3).map(alert => (
                      <p key={alert.id} className="text-sm text-red-800">• {alert.title}</p>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{visits?.length || 0}</p>
                  <p className="text-xs text-slate-600">Total Visits</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-lg">
                  <Heart className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{activeCarePlan ? '1' : '0'}</p>
                  <p className="text-xs text-slate-600">Active Care Plan</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-yellow-100 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{activeAlerts.length}</p>
                  <p className="text-xs text-slate-600">Active Alerts</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg ${
                  riskAnalysis?.overall_risk_level === 'high' ? 'bg-red-100' : 
                  riskAnalysis?.overall_risk_level === 'medium' ? 'bg-yellow-100' : 'bg-green-100'
                }`}>
                  <Activity className={`h-5 w-5 ${
                    riskAnalysis?.overall_risk_level === 'high' ? 'text-red-600' : 
                    riskAnalysis?.overall_risk_level === 'medium' ? 'text-yellow-600' : 'text-green-600'
                  }`} />
                </div>
                <div>
                  <p className="text-2xl font-bold capitalize">{riskAnalysis?.overall_risk_level || 'Low'}</p>
                  <p className="text-xs text-slate-600">Risk Level</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="vitals">Vitals</TabsTrigger>
            <TabsTrigger value="medications">Medications</TabsTrigger>
            <TabsTrigger value="visits">Visits</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Demographics */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Demographics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600">Date of Birth:</span>
                    <span className="text-sm font-medium">{patient.date_of_birth || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600">Gender:</span>
                    <span className="text-sm font-medium">{patient.gender || 'N/A'}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-sm text-slate-600 flex items-center gap-1">
                      <Home className="h-4 w-4" />
                      Address:
                    </span>
                    <span className="text-sm font-medium text-right">{patient.address || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 flex items-center gap-1">
                      <Phone className="h-4 w-4" />
                      Phone:
                    </span>
                    <span className="text-sm font-medium">{patient.phone || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600 flex items-center gap-1">
                      <Mail className="h-4 w-4" />
                      Email:
                    </span>
                    <span className="text-sm font-medium">{patient.email || 'N/A'}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Clinical Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Heart className="h-5 w-5" />
                    Clinical Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Primary Diagnosis</p>
                    <p className="text-sm font-medium">{patient.primary_diagnosis || 'Not specified'}</p>
                  </div>
                  {patient.secondary_diagnoses && patient.secondary_diagnoses.length > 0 && (
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Secondary Diagnoses</p>
                      <div className="space-y-1">
                        {patient.secondary_diagnoses.slice(0, 3).map((diag, idx) => (
                          <p key={idx} className="text-sm">• {diag}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Admission Date</p>
                    <p className="text-sm font-medium">
                      {patient.admission_date ? new Date(patient.admission_date).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentVisits.map(visit => (
                    <div key={visit.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="text-sm font-medium">{visit.visit_type}</p>
                        <p className="text-xs text-slate-600">
                          {visit.visit_date ? new Date(visit.visit_date).toLocaleDateString() : 'N/A'}
                        </p>
                      </div>
                      <Badge variant="outline">{visit.status}</Badge>
                    </div>
                  ))}
                  {recentVisits.length === 0 && (
                    <p className="text-sm text-slate-600 text-center py-4">No recent visits</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Other tabs would be implemented similarly */}
          <TabsContent value="vitals">
            <Card>
              <CardContent className="py-8 text-center">
                <Activity className="h-12 w-12 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-600">Vitals tracking coming soon</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="medications">
            <Card>
              <CardContent className="py-8 text-center">
                <Pill className="h-12 w-12 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-600">Medication management coming soon</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="visits">
            <Card>
              <CardHeader>
                <CardTitle>Visit History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {visits?.map(visit => (
                    <div key={visit.id} className="p-3 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{visit.visit_type}</p>
                          <p className="text-sm text-slate-600">
                            {visit.visit_date ? new Date(visit.visit_date).toLocaleDateString() : 'N/A'}
                          </p>
                        </div>
                        <Badge>{visit.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle>Documents ({documents?.length || 0})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {documents?.map(doc => (
                    <div key={doc.id} className="p-3 border rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-slate-600" />
                        <div>
                          <p className="font-medium">{doc.document_name}</p>
                          <p className="text-xs text-slate-600">{doc.document_type}</p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline">View</Button>
                    </div>
                  ))}
                  {(!documents || documents.length === 0) && (
                    <p className="text-sm text-slate-600 text-center py-4">No documents</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="outcomes">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Patient Outcomes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {outcomes && outcomes.length > 0 ? (
                  <div className="space-y-4">
                    {outcomes.map(outcome => (
                      <div key={outcome.id} className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <p className="font-medium">Episode Outcome</p>
                          <Badge>{outcome.discharge_disposition}</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-slate-600">Length of Service</p>
                            <p className="font-medium">{outcome.length_of_service} days</p>
                          </div>
                          <div>
                            <p className="text-slate-600">Goal Achievement</p>
                            <p className="font-medium">{outcome.goal_achievement_rate}%</p>
                          </div>
                          <div>
                            <p className="text-slate-600">Quality Score</p>
                            <p className="font-medium">{outcome.outcome_quality_score}/100</p>
                          </div>
                          <div>
                            <p className="text-slate-600">30-Day Readmission</p>
                            <p className="font-medium">{outcome.readmission_30_day ? 'Yes' : 'No'}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 text-center py-4">No outcome data available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}