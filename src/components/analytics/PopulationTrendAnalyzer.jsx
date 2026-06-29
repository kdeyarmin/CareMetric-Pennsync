import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { TrendingUp, TrendingDown, Users, Activity, AlertTriangle } from "lucide-react";
import { format, subDays, eachDayOfInterval } from "date-fns";
import { computeAge } from "@/components/oasis/oasisAnalytics";

export default function PopulationTrendAnalyzer({ patients, visits, incidents }) {
  const [timeRange, setTimeRange] = useState("90");
  const [metric, setMetric] = useState("admissions");
  const [groupBy, setGroupBy] = useState("diagnosis");

  // Calculate trends based on selected parameters
  const trendData = useMemo(() => {
    const days = parseInt(timeRange);
    const startDate = subDays(new Date(), days);
    
    if (metric === "admissions") {
      // Patient admission trends over time
      const dateMap = {};
      patients.filter(p => p.admission_date && new Date(p.admission_date) >= startDate).forEach(p => {
        const date = format(new Date(p.admission_date), 'yyyy-MM-dd');
        dateMap[date] = (dateMap[date] || 0) + 1;
      });
      
      return eachDayOfInterval({ start: startDate, end: new Date() })
        .map(date => ({
          date: format(date, 'MMM dd'),
          value: dateMap[format(date, 'yyyy-MM-dd')] || 0
        }));
    } else if (metric === "visits") {
      // Visit volume trends
      const dateMap = {};
      visits.filter(v => v.visit_date && new Date(v.visit_date) >= startDate).forEach(v => {
        const date = format(new Date(v.visit_date), 'yyyy-MM-dd');
        dateMap[date] = (dateMap[date] || 0) + 1;
      });
      
      return eachDayOfInterval({ start: startDate, end: new Date() })
        .map(date => ({
          date: format(date, 'MMM dd'),
          value: dateMap[format(date, 'yyyy-MM-dd')] || 0
        }));
    } else if (metric === "incidents") {
      // Incident trends
      const dateMap = {};
      incidents.filter(i => i.incident_date && new Date(i.incident_date) >= startDate).forEach(i => {
        const date = format(new Date(i.incident_date), 'yyyy-MM-dd');
        dateMap[date] = (dateMap[date] || 0) + 1;
      });
      
      return eachDayOfInterval({ start: startDate, end: new Date() })
        .map(date => ({
          date: format(date, 'MMM dd'),
          value: dateMap[format(date, 'yyyy-MM-dd')] || 0
        }));
    }
    
    return [];
  }, [timeRange, metric, patients, visits, incidents]);

  // Population segmentation
  const segmentationData = useMemo(() => {
    if (groupBy === "diagnosis") {
      const diagnosisMap = {};
      patients.forEach(p => {
        const dx = p.primary_diagnosis || "Unknown";
        diagnosisMap[dx] = (diagnosisMap[dx] || 0) + 1;
      });
      return Object.entries(diagnosisMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    } else if (groupBy === "age") {
      const ageGroups = { "0-50": 0, "51-65": 0, "66-75": 0, "76-85": 0, "86+": 0 };
      patients.forEach(p => {
        if (!p.date_of_birth) return;
        // Month/day-aware (and ISO-timezone-safe) — a bare year subtraction
        // mis-buckets patients near their birthday.
        const age = computeAge(p.date_of_birth);
        if (Number.isNaN(age)) return;
        if (age <= 50) ageGroups["0-50"]++;
        else if (age <= 65) ageGroups["51-65"]++;
        else if (age <= 75) ageGroups["66-75"]++;
        else if (age <= 85) ageGroups["76-85"]++;
        else ageGroups["86+"]++;
      });
      return Object.entries(ageGroups).map(([name, count]) => ({ name, count }));
    } else if (groupBy === "care_type") {
      const typeMap = { home_health: 0, hospice: 0 };
      patients.forEach(p => {
        typeMap[p.care_type || "home_health"]++;
      });
      return Object.entries(typeMap).map(([name, count]) => ({ 
        name: name.replace("_", " "), 
        count 
      }));
    }
    return [];
  }, [groupBy, patients]);

  // Calculate trend indicators
  const trendIndicator = useMemo(() => {
    if (trendData.length < 2) return { direction: "stable", percent: 0 };
    
    const recent = trendData.slice(-7).reduce((sum, d) => sum + d.value, 0) / 7;
    const previous = trendData.slice(-14, -7).reduce((sum, d) => sum + d.value, 0) / 7;
    
    if (previous === 0) return { direction: "stable", percent: 0 };
    
    const percent = Math.round(((recent - previous) / previous) * 100);
    return {
      direction: percent > 5 ? "up" : percent < -5 ? "down" : "stable",
      percent: Math.abs(percent)
    };
  }, [trendData]);

  // Key insights
  const insights = useMemo(() => {
    const activePatients = patients.filter(p => p.status === "active").length;
    const recentIncidents = incidents.filter(i => 
      new Date(i.incident_date) >= subDays(new Date(), 7)
    ).length;
    const avgVisitsPerDay = trendData.slice(-7).reduce((sum, d) => sum + d.value, 0) / 7;
    
    return [
      { label: "Active Patients", value: activePatients, icon: Users, color: "text-blue-600" },
      { label: "7-Day Incidents", value: recentIncidents, icon: AlertTriangle, color: "text-red-600" },
      { label: "Avg Daily Visits", value: Math.round(avgVisitsPerDay), icon: Activity, color: "text-green-600" }
    ];
  }, [patients, incidents, trendData]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="population-metric" className="text-xs font-medium text-slate-600 mb-1 block">Metric</label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger id="population-metric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admissions">Patient Admissions</SelectItem>
                  <SelectItem value="visits">Visit Volume</SelectItem>
                  <SelectItem value="incidents">Incidents</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="population-time-range" className="text-xs font-medium text-slate-600 mb-1 block">Time Range</label>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger id="population-time-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="60">Last 60 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                  <SelectItem value="180">Last 6 Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="population-group-by" className="text-xs font-medium text-slate-600 mb-1 block">Group By</label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger id="population-group-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="diagnosis">Primary Diagnosis</SelectItem>
                  <SelectItem value="age">Age Group</SelectItem>
                  <SelectItem value="care_type">Care Type</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Insights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {insights.map((insight, idx) => (
          <Card key={idx}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">{insight.label}</p>
                  <p className="text-2xl font-bold mt-1">{insight.value}</p>
                </div>
                <insight.icon className={`w-8 h-8 ${insight.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Population Trends</CardTitle>
            <div className="flex items-center gap-2">
              {trendIndicator.direction === "up" && (
                <Badge className="bg-green-500 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  +{trendIndicator.percent}%
                </Badge>
              )}
              {trendIndicator.direction === "down" && (
                <Badge className="bg-red-500 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" />
                  -{trendIndicator.percent}%
                </Badge>
              )}
              {trendIndicator.direction === "stable" && (
                <Badge variant="outline">Stable</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3557b0" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3557b0" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#3557b0" fillOpacity={1} fill="url(#colorValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Population Segmentation */}
      <Card>
        <CardHeader>
          <CardTitle>Population Segmentation</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={segmentationData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}