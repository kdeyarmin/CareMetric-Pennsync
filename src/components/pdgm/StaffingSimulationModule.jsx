import { useState } from "react";
import { invokeLLM } from "@/lib/invokeLLM";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


import {
  Users,
  TrendingUp,
  Calculator,
  Loader2,
  Plus,
  Minus,
  Building2,
  Stethoscope,
  Heart,
  Activity,
  CheckCircle2
} from "lucide-react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area
} from "recharts";

const SERVICE_LINES = [
  { id: 'wound_care', name: 'Wound Care', icon: Heart, avgRevenue: 2800, color: '#ef4444' },
  { id: 'cardiac', name: 'Cardiac Care', icon: Activity, avgRevenue: 2400, color: '#3557b0' },
  { id: 'orthopedic', name: 'Orthopedic/Post-Surgical', icon: Stethoscope, avgRevenue: 2200, color: '#22c55e' },
  { id: 'neuro_rehab', name: 'Neuro/Stroke Rehab', icon: Activity, avgRevenue: 2600, color: '#8b5cf6' },
  { id: 'diabetes', name: 'Diabetes Management', icon: Heart, avgRevenue: 2100, color: '#f59e0b' },
  { id: 'palliative', name: 'Palliative/Hospice Transition', icon: Heart, avgRevenue: 1900, color: '#6b7280' },
];

export default function StaffingSimulationModule({ currentData, formatCurrency }) {
  const [activeSimTab, setActiveSimTab] = useState("staffing");
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResults, setSimulationResults] = useState(null);

  // Staffing simulation state
  const [staffingChanges, setStaffingChanges] = useState({
    rn_change: 0,
    lpn_change: 0,
    pt_change: 0,
    ot_change: 0,
    st_change: 0,
    msw_change: 0,
    aide_change: 0
  });

  // Service line simulation state
  const [newServiceLine, setNewServiceLine] = useState(null);
  const [serviceLineParams, setServiceLineParams] = useState({
    monthly_admissions: 10,
    avg_episodes_per_patient: 1.5,
    marketing_budget: 5000,
    ramp_up_months: 3
  });

  const runStaffingSimulation = async () => {
    setIsSimulating(true);
    try {
      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `Simulate financial impact of staffing changes for a home health agency.

CURRENT STATE:
- Active patients: ${currentData?.activePatients || 50}
- Monthly revenue: ${currentData?.monthlyRevenue || 150000}
- Current case-mix weight: ${currentData?.caseMixWeight || 1.05}

STAFFING CHANGES:
- RN: ${staffingChanges.rn_change > 0 ? '+' : ''}${staffingChanges.rn_change} FTE
- LPN: ${staffingChanges.lpn_change > 0 ? '+' : ''}${staffingChanges.lpn_change} FTE
- PT: ${staffingChanges.pt_change > 0 ? '+' : ''}${staffingChanges.pt_change} FTE
- OT: ${staffingChanges.ot_change > 0 ? '+' : ''}${staffingChanges.ot_change} FTE
- ST: ${staffingChanges.st_change > 0 ? '+' : ''}${staffingChanges.st_change} FTE
- MSW: ${staffingChanges.msw_change > 0 ? '+' : ''}${staffingChanges.msw_change} FTE
- Aide: ${staffingChanges.aide_change > 0 ? '+' : ''}${staffingChanges.aide_change} FTE

Generate realistic projections:

Return JSON:
{
  "staffing_impact": {
    "additional_capacity": 15,
    "projected_new_admissions": 12,
    "revenue_increase": 28000,
    "cost_increase": 18000,
    "net_margin_change": 10000,
    "roi_percentage": 55.5,
    "breakeven_months": 4,
    "monthly_projection": [
      {"month": "Month 1", "revenue": 152000, "cost": 142000, "margin": 10000},
      {"month": "Month 2", "revenue": 158000, "cost": 145000, "margin": 13000},
      {"month": "Month 3", "revenue": 165000, "cost": 148000, "margin": 17000}
    ],
    "capacity_utilization": {
      "current": 85,
      "projected": 78,
      "optimal": 82
    },
    "quality_impact": {
      "visit_frequency_improvement": "+8%",
      "documentation_quality": "+12%",
      "patient_outcomes": "Improved readmission rates"
    },
    "risks": [
      {"risk": "Recruitment timeline", "probability": "medium", "mitigation": "Start recruitment 60 days before need"},
      {"risk": "Training ramp-up", "probability": "low", "mitigation": "Structured onboarding program"}
    ],
    "recommendations": [
      "Phase hiring over 2 months to manage training load",
      "Focus on therapy staff to maximize PDGM reimbursement",
      "Consider PRN pool for volume fluctuations"
    ]
  }
}`,
        response_json_schema: {
          type: "object",
          properties: {
            staffing_impact: { type: "object" }
          }
        }
      });
      setSimulationResults({ type: 'staffing', data: result.staffing_impact });
    } catch (err) {
      console.error("Simulation error:", err);
    }
    setIsSimulating(false);
  };

  const runServiceLineSimulation = async () => {
    if (!newServiceLine) return;
    setIsSimulating(true);
    
    const selectedService = SERVICE_LINES.find(s => s.id === newServiceLine);
    
    try {
      const result = await invokeLLM({
        model: "claude_opus_4_8",
        prompt: `Simulate financial impact of adding a new service line to a home health agency.

CURRENT STATE:
- Active patients: ${currentData?.activePatients || 50}
- Monthly revenue: ${currentData?.monthlyRevenue || 150000}

NEW SERVICE LINE:
- Type: ${selectedService?.name}
- Average revenue per episode: $${selectedService?.avgRevenue}
- Projected monthly admissions: ${serviceLineParams.monthly_admissions}
- Average episodes per patient: ${serviceLineParams.avg_episodes_per_patient}
- Marketing budget: $${serviceLineParams.marketing_budget}/month
- Ramp-up period: ${serviceLineParams.ramp_up_months} months

Generate realistic projections:

Return JSON:
{
  "service_line_impact": {
    "service_name": "${selectedService?.name}",
    "year_one_revenue": 180000,
    "year_one_cost": 95000,
    "net_profit_year_one": 85000,
    "breakeven_month": 5,
    "staffing_requirements": {
      "rn_fte": 1.5,
      "specialty_training": "Wound care certification required",
      "estimated_hiring_cost": 8000
    },
    "market_analysis": {
      "local_demand": "high",
      "competition": "moderate",
      "referral_sources": ["Hospitals", "SNFs", "Physicians"],
      "growth_potential": "15% annually"
    },
    "monthly_ramp_up": [
      {"month": 1, "admissions": 3, "revenue": 8400, "cost": 12000, "profit": -3600},
      {"month": 2, "admissions": 5, "revenue": 14000, "cost": 13000, "profit": 1000},
      {"month": 3, "admissions": 8, "revenue": 22400, "cost": 15000, "profit": 7400},
      {"month": 6, "admissions": 12, "revenue": 33600, "cost": 18000, "profit": 15600},
      {"month": 12, "admissions": 15, "revenue": 42000, "cost": 20000, "profit": 22000}
    ],
    "pdgm_considerations": {
      "clinical_group": "Wounds/Surgical",
      "avg_case_mix_weight": 1.15,
      "functional_documentation_focus": ["M1800-M1860", "GG items"],
      "revenue_optimization_tips": ["Capture all wound measurements", "Document functional impact"]
    },
    "risks": [
      {"risk": "Slow referral development", "impact": "Delayed revenue", "mitigation": "Dedicated marketing rep"},
      {"risk": "Staff certification delays", "impact": "Service start delay", "mitigation": "Begin training immediately"}
    ],
    "success_metrics": [
      {"metric": "Monthly admissions", "target": 12, "timeline": "Month 6"},
      {"metric": "Referral partnerships", "target": 5, "timeline": "Month 3"},
      {"metric": "Patient satisfaction", "target": "90%", "timeline": "Ongoing"}
    ]
  }
}`,
        response_json_schema: {
          type: "object",
          properties: {
            service_line_impact: { type: "object" }
          }
        }
      });
      setSimulationResults({ type: 'service_line', data: result.service_line_impact });
    } catch (err) {
      console.error("Simulation error:", err);
    }
    setIsSimulating(false);
  };

  const StaffingControl = ({ label, value, onChange, icon: Icon }) => (
    <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-500" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 w-7 p-0"
          onClick={() => onChange(Math.max(-5, value - 1))}
        >
          <Minus className="w-3 h-3" />
        </Button>
        <span className={`w-8 text-center font-bold ${
          value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-slate-600'
        }`}>
          {value > 0 ? '+' : ''}{value}
        </span>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 w-7 p-0"
          onClick={() => onChange(Math.min(5, value + 1))}
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Tabs value={activeSimTab} onValueChange={setActiveSimTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="staffing" className="gap-2 text-xs">
            <Users className="w-4 h-4" />
            Staffing Changes
          </TabsTrigger>
          <TabsTrigger value="service_line" className="gap-2 text-xs">
            <Building2 className="w-4 h-4" />
            New Service Line
          </TabsTrigger>
        </TabsList>

        {/* Staffing Simulation Tab */}
        <TabsContent value="staffing" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Adjust Staffing Levels (FTE Change)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <StaffingControl 
                  label="RN" 
                  value={staffingChanges.rn_change} 
                  onChange={(v) => setStaffingChanges(prev => ({...prev, rn_change: v}))}
                  icon={Users}
                />
                <StaffingControl 
                  label="LPN" 
                  value={staffingChanges.lpn_change} 
                  onChange={(v) => setStaffingChanges(prev => ({...prev, lpn_change: v}))}
                  icon={Users}
                />
                <StaffingControl 
                  label="PT" 
                  value={staffingChanges.pt_change} 
                  onChange={(v) => setStaffingChanges(prev => ({...prev, pt_change: v}))}
                  icon={Activity}
                />
                <StaffingControl 
                  label="OT" 
                  value={staffingChanges.ot_change} 
                  onChange={(v) => setStaffingChanges(prev => ({...prev, ot_change: v}))}
                  icon={Activity}
                />
                <StaffingControl 
                  label="ST" 
                  value={staffingChanges.st_change} 
                  onChange={(v) => setStaffingChanges(prev => ({...prev, st_change: v}))}
                  icon={Stethoscope}
                />
                <StaffingControl 
                  label="MSW" 
                  value={staffingChanges.msw_change} 
                  onChange={(v) => setStaffingChanges(prev => ({...prev, msw_change: v}))}
                  icon={Heart}
                />
              </div>
              <Button 
                onClick={runStaffingSimulation} 
                disabled={isSimulating || Object.values(staffingChanges).every(v => v === 0)}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                {isSimulating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Simulating...</>
                ) : (
                  <><Calculator className="w-4 h-4 mr-2" /> Run Staffing Simulation</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Staffing Simulation Results */}
          {simulationResults?.type === 'staffing' && simulationResults.data && (
            <Card className="border-green-200">
              <CardHeader className="pb-2 bg-green-50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  Staffing Impact Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* Key Metrics */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-blue-50 p-2 rounded-lg border border-blue-200 text-center">
                    <p className="text-xs text-blue-600">New Capacity</p>
                    <p className="text-lg font-bold text-blue-900">+{simulationResults.data.additional_capacity}</p>
                  </div>
                  <div className="bg-green-50 p-2 rounded-lg border border-green-200 text-center">
                    <p className="text-xs text-green-600">Revenue Increase</p>
                    <p className="text-lg font-bold text-green-900">{formatCurrency(simulationResults.data.revenue_increase)}</p>
                  </div>
                  <div className="bg-navy-50 p-2 rounded-lg border border-navy-200 text-center">
                    <p className="text-xs text-navy-600">Net Margin</p>
                    <p className="text-lg font-bold text-navy-900">{formatCurrency(simulationResults.data.net_margin_change)}</p>
                  </div>
                  <div className="bg-orange-50 p-2 rounded-lg border border-orange-200 text-center">
                    <p className="text-xs text-orange-600">ROI</p>
                    <p className="text-lg font-bold text-orange-900">{simulationResults.data.roi_percentage}%</p>
                  </div>
                </div>

                {/* Monthly Projection Chart */}
                {simulationResults.data.monthly_projection && (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={simulationResults.data.monthly_projection}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={(value) => formatCurrency(value)} />
                        <Legend />
                        <Area type="monotone" dataKey="revenue" stackId="1" stroke="#3557b0" fill="#93c5fd" name="Revenue" />
                        <Area type="monotone" dataKey="margin" stackId="2" stroke="#22c55e" fill="#86efac" name="Margin" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Recommendations */}
                {simulationResults.data.recommendations && (
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-xs font-semibold text-blue-800 mb-2">Recommendations</p>
                    <ul className="space-y-1">
                      {simulationResults.data.recommendations.map((rec, idx) => (
                        <li key={idx} className="text-xs text-blue-700 flex items-start gap-2">
                          <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Service Line Simulation Tab */}
        <TabsContent value="service_line" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Select New Service Line</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {SERVICE_LINES.map((service) => (
                  <div
                    key={service.id}
                    onClick={() => setNewServiceLine(service.id)}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      newServiceLine === service.id 
                        ? 'border-indigo-500 bg-indigo-50' 
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <service.icon className="w-5 h-5 mb-1" style={{ color: service.color }} />
                    <p className="text-xs font-semibold">{service.name}</p>
                    <p className="text-xs text-slate-500">{formatCurrency(service.avgRevenue)}/ep</p>
                  </div>
                ))}
              </div>

              {newServiceLine && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Monthly Admissions</Label>
                      <Input
                        type="number"
                        value={serviceLineParams.monthly_admissions}
                        onChange={(e) => setServiceLineParams(prev => ({...prev, monthly_admissions: parseInt(e.target.value) || 0}))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Avg Episodes/Patient</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={serviceLineParams.avg_episodes_per_patient}
                        onChange={(e) => setServiceLineParams(prev => ({...prev, avg_episodes_per_patient: parseFloat(e.target.value) || 1}))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Marketing Budget/Month</Label>
                      <Input
                        type="number"
                        value={serviceLineParams.marketing_budget}
                        onChange={(e) => setServiceLineParams(prev => ({...prev, marketing_budget: parseInt(e.target.value) || 0}))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Ramp-up Months</Label>
                      <Input
                        type="number"
                        value={serviceLineParams.ramp_up_months}
                        onChange={(e) => setServiceLineParams(prev => ({...prev, ramp_up_months: parseInt(e.target.value) || 1}))}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              <Button 
                onClick={runServiceLineSimulation} 
                disabled={isSimulating || !newServiceLine}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                {isSimulating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Simulating...</>
                ) : (
                  <><Calculator className="w-4 h-4 mr-2" /> Simulate Service Line</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Service Line Simulation Results */}
          {simulationResults?.type === 'service_line' && simulationResults.data && (
            <Card className="border-navy-200">
              <CardHeader className="pb-2 bg-navy-50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-navy-600" />
                  {simulationResults.data.service_name} - Financial Projection
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* Key Metrics */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-blue-50 p-2 rounded-lg border border-blue-200 text-center">
                    <p className="text-xs text-blue-600">Year 1 Revenue</p>
                    <p className="text-lg font-bold text-blue-900">{formatCurrency(simulationResults.data.year_one_revenue)}</p>
                  </div>
                  <div className="bg-green-50 p-2 rounded-lg border border-green-200 text-center">
                    <p className="text-xs text-green-600">Year 1 Profit</p>
                    <p className="text-lg font-bold text-green-900">{formatCurrency(simulationResults.data.net_profit_year_one)}</p>
                  </div>
                  <div className="bg-orange-50 p-2 rounded-lg border border-orange-200 text-center">
                    <p className="text-xs text-orange-600">Breakeven</p>
                    <p className="text-lg font-bold text-orange-900">Month {simulationResults.data.breakeven_month}</p>
                  </div>
                  <div className="bg-navy-50 p-2 rounded-lg border border-navy-200 text-center">
                    <p className="text-xs text-navy-600">Case-Mix</p>
                    <p className="text-lg font-bold text-navy-900">{simulationResults.data.pdgm_considerations?.avg_case_mix_weight}</p>
                  </div>
                </div>

                {/* Ramp-up Chart */}
                {simulationResults.data.monthly_ramp_up && (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={simulationResults.data.monthly_ramp_up}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(v) => `M${v}`} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={(value) => formatCurrency(value)} />
                        <Legend />
                        <Line type="monotone" dataKey="revenue" stroke="#3557b0" strokeWidth={2} name="Revenue" />
                        <Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2} name="Profit" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Staffing Requirements */}
                {simulationResults.data.staffing_requirements && (
                  <Alert className="bg-blue-50 border-blue-200">
                    <Users className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-blue-800 text-xs">
                      <strong>Staffing Need:</strong> {simulationResults.data.staffing_requirements.rn_fte} RN FTE • 
                      {simulationResults.data.staffing_requirements.specialty_training} • 
                      Hiring cost: {formatCurrency(simulationResults.data.staffing_requirements.estimated_hiring_cost)}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Success Metrics */}
                {simulationResults.data.success_metrics && (
                  <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                    <p className="text-xs font-semibold text-green-800 mb-2">Success Metrics</p>
                    <div className="grid grid-cols-3 gap-2">
                      {simulationResults.data.success_metrics.map((metric, idx) => (
                        <div key={idx} className="bg-white p-2 rounded border text-center">
                          <p className="text-xs text-slate-600">{metric.metric}</p>
                          <p className="text-sm font-bold text-green-700">{metric.target}</p>
                          <p className="text-xs text-slate-500">{metric.timeline}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}