import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  AlertTriangle,
  Activity,
  Brain
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

const RISK_COLORS = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e'
};

export default function PopulationRiskOverview({ 
  patients = [], 
  oasisData = [], 
  visits = [],
  alerts = [],
  riskFilter = 'all'
}) {
  // Calculate risk scores for all patients
  const patientRisks = useMemo(() => {
    return patients.map(patient => {
      const patientOASIS = oasisData.filter(o => o.patient_id === patient.id);
      const patientVisits = visits.filter(v => v.patient_id === patient.id);
      const patientAlerts = alerts.filter(a => a.patient_id === patient.id);
      
      // Calculate risk factors
      let riskScore = 0;
      const riskFactors = [];

      // OASIS-based risks
      const latestOASIS = patientOASIS[0];
      if (latestOASIS?.pdgm_data) {
        const fs = latestOASIS.pdgm_data.functional_scores || {};
        
        // High functional impairment
        if ((fs.m1860_ambulation || 0) >= 4) {
          riskScore += 15;
          riskFactors.push('Severe mobility impairment');
        }
        if ((fs.m1830_bathing || 0) >= 4) {
          riskScore += 10;
          riskFactors.push('ADL dependency');
        }
        
        // Admission source
        if (latestOASIS.pdgm_data.admission_source === 'institutional') {
          riskScore += 20;
          riskFactors.push('Recent facility discharge');
        }

        // Clinical conditions
        const dx = (latestOASIS.pdgm_data.primary_diagnosis || '').toLowerCase();
        if (dx.includes('chf') || dx.includes('heart failure')) {
          riskScore += 15;
          riskFactors.push('CHF diagnosis');
        }
        if (dx.includes('copd')) {
          riskScore += 12;
          riskFactors.push('COPD diagnosis');
        }
      }

      // Visit frequency changes
      const recentVisits = patientVisits.filter(v => {
        const visitDate = new Date(v.visit_date);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 14);
        return visitDate >= weekAgo;
      });
      if (recentVisits.length === 0 && patientVisits.length > 0) {
        riskScore += 10;
        riskFactors.push('No recent visits');
      }

      // Active alerts
      if (patientAlerts.length > 0) {
        riskScore += patientAlerts.length * 8;
        riskFactors.push(`${patientAlerts.length} active alert(s)`);
      }

      // Determine risk level
      let riskLevel = 'low';
      if (riskScore >= 40) riskLevel = 'high';
      else if (riskScore >= 20) riskLevel = 'medium';

      return {
        ...patient,
        riskScore: Math.min(100, riskScore),
        riskLevel,
        riskFactors,
        latestOASIS,
        visitCount: patientVisits.length,
        alertCount: patientAlerts.length
      };
    });
  }, [patients, oasisData, visits, alerts]);

  // Filter by risk level
  const filteredPatients = riskFilter === 'all' 
    ? patientRisks 
    : patientRisks.filter(p => p.riskLevel === riskFilter);

  // Risk distribution
  const riskDistribution = useMemo(() => {
    const dist = { high: 0, medium: 0, low: 0 };
    patientRisks.forEach(p => dist[p.riskLevel]++);
    return [
      { name: 'High Risk', value: dist.high, color: RISK_COLORS.high },
      { name: 'Medium Risk', value: dist.medium, color: RISK_COLORS.medium },
      { name: 'Low Risk', value: dist.low, color: RISK_COLORS.low }
    ].filter(d => d.value > 0);
  }, [patientRisks]);

  // Top risk factors
  const topRiskFactors = useMemo(() => {
    const factors = {};
    patientRisks.forEach(p => {
      p.riskFactors.forEach(f => {
        factors[f] = (factors[f] || 0) + 1;
      });
    });
    return Object.entries(factors)
      .map(([factor, count]) => ({ factor, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [patientRisks]);

  const highRiskCount = patientRisks.filter(p => p.riskLevel === 'high').length;
  const avgRiskScore = patientRisks.length > 0
    ? Math.round(patientRisks.reduce((s, p) => s + p.riskScore, 0) / patientRisks.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-red-50 to-orange-50 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <p className="text-3xl font-bold text-red-900">{highRiskCount}</p>
            <p className="text-xs text-red-700">High Risk Patients</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-3xl font-bold text-blue-900">{patients.length}</p>
            <p className="text-xs text-blue-700">Active Patients</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-navy-50 to-gold-50 border-navy-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-5 h-5 text-navy-600" />
            </div>
            <p className="text-3xl font-bold text-navy-900">{avgRiskScore}</p>
            <p className="text-xs text-navy-700">Avg Risk Score</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Brain className="w-5 h-5 text-amber-600" />
            </div>
            <p className="text-3xl font-bold text-amber-900">{alerts.length}</p>
            <p className="text-xs text-amber-700">Active Alerts</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Risk Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={riskDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                  label={({ _name, percent }) => `${(percent * 100).toFixed(0)}%`}
                >
                  {riskDistribution.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-2">
              {riskDistribution.map(d => (
                <div key={d.name} className="flex items-center gap-1 text-xs">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.name}: {d.value}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top Risk Factors */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Common Risk Factors</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topRiskFactors} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="factor" type="category" tick={{ fontSize: 10 }} width={120} />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Patient Risk List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            Patient Risk Summary
            <Badge variant="outline">{filteredPatients.length} patients</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {filteredPatients
              .sort((a, b) => b.riskScore - a.riskScore)
              .slice(0, 20)
              .map(patient => (
                <div 
                  key={patient.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full`} style={{ backgroundColor: RISK_COLORS[patient.riskLevel] }} />
                    <div>
                      <p className="text-sm font-medium">{patient.first_name} {patient.last_name}</p>
                      <p className="text-xs text-slate-500">
                        {patient.riskFactors.slice(0, 2).join(' • ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24">
                      <Progress 
                        value={patient.riskScore} 
                        className="h-2"
                        style={{ 
                          '--progress-background': RISK_COLORS[patient.riskLevel]
                        }}
                      />
                    </div>
                    <Badge className={`text-xs ${
                      patient.riskLevel === 'high' ? 'bg-red-100 text-red-800' :
                      patient.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {patient.riskScore}%
                    </Badge>
                  </div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}