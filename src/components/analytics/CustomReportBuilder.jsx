import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHART_COLORS_6 } from "@/constants/chartColors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, BarChart3, Calendar } from "lucide-react";
import { format } from "date-fns";
import { escapeCsvField } from "@/components/admin/csvExport";

export default function CustomReportBuilder({ patients, visits, incidents, users }) {
  const [reportName, setReportName] = useState("");
  const [dateRange, setDateRange] = useState("30");
  const [selectedMetrics, setSelectedMetrics] = useState([]);
  const [chartType, setChartType] = useState("bar");
  const [generatedReport, setGeneratedReport] = useState(null);

  const availableMetrics = [
    { id: "total_patients", label: "Total Patients", category: "patients" },
    { id: "active_patients", label: "Active Patients", category: "patients" },
    { id: "admissions", label: "New Admissions", category: "patients" },
    { id: "discharges", label: "Discharges", category: "patients" },
    { id: "total_visits", label: "Total Visits", category: "visits" },
    { id: "completed_visits", label: "Completed Visits", category: "visits" },
    { id: "completion_rate", label: "Visit Completion Rate", category: "quality" },
    { id: "falls", label: "Fall Incidents", category: "incidents" },
    { id: "hospitalizations", label: "Hospitalizations", category: "incidents" },
    { id: "med_errors", label: "Medication Errors", category: "incidents" },
    { id: "nurse_count", label: "Active Nurses", category: "staff" },
    { id: "avg_visits_per_nurse", label: "Avg Visits per Nurse", category: "staff" }
  ];

  const toggleMetric = (metricId) => {
    if (selectedMetrics.includes(metricId)) {
      setSelectedMetrics(selectedMetrics.filter(m => m !== metricId));
    } else {
      setSelectedMetrics([...selectedMetrics, metricId]);
    }
  };

  const calculateMetricValue = (metricId) => {
    switch (metricId) {
      case "total_patients":
        return patients.length;
      case "active_patients":
        return patients.filter(p => p.status === "active").length;
      case "admissions":
        return patients.filter(p => p.admission_date).length;
      case "discharges":
        return patients.filter(p => p.discharge_date).length;
      case "total_visits":
        return visits.length;
      case "completed_visits":
        return visits.filter(v => v.status === "completed").length;
      case "completion_rate":
        return visits.length > 0 ? Math.round((visits.filter(v => v.status === "completed").length / visits.length) * 100) : 0;
      case "falls":
        return incidents.filter(i => i.incident_type === "fall").length;
      case "hospitalizations":
        return incidents.filter(i => i.incident_type === "hospitalized").length;
      case "med_errors":
        return incidents.filter(i => i.incident_type === "medication_error").length;
      case "nurse_count":
        return users.filter(u => u.role === "user").length;
      case "avg_visits_per_nurse":
        const nurses = users.filter(u => u.role === "user").length;
        return nurses > 0 ? Math.round(visits.length / nurses) : 0;
      default:
        return 0;
    }
  };

  const generateReport = () => {
    const reportData = selectedMetrics.map(metricId => {
      const metric = availableMetrics.find(m => m.id === metricId);
      return {
        name: metric.label,
        value: calculateMetricValue(metricId),
        id: metricId
      };
    });

    setGeneratedReport({
      name: reportName || "Custom Report",
      date: new Date().toISOString(),
      dateRange,
      data: reportData,
      chartType
    });
  };

  const exportReport = () => {
    if (!generatedReport) return;

    const csvContent = `${escapeCsvField(generatedReport.name)}\nGenerated: ${format(new Date(generatedReport.date), 'PPpp')}\nDate Range: Last ${dateRange} days\n\nMetric,Value\n${generatedReport.data.map(d => `${escapeCsvField(d.name)},${escapeCsvField(d.value)}`).join('\n')}`;
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${generatedReport.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const COLORS = CHART_COLORS_6;

  const groupedMetrics = availableMetrics.reduce((acc, metric) => {
    if (!acc[metric.category]) acc[metric.category] = [];
    acc[metric.category].push(metric);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Custom Report Builder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Report Configuration */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Report Name</Label>
              <Input
                value={reportName}
                onChange={(e) => setReportName(e.target.value)}
                placeholder="e.g., Monthly Quality Metrics"
              />
            </div>
            <div>
              <Label>Date Range</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="60">Last 60 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Metric Selection */}
          <div>
            <Label className="mb-3 block">Select Metrics to Include</Label>
            <div className="space-y-4">
              {Object.entries(groupedMetrics).map(([category, metrics]) => (
                <div key={category}>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2 capitalize">{category}</h4>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {metrics.map(metric => (
                      <div key={metric.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={metric.id}
                          checked={selectedMetrics.includes(metric.id)}
                          onCheckedChange={() => toggleMetric(metric.id)}
                        />
                        <label
                          htmlFor={metric.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {metric.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chart Type Selection */}
          <div>
            <Label>Visualization Type</Label>
            <Select value={chartType} onValueChange={setChartType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bar">Bar Chart</SelectItem>
                <SelectItem value="line">Line Chart</SelectItem>
                <SelectItem value="pie">Pie Chart</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              onClick={generateReport}
              disabled={selectedMetrics.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Generate Report
            </Button>
            {generatedReport && (
              <Button onClick={exportReport} variant="outline">
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Generated Report */}
      {generatedReport && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{generatedReport.name}</CardTitle>
              <Badge variant="outline">
                <Calendar className="w-3 h-3 mr-1" />
                {format(new Date(generatedReport.date), 'MMM d, yyyy')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Chart Visualization */}
            <ResponsiveContainer width="100%" height={300}>
              {chartType === "bar" && (
                <BarChart data={generatedReport.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3557b0" />
                </BarChart>
              )}
              {chartType === "line" && (
                <LineChart data={generatedReport.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#3557b0" strokeWidth={2} />
                </LineChart>
              )}
              {chartType === "pie" && (
                <PieChart>
                  <Pie
                    data={generatedReport.data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label
                  >
                    {generatedReport.data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              )}
            </ResponsiveContainer>

            {/* Metrics Table */}
            <div>
              <h4 className="font-semibold mb-3">Report Summary</h4>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {generatedReport.data.map((item, idx) => (
                  <Card key={idx}>
                    <CardContent className="p-4">
                      <p className="text-sm text-slate-600">{item.name}</p>
                      <p className="text-2xl font-bold mt-1">{item.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}