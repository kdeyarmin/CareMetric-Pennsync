import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  TrendingUp,
  TrendingDown,
  Target,
  Filter,
  BarChart3
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from "recharts";

const COLORS = ['#3557b0', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#0d9488', '#14b8a6'];

export default function PatientCohortAnalysis({ cohortData, formatCurrency }) {
  const [segmentBy, setSegmentBy] = useState("clinical_group");
  const [selectedCohort, setSelectedCohort] = useState(null);

  if (!cohortData) return null;

  const { cohorts, variance_drivers, predicted_vs_actual } = cohortData;

  const getVarianceColor = (variance) => {
    if (variance > 5) return 'text-green-600';
    if (variance < -5) return 'text-red-600';
    return 'text-slate-600';
  };

  const getVarianceBg = (variance) => {
    if (variance > 5) return 'bg-green-50 border-green-200';
    if (variance < -5) return 'bg-red-50 border-red-200';
    return 'bg-slate-50 border-slate-200';
  };

  return (
    <div className="space-y-4">
      {/* Segmentation Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium">Segment by:</span>
          <Select value={segmentBy} onValueChange={setSegmentBy}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="clinical_group">Clinical Group</SelectItem>
              <SelectItem value="risk_profile">Risk Profile</SelectItem>
              <SelectItem value="functional_level">Functional Level</SelectItem>
              <SelectItem value="payer_mix">Payer Mix</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Badge variant="outline" className="text-xs">
          {cohorts?.length || 0} cohorts identified
        </Badge>
      </div>

      {/* Cohort Overview Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cohorts?.slice(0, 4).map((cohort, idx) => (
          <Card 
            key={idx} 
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedCohort === idx ? 'ring-2 ring-indigo-500' : ''
            }`}
            onClick={() => setSelectedCohort(selectedCohort === idx ? null : idx)}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                />
                <Badge variant="outline" className="text-xs">
                  {cohort.patient_count} pts
                </Badge>
              </div>
              <p className="font-semibold text-sm text-slate-900 mb-1">{cohort.name}</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Avg Revenue</span>
                  <span className="font-medium">{formatCurrency(cohort.avg_revenue)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Case-Mix</span>
                  <span className="font-medium">{cohort.avg_case_mix?.toFixed(3)}</span>
                </div>
                <div className={`flex justify-between text-xs ${getVarianceColor(cohort.variance_pct)}`}>
                  <span>Variance</span>
                  <span className="font-medium flex items-center gap-1">
                    {cohort.variance_pct > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {cohort.variance_pct > 0 ? '+' : ''}{cohort.variance_pct}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Predicted vs Actual Revenue Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            Predicted vs Actual Revenue by Cohort
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={predicted_vs_actual || cohorts} barGap={0}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
                <Bar dataKey="predicted_revenue" name="Predicted" fill="#264491" />
                <Bar dataKey="actual_revenue" name="Actual" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Revenue Variance Drivers */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-orange-600" />
            Key Revenue Variance Drivers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {variance_drivers?.map((driver, idx) => (
              <div key={idx} className={`p-3 rounded-lg border ${getVarianceBg(driver.impact_pct)}`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-sm text-slate-900">{driver.driver}</p>
                    <p className="text-xs text-slate-600">{driver.description}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${getVarianceColor(driver.impact_pct)}`}>
                      {driver.impact_pct > 0 ? '+' : ''}{formatCurrency(driver.revenue_impact)}
                    </p>
                    <p className={`text-xs ${getVarianceColor(driver.impact_pct)}`}>
                      {driver.impact_pct > 0 ? '+' : ''}{driver.impact_pct}% variance
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{driver.affected_patients} patients</Badge>
                  <Badge className={`text-xs ${
                    driver.priority === 'high' ? 'bg-red-100 text-red-700' :
                    driver.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {driver.priority} priority
                  </Badge>
                  {driver.actionable && (
                    <Badge className="bg-green-100 text-green-700 text-xs">Actionable</Badge>
                  )}
                </div>
                {driver.recommendation && (
                  <p className="text-xs text-slate-700 mt-2 bg-white p-2 rounded border">
                    <strong>Action:</strong> {driver.recommendation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Selected Cohort Detail */}
      {selectedCohort !== null && cohorts?.[selectedCohort] && (
        <Card className="border-indigo-200">
          <CardHeader className="pb-2 bg-indigo-50">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                {cohorts[selectedCohort].name} - Detailed Analysis
              </span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedCohort(null)}>×</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
                <p className="text-xs text-blue-600">Total Patients</p>
                <p className="text-2xl font-bold text-blue-900">{cohorts[selectedCohort].patient_count}</p>
              </div>
              <div className="bg-green-50 p-3 rounded-lg border border-green-200 text-center">
                <p className="text-xs text-green-600">Total Revenue</p>
                <p className="text-xl font-bold text-green-900">{formatCurrency(cohorts[selectedCohort].total_revenue)}</p>
              </div>
              <div className="bg-navy-50 p-3 rounded-lg border border-navy-200 text-center">
                <p className="text-xs text-navy-600">Optimization Potential</p>
                <p className="text-xl font-bold text-navy-900">+{formatCurrency(cohorts[selectedCohort].optimization_potential)}</p>
              </div>
            </div>

            {/* Risk Distribution */}
            {cohorts[selectedCohort].risk_breakdown && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-2">Risk Distribution</p>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={cohorts[selectedCohort].risk_breakdown}
                          dataKey="count"
                          nameKey="level"
                          cx="50%"
                          cy="50%"
                          outerRadius={50}
                          label={({ level, pct }) => `${level}: ${pct}%`}
                          labelLine={false}
                        >
                          {cohorts[selectedCohort].risk_breakdown.map((entry, i) => (
                            <Cell key={i} fill={
                              entry.level === 'High' ? '#ef4444' :
                              entry.level === 'Medium' ? '#f59e0b' : '#22c55e'
                            } />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-2">Key Characteristics</p>
                  <ul className="space-y-1 text-xs">
                    {cohorts[selectedCohort].characteristics?.map((char, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
                        {char}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}