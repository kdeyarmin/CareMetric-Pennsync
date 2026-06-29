import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { toCsvRows } from "@/components/admin/csvExport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Activity, 
  Clock,
  Download
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

const COLORS = ['#10b981', '#3557b0', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function WorkflowMonitoringDashboard() {
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [ruleFilter, setRuleFilter] = useState('all');

  // Fetch workflow executions
  const { data: workflowExecutions = [] } = useQuery({
    queryKey: ['workflowExecutions'],
    queryFn: () => base44.entities.OASISWorkflowExecution.list('-created_date', 200),
  });

  // Fetch automation rules for filtering
  const { data: automationRules = [] } = useQuery({
    queryKey: ['automationRules'],
    queryFn: () => base44.entities.OASISAutomationRule.list(),
  });

  // Filter data
  const filteredExecutions = workflowExecutions.filter(exec => {
    let matches = true;

    if (statusFilter !== 'all' && exec.status !== statusFilter) {
      matches = false;
    }

    if (ruleFilter !== 'all' && exec.automation_rule_id !== ruleFilter) {
      matches = false;
    }

    if (dateRange.start && new Date(exec.created_date) < new Date(dateRange.start)) {
      matches = false;
    }

    if (dateRange.end && new Date(exec.created_date) > new Date(dateRange.end)) {
      matches = false;
    }

    return matches;
  });

  // Calculate statistics
  const stats = {
    total_executions: filteredExecutions.length,
    successful: filteredExecutions.filter(e => e.status === 'completed').length,
    failed: filteredExecutions.filter(e => e.status === 'failed').length,
    partial: filteredExecutions.filter(e => e.status === 'partially_completed').length,
    avg_completion: filteredExecutions.reduce((sum, e) => sum + (e.completion_percentage || 0), 0) / (filteredExecutions.length || 1),
    total_tasks_created: filteredExecutions.reduce((sum, e) => sum + (e.tasks_created?.length || 0), 0),
    total_alerts_created: filteredExecutions.reduce((sum, e) => sum + (e.alerts_created?.length || 0), 0)
  };

  // Status distribution
  const statusDistribution = [
    { name: 'Completed', value: stats.successful },
    { name: 'Failed', value: stats.failed },
    { name: 'Partial', value: stats.partial }
  ].filter(item => item.value > 0);

  // Rule performance
  const rulePerformance = {};
  filteredExecutions.forEach(exec => {
    if (!rulePerformance[exec.rule_name]) {
      rulePerformance[exec.rule_name] = {
        name: exec.rule_name,
        total: 0,
        successful: 0,
        failed: 0
      };
    }
    rulePerformance[exec.rule_name].total++;
    if (exec.status === 'completed') rulePerformance[exec.rule_name].successful++;
    if (exec.status === 'failed') rulePerformance[exec.rule_name].failed++;
  });

  const rulePerformanceData = Object.values(rulePerformance);

  // Daily execution trend
  const dailyTrend = {};
  filteredExecutions.forEach(exec => {
    const date = new Date(exec.created_date).toLocaleDateString();
    if (!dailyTrend[date]) {
      dailyTrend[date] = { date, executions: 0, successful: 0 };
    }
    dailyTrend[date].executions++;
    if (exec.status === 'completed') dailyTrend[date].successful++;
  });

  const trendData = Object.values(dailyTrend)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-14);

  const exportData = () => {
    const csv = toCsvRows([
      ['Date', 'Patient', 'Rule', 'Status', 'Actions', 'Tasks Created', 'Completion %'],
      ...filteredExecutions.map(exec => [
        new Date(exec.created_date).toLocaleDateString(),
        exec.patient_name || 'N/A',
        exec.rule_name,
        exec.status,
        exec.actions_executed?.length || 0,
        exec.tasks_created?.length || 0,
        exec.completion_percentage || 0
      ])
    ]);

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Workflow_Report_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <div className="space-y-6">
      {/* Header & Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-navy-600" />
              Workflow Monitoring Dashboard
            </CardTitle>
            <Button onClick={exportData} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="partially_completed">Partial</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Rule</Label>
              <Select value={ruleFilter} onValueChange={setRuleFilter}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Rules</SelectItem>
                  {automationRules.map(rule => (
                    <SelectItem key={rule.id} value={rule.id}>{rule.rule_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-600 mb-1">Total Executions</p>
            <p className="text-2xl font-bold text-navy-600">{stats.total_executions}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50">
          <CardContent className="p-4">
            <p className="text-xs text-green-600 mb-1">Successful</p>
            <p className="text-2xl font-bold text-green-700">{stats.successful}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50">
          <CardContent className="p-4">
            <p className="text-xs text-red-600 mb-1">Failed</p>
            <p className="text-2xl font-bold text-red-700">{stats.failed}</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50">
          <CardContent className="p-4">
            <p className="text-xs text-blue-600 mb-1">Avg Completion</p>
            <p className="text-2xl font-bold text-blue-700">{stats.avg_completion.toFixed(0)}%</p>
          </CardContent>
        </Card>
        <Card className="bg-orange-50">
          <CardContent className="p-4">
            <p className="text-xs text-orange-600 mb-1">Tasks Created</p>
            <p className="text-2xl font-bold text-orange-700">{stats.total_tasks_created}</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-50">
          <CardContent className="p-4">
            <p className="text-xs text-yellow-600 mb-1">Alerts Created</p>
            <p className="text-2xl font-bold text-yellow-700">{stats.total_alerts_created}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Execution Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Daily Execution Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" angle={-45} textAnchor="end" height={60} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="executions" stroke="#8b5cf6" strokeWidth={2} name="Total" />
                <Line type="monotone" dataKey="successful" stroke="#10b981" strokeWidth={2} name="Successful" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={statusDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#264491"
                  dataKey="value"
                >
                  {statusDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Rule Performance */}
      {rulePerformanceData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Rule Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rulePerformanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-20} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="successful" stackId="a" fill="#10b981" name="Successful" />
                <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Executions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Workflow Executions</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredExecutions.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No workflow executions found</p>
          ) : (
            <div className="space-y-3">
              {filteredExecutions.slice(0, 20).map((exec) => (
                <Card key={exec.id} className="border-l-4 border-l-navy-500">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{exec.rule_name}</p>
                        <p className="text-xs text-slate-600">{exec.patient_name || 'Unknown Patient'}</p>
                        <p className="text-xs text-slate-500 mt-1">{exec.trigger_reason}</p>
                      </div>
                      <div className="text-right">
                        <Badge className={
                          exec.status === 'completed' ? 'bg-green-600' :
                          exec.status === 'failed' ? 'bg-red-600' :
                          exec.status === 'partially_completed' ? 'bg-yellow-600' :
                          'bg-blue-600'
                        }>
                          {exec.status}
                        </Badge>
                        <p className="text-xs text-slate-500 mt-1">
                          {new Date(exec.created_date).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3">
                      <div className="bg-blue-50 p-2 rounded text-center">
                        <p className="text-xs text-blue-600">Actions</p>
                        <p className="text-lg font-bold text-blue-700">{exec.actions_executed?.length || 0}</p>
                      </div>
                      <div className="bg-green-50 p-2 rounded text-center">
                        <p className="text-xs text-green-600">Tasks</p>
                        <p className="text-lg font-bold text-green-700">{exec.tasks_created?.length || 0}</p>
                      </div>
                      <div className="bg-orange-50 p-2 rounded text-center">
                        <p className="text-xs text-orange-600">Alerts</p>
                        <p className="text-lg font-bold text-orange-700">{exec.alerts_created?.length || 0}</p>
                      </div>
                    </div>

                    {exec.outcome_summary && (
                      <p className="text-xs text-slate-600 mt-2 italic">{exec.outcome_summary}</p>
                    )}

                    {exec.execution_time_ms && (
                      <div className="flex items-center gap-1 mt-2">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <p className="text-xs text-slate-500">
                          Executed in {exec.execution_time_ms}ms
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}