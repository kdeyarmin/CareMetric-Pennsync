import React, { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, Activity, Award, AlertTriangle, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function AdvancedPatientOutcomesAnalytics({ dateRange = 90 }) {
  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list()
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['visits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 1000)
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['carePlans'],
    queryFn: () => base44.entities.CarePlan.list()
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => base44.entities.Incident.list()
  });

  const analytics = useMemo(() => {
    // Outcome metrics
    const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
    const metGoals = carePlans.filter(cp => cp.status === 'met');
    const goalCompletionRate = carePlans.length > 0 ? (metGoals.length / carePlans.length * 100).toFixed(1) : 0;

    // Hospitalization analysis
    const hospitalizations = incidents.filter(i => i.incident_type === 'hospitalized');
    const emergencyVisits = incidents.filter(i => i.incident_type === 'emergency_visit');
    const falls = incidents.filter(i => i.incident_type === 'fall');

    // Treatment effectiveness by diagnosis
    const diagnosisOutcomes = {};
    patients.forEach(patient => {
      const diagnosis = patient.primary_diagnosis;
      if (!diagnosis) return;
      
      if (!diagnosisOutcomes[diagnosis]) {
        diagnosisOutcomes[diagnosis] = {
          total: 0,
          improved: 0,
          stable: 0,
          declined: 0,
          avgVisits: 0
        };
      }
      
      diagnosisOutcomes[diagnosis].total++;
      const patientVisits = visits.filter(v => v.patient_id === patient.id);
      diagnosisOutcomes[diagnosis].avgVisits += patientVisits.length;
      
      const patientCarePlans = carePlans.filter(cp => cp.patient_id === patient.id);
      const metPlans = patientCarePlans.filter(cp => cp.status === 'met').length;
      
      if (metPlans > patientCarePlans.length * 0.7) {
        diagnosisOutcomes[diagnosis].improved++;
      } else if (metPlans > patientCarePlans.length * 0.4) {
        diagnosisOutcomes[diagnosis].stable++;
      } else {
        diagnosisOutcomes[diagnosis].declined++;
      }
    });

    // Calculate average visits per diagnosis
    Object.keys(diagnosisOutcomes).forEach(diag => {
      diagnosisOutcomes[diag].avgVisits = (diagnosisOutcomes[diag].avgVisits / diagnosisOutcomes[diag].total).toFixed(1);
    });

    // Top diagnoses chart data
    const topDiagnoses = Object.entries(diagnosisOutcomes)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([diagnosis, data]) => ({
        diagnosis: diagnosis.substring(0, 30),
        improved: data.improved,
        stable: data.stable,
        declined: data.declined,
        effectiveness: ((data.improved / data.total) * 100).toFixed(1)
      }));

    // Readmission risk distribution
    const riskDistribution = [
      { name: 'Low Risk', value: patients.filter(p => !hospitalizations.some(h => h.patient_id === p.id)).length, color: '#10b981' },
      { name: 'Medium Risk', value: patients.filter(p => hospitalizations.filter(h => h.patient_id === p.id).length === 1).length, color: '#f59e0b' },
      { name: 'High Risk', value: patients.filter(p => hospitalizations.filter(h => h.patient_id === p.id).length > 1).length, color: '#ef4444' }
    ];

    // Monthly trend data
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const month = date.toLocaleString('default', { month: 'short' });
      
      const monthVisits = visits.filter(v => {
        const visitDate = new Date(v.visit_date);
        return visitDate.getMonth() === date.getMonth() && visitDate.getFullYear() === date.getFullYear();
      });
      
      monthlyData.push({
        month,
        visits: monthVisits.length,
        completed: monthVisits.filter(v => v.status === 'completed').length,
        incidents: incidents.filter(i => {
          const incDate = new Date(i.incident_date);
          return incDate.getMonth() === date.getMonth() && incDate.getFullYear() === date.getFullYear();
        }).length
      });
    }

    return {
      goalCompletionRate,
      hospitalizations: hospitalizations.length,
      emergencyVisits: emergencyVisits.length,
      falls: falls.length,
      topDiagnoses,
      riskDistribution,
      monthlyData,
      activeCarePlans: activeCarePlans.length
    };
  }, [patients, visits, carePlans, incidents]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Advanced Patient Outcomes Analytics</h2>
        <p className="text-gray-600">Comprehensive analysis of treatment effectiveness and patient outcomes</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Goal Completion</p>
                <p className="text-3xl font-bold text-green-600">{analytics.goalCompletionRate}%</p>
              </div>
              <Award className="w-12 h-12 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Hospitalizations</p>
                <p className="text-3xl font-bold text-orange-600">{analytics.hospitalizations}</p>
              </div>
              <AlertTriangle className="w-12 h-12 text-orange-200" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Fall Incidents</p>
                <p className="text-3xl font-bold text-red-600">{analytics.falls}</p>
              </div>
              <TrendingDown className="w-12 h-12 text-red-200" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Plans</p>
                <p className="text-3xl font-bold text-blue-600">{analytics.activeCarePlans}</p>
              </div>
              <Activity className="w-12 h-12 text-blue-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="effectiveness" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="effectiveness">Treatment Effectiveness</TabsTrigger>
          <TabsTrigger value="risk">Risk Analysis</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="effectiveness" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Treatment Outcomes by Diagnosis</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={analytics.topDiagnoses}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="diagnosis" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="improved" stackId="a" fill="#10b981" name="Improved" />
                  <Bar dataKey="stable" stackId="a" fill="#f59e0b" name="Stable" />
                  <Bar dataKey="declined" stackId="a" fill="#ef4444" name="Declined" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Top Performing Diagnoses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analytics.topDiagnoses.slice(0, 5).map((diag, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span className="text-sm font-medium">{diag.diagnosis}</span>
                      <Badge className="bg-green-100 text-green-800">{diag.effectiveness}% effective</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Care Plan Success Rate</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-center">
                <div className="text-center">
                  <div className="text-6xl font-bold text-green-600 mb-2">{analytics.goalCompletionRate}%</div>
                  <p className="text-gray-600">of care plan goals achieved</p>
                  <CheckCircle className="w-16 h-16 text-green-200 mx-auto mt-4" />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="risk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Readmission Risk Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <PieChart>
                  <Pie
                    data={analytics.riskDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={150}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {analytics.riskDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-gray-600 mb-2">Emergency Visits</p>
                <p className="text-4xl font-bold text-red-600">{analytics.emergencyVisits}</p>
                <p className="text-sm text-gray-500 mt-2">Requires immediate review</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-gray-600 mb-2">Fall Prevention</p>
                <p className="text-4xl font-bold text-orange-600">{analytics.falls}</p>
                <p className="text-sm text-gray-500 mt-2">Falls this period</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-gray-600 mb-2">Hospital Readmissions</p>
                <p className="text-4xl font-bold text-purple-600">{analytics.hospitalizations}</p>
                <p className="text-sm text-gray-500 mt-2">Within 30 days</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>6-Month Activity Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={analytics.monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="visits" stroke="#3b82f6" strokeWidth={2} name="Total Visits" />
                  <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={2} name="Completed" />
                  <Line type="monotone" dataKey="incidents" stroke="#ef4444" strokeWidth={2} name="Incidents" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}